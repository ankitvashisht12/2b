import { useEffect, useMemo, useState } from 'react'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { BulkGroup, ScheduleList, SpineList } from '@/components/day-lines'
import { Hint, ItemRow } from '@/components/item-bits'
import { FoldGroup, OtherScopeHint, PageHeader, Section } from '@/components/page'
import { useTaskToggle } from '@/lib/actions'
import { useAppActions } from '@/lib/app-actions'
import { addDays, dateToDay, dayKey, dayToDate, formatDay, monthEnd, monthStart, relativeDay, todayKey } from '@/lib/dates'
import { inOverlay, isTypingTarget, ownsArrowKeys } from '@/lib/keys'
import { navigate, withQuery } from '@/lib/router'
import { useActivity, useScope, useVault } from '@/lib/store'
import { activityCount, allScopeLines, dayActivity, scheduleRows } from '@/lib/timeline'
import { inScope, isInbox, isOpenTask, SCOPE_LABELS, statusOf, type ActivityEvent, type Scope, type Vault } from '@/lib/vault'

export const dayHash = (day: string) => (day === todayKey() ? '#today' : '#day/' + day)

/** Days of a month that have lines in the given scope, for calendar dots. */
export function busyDays(vault: Vault, logByDay: Map<string, ActivityEvent[]> | null, from: string, to: string, scope: Scope) {
  const counts = new Map<string, number>()
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const total = activityCount(dayActivity(vault, logByDay, day, scope)) + scheduleRows(vault, day, scope).length
    if (total) counts.set(day, total)
  }
  return counts
}

/** A month with a dot on each day that has lines in the current scope. */
function BusyMonth({ day, onPick, className, inPopover = false }: { day: string; onPick: (day: string) => void; className?: string; inPopover?: boolean }) {
  const vault = useVault()
  const [scope] = useScope()
  const [month, setMonth] = useState(() => monthStart(day))
  useEffect(() => setMonth(monthStart(day)), [day])
  const { byDay } = useActivity(month, monthEnd(month))
  const busy = useMemo(() => busyDays(vault, byDay, month, monthEnd(month), scope), [vault, byDay, month, scope])
  return (
    <Calendar
      mode="single"
      autoFocus={inPopover}
      selected={dayToDate(day)}
      month={dayToDate(month)}
      onMonthChange={date => setMonth(monthStart(dateToDay(date)))}
      today={dayToDate(todayKey())}
      onSelect={date => date && onPick(dateToDay(date))}
      modifiers={{ busy: [...busy.keys()].map(dayToDate) }}
      modifiersClassNames={{ busy: 'day-busy' }}
      captionLayout={inPopover ? 'dropdown' : 'label'}
      startMonth={new Date(2015, 0)}
      endMonth={new Date(new Date().getFullYear() + 2, 11)}
      className={className}
    />
  )
}

