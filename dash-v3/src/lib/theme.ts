import { useSyncExternalStore } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

// The choice is a browser preference, so it stays in this browser and is not saved in the vault.
const STORAGE_KEY = '2b.theme'
const darkScheme = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

const isPreference = (value: unknown): value is ThemePreference => value === 'light' || value === 'dark' || value === 'system'

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isPreference(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

let preference = readStoredPreference()

const resolvedTheme = (): ResolvedTheme => preference === 'dark' || (preference === 'system' && darkScheme.matches) ? 'dark' : 'light'

function applyTheme() {
  const resolved = resolvedTheme()
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
  listeners.forEach(listener => listener())
}

/** Applies the saved theme now and keeps it current. Call once, before React mounts. */
export function startTheme() {
  applyTheme()
  darkScheme.addEventListener('change', () => { if (preference === 'system') applyTheme() })
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY && event.key !== null) return
    preference = readStoredPreference()
    applyTheme()
  })
}

export function setThemePreference(next: ThemePreference) {
  preference = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Storage is blocked; the choice applies to this tab only.
  }
  applyTheme()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const useThemePreference = () => useSyncExternalStore(subscribe, () => preference)
export const useResolvedTheme = () => useSyncExternalStore(subscribe, resolvedTheme)
