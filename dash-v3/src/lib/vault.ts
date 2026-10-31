import { clockTime, dayKey, isDayKey } from '@/lib/dates'

// Wire format of the local 2b API. The API says "object"; the UI says "item".
export interface Item {
  id: string
  type: string
  name: string
  description: string
  properties: Record<string, unknown>
  tags: string[]
  path: string | null
  createdAt: string
  modifiedAt: string
}
export interface Relationship { id: string; from: string; to: string; kind: string; properties?: Record<string, unknown> }
export type PropertyKind = 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'select' | 'relation' | 'json'
export const PROPERTY_KINDS: PropertyKind[] = ['text', 'number', 'boolean', 'date', 'datetime', 'select', 'relation', 'json']
export interface PropertyDefinition { key: string; type: PropertyKind; required?: boolean; options?: string[]; targetType?: string }
export interface TypeDefinition { id: string; name: string; description: string; properties: PropertyDefinition[] }
export interface ActivityEvent {
  id: string
  at: string
  kind: string
  detail: string
  objectId: string
  objectName: string
  projectId: string | null
  projectName: string | null
  tags: string[]
  source: 'log'
}
export interface StatePayload {
  objects: Item[]
  relationships: Relationship[]
  types: TypeDefinition[]
  stats: { objects: number; relationships: number; types: number; files: number }
  root: string
  /** Set by `/api/startup`: only the items Today, Inbox, and Projects need. `stats` still counts the full vault. */
  partial?: boolean
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init.headers } })
  let data: { error?: string } | null = null
  try { data = await response.json() } catch { /* empty or non-JSON body */ }
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`)
  return data as T
}

/** Server messages in the UI's words: "item", not "object", and field labels, not keys. */
export function errorText(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  return text
    .replace(/^Object not found$/, 'This item is not in the vault. The link may be old')
    .replace(/^Unknown object type (.+)$/, 'There is no type “$1”')
    .replace(/^Required property (.+)$/, (_, key: string) => `${fieldLabel(key)} is required`)
    .replace(/^Invalid property (.+)$/, (_, key: string) => `${fieldLabel(key)} has a value that this type does not allow`)
    .replace(/^Relationship endpoint not found$/, 'The linked item is not in the vault')
    .replace(/\bobject\b/g, 'item')
}

// ---------- plain labels ----------

const FIELD_LABELS: Record<string, string> = {
  processingState: 'Inbox state', contentDate: 'Content date', noteType: 'Note type', startsAt: 'Starts at', endsAt: 'Ends at',
  readingState: 'Reading state', dateConfidence: 'Date confidence', completedAt: 'Completed', plannedFor: 'Planned for',
  at: 'Remind at', every: 'Repeats every', timezone: 'Time zone', url: 'Link', aliases: 'Other names', activityAt: 'Edited in 2b',
  sourcePath: 'Source path', sourceVault: 'Source vault', migrationReview: 'Review', statusReason: 'Status reason',
}

const humanize = (key: string) => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** "processingState" reads "Inbox state", "startsAt" reads "Starts at". Raw keys stay on the Types page. */
export const fieldLabel = (key: string) => FIELD_LABELS[key] ?? humanize(key)

const VALUE_LABELS: Record<string, string> = { todo: 'To do', doing: 'In progress', med: 'Medium', inbox: 'In Inbox', 'to-read': 'To read' }

/** Stored choices such as "on-hold" read "On hold". Free text stays as it is. */
export function valueLabel(value: unknown) {
  const text = String(value ?? '')
  return VALUE_LABELS[text] ?? (/^[a-z]+(?:-[a-z]+)*$/.test(text) ? humanize(text) : text)
}

const LINK_LABELS: Record<string, [string, string]> = {
  'part-of': ['Part of', 'Contains'],
  'links-to': ['Links to', 'Linked from'],
  'has-artifact': ['Artifacts', 'Artifact of'],
  'has-attendee': ['Attendees', 'Attended'],
  mentions: ['Mentions', 'Mentioned in'],
  references: ['References', 'Referenced by'],
  'uses-repository': ['Uses repository', 'Used by'],
  'in-area': ['Area', 'In this area'],
  'associated-with': ['Associated with', 'Associated with'],
  'worked-with': ['Worked with', 'Worked with'],
  'tagged-with': ['Tags', 'Tagged items'],
  related: ['Related', 'Related'],
}

/** A link group heading: an outgoing "part-of" reads "Part of", an incoming one reads "Contains". */
export function linkLabel(kind: string, incoming: boolean) {
  const known = LINK_LABELS[kind]
  if (known) return known[incoming ? 1 : 0]
  return incoming ? `${humanize(kind)} (linked from)` : humanize(kind)
}

// ---------- scope ----------

export type Scope = 'all' | 'work' | 'personal'
export type ItemScope = 'work' | 'personal' | 'both' | null
export const SCOPE_LABELS: Record<Scope, string> = { all: 'All', work: 'Work', personal: 'Personal' }
export const inScope = (itemScope: ItemScope, scope: Scope) => scope === 'all' || itemScope === scope || itemScope === 'both'

const TOP_AREA_SCOPE: Record<string, 'work' | 'personal'> = { 'area:work': 'work', 'area:personal': 'personal' }

/** Activity log events still carry Work/Personal as tags. */
export function scopeFrom(tags: string[]): ItemScope {
  const lower = tags.map(tag => tag.toLowerCase())
  return combineScopes([lower.includes('work') ? 'work' : null, lower.includes('personal') ? 'personal' : null])
}

const combineScopes = (scopes: Array<'work' | 'personal' | null>): ItemScope =>
  scopes.includes('work') && scopes.includes('personal') ? 'both' : scopes.find(Boolean) ?? null

// ---------- item facts ----------

const CLOSED_TASK_STATES = new Set(['done', 'dropped', 'archived', 'completed'])
// Files and records that arrive in bulk. Lists fold them so they do not hide notes and tasks.
const BULK_TYPES = new Set(['artifact', 'evidence', 'agent-run'])

export const isImported = (item: Item) => item.id.startsWith('import-') || Boolean(item.properties.sourcePath)
export const isBulk = (item: Item) => BULK_TYPES.has(item.type) || item.properties.archived === true
export const statusOf = (item: Item) => String(item.properties.status ?? item.properties.readingState ?? '')
export const isOpenTask = (item: Item) => item.type === 'task' && !CLOSED_TASK_STATES.has(statusOf(item).toLowerCase())
export const isInbox = (item: Item) => item.properties.processingState === 'inbox'
/** An imported reminder or agent job stays disabled until someone reviews it from the CLI. */
export const isPendingReview = (item: Item) => item.properties.migrationReview === 'pending'
/** Imported schedules wait for review, and 2b V3 never claims a reminder or agent job runs. */
export const isDisabledSchedule = (item: Item) =>
  isPendingReview(item) || (['reminder', 'agent-job'].includes(item.type) && item.properties.enabled !== true)
export function projectKind(item: Item) {
  const kind = item.properties.kind || (item.properties.projectKind !== 'unspecified' ? item.properties.projectKind : '')
  return typeof kind === 'string' ? kind : ''
}

/** Source timestamps drive history for imported items; import time never counts as activity. */
export function createdAt(item: Item) {
  return isImported(item) ? String(item.properties.sourceCreatedAt || item.createdAt) : item.createdAt
}

const TYPE_LABELS: Record<string, [string, string]> = {
  project: ['Project', 'Projects'],
  task: ['Task', 'Tasks'],
  note: ['Note', 'Notes'],
  collection: ['Collection', 'Collections'],
  person: ['Person', 'People'],
  book: ['Book', 'Books'],
  organization: ['Organization', 'Organizations'],
  repository: ['Repository', 'Repositories'],
  area: ['Area', 'Areas'],
  meeting: ['Meeting', 'Meetings'],
  artifact: ['Artifact', 'Artifacts'],
  evidence: ['Evidence', 'Evidence'],
  tag: ['Tag', 'Tags'],
  reminder: ['Reminder', 'Reminders'],
  'agent-job': ['Agent job', 'Agent jobs'],
  'agent-run': ['Agent run', 'Agent runs'],
  automation: ['Automation', 'Automations'],
}

export function typeLabel(vault: Vault | null, typeId: string, plural = false) {
  const known = TYPE_LABELS[typeId]
  if (known) return known[plural ? 1 : 0]
  const name = vault?.typeById.get(typeId)?.name || typeId
  const title = name.charAt(0).toUpperCase() + name.slice(1)
  // ponytail: plural by adding "s"; an irregular custom type name reads slightly off.
  return plural && !title.endsWith('s') ? title + 's' : title
}

// ---------- index ----------

export type HistoryKind = 'created' | 'changed' | 'edited' | 'completed' | 'dated'
/** What happened to one item on one day, from its stored dates. */
export interface HistoryEntry { itemId: string; day: string; time: string | null; at: number; kinds: HistoryKind[] }
export type ScheduleKind = 'due' | 'meeting' | 'reminder' | 'planned'
export interface ScheduleEntry { itemId: string; day: string; time: string | null; kind: ScheduleKind }

export interface Vault {
  items: Item[]
  byId: Map<string, Item>
  byPath: Map<string, Item>
  byName: Map<string, Item[]>
  relationships: Relationship[]
  outgoing: Map<string, Relationship[]>
  incoming: Map<string, Relationship[]>
  types: TypeDefinition[]
  typeById: Map<string, TypeDefinition>
  scopeOf: Map<string, ItemScope>
  ownScopeOf: Map<string, ItemScope>
  parentOf: Map<string, string>
  projectOf: Map<string, string>
  searchText: Map<string, string>
  createdTime: Map<string, number>
  changedTime: Map<string, number>
  history: Map<string, HistoryEntry[]>
  schedule: Map<string, ScheduleEntry[]>
  stats: StatePayload['stats']
  root: string
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

const MINUTE = 60_000

function historyMoments(item: Item): Array<[HistoryKind, string]> {
  const created = createdAt(item)
  const createdTime = Date.parse(created)
  const later = (value: unknown): value is string => typeof value === 'string' && Date.parse(value) - createdTime > MINUTE
  const moments: Array<[HistoryKind, string]> = [['created', created]]
  if (isImported(item) && later(item.properties.sourceModifiedAt)) moments.push(['changed', item.properties.sourceModifiedAt])
  if (later(item.properties.activityAt)) moments.push(['edited', item.properties.activityAt])
  if (typeof item.properties.completedAt === 'string') moments.push(['completed', item.properties.completedAt])
  if (isDayKey(item.properties.contentDate)) moments.push(['dated', item.properties.contentDate])
  return moments
}

function scheduleMoments(item: Item): Array<[ScheduleKind, unknown]> {
  const moments: Array<[ScheduleKind, unknown]> = []
  if (item.type === 'task' && item.properties.due) moments.push(['due', item.properties.due])
  if (item.type === 'meeting' && item.properties.startsAt) moments.push(['meeting', item.properties.startsAt])
  if (item.type === 'reminder' && item.properties.at) moments.push(['reminder', item.properties.at])
  if (item.properties.plannedFor) moments.push(['planned', item.properties.plannedFor])
  return moments
}

export function buildVault(state: StatePayload): Vault {
  const items = state.objects
  const byId = new Map<string, Item>()
  const byPath = new Map<string, Item>()
  const byName = new Map<string, Item[]>()
  for (const item of items) {
    byId.set(item.id, item)
    if (item.path) byPath.set(item.path, item)
    push(byName, item.name.toLowerCase(), item)
  }

  const outgoing = new Map<string, Relationship[]>()
  const incoming = new Map<string, Relationship[]>()
  const parentOf = new Map<string, string>()
  for (const relation of state.relationships) {
    push(outgoing, relation.from, relation)
    push(incoming, relation.to, relation)
    if (relation.kind === 'part-of' && !parentOf.has(relation.from)) parentOf.set(relation.from, relation.to)
  }
  for (const relation of state.relationships) {
    if (relation.kind === 'has-artifact' && !parentOf.has(relation.to)) parentOf.set(relation.to, relation.from)
  }

  const projectOf = new Map<string, string>()
  for (const item of items) {
    let current = parentOf.get(item.id)
    for (let step = 0; current && step < 4; step++) {
      if (byId.get(current)?.type === 'project') {
        projectOf.set(item.id, current)
        break
      }
      current = parentOf.get(current)
    }
  }

  // Areas: a sub-area reaches Work or Personal through its part-of chain.
  const topAreaOf = (areaId: string) => {
    let current: string | undefined = areaId
    for (let step = 0; current && step < 6; step++) {
      if (TOP_AREA_SCOPE[current]) return TOP_AREA_SCOPE[current]
      current = parentOf.get(current)
    }
    return null
  }
  // An item's own scope: a direct Work/Personal link wins (a Career collection can be Work);
  // otherwise its sub-area links decide. Without either, it takes its nearest parent's scope.
  const ownScopeOf = new Map<string, ItemScope>()
  for (const item of items) {
    const areas = item.type === 'area' ? [item.id] : (outgoing.get(item.id) ?? []).filter(relation => relation.kind === 'in-area').map(relation => relation.to)
    const direct = areas.filter(area => TOP_AREA_SCOPE[area])
    ownScopeOf.set(item.id, combineScopes((direct.length ? direct : areas).map(topAreaOf)))
  }
  const scopeOf = new Map<string, ItemScope>()
  for (const item of items) {
    let current: string | undefined = item.id
    for (let step = 0; current && step < 6 && !scopeOf.get(item.id); step++) {
      scopeOf.set(item.id, ownScopeOf.get(current) ?? null)
      current = parentOf.get(current)
    }
  }

  const typeById = new Map(state.types.map(type => [type.id, type]))
  const partial = { typeById } as Vault
  const searchText = new Map<string, string>()
  const createdTime = new Map<string, number>()
  const changedTime = new Map<string, number>()
  const history = new Map<string, HistoryEntry[]>()
  const schedule = new Map<string, ScheduleEntry[]>()
  for (const item of items) {
    searchText.set(item.id, [item.name, item.description, typeLabel(partial, item.type), item.tags.join(' '), item.path ?? '', String(item.properties.sourcePath ?? '')].join(' ').toLowerCase())
    const moments = historyMoments(item)
    const times = moments.filter(([, value]) => !isDayKey(value)).map(([, value]) => Date.parse(value)).filter(Number.isFinite)
    createdTime.set(item.id, times[0] ?? 0)
    changedTime.set(item.id, times.length ? Math.max(...times) : 0)
    if (item.type !== 'tag') {
      const byDay = new Map<string, Array<[HistoryKind, string]>>()
      for (const moment of moments) {
        const day = dayKey(moment[1])
        if (day) push(byDay, day, moment)
      }
      for (const [day, dayMoments] of byDay) {
        const timed = dayMoments.filter(([, value]) => !isDayKey(value)).sort((left, right) => Date.parse(left[1]) - Date.parse(right[1]))
        const last = timed.at(-1)
        const kinds = [...new Set([...timed, ...dayMoments.filter(([, value]) => isDayKey(value))].map(([kind]) => kind))]
        push(history, day, { itemId: item.id, day, time: last ? clockTime(last[1]) : null, at: last ? Date.parse(last[1]) : 0, kinds })
      }
    }
    for (const [kind, value] of scheduleMoments(item)) {
      const day = dayKey(value)
      if (day) push(schedule, day, { itemId: item.id, day, time: clockTime(value), kind })
    }
  }

  return {
    items, byId, byPath, byName,
    relationships: state.relationships, outgoing, incoming,
    types: state.types, typeById,
    scopeOf, ownScopeOf, parentOf, projectOf, searchText, createdTime, changedTime, history, schedule,
    stats: state.stats, root: state.root,
  }
}

export const itemScope = (vault: Vault, id: string | null | undefined): ItemScope => (id ? vault.scopeOf.get(id) ?? null : null)

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function searchItems(vault: Vault, query: string, scope: Scope, limit = 50) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return { items: [] as Item[], total: 0, otherScopes: 0 }
  const wordStarts = terms.map(term => new RegExp('(?:^|[^\\p{L}\\p{N}])' + escapeRegExp(term), 'u'))
  const matches: Array<[number, Item]> = []
  let otherScopes = 0
  for (const item of vault.items) {
    const text = vault.searchText.get(item.id) ?? ''
    if (!terms.every(term => text.includes(term))) continue
    if (!inScope(itemScope(vault, item.id), scope)) {
      otherScopes++
      continue
    }
    const name = item.name.toLowerCase()
    // A match at the start of a word ranks above a match inside a word: "avi" finds "Avi" before "navigation".
    const nameRank = name === terms.join(' ') ? 0 : name.startsWith(terms[0]) ? 1
      : wordStarts.every(pattern => pattern.test(name)) ? 2
        : terms.every(term => name.includes(term)) ? 3
          : wordStarts.every(pattern => pattern.test(text)) ? 4 : 5
    matches.push([nameRank * 2 + (isBulk(item) ? 1 : 0), item])
  }
  matches.sort((left, right) => left[0] - right[0] || (vault.changedTime.get(right[1].id) ?? 0) - (vault.changedTime.get(left[1].id) ?? 0))
  return { items: matches.slice(0, limit).map(([, item]) => item), total: matches.length, otherScopes }
}

export const byRecent = (vault: Vault) => (left: Item, right: Item) => (vault.changedTime.get(right.id) ?? 0) - (vault.changedTime.get(left.id) ?? 0)

export function countBy<T>(values: T[], keysOf: (value: T) => string[]) {
  const counts = new Map<string, number>()
  for (const value of values) for (const key of keysOf(value)) counts.set(key, (counts.get(key) ?? 0) + 1)
  return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
}

export const splitTags = (value: string) => [...new Set(value.split(',').map(tag => tag.trim().replace(/^#/, '')).filter(Boolean))]
