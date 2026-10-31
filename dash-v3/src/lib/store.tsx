import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { addDays, dayKey, todayKey } from '@/lib/dates'
import { api, buildVault, errorText, type ActivityEvent, type Item, type Relationship, type Scope, type StatePayload, type TypeDefinition, type Vault } from '@/lib/vault'

// ---------- vault ----------

// The first request reads only the items Today, Inbox, and Projects need (`/api/startup`).
// The full vault loads after the first paint. Local changes made while it loads are kept in a journal
// and applied again on top of the late snapshot, so a slow response never undoes an edit.
type Change =
  | { kind: 'item'; item: Item }
  | { kind: 'relate'; relation: Relationship }
  | { kind: 'unrelate'; id: string }
  | { kind: 'type'; type: TypeDefinition }

export function applyChange(state: StatePayload, change: Change): StatePayload {
  const stats = state.stats
  switch (change.kind) {
    case 'item': {
      const index = state.objects.findIndex(existing => existing.id === change.item.id)
      if (index < 0) return { ...state, objects: [...state.objects, change.item], stats: { ...stats, objects: stats.objects + 1 } }
      return { ...state, objects: state.objects.with(index, change.item) }
    }
    case 'relate':
      if (state.relationships.some(existing => existing.id === change.relation.id)) return state
      return { ...state, relationships: [...state.relationships, change.relation], stats: { ...stats, relationships: stats.relationships + 1 } }
    case 'unrelate': {
      const relationships = state.relationships.filter(relation => relation.id !== change.id)
      return relationships.length === state.relationships.length ? state : { ...state, relationships, stats: { ...stats, relationships: stats.relationships - 1 } }
    }
    case 'type': {
      const types = [...state.types.filter(existing => existing.id !== change.type.id), change.type]
      return { ...state, types, stats: { ...stats, types: types.length } }
    }
  }
}

interface VaultContextValue {
  vault: Vault | null
  loadError: string | null
  /** False while only the startup items are loaded. Pages that list the whole vault wait for this. */
  complete: boolean
  /** The full vault did not load. The startup items stay usable. */
  fullError: string | null
  /** Read the full vault again. The latest request wins; older responses are dropped. */
  reload: () => Promise<void>
  /** Put a saved item from a server response into the local index. */
  saveItem: (item: Item) => void
  addRelationship: (relation: Relationship) => void
  removeRelationship: (id: string) => void
  addType: (type: TypeDefinition) => void
}

const VaultContext = createContext<VaultContextValue | null>(null)

// Safari has no requestIdleCallback.
const afterPaint = (callback: () => void) =>
  typeof requestIdleCallback === 'function' ? requestIdleCallback(callback, { timeout: 500 }) : setTimeout(callback, 50)

export function VaultProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<StatePayload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fullError, setFullError] = useState<string | null>(null)
  const vault = useMemo(() => (payload ? buildVault(payload) : null), [payload])
  // ponytail: the journal is never trimmed; it holds only this tab's own edits.
  const journal = useRef<Change[]>([])
  const latest = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null })

  const loadFull = useCallback(async () => {
    latest.current.controller?.abort()
    const controller = new AbortController()
    const id = latest.current.id + 1
    latest.current = { id, controller }
    const since = journal.current.length
    setFullError(null)
    try {
      const full = await api<StatePayload>('/api/state', { signal: controller.signal })
      if (latest.current.id !== id) return
      startTransition(() => setPayload(current => {
        if (latest.current.id !== id) return current
        return journal.current.slice(since).reduce(applyChange, { ...full, partial: false })
      }))
    } catch (error) {
      if (latest.current.id === id) setFullError(errorText(error))
    }
  }, [])

  const bootstrap = useCallback(async () => {
    setLoadError(null)
    const since = journal.current.length
    try {
      let first: StatePayload
      try {
        first = await api<StatePayload>('/api/startup')
      } catch {
        // An older server has no startup route; read the full vault instead.
        first = { ...(await api<StatePayload>('/api/state')), partial: false }
      }
      const merged = journal.current.slice(since).reduce(applyChange, first)
      setPayload(current => current ?? merged)
      if (first.partial) afterPaint(() => void loadFull())
    } catch (error) {
      setLoadError(errorText(error))
    }
  }, [loadFull])
  useEffect(() => { void bootstrap() }, [bootstrap])

  const reload = useCallback(() => (payload ? loadFull() : bootstrap()), [payload, loadFull, bootstrap])

  const record = useCallback((change: Change) => {
    journal.current.push(change)
    setPayload(current => current && applyChange(current, change))
  }, [])
  const saveItem = useCallback((item: Item) => record({ kind: 'item', item }), [record])
  const addRelationship = useCallback((relation: Relationship) => record({ kind: 'relate', relation }), [record])
  const removeRelationship = useCallback((id: string) => record({ kind: 'unrelate', id }), [record])
  const addType = useCallback((type: TypeDefinition) => record({ kind: 'type', type }), [record])

  const complete = Boolean(payload && !payload.partial)
  const value = useMemo(
    () => ({ vault, loadError, complete, fullError, reload, saveItem, addRelationship, removeRelationship, addType }),
    [vault, loadError, complete, fullError, reload, saveItem, addRelationship, removeRelationship, addType],
  )
  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

