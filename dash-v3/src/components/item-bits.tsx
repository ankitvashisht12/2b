import type { ReactNode } from 'react'
import {
  BellIcon, BookOpenIcon, BotIcon, Building2Icon, FileClockIcon, FileTextIcon, FolderKanbanIcon, HashIcon, LayersIcon,
  PaperclipIcon, PlayIcon, ServerIcon, ShapesIcon, SquareCheckIcon, UserIcon, UsersIcon, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { itemHref } from '@/lib/markdown'
import { shortDay } from '@/lib/dates'
import { useVault } from '@/lib/store'
import { isDisabledSchedule, isOpenTask, statusOf, typeLabel, valueLabel, type Item, type ItemScope } from '@/lib/vault'

const TYPE_ICONS: Record<string, LucideIcon> = {
  project: FolderKanbanIcon,
  task: SquareCheckIcon,
  note: FileTextIcon,
  collection: LayersIcon,
  person: UserIcon,
  book: BookOpenIcon,
  organization: Building2Icon,
  system: ServerIcon,
  meeting: UsersIcon,
  artifact: PaperclipIcon,
  evidence: FileClockIcon,
  tag: HashIcon,
  reminder: BellIcon,
  'agent-job': BotIcon,
  'agent-run': PlayIcon,
}

export function TypeIcon({ type, className }: { type: string | null | undefined; className?: string }) {
  const Icon = (type && TYPE_ICONS[type]) || ShapesIcon
  return <Icon aria-hidden="true" className={cn('size-4 shrink-0 text-muted-foreground', className)} />
}

const SCOPE_NAMES = { work: 'Work', personal: 'Personal', both: 'Work and Personal' }

/** A small coloured mark: blue for Work, green for Personal. */
export function ScopeDot({ scope, className }: { scope: ItemScope; className?: string }) {
  if (!scope) return null
  return (
    <span
      role="img"
      aria-label={SCOPE_NAMES[scope]}
      title={SCOPE_NAMES[scope]}
      data-scope={scope}
      className={cn('scope-dot inline-block size-2 shrink-0 rounded-full', className)}
    />
  )
}

export function TaskCheck({ item, onToggle, busy }: { item: Item; onToggle: (item: Item, done: boolean) => void; busy?: boolean }) {
  const done = !isOpenTask(item)
  return (
    <Checkbox
      checked={done}
      disabled={busy}
      onCheckedChange={value => onToggle(item, value === true)}
      aria-label={`${done ? 'Reopen' : 'Complete'} ${item.name}`}
      data-task-id={item.id}
      className="relative z-10"
    />
  )
}

interface ItemRowProps {
  item: Item
  /** Text at the left edge, such as a time or a count. */
  lead?: ReactNode
  /** Extra facts shown under the name. */
  meta?: ReactNode
  /** Controls at the right edge. They stay above the row link. */
  actions?: ReactNode
  date?: string | null
  showType?: boolean
  showDescription?: boolean
  onToggleTask?: (item: Item, done: boolean) => void
  busy?: boolean
  /** Completed here a moment ago: the row stays, struck through, then folds away. */
  lingering?: boolean
}

/** One dense line for an item. The whole line opens the item; controls stay clickable. */
// "To do" and "Active" are the normal states; a row names only a state worth noticing.
const QUIET_STATES = new Set(['todo', 'active'])

export function ItemRow({ item, lead, meta, actions, date, showType = true, showDescription = true, onToggleTask, busy, lingering }: ItemRowProps) {
  const vault = useVault()
  const status = statusOf(item)
  const projectId = item.type === 'project' ? null : vault.projectOf.get(item.id)
  const project = projectId ? vault.byId.get(projectId) : null
  const done = item.type === 'task' && !isOpenTask(item)
  return (
    <li className="item-row group/row relative flex min-h-10 items-start gap-3 rounded-md px-2 py-2" data-done={done || undefined} data-lingering={(lingering && done) || undefined}>
      {lead !== undefined && <span className="w-12 shrink-0 pt-0.5 text-right text-xs tabular-nums text-muted-foreground">{lead}</span>}
      <span className="flex h-5 w-4 shrink-0 items-center justify-center">
        {item.type === 'task' && onToggleTask ? <TaskCheck item={item} onToggle={onToggleTask} busy={busy} /> : <TypeIcon type={item.type} />}
      </span>
      <div className="min-w-0 flex-1">
        <a href={itemHref(item.id)} className="row-link block truncate text-sm font-medium text-foreground outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring/60">
          <span className="row-title">{item.name}</span>
        </a>
        {showDescription && item.description && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.description}</p>}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground empty:hidden">
          {showType && <span>{typeLabel(vault, item.type)}</span>}
          {status && !QUIET_STATES.has(status) && !isDisabledSchedule(item) && <span>{valueLabel(status)}</span>}
          {project && <span className="truncate">{project.name}</span>}
          {meta}
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-2 pt-0.5">
        {date && <span className="text-xs tabular-nums text-muted-foreground">{shortDay(date)}</span>}
        <ScopeDot scope={vault.scopeOf.get(item.id) ?? null} />
        {actions && <span className="row-actions relative z-10 flex items-center gap-1">{actions}</span>}
      </span>
    </li>
  )
}

/** Tags other than the scope tags `work` and `personal`, which the scope dot already shows. */
export const plainTags = (tags: string[]) => tags.filter(tag => !['work', 'personal'].includes(tag.toLowerCase()))

export function TagBadges({ tags, limit = 4 }: { tags: string[]; limit?: number }) {
  const shown = plainTags(tags).slice(0, limit)
  return (
    <>
      {shown.map(tag => (
        <Badge key={tag} variant="outline" asChild className="relative z-10 h-5 max-w-48 px-1.5 font-normal text-muted-foreground">
          <a href={'#library?tag=' + encodeURIComponent(tag)} title={'#' + tag}><span className="truncate">#{tag}</span></a>
        </Badge>
      ))}
    </>
  )
}

/** A hover hint for icon-only controls. */
export function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
