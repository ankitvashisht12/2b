import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import type { DayButtonProps } from 'react-day-picker'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { BulkGroup, ScheduleList, SpineList } from '@/components/day-lines'
import { OtherScopeHint, PageHeader, Section } from '@/components/page'
import { dayHash } from '@/views/day'
import { addDays, dateToDay, dayToDate, formatDay, formatMonth, isDayKey, monthEnd, monthStart, todayKey } from '@/lib/dates'
import { navigate, withQuery, type Route } from '@/lib/router'
import { useActivity, useScope, useVault } from '@/lib/store'
import { activityCount, allScopeLines, dayActivity, scheduleRows, type DayActivity, type TimelineRow } from '@/lib/timeline'
import { SCOPE_LABELS } from '@/lib/vault'
import { cn } from '@/lib/utils'

interface DaySummary { lines: TimelineRow[]; total: number; due: number; bulk: number }
const SummaryContext = createContext<Map<string, DaySummary>>(new Map())

function summarize(schedule: TimelineRow[], activity: DayActivity): DaySummary {
  const seen = new Set<string>()
  const lines: TimelineRow[] = []
  for (const row of [...schedule, ...activity.allDay, ...activity.timed]) {
    const key = row.itemId ?? row.key
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(row)
  }
  return { lines, total: lines.length, due: schedule.filter(row => row.scheduleKind === 'due').length, bulk: activity.bulk.length }
}

/** A month cell: the date, the first lines of the day, and how many more there are. */
function MonthDayButton({ day, modifiers, className, ...props }: DayButtonProps) {
  const summaries = useContext(SummaryContext)
  const key = dateToDay(day.date)
  const summary = summaries.get(key)
  const extra = summary ? summary.total - Math.min(summary.total, 3) : 0
  // Arrow keys move the focused day; the button must take the focus itself, as the default day button does.
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (modifiers.focused) ref.current?.focus() }, [modifiers.focused])
  const others = summary ? summary.total - summary.due : 0
  return (
    <button
      {...props}
      ref={ref}
      aria-label={`${formatDay(key, 'long')}${summary?.total ? `, ${summary.total} ${summary.total === 1 ? 'line' : 'lines'}` : ''}${summary?.due ? `, ${summary.due} due` : ''}`}
      data-selected={modifiers.selected || undefined}
      data-today={modifiers.today || undefined}
      data-outside={modifiers.outside || undefined}
      className={cn('month-cell', className)}
    >
      <span className="month-cell-date tabular-nums">{day.date.getDate()}</span>
      {summary?.total ? (
        <span className="month-cell-marks" aria-hidden="true">
          {summary.due > 0 && <span className="month-mark" data-kind="due" />}
          {others > 0 && <span className="month-mark" />}
        </span>
      ) : null}
      {summary?.lines.slice(0, 3).map(row => (
        <span key={row.key} className="month-cell-line" data-kind={row.scheduleKind ?? row.source}>
          <span className="scope-dot size-1.5 shrink-0 rounded-full" data-scope={row.scope ?? 'none'} aria-hidden="true" />
          <span className="truncate">{row.title}</span>
        </span>
      ))}
      {extra > 0 && <span className="month-cell-more">+{extra} more</span>}
      {summary?.total ? <span className="month-cell-total tabular-nums">{summary.total}</span> : null}
      {!summary?.total && summary?.bulk ? <span className="month-cell-more">{summary.bulk} files</span> : null}
    </button>
  )
}

