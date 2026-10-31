import { Component, Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { PlusIcon, RotateCcwIcon, SearchIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CaptureDialog } from '@/components/capture-dialog'
import { Hint } from '@/components/item-bits'
import { AppSidebar, NAV_MAIN, NAV_VAULT, sectionFor } from '@/components/navigation'
import { EmptyState, PageHeader } from '@/components/page'
import { ProcessDialog, type ProcessRequest } from '@/components/process-dialog'
import { SearchPalette } from '@/components/search-palette'
import { ShortcutsDialog } from '@/components/shortcuts-dialog'
import { undoLatest } from '@/lib/actions'
import { AppActionsContext, type AppActions, type CaptureContext } from '@/lib/app-actions'
import { formatDay, isDayKey, todayKey } from '@/lib/dates'
import { isTypingTarget } from '@/lib/keys'
import { navigate, useRoute, withQuery, type Route } from '@/lib/router'
import { ActivityProvider, ScopeProvider, useScope, useVault, useVaultContext, VaultProvider } from '@/lib/store'
import { SCOPE_LABELS, typeLabel, type Item, type Scope, type Vault } from '@/lib/vault'
import { CalendarView } from '@/views/calendar'
import { DayView } from '@/views/day'
import { InboxView } from '@/views/inbox'
import { ItemView } from '@/views/item'
import { LibraryView } from '@/views/library'
import { ProjectsView } from '@/views/projects'
import { SettingsView } from '@/views/settings'
import { TagsView } from '@/views/tags'
import { TimelineView } from '@/views/timeline'
import { TypesView } from '@/views/types'

// The graph and its Canvas library load only when the graph opens.
const GraphView = lazy(() => import('@/views/graph').then(module => ({ default: module.GraphView })))

export function App() {
  return (
    <ScopeProvider>
      <VaultProvider>
        <ActivityProvider>
          <TooltipProvider delayDuration={500}>
            <Shell />
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </ActivityProvider>
      </VaultProvider>
    </ScopeProvider>
  )
}

function Shell() {
  const { vault, loadError, reload } = useVaultContext()
  if (vault) return <PageBoundary><Workspace /></PageBoundary>
  if (loadError) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24">
        <EmptyState title="2b is not reachable" description={`Could not load your vault: ${loadError}. Check that the 2b V3 server is running, then try again.`}>
          <Button onClick={() => void reload()}><RotateCcwIcon />Try again</Button>
        </EmptyState>
      </main>
    )
  }
  return (
    <div className="flex min-h-svh" aria-busy="true" aria-label="Loading your vault">
      <div className="hidden w-64 shrink-0 border-r bg-sidebar p-3 md:block">{[0, 1, 2, 3, 4, 5].map(index => <Skeleton key={index} className="mb-2 h-7" />)}</div>
      <div className="flex-1 p-8">
        <Skeleton className="mb-6 h-7 w-48" />
        {[0, 1, 2, 3, 4].map(index => <Skeleton key={index} className="mb-3 h-10 max-w-3xl" />)}
        <p className="text-sm text-muted-foreground">Loading your vault…</p>
      </div>
    </div>
  )
}

const sidebarOpenByDefault = () => !document.cookie.split('; ').includes('sidebar_state=false')

// Day pages share one key, so a move between days keeps focus on the day controls or the month.
// Item and graph pages start fresh for each item.
const pageKey = (route: Route) => (['today', 'day'].includes(route.name) ? 'day' : ['item', 'graph'].includes(route.name) ? `${route.name}/${route.param}` : route.name)
const GO_TO = [...NAV_MAIN, ...NAV_VAULT].filter(entry => entry.key)

