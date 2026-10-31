import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d'
import { MaximizeIcon, MinusIcon, PauseIcon, PlayIcon, PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Input } from '@/components/ui/input'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Hint, ScopeDot, TypeIcon } from '@/components/item-bits'
import { EmptyState, PageHeader } from '@/components/page'
import { selectGraph, type GraphNode } from '@/lib/graph-data'
import { itemHref } from '@/lib/markdown'
import { navigate, withQuery, type Route } from '@/lib/router'
import { useScope, useVault } from '@/lib/store'
import { inScope, isBulk, SCOPE_LABELS, typeLabel, type ItemScope } from '@/lib/vault'

// The simulation moves these objects. They hold only an id and a position, never a vault record,
// and they live for this browser tab only: nothing about the layout is saved.
type SimNode = NodeObject<{ id: string }>
type SimLink = LinkObject<{ id: string }, { kind: string }>
const positions = new Map<string, SimNode>()

const LIMITS = [300, 1000, Infinity] as const
const LIST_LIMIT = 60
const endId = (end: SimLink['source']) => (typeof end === 'object' ? String(end.id) : String(end))
const radius = (degree: number) => 2.5 + Math.min(10, Math.sqrt(degree) * 1.2)
const shortName = (name: string) => (name.length > 28 ? name.slice(0, 27) + '…' : name)
const graphHash = (id?: string) => (id ? '#graph/' + encodeURIComponent(id) : '#graph')

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
const useReducedMotion = () => useSyncExternalStore(
  listener => { reducedMotionQuery.addEventListener('change', listener); return () => reducedMotionQuery.removeEventListener('change', listener) },
  () => reducedMotionQuery.matches,
)

/** Canvas colours from the CSS tokens; they change with the light or dark setting. */
function useCanvasColors() {
  const read = () => {
    const style = getComputedStyle(document.documentElement)
    const token = (name: string) => style.getPropertyValue(name).trim()
    return { foreground: token('--foreground'), background: token('--background'), muted: token('--muted-foreground'), link: token('--link'), work: token('--work'), personal: token('--personal') }
  }
  const [colors, setColors] = useState(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return colors
}
// Tokens are oklch(); this adds an alpha channel.
const withAlpha = (color: string, alpha: number) => color.replace(/\)$/, ` / ${alpha})`)

