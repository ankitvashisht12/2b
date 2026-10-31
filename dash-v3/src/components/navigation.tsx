import {
  CalendarDaysIcon, FolderKanbanIcon, HashIcon, HistoryIcon, InboxIcon, LibraryIcon, SettingsIcon, ShapesIcon, SunIcon, WaypointsIcon, type LucideIcon,
} from 'lucide-react'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuBadge,
  SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar,
} from '@/components/ui/sidebar'
import { Kbd } from '@/components/ui/kbd'
import { useAppActions } from '@/lib/app-actions'
import { useScope, useVault, useVaultContext } from '@/lib/store'
import { inScope, isInbox, SCOPE_LABELS } from '@/lib/vault'
import { formatDay, todayKey } from '@/lib/dates'

/** `key`: press G, then this key, to open the page. */
export interface NavEntry { title: string; route: string; hash: string; icon: LucideIcon; routes: string[]; key?: string }

export const NAV_MAIN: NavEntry[] = [
  { title: 'Today', route: 'today', hash: '#today', icon: SunIcon, routes: ['today', 'day'], key: 't' },
  { title: 'Timeline', route: 'timeline', hash: '#timeline', icon: HistoryIcon, routes: ['timeline'], key: 'h' },
  { title: 'Calendar', route: 'calendar', hash: '#calendar', icon: CalendarDaysIcon, routes: ['calendar'], key: 'c' },
  { title: 'Inbox', route: 'inbox', hash: '#inbox', icon: InboxIcon, routes: ['inbox'], key: 'i' },
  { title: 'Projects', route: 'projects', hash: '#projects', icon: FolderKanbanIcon, routes: ['projects'], key: 'p' },
  { title: 'Library', route: 'library', hash: '#library', icon: LibraryIcon, routes: ['library'], key: 'l' },
]

export const NAV_VAULT: NavEntry[] = [
  { title: 'Tags', route: 'tags', hash: '#tags', icon: HashIcon, routes: ['tags'] },
  { title: 'Types', route: 'types', hash: '#types', icon: ShapesIcon, routes: ['types'] },
  { title: 'Graph', route: 'graph', hash: '#graph', icon: WaypointsIcon, routes: ['graph'], key: 'g' },
  { title: 'Settings', route: 'settings', hash: '#settings', icon: SettingsIcon, routes: ['settings'], key: 's' },
]

/** The sidebar section that holds the current page. Item pages belong to Projects or Library. */
export function sectionFor(routeName: string, itemType: string | undefined) {
  if (routeName === 'item') return itemType === 'project' ? 'projects' : 'library'
  return [...NAV_MAIN, ...NAV_VAULT].find(entry => entry.routes.includes(routeName))?.route ?? 'today'
}

export function AppSidebar({ section }: { section: string }) {
  const vault = useVault()
  const { complete } = useVaultContext()
  const [scope] = useScope()
  const { isMobile, setOpenMobile } = useSidebar()
  const { openShortcuts } = useAppActions()
  const inboxCount = vault.items.filter(item => isInbox(item) && inScope(vault.scopeOf.get(item.id) ?? null, scope)).length
  const close = () => { if (isMobile) setOpenMobile(false) }
  const menu = (entries: NavEntry[]) => (
    <SidebarMenu>
      {entries.map(entry => (
        <SidebarMenuItem key={entry.route}>
          <SidebarMenuButton asChild isActive={section === entry.route} tooltip={entry.title}>
            <a href={entry.hash} onClick={close} aria-current={section === entry.route ? 'page' : undefined}>
              <entry.icon />
              <span>{entry.title}</span>
            </a>
          </SidebarMenuButton>
          {entry.route === 'inbox' && inboxCount > 0 && <SidebarMenuBadge className="tabular-nums">{inboxCount.toLocaleString('en-IN')}</SidebarMenuBadge>}
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="2b, go to Today">
              <a href="#today" onClick={close}>
                <span className="brand-mark flex aspect-square size-8 items-center justify-center rounded-md text-sm font-semibold">2b</span>
                <span className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">2b</span>
                  <span className="truncate text-xs text-muted-foreground">{formatDay(todayKey())} · IST</span>
                </span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Main" className="flex flex-col">
          <SidebarGroup>
            <SidebarGroupContent>{menu(NAV_MAIN)}</SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Vault</SidebarGroupLabel>
            <SidebarGroupContent>{menu(NAV_VAULT)}</SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter className="group-data-[collapsible=icon]:hidden">
        <p className="px-2 text-xs text-muted-foreground">
          Showing {scope === 'all' ? 'Work and Personal' : SCOPE_LABELS[scope]} · {vault.stats.objects.toLocaleString('en-IN')} items in vault{complete ? '' : ' · loading'}
        </p>
        <button type="button" className="rail-link flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground" onClick={() => { close(); openShortcuts() }}>
          Keyboard shortcuts <Kbd>?</Kbd>
        </button>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