function Workspace() {
  const vault = useVault()
  const route = useRoute()
  const [captureOpen, setCaptureOpen] = useState(false)
  const [captureRequest, setCaptureRequest] = useState<{ context: CaptureContext }>({ context: {} })
  const [searchOpen, setSearchOpen] = useState(false)
  const [processOpen, setProcessOpen] = useState(false)
  const [processRequest, setProcessRequest] = useState<ProcessRequest | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const actions = useMemo<AppActions>(() => ({
    openCapture: (context = {}) => { setCaptureRequest({ context }); setCaptureOpen(true) },
    openSearch: () => setSearchOpen(true),
    openProcess: (item, options = {}) => { setProcessRequest({ id: Date.now(), item, options }); setProcessOpen(true) },
    openShortcuts: () => setShortcutsOpen(true),
  }), [])
  useEffect(() => {
    let goPressedAt = 0
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(open => !open)
        return
      }
      const dialogOpen = Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'))
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z') {
        if (!isTypingTarget(event.target) && !dialogOpen && undoLatest()) event.preventDefault()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target) || dialogOpen) return
      // "G" then a letter opens a page. The second key goes no further, so "G T" does not also act as "T".
      if (Date.now() - goPressedAt < 1500) {
        goPressedAt = 0
        const entry = GO_TO.find(nav => nav.key === event.key.toLowerCase())
        if (entry) {
          event.preventDefault()
          event.stopPropagation()
          navigate(entry.hash)
        }
        return
      }
      if (event.key === 'g' || event.key === 'G') goPressedAt = Date.now()
      else if (event.key === '?') { event.preventDefault(); setShortcutsOpen(true) }
      else if (event.key === '/') { event.preventDefault(); setSearchOpen(true) }
      else if (event.key === 'n' || event.key === 'N') { event.preventDefault(); actions.openCapture() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [actions])

  // A new page moves focus to its title for screen readers and keyboard users. Day-to-day moves keep focus on the day controls.
  const previous = useRef(route)
  useEffect(() => {
    const before = previous.current
    previous.current = route
    const newPage = before.name !== route.name && !(['today', 'day'].includes(before.name) && ['today', 'day'].includes(route.name))
    if (newPage || (['item', 'graph'].includes(route.name) && before.param !== route.param)) {
      window.scrollTo(0, 0)
      document.getElementById('page-title')?.focus({ preventScroll: true })
    } else if (before.param !== route.param) window.scrollTo(0, 0)
  }, [route])

  const item = route.name === 'item' ? vault.byId.get(route.param) : undefined
  const section = sectionFor(route.name, item?.type)
  useEffect(() => {
    const title = document.getElementById('page-title')?.textContent
    document.title = title ? `${title} · 2b` : '2b'
  })

  return (
    <AppActionsContext.Provider value={actions}>
      <SidebarProvider defaultOpen={sidebarOpenByDefault()}>
        <a href="#main" className="skip-link" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus() }}>Skip to content</a>
        <AppSidebar section={section} />
        <SidebarInset>
          <header className="topbar sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b px-3 md:px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 hidden data-[orientation=vertical]:h-4 sm:block" />
            <Crumbs route={route} item={item} vault={vault} />
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <ScopeSwitch />
              <Hint label="Search (/ or ⌘K)">
                <Button variant="outline" size="sm" onClick={() => setSearchOpen(true)} aria-label="Search" className="md:w-44 md:justify-start md:text-muted-foreground">
                  <SearchIcon />
                  <span className="hidden md:inline">Search</span>
                  <Kbd className="ml-auto hidden md:inline-flex">/</Kbd>
                </Button>
              </Hint>
              <Hint label="New item (N)">
                <Button size="sm" onClick={() => actions.openCapture()} aria-label="New item">
                  <PlusIcon />
                  <span className="hidden md:inline">New item</span>
                </Button>
              </Hint>
            </div>
          </header>
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none md:px-8 md:py-8">
            <PageBoundary key={pageKey(route)} resetKey={route.name + '/' + route.param}>
              <FullVaultGate route={route}><RouteView route={route} /></FullVaultGate>
            </PageBoundary>
          </main>
        </SidebarInset>
      </SidebarProvider>
      <CaptureDialog open={captureOpen} onOpenChange={setCaptureOpen} request={captureRequest} />
      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <ProcessDialog open={processOpen} request={processRequest} onClose={() => setProcessOpen(false)} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </AppActionsContext.Provider>
  )
}