export function DayPicker({ day }: { day: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-label={`Choose a date. Showing ${formatDay(day, 'long')}`}>
          <CalendarIcon />
          <span className="tabular-nums">{formatDay(day)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        {/* Focus starts on the shown day, so the arrow keys move between days at once. */}
        <BusyMonth day={day} inPopover onPick={picked => { setOpen(false); navigate(dayHash(picked)) }} />
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">A dot marks a day with lines in this scope.</p>
      </PopoverContent>
    </Popover>
  )
}

export function DayView({ day }: { day: string }) {
  const vault = useVault()
  const [scope] = useScope()
  const { openCapture } = useAppActions()
  const today = todayKey()
  const isToday = day === today
  const { byDay, error, retry } = useActivity(day, day)
  const { toggle, busyId, lingering } = useTaskToggle()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || isTypingTarget(event.target) || inOverlay(event.target)) return
      // The scope switch, a calendar month, and other controls use the arrow keys themselves.
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && ownsArrowKeys(event)) return
      if (event.key === 'ArrowLeft') navigate(dayHash(addDays(day, -1)))
      else if (event.key === 'ArrowRight') navigate(dayHash(addDays(day, 1)))
      else if (event.key === 't' || event.key === 'T') navigate('#today')
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [day])

  const visible = (id: string) => inScope(vault.scopeOf.get(id) ?? null, scope)
  const stays = (id: string) => lingering.has(id)
  const overdue = isToday
    ? vault.items.filter(item => item.type === 'task' && (isOpenTask(item) || stays(item.id)) && dayKey(item.properties.due) && dayKey(item.properties.due) < today && visible(item.id))
      .sort((left, right) => dayKey(left.properties.due).localeCompare(dayKey(right.properties.due)))
    : []
  const overdueIds = new Set(overdue.map(item => item.id))
  const inProgress = isToday
    ? vault.items.filter(item => item.type === 'task' && (statusOf(item) === 'doing' || stays(item.id)) && !overdueIds.has(item.id) && (isOpenTask(item) || stays(item.id)) && visible(item.id))
    : []
  const schedule = scheduleRows(vault, day, scope)
  const activity = dayActivity(vault, byDay, day, scope)
  const hiddenLines = scope === 'all' ? 0 : allScopeLines(vault, byDay, day) - schedule.length - activityCount(activity)
  const inboxCount = vault.items.filter(item => isInbox(item) && visible(item.id)).length
  const relative = relativeDay(day)
  const scopeText = scope === 'all' ? 'Work and Personal' : SCOPE_LABELS[scope]
  const addTask = () => openCapture({ type: 'task', day })

  return (
    <div className="flex gap-10">
      <div className="min-w-0 flex-1">
        <PageHeader
          title={isToday ? 'Today' : relative || formatDay(day, 'long')}
          description={relative ? <>{formatDay(day, 'long')} · {scopeText}</> : scopeText}
          actions={
            <>
              <ButtonGroup aria-label="Change day" className="day-controls">
                <Hint label="Previous day (←)">
                  <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => navigate(dayHash(addDays(day, -1)))}><ChevronLeftIcon /></Button>
                </Hint>
                <Button variant="outline" onClick={() => navigate('#today')} disabled={isToday}>Today</Button>
                <Hint label="Next day (→)">
                  <Button variant="outline" size="icon" aria-label="Next day" onClick={() => navigate(dayHash(addDays(day, 1)))}><ChevronRightIcon /></Button>
                </Hint>
              </ButtonGroup>
              <span className="day-controls"><DayPicker day={day} /></span>
            </>
          }
        />

        {overdue.length > 0 && (
          <FoldGroup id="today-overdue" title="Overdue" count={overdue.filter(isOpenTask).length} tone="warn">
            <ul>{overdue.map(item => <ItemRow key={item.id} item={item} onToggleTask={toggle} busy={busyId === item.id} lingering={stays(item.id)} showType={false} showDescription={false} meta={<span className="text-warn">Due {formatDay(dayKey(item.properties.due))}</span>} />)}</ul>
          </FoldGroup>
        )}
        {inProgress.length > 0 && (
          <FoldGroup id="today-progress" title="In progress" count={inProgress.filter(isOpenTask).length} tone="progress">
            <ul>{inProgress.map(item => <ItemRow key={item.id} item={item} onToggleTask={toggle} busy={busyId === item.id} lingering={stays(item.id)} showType={false} showDescription={false} />)}</ul>
          </FoldGroup>
        )}

        <Section
          title="Schedule"
          count={schedule.length}
          actions={<Button variant="ghost" size="sm" className="text-muted-foreground" onClick={addTask} aria-label={`Add a task due ${formatDay(day, 'long')}`}><PlusIcon />Add task</Button>}
        >
          {schedule.length ? <ScheduleList rows={schedule} /> : <p className="py-3 text-sm text-muted-foreground">No deadline, meeting, or reminder on this day.</p>}
        </Section>

        <Section title="Activity" count={activityCount(activity)}>
          {error && (
            <Alert className="my-3">
              <AlertDescription className="flex flex-wrap items-center gap-2">
                Log history did not load: {error}. Item dates still show.
                <Button variant="outline" size="xs" onClick={retry}>Try again</Button>
              </AlertDescription>
            </Alert>
          )}
          {activity.allDay.length > 0 && <SpineList key={'all-day' + day} rows={activity.allDay} />}
          {activity.timed.length > 0 && <SpineList key={'timed' + day} rows={activity.timed} limit={80} />}
          {!activityCount(activity) && !activity.bulk.length && (
            <p className="py-3 text-sm text-muted-foreground">
              {byDay ? `Nothing was written, changed, or logged on this day in ${scopeText}.` : error ? 'No item dates on this day.' : 'Loading log history…'}
              {isToday && byDay && <> <Button variant="link" size="xs" className="h-auto p-0" onClick={() => openCapture()}>New item</Button></>}
            </p>
          )}
          <BulkGroup key={'bulk' + day} rows={activity.bulk} className="mt-2" />
        </Section>
        <OtherScopeHint hidden={hiddenLines} noun={['line on this day', 'lines on this day']} />

        {/* Below 1280 px the side rail is hidden; what is coming up still shows, under the day. */}
        <div className="mt-8 xl:hidden">
          <ComingUp />
          <InboxLink count={inboxCount} />
        </div>
      </div>

      <aside className="sticky top-16 hidden w-[17rem] shrink-0 self-start xl:block" aria-label="Month and coming up">
        <BusyMonth day={day} onPick={picked => navigate(dayHash(picked))} className="rounded-lg border p-2" />
        <p className="mt-2 px-1 text-xs text-muted-foreground">A dot marks a day with lines in this scope.</p>
        <div className="mt-6"><ComingUp /></div>
        <InboxLink count={inboxCount} />
      </aside>
    </div>
  )
}

