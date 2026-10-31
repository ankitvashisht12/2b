// Pick the items and links that the graph draws. No imports, so `node --test` can load this file directly.

export type GraphScope = 'all' | 'work' | 'personal'
type ItemScope = 'work' | 'personal' | 'both' | null
interface SourceItem { id: string; type: string; name: string }
interface SourceRelation { from: string; to: string; kind: string }
export interface GraphSource<T extends SourceItem = SourceItem> {
  items: T[]
  relationships: SourceRelation[]
  byId: Map<string, T>
  scopeOf: Map<string, ItemScope>
}

export interface GraphOptions<T extends SourceItem = SourceItem> {
  scope: GraphScope
  /** Show tags and their links. A tag links to hundreds of items, so the default leaves them out. */
  tags: boolean
  /** Show bulk files: artifacts, evidence, agent runs, archived records. */
  files: boolean
  isBulk: (item: T) => boolean
  /** Local graph: this item and its direct links. */
  focusId?: string
  /** Most items to draw; the best-linked first. */
  limit: number
}

export interface GraphNode { id: string; name: string; type: string; scope: ItemScope; degree: number }
export interface GraphLink { source: string; target: string; kind: string }
export interface GraphSelection {
  nodes: GraphNode[]
  links: GraphLink[]
  /** Items that pass the filters and have at least one link (local graph: the focus and its neighbours). */
  total: number
  totalLinks: number
  /** Neighbours of the focus that only the Tags or Files filter hides. */
  hiddenNeighbors: number
}

const inScope = (itemScope: ItemScope, scope: GraphScope) => scope === 'all' || itemScope === scope || itemScope === 'both'

export function selectGraph<T extends SourceItem>(source: GraphSource<T>, options: GraphOptions<T>): GraphSelection {
  const focusIsTag = options.focusId !== undefined && source.byId.get(options.focusId)?.type === 'tag'
  const showTags = options.tags || focusIsTag
  const visible = (item: T | undefined): item is T =>
    item !== undefined
    && inScope(source.scopeOf.get(item.id) ?? null, options.scope)
    && (showTags || item.type !== 'tag')
    && (options.files || item.id === options.focusId || !options.isBulk(item))

  // One undirected link per pair of items; the first kind wins.
  const pairs = new Map<string, GraphLink>()
  const degree = new Map<string, number>()
  const hiddenNeighbors = new Set<string>()
  for (const relation of source.relationships) {
    if (relation.from === relation.to) continue
    const from = source.byId.get(relation.from)
    const to = source.byId.get(relation.to)
    if (!visible(from) || !visible(to) || (!showTags && relation.kind === 'tagged-with')) {
      const touchesFocus = relation.from === options.focusId || relation.to === options.focusId
      if (touchesFocus && from && to && inScope(source.scopeOf.get(from.id) ?? null, options.scope) && inScope(source.scopeOf.get(to.id) ?? null, options.scope)) hiddenNeighbors.add(relation.from === options.focusId ? to.id : from.id)
      continue
    }
    const key = relation.from < relation.to ? relation.from + '\n' + relation.to : relation.to + '\n' + relation.from
    if (pairs.has(key)) continue
    pairs.set(key, { source: relation.from, target: relation.to, kind: relation.kind })
    degree.set(relation.from, (degree.get(relation.from) ?? 0) + 1)
    degree.set(relation.to, (degree.get(relation.to) ?? 0) + 1)
  }

  let candidates: string[]
  if (options.focusId !== undefined) {
    const neighbors = new Set<string>()
    for (const link of pairs.values()) {
      if (link.source === options.focusId) neighbors.add(link.target)
      else if (link.target === options.focusId) neighbors.add(link.source)
    }
    candidates = neighbors.size ? [options.focusId, ...neighbors] : []
  } else candidates = [...degree.keys()]

  const byDegree = (left: string, right: string) => degree.get(right)! - degree.get(left)! || left.localeCompare(right)
  const focusFirst = options.focusId !== undefined ? candidates.slice(1).sort(byDegree) : candidates.sort(byDegree)
  const kept = new Set(options.focusId !== undefined && candidates.length ? [options.focusId, ...focusFirst.slice(0, options.limit - 1)] : focusFirst.slice(0, options.limit))

  const links = [...pairs.values()].filter(link => kept.has(link.source) && kept.has(link.target))
  // A cut can leave an item with no drawn link; it would only float at the edge, so it goes.
  const drawnDegree = new Map<string, number>()
  for (const link of links) for (const id of [link.source, link.target]) drawnDegree.set(id, (drawnDegree.get(id) ?? 0) + 1)
  const nodes: GraphNode[] = []
  for (const id of kept) {
    if (!drawnDegree.has(id)) continue
    const item = source.byId.get(id)!
    nodes.push({ id, name: item.name, type: item.type, scope: source.scopeOf.get(id) ?? null, degree: degree.get(id) ?? 0 })
  }
  const candidateSet = new Set(candidates)
  const totalLinks = options.focusId !== undefined
    ? [...pairs.values()].filter(link => candidateSet.has(link.source) && candidateSet.has(link.target)).length
    : pairs.size
  return { nodes, links, total: candidates.length, totalLinks, hiddenNeighbors: hiddenNeighbors.size }
}
