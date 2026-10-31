import { useState } from 'react'
import { CheckIcon, InboxIcon, PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Hint, ItemRow, TagBadges } from '@/components/item-bits'
import { EmptyState, OtherScopeHint, PageHeader, ShowMore } from '@/components/page'
import { useMarkProcessed, useTaskToggle } from '@/lib/actions'
import { useAppActions } from '@/lib/app-actions'
import { useScope, useVault } from '@/lib/store'
import { inScope, isInbox, SCOPE_LABELS, type Item } from '@/lib/vault'

const PAGE = 100

/** After a row leaves the Inbox, the keyboard stays in the list: focus goes to the next row's Process button. */
function focusRow(position: number) {
  requestAnimationFrame(() => {
    const buttons = document.querySelectorAll<HTMLButtonElement>('[data-process]')
    ;(buttons[Math.min(position, buttons.length - 1)] ?? document.getElementById('page-title'))?.focus()
  })
}

export function InboxView() {
  const vault = useVault()
  const [scope] = useScope()
  const { openCapture, openProcess } = useAppActions()
  const { markProcessed, busyId } = useMarkProcessed()
  const { toggle, busyId: taskBusy } = useTaskToggle()
  const [limit, setLimit] = useState(PAGE)
  const all = vault.items.filter(isInbox)
  const items = all.filter(item => inScope(vault.scopeOf.get(item.id) ?? null, scope))
    .sort((left, right) => (vault.createdTime.get(right.id) ?? 0) - (vault.createdTime.get(left.id) ?? 0))
  const scopeText = scope === 'all' ? '' : ` in ${SCOPE_LABELS[scope]}`

  const quickProcess = async (item: Item) => {
    const position = items.indexOf(item)
    if (await markProcessed(item)) focusRow(position)
  }
  const process = (item: Item) => {
    const position = items.indexOf(item)
    openProcess(item, { markProcessed: true, onSaved: () => focusRow(position) })
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Inbox"
        description={items.length ? `${items.length.toLocaleString('en-IN')} ${items.length === 1 ? 'item' : 'items'} to process${scopeText}, newest first. Process gives each item a type and a place.` : `Nothing to process${scopeText}.`}
      />
      {items.length ? (
        <>
          <ul>
            {items.slice(0, limit).map(item => (
              <ItemRow
                key={item.id}
                item={item}
                date={new Date(vault.createdTime.get(item.id) || Date.parse(item.createdAt)).toISOString()}
                onToggleTask={toggle}
                busy={taskBusy === item.id}
                meta={<TagBadges tags={item.tags} limit={3} />}
                actions={
                  <>
                    <Button variant="outline" size="sm" data-process onClick={() => process(item)} aria-label={`Process “${item.name}”`}>
                      <InboxIcon />Process…
                    </Button>
                    <Hint label="Mark processed, no other change">
                      <Button variant="ghost" size="icon-sm" onClick={() => void quickProcess(item)} disabled={busyId === item.id} aria-label={`Mark “${item.name}” processed`}>
                        <CheckIcon />
                      </Button>
                    </Hint>
                  </>
                }
              />
            ))}
          </ul>
          <ShowMore shown={Math.min(limit, items.length)} total={items.length} onMore={() => setLimit(value => value + PAGE)} />
        </>
      ) : (
        <EmptyState title="Inbox is empty" description="New items land here. Press N to add one.">
          <Button onClick={() => openCapture()}><PlusIcon />New item</Button>
        </EmptyState>
      )}
      <OtherScopeHint hidden={all.length - items.length} noun={['Inbox item', 'Inbox items']} />
    </div>
  )
}