const UPCOMING_DAYS = 14

function ComingUp() {
  const vault = useVault()
  const [scope] = useScope()
  const [limit, setLimit] = useState(8)
  const today = todayKey()
  const upcoming = useMemo(() => {
    const rows = []
    for (let offset = 1; offset <= UPCOMING_DAYS; offset++) rows.push(...scheduleRows(vault, addDays(today, offset), scope))
    return rows
  }, [vault, scope, today])
  return (
    <section aria-label="Coming up">
      <h2 className="mb-2 flex items-baseline justify-between gap-2 px-1 text-sm font-semibold">
        Coming up
        <a className="spine-link text-xs font-normal text-muted-foreground" href={withQuery('#calendar', { month: today.slice(0, 7), date: today })}>Calendar</a>
      </h2>
      {upcoming.length ? (
        <>
          <ul className="flex flex-col gap-1">
            {upcoming.slice(0, limit).map(row => (
              <li key={row.key}>
                <a href={dayHash(row.day)} className="rail-link flex items-baseline gap-2 rounded-md px-1 py-1 text-sm">
                  <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">{formatDay(row.day).replace(/^\w+, /, '')}</span>
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  <span className="text-xs text-muted-foreground">{row.label}</span>
                </a>
              </li>
            ))}
          </ul>
          {upcoming.length > limit && (
            <Button variant="ghost" size="sm" className="mt-1 text-muted-foreground" onClick={() => setLimit(upcoming.length)}>
              Show {upcoming.length - limit} more in the next {UPCOMING_DAYS} days
            </Button>
          )}
        </>
      ) : <p className="px-1 text-sm text-muted-foreground">Nothing scheduled in the next {UPCOMING_DAYS} days.</p>}
    </section>
  )
}

function InboxLink({ count }: { count: number }) {
  return (
    <a href="#inbox" className="rail-link mt-6 flex items-center justify-between rounded-md border px-3 py-2 text-sm">
      Inbox
      <span className="tabular-nums text-muted-foreground">{count ? `${count.toLocaleString('en-IN')} to process` : 'Empty'}</span>
    </a>
  )
}