function ScopeSwitch() {
  const [scope, setScope] = useScope()
  return (
    <ToggleGroup type="single" size="sm" spacing={0.5} value={scope} onValueChange={value => value && setScope(value as Scope)} aria-label="Scope: show Work, Personal, or all items" className="scope-switch rounded-lg bg-muted p-0.5">
      {(['all', 'work', 'personal'] as Scope[]).map(value => (
        <ToggleGroupItem key={value} value={value} aria-label={`Show ${value === 'all' ? 'all items' : SCOPE_LABELS[value] + ' items'}`} className="h-7 px-2 text-muted-foreground hover:bg-transparent data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm sm:px-2.5">
          {value !== 'all' && <span className="scope-dot size-2 rounded-full" data-scope={value} aria-hidden="true" />}
          {SCOPE_LABELS[value]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function Crumbs({ route, item, vault }: { route: Route; item: Item | undefined; vault: Vault }) {
  const trail: Array<{ label: string; href?: string }> = []
  const titles: Record<string, string> = { timeline: 'Timeline', calendar: 'Calendar', inbox: 'Inbox', projects: 'Projects', tags: 'Tags', types: 'Types', settings: 'Settings' }
  if (route.name === 'today' || route.name === 'day') {
    const day = route.name === 'day' && isDayKey(route.param) ? route.param : todayKey()
    trail.push({ label: 'Today', href: day === todayKey() ? undefined : '#today' })
    if (day !== todayKey()) trail.push({ label: formatDay(day) })
  } else if (route.name === 'library') {
    const type = route.query.get('type')
    trail.push({ label: 'Library', href: type ? '#library' : undefined })
    if (type) trail.push({ label: typeLabel(vault, type, true) })
  } else if (route.name === 'item') {
    if (item?.type === 'project') trail.push({ label: 'Projects', href: '#projects' })
    else if (item) trail.push({ label: 'Library', href: '#library' }, { label: typeLabel(vault, item.type, true), href: withQuery('#library', { type: item.type }) })
    trail.push({ label: item?.name ?? 'Item' })
  } else if (route.name === 'graph') {
    const focus = vault.byId.get(route.param)
    trail.push({ label: 'Graph', href: focus ? '#graph' : undefined })
    if (focus) trail.push({ label: focus.name, href: undefined })
  } else trail.push({ label: titles[route.name] ?? 'Not found' })

  return (
    <Breadcrumb className="hidden min-w-0 sm:block">
      <BreadcrumbList className="flex-nowrap">
        {trail.map((crumb, index) => (
          <Fragment key={index}>
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem className={index === trail.length - 1 ? 'min-w-0' : 'shrink-0'}>
              {crumb.href ? <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink> : <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

// These pages list or link the whole vault. Until it loads they say so, never "empty" or "not found".
const FULL_VAULT_PAGES: Record<string, string> = { timeline: 'Timeline', calendar: 'Calendar', library: 'Library', item: 'Item', graph: 'Graph', tags: 'Tags', types: 'Types' }

function FullVaultGate({ route, children }: { route: Route; children: ReactNode }) {
  const { complete, fullError, reload } = useVaultContext()
  const vault = useVault()
  if (complete) return children
  const title = FULL_VAULT_PAGES[route.name]
  if (!title) {
    return (
      <>
        <p role="status" className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {fullError
            ? <>The full vault did not load: {fullError}. Tasks, meetings, and Inbox still work. <Button variant="outline" size="xs" onClick={() => void reload()}><RotateCcwIcon />Try again</Button></>
            : 'Tasks, meetings, and Inbox are ready. Files and older history are still loading…'}
        </p>
        {children}
      </>
    )
  }
  const noun = route.name === 'item' ? 'this item' : `the ${title.toLowerCase()}`
  return (
    <div className="max-w-3xl" aria-busy={!fullError}>
      <PageHeader title={fullError ? `${title} did not load` : title} description={`${noun.charAt(0).toUpperCase() + noun.slice(1)} needs all ${vault.stats.objects.toLocaleString('en-IN')} items in your vault.`} />
      {fullError ? (
        <Alert>
          <AlertTitle>{fullError}</AlertTitle>
          <AlertDescription>
            <p>Today, Inbox, and Projects still work.</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => void reload()}><RotateCcwIcon />Try again</Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div role="status">
          {[0, 1, 2, 3, 4].map(index => <Skeleton key={index} className="mb-3 h-10" />)}
          <p className="text-sm text-muted-foreground">Loading {noun}…</p>
        </div>
      )}
    </div>
  )
}

function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case 'today': return <DayView day={todayKey()} />
    case 'day': return <DayView day={isDayKey(route.param) ? route.param : todayKey()} />
    case 'timeline': return <TimelineView route={route} />
    case 'calendar': return <CalendarView route={route} />
    case 'inbox': return <InboxView />
    case 'projects': return <ProjectsView />
    case 'library': return <LibraryView route={route} />
    case 'item': return <ItemView key={route.param} id={route.param} />
    case 'graph': return <Suspense fallback={<p className="text-sm text-muted-foreground">Loading the graph…</p>}><GraphView route={route} /></Suspense>
    case 'tags': return <TagsView />
    case 'types': return <TypesView route={route} />
    case 'settings': return <SettingsView />
    default:
      return (
        <div className="max-w-3xl">
          <PageHeader title="This page does not exist" description="The link may be old." />
          <EmptyState title="Nothing here" description="Open Today, or search for the item you want.">
            <Button variant="outline" asChild><a href="#today">Go to Today</a></Button>
          </EmptyState>
        </div>
      )
  }
}

/** A page that fails to render shows the problem and ways out; the rest of the app keeps working. */
class PageBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidUpdate(previous: { resetKey?: string }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Page failed to render', error, info.componentStack) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="max-w-2xl">
        <h1 id="page-title" tabIndex={-1} className="mb-4 text-[1.375rem] font-semibold outline-none">This page did not load</h1>
        <Alert variant="destructive">
          <AlertTitle>{this.state.error.message}</AlertTitle>
          <AlertDescription>
            <p>Your items are not changed. Try again, or open another page.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}><RotateCcwIcon />Try again</Button>
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Reload 2b</Button>
              <Button size="sm" variant="ghost" asChild><a href="#today">Go to Today</a></Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    )
  }
}