export function GraphView({ route }: { route: Route }) {
  const vault = useVault()
  const [scope, setScope] = useScope()
  const focusId = route.param || undefined
  const focus = focusId ? vault.byId.get(focusId) : undefined
  const tags = route.query.get('tags') === '1'
  const files = route.query.get('files') === '1'
  const limitParam = route.query.get('limit')
  const limit = limitParam === 'all' ? Infinity : LIMITS.find(value => String(value) === limitParam) ?? (focusId ? 300 : 1000)
  const setOption = (changes: Record<string, string | null>) => {
    const current = { tags: tags ? '1' : null, files: files ? '1' : null, limit: limitParam }
    navigate(withQuery(graphHash(focusId), { ...current, ...changes }), { replace: true })
  }

  const graph = useMemo(
    () => selectGraph(vault, { scope, tags, files, isBulk, focusId: focus?.id, limit }),
    [vault, scope, tags, files, focus, limit],
  )

  const header = (description: string) => (
    <PageHeader
      title={focus ? focus.name : 'Graph'}
      description={description}
      actions={focus && (
        <>
          <Button variant="outline" asChild><a href={itemHref(focus.id)}>Open {typeLabel(vault, focus.type).toLowerCase()}</a></Button>
          <Button variant="ghost" asChild><a href={withQuery('#graph', { tags: tags ? '1' : null, files: files ? '1' : null })}>Whole graph</a></Button>
        </>
      )}
    />
  )

  if (focusId && !focus) {
    return (
      <div className="max-w-3xl">
        {header('This item is not in the vault. The link may be old.')}
        <EmptyState title="Nothing to show" description="Open the whole graph, or search for the item."><Button variant="outline" asChild><a href="#graph">Whole graph</a></Button></EmptyState>
      </div>
    )
  }
  if (focus && !inScope(vault.scopeOf.get(focus.id) ?? null, scope)) {
    return (
      <div className="max-w-3xl">
        {header(`This item is outside ${SCOPE_LABELS[scope]}.`)}
        <EmptyState title={`Not in ${SCOPE_LABELS[scope]}`} description={`The scope switch shows ${SCOPE_LABELS[scope]} items only. Show all scopes to see the links of this item.`}>
          <Button variant="outline" onClick={() => setScope('all')}>Show all scopes</Button>
          <Button variant="ghost" asChild><a href="#graph">Whole graph</a></Button>
        </EmptyState>
      </div>
    )
  }
  if (!graph.nodes.length) {
    const hidden = graph.hiddenNeighbors
    return (
      <div className="max-w-3xl">
        {header(focus ? 'No links to show.' : 'No links to show.')}
        <EmptyState
          title="No links yet"
          description={hidden ? `${hidden.toLocaleString('en-IN')} linked ${hidden === 1 ? 'item is a tag or a file' : 'items are tags or files'}. Show them, or add a link on the item page.`
            : scope !== 'all' ? `No linked items in ${SCOPE_LABELS[scope]}.` : 'Open an item and link it to another item.'}
        >
          {hidden > 0 && <Button variant="outline" onClick={() => setOption({ tags: '1', files: '1' })}>Show tags and files</Button>}
          {scope !== 'all' && <Button variant="outline" onClick={() => setScope('all')}>Show all scopes</Button>}
          {focus && <Button variant="ghost" asChild><a href="#graph">Whole graph</a></Button>}
        </EmptyState>
      </div>
    )
  }

  const count = (value: number) => value.toLocaleString('en-IN')
  const drawn = graph.nodes.length < graph.total ? `${count(graph.nodes.length)} of ${count(graph.total)}` : count(graph.nodes.length)
  const description = focus
    ? `${drawn} items: this ${typeLabel(vault, focus.type).toLowerCase()} and its links, with the links between them.`
    : `${drawn} linked items, ${count(graph.links.length)} links.${tags || files ? '' : ' Tags and files are hidden.'}`

  return (
    <div className="flex flex-col md:h-[calc(100svh-7rem)]">
      {header(description)}
      <GraphWorkspace
        graph={graph}
        focusId={focus?.id}
        options={
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Graph filters">
            <Toggle variant="outline" size="sm" pressed={tags} onPressedChange={value => setOption({ tags: value ? '1' : null })}>Tags</Toggle>
            <Toggle variant="outline" size="sm" pressed={files} onPressedChange={value => setOption({ files: value ? '1' : null })}>Files</Toggle>
            {graph.total > LIMITS[0] && (
              <ToggleGroup type="single" size="sm" variant="outline" value={limit === Infinity ? 'all' : String(limit)} onValueChange={value => value && setOption({ limit: value })} aria-label="Most items to draw">
                {LIMITS.filter(value => value === Infinity || value < graph.total).map(value => (
                  <ToggleGroupItem key={value} value={value === Infinity ? 'all' : String(value)} className="tabular-nums">{value === Infinity ? 'All' : count(value)}</ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          </div>
        }
      />
    </div>
  )
}

interface WorkspaceProps { graph: ReturnType<typeof selectGraph>; focusId?: string; options: React.ReactNode }

function GraphWorkspace({ graph, focusId, options }: WorkspaceProps) {
  const vault = useVault()
  const colors = useCanvasColors()
  const reducedMotion = useReducedMotion()
  const graphRef = useRef<ForceGraphMethods<SimNode, SimLink>>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null)
  // `running`: the layout moves now. `paused`: the user stopped it, and every item stays where it is.
  const [running, setRunning] = useState(!reducedMotion)
  const [paused, setPaused] = useState(false)
  const [query, setQuery] = useState('')
  const cameraMoved = useRef(false)
  const labelQueue = useRef<Array<{ x: number; y: number; text: string; rank: number; degree: number; bold: boolean }>>([])
  const labelCount = useRef(0)
  const fitted = useRef(false)

  const infoById = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph])
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const link of graph.links) {
      for (const [from, to] of [[link.source, link.target], [link.target, link.source]]) {
        const set = map.get(from) ?? new Set()
        set.add(to)
        map.set(from, set)
      }
    }
    return map
  }, [graph])
  // Labels always show for the best-linked dozen; the rest appear on zoom or hover.
  const hubs = useMemo(() => new Set([...graph.nodes].sort((left, right) => right.degree - left.degree).slice(0, 12).map(node => node.id)), [graph])

  // New simulation input only when the drawn items change. Hover and selection never restart the layout.
  // Known items keep their place; a new item starts next to a placed neighbour.
  const graphData = useMemo(() => {
    const nodes = graph.nodes.map(node => {
      let sim = positions.get(node.id)
      if (!sim) {
        sim = { id: node.id }
        const placed = [...(neighbors.get(node.id) ?? [])].map(id => positions.get(id)).find(other => other?.x !== undefined)
        if (placed) { sim.x = placed.x! + (Math.random() - 0.5) * 30; sim.y = placed.y! + (Math.random() - 0.5) * 30 }
        positions.set(node.id, sim)
      }
      return sim
    })
    const links: SimLink[] = graph.links.map(link => ({ source: link.source, target: link.target, kind: link.kind }))
    return { nodes, links }
  }, [graph, neighbors])
  useEffect(() => { setRunning(!reducedMotion && !paused) }, [graphData]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const fg = graphRef.current
    if (!fg) return
    fg.d3Force('charge')?.strength(-40).distanceMax(360)
    fg.d3Force('link')?.distance(34)
  }, [size.width > 0])

  // A hidden tab draws nothing.
  useEffect(() => {
    const onVisibility = () => (document.hidden ? graphRef.current?.pauseAnimation() : graphRef.current?.resumeAnimation())
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const motion = reducedMotion ? 0 : 250
  const fit = useCallback((duration: number) => graphRef.current?.zoomToFit(duration, 48), [])
  // Quick presses add up: each step starts from the zoom the last press asked for, not from the middle of its transition.
  const zoomTarget = useRef({ value: 1, until: 0 })
  const zoomTo = (value: number) => {
    graphRef.current?.zoom(value, motion)
    zoomTarget.current = { value, until: performance.now() + motion }
  }
  const zoomBy = (factor: number) => {
    const fg = graphRef.current
    if (!fg) return
    const from = performance.now() < zoomTarget.current.until ? zoomTarget.current.value : fg.zoom()
    zoomTo(Math.min(8, Math.max(0.05, from * factor)))
  }
  const select = (id: string | null, center = false) => {
    setSelectedId(id)
    const sim = id ? positions.get(id) : undefined
    const fg = graphRef.current
    if (center && fg && sim?.x !== undefined) {
      cameraMoved.current = true
      fg.centerAt(sim.x, sim.y, motion)
      if (fg.zoom() < 1.5) zoomTo(1.5)
    }
  }
  // Stop pins every item where it is. Run lets them go and starts the layout again, also with reduced motion:
  // the user asked for the movement.
  const toggleLayout = () => {
    const fg = graphRef.current
    if (!fg) return
    if (running) {
      for (const node of graphData.nodes) { node.fx = node.x; node.fy = node.y }
      setPaused(true)
      setRunning(false)
    } else {
      for (const node of graphData.nodes) { node.fx = undefined; node.fy = undefined }
      setPaused(false)
      setRunning(true)
      fg.d3ReheatSimulation()
    }
  }

  // Test hook: screen position of an item, the zoom level, and whether the layout runs. Read-only.
  useEffect(() => {
    const element = containerRef.current as (HTMLDivElement & { graphProbe?: unknown }) | null
    if (!element) return
    element.graphProbe = {
      screen: (id: string) => { const sim = positions.get(id); return sim?.x !== undefined ? graphRef.current?.graph2ScreenCoords(sim.x, sim.y!) : null },
      zoom: () => graphRef.current?.zoom(),
      labels: () => labelCount.current,
    }
  }, [])

  const activeId = hoveredId ?? selectedId
  const highlighted = useMemo(() => (activeId ? new Set([activeId, ...(neighbors.get(activeId) ?? [])]) : null), [activeId, neighbors])

  const paintNode = useCallback((node: SimNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const info = infoById.get(String(node.id))
    if (!info || node.x === undefined || node.y === undefined) return
    const r = radius(info.degree)
    const dim = highlighted !== null && !highlighted.has(info.id)
    ctx.globalAlpha = dim ? 0.15 : 1
    paintDot(ctx, node.x, node.y, r, info.scope, colors)
    if (info.id === selectedId || info.id === hoveredId || info.id === focusId) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, r + 2.5 / scale, 0, Math.PI * 2)
      ctx.strokeStyle = info.id === selectedId ? colors.foreground : colors.link
      ctx.lineWidth = (info.id === selectedId ? 2 : 1.5) / scale
      ctx.stroke()
    }
    // Labels are collected here and drawn after all dots, best first, within a screen budget.
    if (dim) return
    const always = info.id === activeId || info.id === selectedId || info.id === focusId
    const rank = always ? 0 : highlighted?.has(info.id) ? 1 : hubs.has(info.id) ? 2 : 3
    labelQueue.current.push({ x: node.x, y: node.y + r + 3 / scale, text: shortName(info.name), rank, degree: info.degree, bold: info.id === activeId })
    ctx.globalAlpha = 1
    ctx.globalAlpha = 1
  }, [infoById, highlighted, selectedId, hoveredId, focusId, activeId, hubs, colors])

  // The budget follows how many dots are on screen: a dozen labels over a dense cloud, all of them for a few dots.
  // Two labels never overlap. The selected, hovered, and focus labels always show.
  const paintLabels = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const queue = labelQueue.current.sort((left, right) => left.rank - right.rank || right.degree - left.degree)
    const matrix = ctx.getTransform()
    const onScreen = (x: number, y: number) => {
      const screenX = matrix.a * x + matrix.e, screenY = matrix.d * y + matrix.f
      return screenX >= 0 && screenX <= ctx.canvas.width && screenY >= 0 && screenY <= ctx.canvas.height
    }
    let visibleDots = 0
    for (const node of graphData.nodes) if (node.x !== undefined && onScreen(node.x, node.y!)) visibleDots++
    const budget = visibleDots > 150 ? 12 : visibleDots > 50 ? 30 : 120
    const placed: Array<[number, number, number, number]> = []
    const fontSize = 12 / scale
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.lineWidth = 3 / scale
    ctx.lineJoin = 'round'
    let optional = 0
    for (const label of queue) {
      if (label.rank > 0 && optional >= budget) break
      ctx.font = `${label.bold ? 600 : 400} ${fontSize}px system-ui, -apple-system, sans-serif`
      const halfWidth = (ctx.measureText(label.text).width / 2) * matrix.a
      const left = matrix.a * label.x + matrix.e - halfWidth, top = matrix.d * label.y + matrix.f
      const box: [number, number, number, number] = [left - 4, top - 2, left + halfWidth * 2 + 4, top + fontSize * matrix.d + 2]
      if (label.rank > 0) {
        if (!onScreen(label.x, label.y)) continue
        if (placed.some(other => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1])) continue
        optional++
      }
      placed.push(box)
      ctx.strokeStyle = colors.background
      ctx.strokeText(label.text, label.x, label.y)
      ctx.fillStyle = colors.foreground
      ctx.fillText(label.text, label.x, label.y)
    }
    labelCount.current = placed.length
  }, [colors, graphData])

  const paintHitArea = useCallback((node: SimNode, color: string, ctx: CanvasRenderingContext2D, scale: number) => {
    const info = infoById.get(String(node.id))
    if (!info || node.x === undefined || node.y === undefined) return
    ctx.fillStyle = color
    ctx.beginPath()
    // At least 8 screen pixels, so small dots are easy to hit with a finger.
    ctx.arc(node.x, node.y, Math.max(radius(info.degree), 8 / scale), 0, Math.PI * 2)
    ctx.fill()
  }, [infoById])

  const touchesActive = (link: SimLink) => activeId !== null && (endId(link.source) === activeId || endId(link.target) === activeId)
  const linkColor = useCallback((link: SimLink) => (touchesActive(link) ? colors.link : withAlpha(colors.muted, highlighted ? 0.08 : 0.3)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId, highlighted, colors])
  const linkWidth = useCallback((link: SimLink) => (touchesActive(link) ? 1.6 : 0.7),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId])

  const selected = selectedId ? infoById.get(selectedId) : undefined
  const typed = query.trim().toLowerCase()
  const matches = useMemo(() => {
    const list = typed ? graph.nodes.filter(node => node.name.toLowerCase().includes(typed)) : graph.nodes
    return [...list].sort((left, right) => right.degree - left.degree)
  }, [graph, typed])
  const linkedToSelected = selected ? [...(neighbors.get(selected.id) ?? [])].map(id => infoById.get(id)!).sort((left, right) => right.degree - left.degree) : []

  return (
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
      <div
        ref={containerRef}
        data-graph-canvas
        data-layout={running ? 'running' : 'stopped'}
        className="graph-canvas relative h-[62svh] min-h-80 min-w-0 overflow-hidden rounded-lg border bg-background md:h-auto"
        onPointerDown={() => { cameraMoved.current = true }}
        onWheel={() => { cameraMoved.current = true }}
      >
        {size.width > 0 && (
          <ForceGraph2D<{ id: string }, { kind: string }>
            ref={graphRef}
            width={size.width}
            height={size.height}
            graphData={graphData}
            backgroundColor="rgba(0,0,0,0)"
            nodeLabel={() => ''}
            nodeRelSize={1}
            nodeVal={node => radius(infoById.get(String(node.id))?.degree ?? 0) ** 2}
            nodeCanvasObject={paintNode}
            nodePointerAreaPaint={paintHitArea}
            onRenderFramePre={() => { labelQueue.current = [] }}
            onRenderFramePost={paintLabels}
            linkColor={linkColor}
            linkWidth={linkWidth}
            minZoom={0.05}
            maxZoom={8}
            // Reduced motion: work the layout out before the first paint and never move it after.
            warmupTicks={reducedMotion ? Math.min(300, Math.ceil(150_000 / graphData.nodes.length)) : 20}
            cooldownTicks={running ? 220 : reducedMotion || paused ? 0 : 220}
            cooldownTime={6000}
            d3AlphaDecay={0.035}
            d3VelocityDecay={0.35}
            onEngineTick={() => {
              if (!fitted.current) { fitted.current = true; fit(0) }
            }}
            onEngineStop={() => {
              setRunning(false)
              if (!cameraMoved.current) { cameraMoved.current = true; fit(motion) }
            }}
            onNodeHover={node => setHoveredId(node ? String(node.id) : null)}
            onNodeClick={node => select(String(node.id))}
            onBackgroundClick={() => select(null)}
            onNodeDrag={() => { if (!running && !reducedMotion && !paused) setRunning(true) }}
          />
        )}
        <ButtonGroup className="absolute top-2 left-2" aria-label="Graph view">
          <Hint label="Zoom in"><Button variant="outline" size="icon" aria-label="Zoom in" onClick={() => zoomBy(1.5)}><PlusIcon /></Button></Hint>
          <Hint label="Zoom out"><Button variant="outline" size="icon" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.5)}><MinusIcon /></Button></Hint>
          <Hint label="Fit to view"><Button variant="outline" size="icon" aria-label="Fit to view" onClick={() => { cameraMoved.current = true; fit(motion) }}><MaximizeIcon /></Button></Hint>
          <Hint label={running ? 'Stop the layout' : 'Run the layout again'}>
            <Button variant="outline" size="icon" aria-label={running ? 'Stop the layout' : 'Run the layout again'} onClick={toggleLayout}>{running ? <PauseIcon /> : <PlayIcon />}</Button>
          </Hint>
        </ButtonGroup>
        <ul className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-background/85 px-2 py-1 text-xs text-muted-foreground" aria-label="Colours">
          {([['work', 'Work'], ['personal', 'Personal'], ['both', 'Both'], ['none', 'No scope']] as const).map(([value, label]) => (
            <li key={value} className="flex items-center gap-1.5"><span className="scope-dot size-2 rounded-full" data-scope={value} aria-hidden="true" />{label}</li>
          ))}
        </ul>
      </div>

      <aside className="flex min-h-0 min-w-0 flex-col gap-4" aria-label="Graph details">
        {options}
        {selected && (
          <section aria-label="Selected item" className="rounded-lg border p-3">
            <h2 className="text-sm leading-snug font-semibold">{selected.name}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <TypeIcon type={selected.type} className="size-3.5" />
              {typeLabel(vault, selected.type)}
              <ScopeDot scope={selected.scope} />
              <span className="tabular-nums">· {selected.degree.toLocaleString('en-IN')} {selected.degree === 1 ? 'link' : 'links'}</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" asChild><a href={itemHref(selected.id)}>Open item</a></Button>
              {selected.id !== focusId && <Button size="sm" variant="ghost" asChild><a href={graphHash(selected.id)}>Show its links</a></Button>}
            </div>
            {linkedToSelected.length > 0 && (
              <>
                <h3 className="mt-3 text-xs font-medium text-muted-foreground">Linked here ({linkedToSelected.length.toLocaleString('en-IN')})</h3>
                <ul className="mt-1 max-h-40 overflow-y-auto">
                  {linkedToSelected.slice(0, LIST_LIMIT).map(node => <NodeButton key={node.id} node={node} onSelect={() => select(node.id, true)} />)}
                </ul>
              </>
            )}
          </section>
        )}
        <section aria-label="Items in this graph" className="flex min-h-0 flex-1 flex-col">
          <Input type="search" placeholder="Find in graph" aria-label="Find an item in the graph" value={query} onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && matches[0]) select(matches[0].id, true) }} />
          <p className="mt-2 text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {typed ? `${matches.length.toLocaleString('en-IN')} matching` : 'Most linked first'}{matches.length > LIST_LIMIT ? `; ${LIST_LIMIT} shown, type to narrow` : ''}
          </p>
          <ul className="mt-1 min-h-0 flex-1 overflow-y-auto">
            {matches.slice(0, LIST_LIMIT).map(node => <NodeButton key={node.id} node={node} selected={node.id === selectedId} onSelect={() => select(node.id, true)} />)}
          </ul>
        </section>
      </aside>
    </div>
  )
}

function NodeButton({ node, selected = false, onSelect }: { node: GraphNode; selected?: boolean; onSelect: () => void }) {
  return (
    <li>
      <button type="button" aria-pressed={selected} onClick={onSelect}
        className="graph-list-item flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:font-medium">
        <TypeIcon type={node.type} className="size-3.5" />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{node.degree.toLocaleString('en-IN')}</span>
      </button>
    </li>
  )
}

function paintDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, scope: ItemScope, colors: ReturnType<typeof useCanvasColors>) {
  if (scope === 'both') {
    ctx.fillStyle = colors.work
    ctx.beginPath(); ctx.arc(x, y, r, Math.PI / 2, Math.PI * 1.5); ctx.fill()
    ctx.fillStyle = colors.personal
    ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2); ctx.fill()
    return
  }
  ctx.fillStyle = scope === 'work' ? colors.work : scope === 'personal' ? colors.personal : withAlpha(colors.muted, 0.55)
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}
