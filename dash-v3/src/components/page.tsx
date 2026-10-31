import { useState, type ReactNode } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { useScope } from '@/lib/store'
import { SCOPE_LABELS } from '@/lib/vault'
import { cn } from '@/lib/utils'

export function PageHeader({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 id="page-title" tabIndex={-1} className="text-[1.375rem] leading-tight font-semibold tracking-[-0.01em] text-balance outline-none">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  )
}

export function Section({ title, count, actions, children, className }: { title: string; count?: number; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mb-8', className)} aria-label={title}>
      <header className="mb-1 flex items-center gap-2 border-b pb-1.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {count !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{count.toLocaleString('en-IN')}</span>}
        {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      </header>
      {children}
    </section>
  )
}

const OPEN_KEY = '2b.groups'
function storedOpen(id: string, fallback: boolean) {
  try {
    const value = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}')[id]
    return typeof value === 'boolean' ? value : fallback
  } catch {
    return fallback
  }
}

/** A small group with a count that the user can fold. The choice is remembered. */
export function FoldGroup({ id, title, count, tone, defaultOpen = true, children }: { id: string; title: string; count: number; tone?: 'warn' | 'progress'; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(() => storedOpen(id, defaultOpen))
  const change = (next: boolean) => {
    setOpen(next)
    try { localStorage.setItem(OPEN_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'), [id]: next })) } catch { /* keep it for this view only */ }
  }
  return (
    <Collapsible open={open} onOpenChange={change} className="mb-6">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="fold-trigger -ml-2 gap-1.5 px-2 text-sm font-semibold aria-expanded:bg-transparent">
          <ChevronRightIcon className="fold-chevron text-muted-foreground" />
          {tone && <span className="tone-dot size-2 rounded-full" data-tone={tone} aria-hidden="true" />}
          {title}
          <span className="text-xs font-normal tabular-nums text-muted-foreground">{count.toLocaleString('en-IN')}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="fold-content">{children}</CollapsibleContent>
    </Collapsible>
  )
}

export function EmptyState({ title, description, children }: { title: string; description: ReactNode; children?: ReactNode }) {
  return (
    <Empty className="border border-dashed py-10">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children && <EmptyContent className="flex-row justify-center">{children}</EmptyContent>}
    </Empty>
  )
}

/** Shown when the current scope hides items that exist in another scope. `noun` is [one, many]. */
export function OtherScopeHint({ hidden, noun = ['item', 'items'] }: { hidden: number; noun?: [string, string] }) {
  const [scope, setScope] = useScope()
  if (scope === 'all' || hidden <= 0) return null
  return (
    <p className="mt-3 text-xs text-muted-foreground">
      {hidden.toLocaleString('en-IN')} more {hidden === 1 ? `${noun[0]} is` : `${noun[1]} are`} outside {SCOPE_LABELS[scope]}.{' '}
      <Button variant="link" size="xs" className="h-auto p-0 text-xs" onClick={() => setScope('all')}>Show all scopes</Button>
    </p>
  )
}

export function ShowMore({ shown, total, onMore, step = 100 }: { shown: number; total: number; onMore: () => void; step?: number }) {
  if (shown >= total) return null
  return (
    <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
      <Button variant="outline" size="sm" onClick={onMore}>Show {Math.min(step, total - shown).toLocaleString('en-IN')} more</Button>
      <span className="tabular-nums">{shown.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}</span>
    </div>
  )
}
