import { useMemo, useState } from 'react'
import { CalendarRangeIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { BulkGroup, ScheduleList, SpineList } from '@/components/day-lines'
import { EmptyState, OtherScopeHint, PageHeader } from '@/components/page'
import { dayHash } from '@/views/day'
import { addDays, dateToDay, daysBetween, dayToDate, formatDay, isDayKey, relativeDay, todayKey } from '@/lib/dates'
import { navigate, withQuery, type Route } from '@/lib/router'
import { useActivity, useScope, useVault } from '@/lib/store'
import { activityCount, allScopeLines, dayActivity, scheduleRows } from '@/lib/timeline'
import { SCOPE_LABELS } from '@/lib/vault'

const PRESETS = [7, 30, 90]
const MAX_DAYS = 366
const DAYS_PER_STEP = 31

function rangeOf(route: Route) {
  const today = todayKey()
  const from = route.query.get('from')
  const to = route.query.get('to')
  if (isDayKey(from) && isDayKey(to) && from <= to && daysBetween(from, to) < MAX_DAYS) return { from, to }
  const days = Number(route.query.get('days')) || 7
  return { from: addDays(today, -(Math.min(Math.max(days, 1), MAX_DAYS) - 1)), to: today }
}

const rangeHash = (from: string, to: string) => withQuery('#timeline', { from, to })

export function TimelineView({ route }: { route: Route }) {
  const vault = useVault()
  const [scope] = useScope()
  const { from, to } = rangeOf(route)
  const length = daysBetween(from, to) + 1
  const today = todayKey()
  const { byDay, error, retry } = useActivity(from, to)
  const [renderDays, setRenderDays] = useState(DAYS_PER_STEP)
  const [shownRange, setShownRange] = useState(from + to)
  // A new range starts with its first 31 days again.
  if (shownRange !== from + to) {
    setShownRange(from + to)
    setRenderDays(DAYS_PER_STEP)
  }
  const [pickerOpen, setPickerOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>()

  // Each day shows its schedule (deadlines, meetings, reminders, plans) above its activity, as Today does.
  const { days, hidden } = useMemo(() => {
    const list = []
    let hiddenLines = 0
    for (let day = to; day >= from; day = addDays(day, -1)) {
      const schedule = scheduleRows(vault, day, scope)
      const activity = dayActivity(vault, byDay, day, scope)
      const lines = schedule.length + activityCount(activity)
      if (scope !== 'all') hiddenLines += allScopeLines(vault, byDay, day) - lines
      if (lines || activity.bulk.length) list.push({ day, schedule, activity, lines })
    }
    return { days: list, hidden: hiddenLines }
  }, [vault, byDay, from, to, scope])
  const total = days.reduce((sum, entry) => sum + entry.lines, 0)
  // An empty range points to the nearest earlier day that has lines, instead of more empty ranges.
  const nearest = useMemo(() => {
    if (!byDay || days.length) return null
    const candidates = [...new Set([...vault.history.keys(), ...vault.schedule.keys(), ...byDay.keys()])].filter(day => day < from).sort().reverse()
    return candidates.find(day => scheduleRows(vault, day, scope).length + activityCount(dayActivity(vault, byDay, day, scope)) > 0) ?? null
  }, [vault, byDay, days.length, from, scope])
  const preset = to === today && PRESETS.includes(length) ? String(length) : ''
  const shift = (direction: -1 | 1) => {
    const nextTo = addDays(to, direction * length)
    navigate(rangeHash(addDays(nextTo, -(length - 1)), nextTo > today ? today : nextTo))
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Timeline"
        description={<>{formatDay(from)} to {formatDay(to)} · {length} {length === 1 ? 'day' : 'days'} · {scope === 'all' ? 'Work and Personal' : SCOPE_LABELS[scope]}{byDay ? ` · ${total.toLocaleString('en-IN')} lines` : ''}</>}
      >
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={preset} onValueChange={value => value && navigate(withQuery('#timeline', { days: value }))} aria-label="Range">
            {PRESETS.map(days => <ToggleGroupItem key={days} value={String(days)}>{days} days</ToggleGroupItem>)}
          </ToggleGroup>
          <Popover open={pickerOpen} onOpenChange={open => { setPickerOpen(open); setDraft(open ? { from: dayToDate(from), to: dayToDate(to) } : undefined) }}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm"><CalendarRangeIcon />Choose dates</Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                autoFocus
                numberOfMonths={2}
                defaultMonth={dayToDate(addDays(to, -31))}
                selected={draft}
                onSelect={setDraft}
                today={dayToDate(today)}
                disabled={{ after: dayToDate(today) }}
              />
              <div className="flex items-center justify-between gap-2 border-t p-2 text-xs text-muted-foreground">
                <span>Up to one year.</span>
                <Button
                  size="sm"
                  disabled={!draft?.from || !draft.to || daysBetween(dateToDay(draft.from), dateToDay(draft.to)) >= MAX_DAYS}
                  onClick={() => { if (draft?.from && draft.to) { setPickerOpen(false); navigate(rangeHash(dateToDay(draft.from), dateToDay(draft.to))) } }}
                >
                  Show range
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <ButtonGroup aria-label="Move the range" className="ml-auto">
            <Button variant="outline" size="sm" onClick={() => shift(-1)}><ChevronLeftIcon />Earlier</Button>
            <Button variant="outline" size="sm" onClick={() => shift(1)} disabled={to >= today}>Later<ChevronRightIcon /></Button>
          </ButtonGroup>
        </div>
      </PageHeader>

      {error && (
        <Alert className="mb-4">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            Log history did not load: {error}. Item dates still show.
            <Button variant="outline" size="xs" onClick={retry}>Try again</Button>
          </AlertDescription>
        </Alert>
      )}
      {!byDay && !error && <div className="grid gap-2" aria-busy="true" aria-label="Loading log history">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-10" />)}</div>}
      {byDay && !days.length && (
        <EmptyState title="Nothing in this range" description={`No deadline, item date, or log line between ${formatDay(from)} and ${formatDay(to)} in this scope.`}>
          {nearest
            ? <Button variant="outline" onClick={() => navigate(rangeHash(addDays(nearest, -(length - 1)), nearest))}>Go to {formatDay(nearest)}, the nearest earlier day with lines</Button>
            : <Button variant="outline" onClick={() => shift(-1)}>Show the {length} days before</Button>}
        </EmptyState>
      )}
      {(byDay || error) && days.slice(0, renderDays).map(({ day, schedule, activity, lines }) => (
        <section key={day} className="mb-6" aria-label={formatDay(day, 'long')}>
          <header className="day-head sticky top-12 z-10 -mx-2 mb-1 flex items-baseline gap-2 px-2 py-1.5">
            <h2 className="text-sm font-semibold"><a href={dayHash(day)} className="spine-link">{relativeDay(day) ? `${relativeDay(day)} · ${formatDay(day)}` : formatDay(day, 'long')}</a></h2>
            <span className="text-xs tabular-nums text-muted-foreground">{lines.toLocaleString('en-IN')}</span>
          </header>
          {schedule.length > 0 && <ScheduleList rows={schedule} />}
          {activity.allDay.length > 0 && <SpineList key={'all-day' + day} rows={activity.allDay} />}
          {activity.timed.length > 0 && <SpineList key={'timed' + day} rows={activity.timed} limit={30} />}
          <BulkGroup key={'bulk' + day} rows={activity.bulk} className="mt-1" />
        </section>
      ))}
      {days.length > renderDays && (
        <Button variant="outline" onClick={() => setRenderDays(count => count + DAYS_PER_STEP)}>Show earlier days ({days.length - renderDays} more with lines)</Button>
      )}
      <OtherScopeHint hidden={hidden} noun={['line in this range', 'lines in this range']} />
    </div>
  )
}