export function useVaultContext() {
  const context = useContext(VaultContext)
  if (!context) throw new Error('VaultProvider is missing')
  return context
}

/** The loaded vault. Views render only after the first load. */
export function useVault() {
  const { vault } = useVaultContext()
  if (!vault) throw new Error('The vault is not loaded yet')
  return vault
}

export async function patchItem(id: string, patch: Record<string, unknown>) {
  return api<Item>('/api/objects/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch) })
}

// ---------- scope ----------

const SCOPE_KEY = '2b.scope'
const ScopeContext = createContext<[Scope, (scope: Scope) => void] | null>(null)

function storedScope(): Scope {
  try {
    const value = localStorage.getItem(SCOPE_KEY)
    return value === 'work' || value === 'personal' ? value : 'all'
  } catch {
    return 'all'
  }
}

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScopeState] = useState<Scope>(storedScope)
  const setScope = useCallback((next: Scope) => {
    setScopeState(next)
    try { localStorage.setItem(SCOPE_KEY, next) } catch { /* private mode: the choice lasts for this tab */ }
  }, [])
  const value = useMemo(() => [scope, setScope] as [Scope, (scope: Scope) => void], [scope, setScope])
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
}

export function useScope() {
  const context = useContext(ScopeContext)
  if (!context) throw new Error('ScopeProvider is missing')
  return context
}

// ---------- log history ----------

// The server reads at most 366 days per request.
const MAX_RANGE_DAYS = 365

interface ActivityContextValue {
  version: number
  byDay: Map<string, ActivityEvent[]>
  covers: (from: string, to: string) => boolean
  ensure: (from: string, to: string) => void
  errorFor: (from: string, to: string) => string | null
}

const ActivityContext = createContext<ActivityContextValue | null>(null)

export function ActivityProvider({ children }: { children: ReactNode }) {
  const cache = useRef({ events: new Map<string, ActivityEvent>(), covered: [] as Array<[string, string]>, inflight: new Set<string>() })
  const [version, setVersion] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const byDay = useMemo(() => {
    const days = new Map<string, ActivityEvent[]>()
    for (const event of cache.current.events.values()) {
      const day = dayKey(event.at)
      const list = days.get(day)
      if (list) list.push(event)
      else days.set(day, [event])
    }
    return days
  }, [version]) // `version` changes after each merge into the cache.

  const covers = useCallback((from: string, to: string) => cache.current.covered.some(([start, end]) => start <= from && end >= to), [])

  const ensure = useCallback((from: string, to: string) => {
    const end = to > todayKey() ? todayKey() : to
    if (from > end || covers(from, end)) return
    const start = from < addDays(end, -MAX_RANGE_DAYS) ? addDays(end, -MAX_RANGE_DAYS) : from
    const key = `${start}|${end}`
    if (cache.current.inflight.has(key)) return
    cache.current.inflight.add(key)
    setErrors(current => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    api<{ events: ActivityEvent[] }>(`/api/activity?from=${start}&to=${end}`)
      .then(({ events }) => {
        for (const event of events) cache.current.events.set(event.id, event)
        cache.current.covered.push([start, end])
        setVersion(current => current + 1)
      })
      .catch(error => setErrors(current => ({ ...current, [key]: errorText(error) })))
      .finally(() => cache.current.inflight.delete(key))
  }, [covers])

  const errorFor = useCallback((from: string, to: string) => {
    const end = to > todayKey() ? todayKey() : to
    const start = from < addDays(end, -MAX_RANGE_DAYS) ? addDays(end, -MAX_RANGE_DAYS) : from
    return errors[`${start}|${end}`] ?? null
  }, [errors])

  const value = useMemo(() => ({ version, byDay, covers, ensure, errorFor }), [version, byDay, covers, ensure, errorFor])
  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>
}

/**
 * Log history for a day range. Days in the future have no log lines.
 * `byDay` is null until the range is loaded; `error` is set when the server cannot read the logs.
 */
export function useActivity(from: string, to: string) {
  const context = useContext(ActivityContext)
  if (!context) throw new Error('ActivityProvider is missing')
  const { ensure, covers, errorFor, byDay } = context
  const { complete } = useVaultContext()
  const end = to > todayKey() ? todayKey() : to
  // One day loads at once. A longer range waits for the full vault, so it does not slow the first page.
  const waits = from < end && !complete
  useEffect(() => { if (!waits) ensure(from, to) }, [ensure, from, to, waits])
  const ready = from > end || covers(from, end)
  return {
    byDay: ready ? byDay : null,
    error: ready ? null : errorFor(from, to),
    retry: () => ensure(from, to),
  }
}
