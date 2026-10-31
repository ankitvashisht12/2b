import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { patchItem, useVaultContext } from '@/lib/store'
import { errorText, type Item } from '@/lib/vault'

/** A completed task stays in its list this long, struck through, so the user sees what happened and can undo it. */
export const LINGER_MS = 1500

// ⌘Z runs the newest Undo that is still on screen.
let latestUndo: (() => void) | null = null
export function undoLatest() {
  const undo = latestUndo
  undo?.()
  return Boolean(undo)
}

/** A toast with Undo. The undo runs once, from the toast or from ⌘Z. */
export function offerUndo(message: string, undo: () => Promise<unknown>) {
  let done = false
  const run = () => {
    if (done) return
    done = true
    if (latestUndo === run) latestUndo = null
    toast.dismiss(id)
    void undo()
  }
  const forget = () => { if (latestUndo === run) latestUndo = null }
  latestUndo = run
  const id = toast.success(message, { duration: 8000, action: { label: 'Undo', onClick: run }, onDismiss: forget, onAutoClose: forget })
}

/** The fields that `patch` changes, set back to their values in `item`. */
export function reversePatch(item: Item, patch: Record<string, unknown>) {
  const reverse: Record<string, unknown> = {}
  for (const key of ['name', 'type', 'description', 'tags'] as const) if (key in patch) reverse[key] = item[key]
  if (patch.properties) reverse.properties = Object.fromEntries(Object.keys(patch.properties as Record<string, unknown>).map(key => [key, item.properties[key] ?? null]))
  return reverse
}

/** Save a change to one item, then offer Undo. Returns the saved item, or null when the save failed. */
export function useUndoableSave() {
  const { saveItem } = useVaultContext()
  return useCallback(async (item: Item, patch: Record<string, unknown>, message: string) => {
    let saved: Item
    try {
      saved = await patchItem(item.id, patch)
    } catch (error) {
      toast.error(`Not saved: ${errorText(error)}`)
      return null
    }
    saveItem(saved)
    offerUndo(message, async () => {
      try {
        saveItem(await patchItem(item.id, reversePatch(item, patch)))
        toast.success(`Undone. “${item.name}” is as it was.`)
      } catch (error) {
        toast.error(`Undo failed: ${errorText(error)}`)
      }
    })
    return saved
  }, [saveItem])
}

/**
 * Complete or reopen a task. `lingering` holds tasks completed here in the last moments: lists keep them,
 * struck through, then drop them. Focus moves to the next task box, so the keyboard never waits.
 */
export function useTaskToggle() {
  const save = useUndoableSave()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [lingering, setLingering] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = useCallback(async (item: Item, done: boolean) => {
    setBusyId(item.id)
    const patch = { properties: { status: done ? 'done' : 'todo', completedAt: done ? new Date().toISOString() : null } }
    const saved = await save(item, patch, done ? `Completed “${item.name}”.` : `Reopened “${item.name}”.`)
    setBusyId(null)
    if (saved && done) {
      setLingering(current => new Set(current).add(item.id))
      setTimeout(() => {
        const active = document.activeElement instanceof HTMLElement && document.activeElement.dataset.taskId === item.id ? document.activeElement : null
        const position = active ? [...document.querySelectorAll('[data-task-id]')].indexOf(active) : -1
        setLingering(current => {
          const next = new Set(current)
          next.delete(item.id)
          return next
        })
        if (active) requestAnimationFrame(() => {
          if (active.isConnected) return
          const boxes = document.querySelectorAll<HTMLElement>('[data-task-id]')
          ;(boxes[Math.min(position, boxes.length - 1)] ?? document.getElementById('page-title'))?.focus()
        })
      }, LINGER_MS)
    }
    return saved
  }, [save])
  return { toggle, busyId, lingering }
}

/** Mark an Inbox item processed without other changes. */
export function useMarkProcessed() {
  const save = useUndoableSave()
  const [busyId, setBusyId] = useState<string | null>(null)
  const markProcessed = useCallback(async (item: Item) => {
    setBusyId(item.id)
    const saved = await save(item, { properties: { processingState: 'processed' } }, `Processed “${item.name}”. It left the Inbox.`)
    setBusyId(null)
    return saved
  }, [save])
  return { markProcessed, busyId }
}
