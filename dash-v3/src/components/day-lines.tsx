import { useState } from 'react'
import {
  CircleDotIcon, FilePlus2Icon, GitPullRequestIcon, LayersIcon, Link2Icon, MessageSquareTextIcon, PaperclipIcon, ScaleIcon, SlidersHorizontalIcon,
  ChevronRightIcon, type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScopeDot, TypeIcon } from '@/components/item-bits'
import { itemHref } from '@/lib/markdown'
import { useVault } from '@/lib/store'
import { groupByParent, type TimelineRow } from '@/lib/timeline'
import { isDisabledSchedule, isOpenTask, isPendingReview } from '@/lib/vault'
import { cn } from '@/lib/utils'
import { shortDay, todayKey } from '@/lib/dates'

const dayHash = (day: string) => (day === todayKey() ? '#today' : '#day/' + day)

const LOG_ICONS: Record<string, LucideIcon> = {
  status: CircleDotIcon,
  note: MessageSquareTextIcon,
  created: FilePlus2Icon,
  artifact: PaperclipIcon,
  resource: Link2Icon,
  link: Link2Icon,
  set: SlidersHorizontalIcon,
  rule: ScaleIcon,
  collection: LayersIcon,
  pr: GitPullRequestIcon,
}

const readableDetail = (detail: string) => detail.replace(/\s->\s/g, ' → ')
// About three lines of the main column; longer log text folds behind "Show all".
const LONG_DETAIL = 240

/** The day spine: times in the gutter, one margin rule, and the lines of the day beside it. */
export function SpineList({ rows, limit, dated = false }: { rows: TimelineRow[]; limit?: number; dated?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const shown = limit && !expanded ? rows.slice(0, limit) : rows
  return (
    <>
      <ol className="spine">
        {shown.map(row => <SpineLine key={row.key} row={row} dated={dated} />)}
      </ol>
      {shown.length < rows.length && (
        <Button variant="ghost" size="sm" className="spine-more text-muted-foreground" onClick={() => setExpanded(true)}>
          Show {(rows.length - shown.length).toLocaleString('en-IN')} more
        </Button>
      )}
    </>
  )
}

function SpineLine({ row, dated }: { row: TimelineRow; dated: boolean }) {
  const vault = useVault()
  const [open, setOpen] = useState(false)
  const long = row.detail.length > LONG_DETAIL
  const item = row.itemId ? vault.byId.get(row.itemId) : null
  const project = row.projectId && row.projectId !== row.itemId ? vault.byId.get(row.projectId) : null
  const Icon = row.source === 'log' ? LOG_ICONS[row.label.toLowerCase()] ?? CircleDotIcon : null
  const title = item ? <a href={itemHref(item.id)} className="spine-link font-medium text-foreground">{row.title}</a> : <span className="font-medium">{row.title}</span>
  return (
    <li className="spine-line" data-source={row.source}>
      <span className="spine-time tabular-nums">{dated ? <a href={dayHash(row.day)} className="spine-link">{shortDay(row.day)}</a> : row.time ?? ''}</span>
      <span className="spine-mark" aria-hidden="true">
        {Icon ? <Icon className="size-3.5" /> : <TypeIcon type={item?.type} className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        {row.source === 'log' ? (
          <>
            <p className={cn('text-sm [overflow-wrap:anywhere]', long && !open && 'line-clamp-3')}>
              <span className="text-muted-foreground">{row.label}{dated && row.time ? ` ${row.time}` : ''}</span>{row.detail ? ' ' : ''}
              {row.detail !== row.title && readableDetail(row.detail)}
            </p>
            {long && (
              <Button variant="link" size="xs" className="h-auto p-0 text-xs text-muted-foreground" aria-expanded={open} onClick={() => setOpen(value => !value)}>
                {open ? 'Show less' : 'Show all'}
              </Button>
            )}
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {title}{project ? <> · {project.name}</> : null}
            </p>
          </>
        ) : (
          <>
            <p className="truncate text-sm">{title}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {row.label}{project ? <> · {project.name}</> : null}
            </p>
          </>
        )}
      </div>
      <ScopeDot scope={row.scope} className="mt-1.5" />
    </li>
  )
}

/** Scheduled lines: deadlines, meetings, reminders, and plans for the day. */
export function ScheduleList({ rows }: { rows: TimelineRow[] }) {
  const vault = useVault()
  return (
    <ol className="spine">
      {rows.map(row => {
        const item = row.itemId ? vault.byId.get(row.itemId) : null
        const closed = item?.type === 'task' && !isOpenTask(item)
        const disabled = item && isDisabledSchedule(item)
        return (
          <li key={row.key} className="spine-line" data-source="schedule" data-done={closed || undefined}>
            <span className="spine-time tabular-nums">{row.time ?? 'All day'}</span>
            <span className="spine-mark" aria-hidden="true"><TypeIcon type={item?.type} className="size-3.5" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {item ? <a href={itemHref(item.id)} className="spine-link row-title font-medium text-foreground">{row.title}</a> : row.title}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>{row.label}</span>
                {closed && <span>done</span>}
                {disabled && <Badge variant="outline" className="h-5 px-1.5 text-xs font-normal">{isPendingReview(item) ? 'Waiting for review' : 'Disabled'}</Badge>}
                {row.projectId && vault.byId.get(row.projectId) && <span className="truncate">{vault.byId.get(row.projectId)!.name}</span>}
              </p>
            </div>
            <ScopeDot scope={row.scope} className="mt-1.5" />
          </li>
        )
      })}
    </ol>
  )
}

/** Artifacts, evidence, and archived records of a day, folded under their parent item. */
export function BulkGroup({ rows, className }: { rows: TimelineRow[]; className?: string }) {
  const vault = useVault()
  const [open, setOpen] = useState(false)
  if (!rows.length) return null
  const groups = open ? groupByParent(vault, rows) : []
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('bulk-group', className)}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="fold-trigger -ml-2 gap-1.5 px-2 font-normal text-muted-foreground aria-expanded:bg-transparent">
          <ChevronRightIcon className="fold-chevron" />
          <PaperclipIcon />
          {rows.length === 1 ? '1 artifact or archived record' : `${rows.length.toLocaleString('en-IN')} artifacts, evidence files, and archived records`}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="fold-content">
        <ul className="mt-1 grid gap-2 pl-6">
          {groups.slice(0, 30).map(group => (
            <li key={group.parentId ?? 'none'} className="text-sm">
              <p className="flex items-baseline gap-2">
                {group.parentId ? <a href={itemHref(group.parentId)} className="spine-link font-medium">{group.title}</a> : <span className="font-medium">{group.title}</span>}
                <span className="text-xs tabular-nums text-muted-foreground">{group.rows.length.toLocaleString('en-IN')}</span>
              </p>
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {group.rows.slice(0, 8).map((row, index) => (
                  <span key={row.key}>
                    {index > 0 && ', '}
                    {row.itemId ? <a href={itemHref(row.itemId)} className="spine-link">{row.title}</a> : row.title}
                  </span>
                ))}
                {group.rows.length > 8 && <span>, and {(group.rows.length - 8).toLocaleString('en-IN')} more</span>}
              </p>
            </li>
          ))}
          {groups.length > 30 && <li className="text-xs text-muted-foreground">{groups.length - 30} more groups. Narrow the scope or open a parent item.</li>}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
