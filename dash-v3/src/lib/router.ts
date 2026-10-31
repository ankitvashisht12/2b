import { useMemo, useSyncExternalStore } from 'react'

// Hash routes keep the static server simple: "#today", "#day/2026-10-28", "#item/<id>", "#library?type=note".
export interface Route { name: string; param: string; query: URLSearchParams }

const ALIASES: Record<string, string> = { object: 'item', objects: 'library', people: 'library', books: 'library', collections: 'library' }
const ALIAS_TYPES: Record<string, string> = { people: 'person', books: 'book', collections: 'collection' }

export function parseHash(hash: string): Route {
  const [path, queryString = ''] = hash.replace(/^#/, '').split('?')
  const [first, ...rest] = path.split('/')
  const query = new URLSearchParams(queryString)
  if (ALIAS_TYPES[first] && !query.has('type')) query.set('type', ALIAS_TYPES[first])
  let param = rest.join('/')
  try { param = decodeURIComponent(param) } catch { /* keep the raw value */ }
  return { name: ALIASES[first] ?? (first || 'today'), param, query }
}

let currentHash = window.location.hash
const listeners = new Set<() => void>()
let leaveGuard: ((target: string) => boolean) | null = null

/** A guard gets the hash the user wants to open and returns false to stay, for example with unsaved edits. */
export function setLeaveGuard(guard: (target: string) => boolean) {
  leaveGuard = guard
  return () => {
    if (leaveGuard === guard) leaveGuard = null
  }
}

window.addEventListener('hashchange', () => {
  if (window.location.hash === currentHash) return
  if (leaveGuard && !leaveGuard(window.location.hash)) {
    history.replaceState(null, '', currentHash || '#today')
    return
  }
  currentHash = window.location.hash
  for (const listener of listeners) listener()
})

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => currentHash)
  return useMemo(() => parseHash(hash), [hash])
}

export function navigate(hash: string, { replace = false } = {}) {
  if (hash === currentHash) return
  if (!replace) {
    window.location.hash = hash
    return
  }
  if (leaveGuard && !leaveGuard(hash)) return
  history.replaceState(null, '', hash)
  currentHash = hash
  for (const listener of listeners) listener()
}

export function withQuery(base: string, query: Record<string, string | null | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value)
  const text = params.toString()
  return text ? `${base}?${text}` : base
}