export function CalendarView({ route }: { route: Route }) {
  const vault = useVault()
  const [scope] = useScope()
  const today = todayKey()
  const queryDate = route.query.get('date')
  const selected = isDayKey(queryDate) ? queryDate : today
  const queryMonth = route.query.get('month')
  const month = queryMonth && /^\d{4}-\d{2}$/.test(queryMonth) ? queryMonth + '-01' : monthStart(selected)
  // The grid shows days of the next and previous month; load a little around the month.
  const from = addDays(month, -7)
  const to = addDays(monthEnd(month), 14)
  const { byDay, error, retry } = useActivity(from, to)

  const summaries = useMemo(() => {
    const map = new Map<string, DaySummary>()
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const summary = summarize(scheduleRows(vault, day, scope), dayActivity(vault, byDay, day, scope))
      if (summary.total || summary.bulk) map.set(day, summary)
    }
    return map
  }, [vault, byDay, from, to, scope])

  // Each pick is a new history entry, as on Today, so Back returns to the day before.
  const go = (date: string, monthKey = date.slice(0, 7)) => navigate(withQuery('#calendar', { month: monthKey, date }))
  // A new month keeps the selected day only when that day is in it; otherwise today, or the 1st.
  const showMonth = (monthKey: string) => go(selected.startsWith(monthKey) ? selected : today.startsWith(monthKey) ? today : monthKey + '-01', monthKey)
  const selectedActivity = dayActivity(vault, byDay, selected, scope)
  const selectedSchedule = scheduleRows(vault, selected, scope)
  const hiddenLines = scope === 'all' ? 0 : allScopeLines(vault, byDay, selected) - selectedSchedule.length - activityCount(selectedActivity)

  return (
    <div>
      <PageHeader
        title="Calendar"
        description={<>{formatMonth(month)} · {scope === 'all' ? 'Work and Personal' : SCOPE_LABELS[scope]}</>}
        actions={<Button variant="outline" onClick={() => go(today)} disabled={selected === today && month === monthStart(today)}>Today</Button>}
      />
      {error && (
        <Alert className="mb-4">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            Log history did not load: {error}. Item dates and the schedule still show.
            <Button variant="outline" size="xs" onClick={retry}>Try again</Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <SummaryContext.Provider value={summaries}>
          <Calendar
            mode="single"
            required
            selected={dayToDate(selected)}
            onSelect={date => go(dateToDay(date), month.slice(0, 7))}
            month={dayToDate(month)}
            onMonthChange={date => showMonth(dateToDay(date).slice(0, 7))}
            today={dayToDate(today)}
            fixedWeeks
            components={{ DayButton: MonthDayButton }}
            className="month-grid w-full rounded-lg border p-3 [--cell-size:--spacing(9)]"
            classNames={{
              root: 'w-full',
              months: 'relative flex w-full flex-col',
              month: 'flex w-full flex-col gap-3',
              month_grid: 'w-full border-collapse',
              weekdays: 'grid grid-cols-7',
              weekday: 'pb-1 text-left text-xs font-normal text-muted-foreground',
              week: 'grid grid-cols-7',
              day: 'month-day p-0',
              today: '',
              outside: '',
            }}
          />
        </SummaryContext.Provider>
        <section aria-label={`Selected day, ${formatDay(selected, 'long')}`} className="min-w-0">
          <header className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">{formatDay(selected, 'long')}</h2>
            <Button variant="link" size="sm" className="px-0" asChild><a href={dayHash(selected)}>Open day</a></Button>
          </header>
          <Section title="Schedule" count={selectedSchedule.length} className="mb-5">
            {selectedSchedule.length ? <ScheduleList rows={selectedSchedule} /> : <p className="py-2 text-sm text-muted-foreground">Nothing scheduled.</p>}
          </Section>
          <Section title="Activity" count={activityCount(selectedActivity)}>
            {selectedActivity.allDay.length > 0 && <SpineList key={'all-day' + selected} rows={selectedActivity.allDay} />}
            {selectedActivity.timed.length > 0 && <SpineList key={'timed' + selected} rows={selectedActivity.timed} limit={20} />}
            {!activityCount(selectedActivity) && <p className="py-2 text-sm text-muted-foreground">{byDay ? 'Nothing written, changed, or logged.' : error ? 'No item dates on this day.' : 'Loading log history…'}</p>}
            <BulkGroup key={'bulk' + selected} rows={selectedActivity.bulk} className="mt-1" />
          </Section>
          <OtherScopeHint hidden={hiddenLines} noun={['line on this day', 'lines on this day']} />
        </section>
      </div>
    </div>
  )
}
