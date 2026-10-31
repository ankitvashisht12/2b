import { clockTime, dayKey } from '@/lib/dates'
import { inScope, isBulk, itemScope, scopeFrom, type ActivityEvent, type HistoryKind, type ItemScope, type Scope, type ScheduleKind, type Vault } from '@/lib/vault'

/** One line of a day: an item date, a log entry, or a scheduled item. */
export interface TimelineRow {
  key: string
  day: string
  time: string | null
  at: number
  source: 'item' | 'log' | 'schedule'
  label: string
  itemId: string | null
  title: string
  detail: string
  projectId: string | null
  scope: ItemScope
  bulk: boolean
  scheduleKind?: ScheduleKind
}

const HISTORY_LABELS: Record<HistoryKind, string> = {
  created: 'Created',
  changed: 'Changed',
  edited: 'Edited in 2b',
  completed: 'Completed',
  dated: 'Dated this day',
}
const SCHEDULE_LABELS: Record<ScheduleKind, string> = { due: 'Due', meeting: 'Meeting', reminder: 'Reminder', planned: 'Planned' }

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export function logRow(vault: Vault, event: ActivityEvent): TimelineRow {
  const item = vault.byId.get(event.objectId)
  return {
    key: 'log:' + event.id,
    day: dayKey(event.at),
    time: clockTime(event.at),
    at: Date.parse(event.at),
    source: 'log',
    label: capitalize((event.kind || '').trim() || 'note'),
    itemId: item ? item.id : null,
    title: item?.name ?? event.objectName,
    detail: event.detail,
    projectId: event.projectId ?? (item ? vault.projectOf.get(item.id) ?? null : null),
    scope: scopeFrom(event.tags) ?? itemScope(vault, event.projectId) ?? itemScope(vault, event.objectId),
    bulk: false,
  }
}

function historyRows(vault: Vault, day: string): TimelineRow[] {
  return (vault.history.get(day) ?? []).flatMap(entry => {
    const item = vault.byId.get(entry.itemId)
    if (!item) return []
    return [{
      key: `item:${item.id}:${day}`,
      day,
      time: entry.time,
      at: entry.at,
      source: 'item' as const,
      label: entry.kinds.map(kind => HISTORY_LABELS[kind]).join(' · '),
      itemId: item.id,
      title: item.name,
      detail: '',
      projectId: vault.projectOf.get(item.id) ?? null,
      scope: itemScope(vault, item.id),
      bulk: isBulk(item),
    }]
  })
}

export function scheduleRows(vault: Vault, day: string, scope: Scope): TimelineRow[] {
  return (vault.schedule.get(day) ?? []).flatMap(entry => {
    const item = vault.byId.get(entry.itemId)
    if (!item || !inScope(itemScope(vault, item.id), scope)) return []
    return [{
      key: `schedule:${entry.kind}:${item.id}:${day}`,
      day,
      time: entry.time,
      at: 0,
      source: 'schedule' as const,
      label: SCHEDULE_LABELS[entry.kind],
      itemId: item.id,
      title: item.name,
      detail: item.description,
      projectId: vault.projectOf.get(item.id) ?? null,
      scope: itemScope(vault, item.id),
      bulk: false,
      scheduleKind: entry.kind,
    }]
  }).sort((left, right) => (left.time ?? '').localeCompare(right.time ?? '') || left.title.localeCompare(right.title))
}

export interface DayActivity {
  /** Timed lines, newest first. */
  timed: TimelineRow[]
  /** Lines with a date and no time, such as a note's content date. */
  allDay: TimelineRow[]
  /** Artifacts, evidence, and archived records, folded by default. */
  bulk: TimelineRow[]
}

export function dayActivity(vault: Vault, logByDay: Map<string, ActivityEvent[]> | null, day: string, scope: Scope): DayActivity {
  const rows = [...historyRows(vault, day), ...(logByDay?.get(day) ?? []).map(event => logRow(vault, event))]
    .filter(row => inScope(row.scope, scope))
  const bulk = rows.filter(row => row.bulk)
  const rest = rows.filter(row => !row.bulk)
  return {
    timed: rest.filter(row => row.time).sort((left, right) => right.at - left.at || left.title.localeCompare(right.title)),
    allDay: rest.filter(row => !row.time).sort((left, right) => left.title.localeCompare(right.title)),
    bulk: bulk.sort((left, right) => right.at - left.at),
  }
}

export const activityCount = (activity: DayActivity) => activity.timed.length + activity.allDay.length

/** Lines of a day in every scope: schedule plus activity. Lists use it to say how many lines another scope hides. */
export const allScopeLines = (vault: Vault, logByDay: Map<string, ActivityEvent[]> | null, day: string) =>
  scheduleRows(vault, day, 'all').length + activityCount(dayActivity(vault, logByDay, day, 'all'))

/** Fold bulk lines under the task or collection they belong to. */
export function groupByParent(vault: Vault, rows: TimelineRow[]) {
  const groups = new Map<string, { parentId: string | null; title: string; rows: TimelineRow[] }>()
  for (const row of rows) {
    const parentId = (row.itemId && vault.parentOf.get(row.itemId)) || null
    const key = parentId ?? ''
    const group = groups.get(key) ?? { parentId, title: parentId ? vault.byId.get(parentId)?.name ?? 'Unknown item' : 'No parent item', rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  return [...groups.values()].sort((left, right) => right.rows.length - left.rows.length || left.title.localeCompare(right.title))
}
