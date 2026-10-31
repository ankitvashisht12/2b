import { useState } from 'react'
import { ChevronsUpDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScopeDot, TypeIcon } from '@/components/item-bits'
import { useVault } from '@/lib/store'
import { byRecent, searchItems, statusOf, typeLabel, type Item } from '@/lib/vault'

const isClosed = (item: Item) => ['done', 'archived'].includes(statusOf(item).toLowerCase())

interface ItemPickerProps {
  id?: string
  label: string
  /** Only items of these types, when set. */
  targetTypes?: string[]
  excludeId?: string
  value: Item | null
  onPick: (item: Item) => void
  placeholder?: string
}

/** Find an item by name. Search covers every scope, because links can cross Work and Personal. */
export function ItemPicker({ id, label, targetTypes, excludeId, value, onPick, placeholder = 'Choose an item' }: ItemPickerProps) {
  const vault = useVault()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const typed = query.trim()
  // With a type limit (for example projects), the list shows before any typing, newest first.
  const results = !open ? [] : typed
    ? searchItems(vault, query, 'all', targetTypes ? 400 : 60).items.filter(item => item.id !== excludeId && (!targetTypes || targetTypes.includes(item.type))).slice(0, 20)
    : targetTypes
      ? vault.items.filter(item => item.id !== excludeId && targetTypes.includes(item.type) && !isClosed(item)).sort(byRecent(vault)).slice(0, 50)
      : []
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} aria-label={value ? `${label}: ${value.name}` : label} className="w-full justify-between font-normal">
          <span className={value ? 'truncate' : 'truncate text-muted-foreground'}>{value ? value.name : placeholder}</span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search by name" value={query} onValueChange={setQuery} aria-label={`Search for ${label.toLowerCase()}`} />
          <CommandList>
            {typed ? <CommandEmpty>No matching item.</CommandEmpty> : <CommandEmpty>Type a name to search.</CommandEmpty>}
            {results.length > 0 && (
              <CommandGroup>
                {results.map(item => (
                  <CommandItem key={item.id} value={item.id} onSelect={() => { onPick(item); setOpen(false); setQuery('') }}>
                    <TypeIcon type={item.type} />
                    <span className="truncate">{item.name}</span>
                    <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                      {typeLabel(vault, item.type)}
                      <ScopeDot scope={vault.scopeOf.get(item.id) ?? null} />
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
