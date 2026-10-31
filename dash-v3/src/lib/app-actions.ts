import { createContext, useContext } from 'react'
import type { Item } from '@/lib/vault'

/** Where a new item comes from. A page passes what it knows, so the user does not have to recall it. */
export interface CaptureContext {
  name?: string
  type?: string
  /** A project or collection: the new item is saved "part-of" it. */
  parentId?: string
  /** A day page: a new task is due on this day. */
  day?: string
  /** A discarded draft to restore as it was. */
  draft?: CaptureDraft
}

export interface CaptureDraft {
  name: string
  typeId: string
  scope: 'work' | 'personal' | 'none'
  tags: string
  body: string
  values: Record<string, string | boolean>
  parentId: string | null
  /** The day page it came from: a task is due on this day. */
  day: string | null
}

export interface ProcessOptions {
  /** Process from the Inbox: saving also marks the item processed. Off for "Change type or project". */
  markProcessed?: boolean
  onSaved?: (item: Item) => void
}

export interface AppActions {
  openCapture: (context?: CaptureContext) => void
  openSearch: () => void
  openProcess: (item: Item, options?: ProcessOptions) => void
  openShortcuts: () => void
}

export const AppActionsContext = createContext<AppActions>({ openCapture: () => {}, openSearch: () => {}, openProcess: () => {}, openShortcuts: () => {} })
export const useAppActions = () => useContext(AppActionsContext)
