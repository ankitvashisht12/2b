import { useState } from 'react'
import { KeyboardIcon, PlusIcon, RefreshCwIcon, SearchIcon } from 'lucide-react'
import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command'
import { ScopeDot, TypeIcon } from '@/components/item-bits'
import { NAV_MAIN, NAV_VAULT, type NavEntry } from '@/components/navigation'
import { useAppActions } from '@/lib/app-actions'
import { itemHref } from '@/lib/markdown'
import { navigate } from '@/lib/router'
import { useScope, useVault, useVaultContext } from '@/lib/store'
import { SCOPE_LABELS, searchItems, typeLabel } from '@/lib/vault'
import { shortDay } from '@/lib/dates'

const PAGES = [...NAV_MAIN, ...NAV_VAULT]

export function SearchPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const vault = useVault()
  const { reload, complete } = useVaultContext()
  const { openCapture, openShortcuts } = useAppActions()
  const [scope, setScope] = useScope()
  const [query, setQuery] = useState('')
  const typed = query.trim()
  const result = searchItems(vault, query, scope, 50)
  const pages = typed ? PAGES.filter(entry => entry.title.toLowerCase().includes(typed.toLowerCase())) : PAGES
  const go = (hash: string) => {
    onOpenChange(false)
    setQuery('')
    navigate(hash)
  }
  const capture = (name: string) => {
    onOpenChange(false)
    setQuery('')
    openCapture({ name })
  }
  const scopeNote = scope === 'all' ? 'all items' : `${SCOPE_LABELS[scope]} items`
  const pageGroup = (entries: NavEntry[]) => (
    <CommandGroup heading="Go to">
      {entries.map(entry => (
        <CommandItem key={entry.route} value={'page-' + entry.route} onSelect={() => go(entry.hash)}>
          <entry.icon />
          {entry.title}
          {entry.key && <CommandShortcut>G {entry.key.toUpperCase()}</CommandShortcut>}
        </CommandItem>
      ))}
    </CommandGroup>
  )
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description={`Search ${scopeNote} by name, description, tag, or path.`} className="sm:max-w-2xl">
      <Command shouldFilter={false}>
      <CommandInput placeholder={`Search ${scopeNote}…`} value={query} onValueChange={setQuery} />
      <CommandList className="max-h-[min(60vh,28rem)]">
        {typed ? (
          <>
            {result.items.length > 0 ? (
              <CommandGroup heading={result.total > result.items.length ? `First ${result.items.length} of ${result.total.toLocaleString('en-IN')} items` : `${result.total} ${result.total === 1 ? 'item' : 'items'}`}>
                {result.items.map(item => (
                  <CommandItem key={item.id} value={item.id} onSelect={() => go(itemHref(item.id))}>
                    <TypeIcon type={item.type} />
                    <span className="truncate">{item.name}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      <span>{typeLabel(vault, item.type)}</span>
                      <span className="tabular-nums">{shortDay(vault.changedTime.get(item.id) ? new Date(vault.changedTime.get(item.id)!).toISOString() : '')}</span>
                      <ScopeDot scope={vault.scopeOf.get(item.id) ?? null} />
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              // The Actions group below always has a row, so cmdk's own "empty" text never shows. Say it here.
              <p role="status" className="px-3 py-3 text-sm text-muted-foreground">No item matches “{typed}” in {complete ? scopeNote : 'tasks, projects, and Inbox'}.</p>
            )}
            {!complete && <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">The full vault is still loading. Notes and files show here when it is ready.</p>}
            {pages.length > 0 && pageGroup(pages)}
            <CommandSeparator />
            <CommandGroup heading="Actions">
              {scope !== 'all' && result.otherScopes > 0 && (
                <CommandItem value="search-all-scopes" onSelect={() => setScope('all')}>
                  <SearchIcon />
                  Search all scopes ({result.otherScopes.toLocaleString('en-IN')} more {result.otherScopes === 1 ? 'match' : 'matches'})
                </CommandItem>
              )}
              <CommandItem value="capture-query" onSelect={() => capture(typed)}>
                <PlusIcon />
                New item “{typed}”
              </CommandItem>
            </CommandGroup>
          </>
        ) : (
          <>
            {pageGroup(pages)}
            <CommandSeparator />
            <CommandGroup heading="Actions">
              <CommandItem value="new-item" onSelect={() => capture('')}>
                <PlusIcon />
                New item
                <CommandShortcut>N</CommandShortcut>
              </CommandItem>
              <CommandItem value="new-type" onSelect={() => go('#types?new=1')}>
                <PlusIcon />
                New type
              </CommandItem>
              <CommandItem value="shortcuts" onSelect={() => { onOpenChange(false); openShortcuts() }}>
                <KeyboardIcon />
                Keyboard shortcuts
                <CommandShortcut>?</CommandShortcut>
              </CommandItem>
              <CommandItem value="reload" onSelect={() => { onOpenChange(false); void reload() }}>
                <RefreshCwIcon />
                Reload items from the vault
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
