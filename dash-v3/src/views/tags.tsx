import { useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, PageHeader, ShowMore } from '@/components/page'
import { withQuery } from '@/lib/router'
import { patchItem, useScope, useVault, useVaultContext } from '@/lib/store'
import { api, countBy, errorText, inScope, SCOPE_LABELS, type Item } from '@/lib/vault'

const PAGE = 100

export function TagsView() {
  const vault = useVault()
  const [scope] = useScope()
  const [limit, setLimit] = useState(PAGE)
  const [editing, setEditing] = useState<string | null>(null)

  const tagItems = useMemo(() => new Map(vault.items.filter(item => item.type === 'tag').map(item => [item.name.toLowerCase(), item])), [vault])
  const usage = useMemo(() => {
    const scoped = vault.items.filter(item => inScope(vault.scopeOf.get(item.id) ?? null, scope))
    const counts = countBy(scoped, item => item.tags)
    if (scope === 'all') for (const tag of tagItems.values()) if (!counts.some(([name]) => name.toLowerCase() === tag.name.toLowerCase())) counts.push([tag.name, 0])
    return counts
  }, [vault, scope, tagItems])

  return (
    <div className="max-w-4xl">
      <PageHeader title="Tags" description={`Light labels. A tag can carry a description; it does not need a page.${scope === 'all' ? '' : ` Counts are for ${SCOPE_LABELS[scope]}.`}`} />
      {usage.length ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead><span className="sr-only">Action</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.slice(0, limit).map(([tag, count]) => {
                const tagItem = tagItems.get(tag.toLowerCase())
                const description = tagItem?.description || (typeof tagItem?.properties.description === 'string' ? tagItem.properties.description : '')
                return (
                  <TableRow key={tag}>
                    <TableCell className="max-w-64 font-medium">
                      <span className="flex min-w-0 items-center gap-2">
                        <a className="spine-link truncate" href={withQuery('#library', { tag })} title={'#' + tag}>#{tag}</a>
                        {/* "work" and "personal" set the scope; the scope switch filters by them. */}
                        {['work', 'personal'].includes(tag.toLowerCase()) && <Badge variant="outline" className="font-normal text-muted-foreground">Scope</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal text-muted-foreground">{description || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{count.toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(tag)} aria-label={`${description ? 'Edit' : 'Add'} description for ${tag}`}>{description ? 'Edit description' : 'Add description'}</Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <ShowMore shown={Math.min(limit, usage.length)} total={usage.length} onMore={() => setLimit(value => value + PAGE)} />
        </>
      ) : <EmptyState title="No tags in this scope" description="Add tags when you add or edit an item." />}
      <TagDialog tag={editing} tagItem={editing ? tagItems.get(editing.toLowerCase()) : undefined} onClose={() => setEditing(null)} />
    </div>
  )
}

function TagDialog({ tag, tagItem, onClose }: { tag: string | null; tagItem: Item | undefined; onClose: () => void }) {
  const { saveItem } = useVaultContext()
  const current = tagItem?.description || (typeof tagItem?.properties.description === 'string' ? tagItem.properties.description : '')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  if (tag !== openedFor) {
    setOpenedFor(tag)
    setText(current)
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!tag) return
    setSaving(true)
    setError('')
    try {
      const saved = tagItem
        ? await patchItem(tagItem.id, { description: text.trim() })
        : await api<Item>('/api/objects', { method: 'POST', body: JSON.stringify({ type: 'tag', name: tag, description: text.trim() }) })
      saveItem(saved)
      toast.success(`Saved the description of #${tag}.`)
      onClose()
    } catch (problem) {
      setError(`Not saved: ${errorText(problem)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={tag !== null} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Describe #{tag}</DialogTitle>
            <DialogDescription>Say what the tag means, so you and your agents use it the same way.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="tag-description">Description</FieldLabel>
            <Textarea id="tag-description" rows={4} value={text} onChange={event => setText(event.target.value)} autoFocus />
          </Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save description'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
