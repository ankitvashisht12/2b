import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ItemPicker } from '@/components/item-picker'
import { PropertyFields, parseProperties } from '@/components/property-fields'
import { useAppActions, type CaptureContext, type CaptureDraft } from '@/lib/app-actions'
import { formatDay } from '@/lib/dates'
import { itemHref } from '@/lib/markdown'
import { navigate } from '@/lib/router'
import { patchItem, useScope, useVault, useVaultContext } from '@/lib/store'
import { api, countBy, errorText, splitTags, typeLabel, type Item, type Relationship, type TypeDefinition, type Vault } from '@/lib/vault'

export const COMMON_TYPES = ['note', 'task', 'project', 'collection', 'person', 'book', 'meeting', 'reminder']
const SHOWN_FIELDS: Record<string, string[]> = { task: ['due', 'priority'], project: ['kind'], meeting: ['startsAt'], reminder: ['at'], book: ['author'] }
/** Types that hold other items through a "part-of" link. */
export const PARENT_TYPES = ['project', 'collection']
const SCOPE_KEY = '2b.captureScope'

type ScopeChoice = CaptureDraft['scope']

export function captureFields(type: TypeDefinition | undefined) {
  return (type?.properties ?? []).filter(definition => definition.required || SHOWN_FIELDS[type!.id]?.includes(definition.key))
}

/** Common types first, then the rest under "More types". Agent runs are made by the worker, not by hand. */
export function typeChoices(vault: Vault) {
  const label = (type: TypeDefinition) => typeLabel(vault, type.id)
  const types = vault.types.filter(type => type.id !== 'agent-run')
  return {
    common: COMMON_TYPES.map(id => types.find(type => type.id === id)).filter((type): type is TypeDefinition => Boolean(type)),
    more: types.filter(type => !COMMON_TYPES.includes(type.id)).sort((left, right) => label(left).localeCompare(label(right))),
  }
}

export function TypeSelect({ id, value, onChange, exclude = [] }: { id: string; value: string; onChange: (typeId: string) => void; exclude?: string[] }) {
  const vault = useVault()
  const choices = useMemo(() => typeChoices(vault), [vault])
  const common = choices.common.filter(type => !exclude.includes(type.id))
  const more = choices.more.filter(type => !exclude.includes(type.id))
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {common.map(option => <SelectItem key={option.id} value={option.id}>{typeLabel(vault, option.id)}</SelectItem>)}
        {more.length > 0 && <SelectSeparator />}
        {more.length > 0 && (
          <SelectGroup>
            <SelectLabel>More types</SelectLabel>
            {more.map(option => <SelectItem key={option.id} value={option.id}>{typeLabel(vault, option.id)}</SelectItem>)}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  )
}

export function ScopeChoiceField({ id, value, onChange }: { id: string; value: ScopeChoice; onChange: (scope: ScopeChoice) => void }) {
  return (
    <Field>
      <FieldLabel id={id}>Scope</FieldLabel>
      <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={value} onValueChange={next => next && onChange(next as ScopeChoice)} aria-labelledby={id}>
        <ToggleGroupItem value="work"><span className="scope-dot size-2 rounded-full" data-scope="work" aria-hidden="true" />Work</ToggleGroupItem>
        <ToggleGroupItem value="personal"><span className="scope-dot size-2 rounded-full" data-scope="personal" aria-hidden="true" />Personal</ToggleGroupItem>
        <ToggleGroupItem value="none">None</ToggleGroupItem>
      </ToggleGroup>
    </Field>
  )
}

/** "Project or collection": the item is saved "part-of" the chosen one. */
export function ParentField({ id, parent, excludeId, onChange }: { id: string; parent: Item | null; excludeId?: string; onChange: (parent: Item | null) => void }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>Project or collection</FieldLabel>
      <div className="flex min-w-0 gap-1">
        <ItemPicker id={id} label="Project or collection" targetTypes={PARENT_TYPES} excludeId={excludeId} value={parent} placeholder="None" onPick={onChange} />
        {parent && <Button type="button" variant="ghost" size="icon" aria-label={`Remove “${parent.name}”`} onClick={() => onChange(null)}><XIcon /></Button>}
      </div>
      <FieldDescription>Optional. The item shows in the list of the project or collection.</FieldDescription>
    </Field>
  )
}

function rememberedScope(): ScopeChoice {
  try {
    const value = localStorage.getItem(SCOPE_KEY)
    return value === 'work' || value === 'personal' ? value : 'none'
  } catch {
    return 'none'
  }
}

const hasText = (draft: CaptureDraft) => Boolean(draft.name.trim() || draft.body.trim() || draft.tags.trim())

export function CaptureDialog({ open, onOpenChange, request }: { open: boolean; onOpenChange: (open: boolean) => void; request: { context: CaptureContext } }) {
  const vault = useVault()
  const { saveItem, addRelationship } = useVaultContext()
  const { openCapture } = useAppActions()
  const [scope] = useScope()
  const [draft, setDraft] = useState<CaptureDraft>({ name: '', typeId: 'note', scope: 'none', tags: '', body: '', values: {}, parentId: null, day: null })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  // Each open starts from what the page knows, or from a draft the user asked to restore. Nothing carries over by accident.
  useEffect(() => {
    if (!open) return
    const { context } = request
    if (context.draft) {
      setDraft(context.draft)
    } else {
      const parent = context.parentId ? vault.byId.get(context.parentId) : undefined
      const parentScope = parent ? vault.scopeOf.get(parent.id) : null
      const typeId = context.type && vault.typeById.has(context.type) ? context.type : 'note'
      setDraft({
        name: context.name ?? '',
        typeId,
        scope: parentScope === 'work' || parentScope === 'personal' ? parentScope : scope !== 'all' ? scope : rememberedScope(),
        tags: '',
        body: '',
        values: context.day && typeId === 'task' ? { due: context.day } : {},
        parentId: parent && PARENT_TYPES.includes(parent.type) ? parent.id : null,
        day: context.day ?? null,
      })
    }
    setError('')
  }, [open, request]) // eslint-disable-line react-hooks/exhaustive-deps -- a new request object opens a new draft

  const type = vault.typeById.get(draft.typeId)
  const fields = captureFields(type)
  const parent = draft.parentId ? vault.byId.get(draft.parentId) ?? null : null
  const knownTags = useMemo(() => countBy(vault.items, item => item.tags).slice(0, 300).map(([tag]) => tag), [vault])
  const update = (change: Partial<CaptureDraft>) => setDraft(current => ({ ...current, ...change }))
  const due = typeof draft.values.due === 'string' && draft.typeId === 'task' ? draft.values.due : ''

  // Closing without saving clears the form. Typed text is one click away in the toast.
  const close = () => {
    onOpenChange(false)
    if (!hasText(draft)) return
    const kept = draft
    toast('Draft discarded.', { action: { label: 'Restore', onClick: () => openCapture({ draft: kept }) } })
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (saving) return
    setError('')
    const name = draft.name.trim()
    if (!name) {
      setError('Give the item a name.')
      nameRef.current?.focus()
      return
    }
    let properties: Record<string, unknown>
    try {
      properties = parseProperties(fields, draft.values)
    } catch (problem) {
      setError(errorText(problem))
      return
    }
    setSaving(true)
    let created: Item
    try {
      created = await api<Item>('/api/objects', {
        method: 'POST',
        body: JSON.stringify({
          type: draft.typeId,
          name,
          tags: splitTags(draft.tags),
          scope: draft.scope,
          properties: {
            ...Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== null)),
            // It stays in the Inbox until it is filed under its project, so a failed link loses nothing.
            processingState: 'inbox',
          },
          ...(draft.body.trim() && draft.typeId !== 'tag' ? { body: draft.body } : {}),
        }),
      })
    } catch (problem) {
      setError(`Not saved: ${errorText(problem)}`)
      setSaving(false)
      return
    }
    saveItem(created)
    try { localStorage.setItem(SCOPE_KEY, draft.scope) } catch { /* the choice lasts for this tab */ }
    setSaving(false)
    onOpenChange(false)
    const openAction = { label: 'Open', onClick: () => navigate(itemHref(created.id)) }
    if (!parent || draft.typeId === 'tag') {
      toast.success(`Saved “${created.name}” to Inbox.`, { action: openAction })
      return
    }
    const file = async () => {
      try {
        addRelationship(await api<Relationship>('/api/relationships', { method: 'POST', body: JSON.stringify({ from: created.id, kind: 'part-of', to: parent.id }) }))
      } catch (problem) {
        toast.error(`Saved “${created.name}” to Inbox, but not in “${parent.name}”: ${errorText(problem)}`, { duration: Infinity, action: { label: 'Try again', onClick: () => void file() } })
        return
      }
      try {
        saveItem(await patchItem(created.id, { properties: { processingState: 'processed' } }))
      } catch { /* It is in the project and also still in the Inbox; nothing is lost. */ }
      toast.success(`Added “${created.name}” to “${parent.name}”.`, { action: openAction })
    }
    await file()
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) close() }}>
      <DialogContent instant className="sm:max-w-lg" onOpenAutoFocus={event => { event.preventDefault(); nameRef.current?.focus() }}>
        <form onSubmit={submit} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit() }} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New item</DialogTitle>
            <DialogDescription>
              {due && <>Due {formatDay(due)}. </>}
              {parent && draft.typeId !== 'tag' ? <>It goes into “{parent.name}”.</> : 'It goes to the Inbox. Process it there later.'}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="capture-name">Name</FieldLabel>
              <Input id="capture-name" ref={nameRef} value={draft.name} onChange={event => update({ name: event.target.value })} maxLength={500} placeholder="What is on your mind?" autoComplete="off" required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <Field>
                <FieldLabel htmlFor="capture-type">Type</FieldLabel>
                <TypeSelect id="capture-type" value={draft.typeId} onChange={next => update({ typeId: next, values: next === 'task' && draft.day ? { due: draft.day } : {} })} />
              </Field>
              <ScopeChoiceField id="capture-scope-label" value={draft.scope} onChange={next => update({ scope: next })} />
            </div>
            {draft.typeId !== 'tag' && (
              <ParentField
                id="capture-parent"
                parent={parent}
                onChange={next => {
                  const nextScope = next ? vault.scopeOf.get(next.id) : null
                  update({ parentId: next?.id ?? null, ...(draft.scope === 'none' && (nextScope === 'work' || nextScope === 'personal') ? { scope: nextScope } : {}) })
                }}
              />
            )}
            {fields.length > 0 && <PropertyFields idPrefix="capture" definitions={fields} values={draft.values} onChange={(key, value) => setDraft(current => ({ ...current, values: { ...current.values, [key]: value } }))} />}
            <Field>
              <FieldLabel htmlFor="capture-tags">Tags</FieldLabel>
              <Input id="capture-tags" value={draft.tags} onChange={event => update({ tags: event.target.value })} placeholder="reading, ideas" autoComplete="off" list="capture-tag-options" />
              <datalist id="capture-tag-options">{knownTags.map(tag => <option key={tag} value={tag} />)}</datalist>
              <FieldDescription>Separate tags with commas.</FieldDescription>
            </Field>
            {draft.typeId !== 'tag' && (
              <Field>
                <FieldLabel htmlFor="capture-body">Content</FieldLabel>
                <Textarea id="capture-body" value={draft.body} onChange={event => update({ body: event.target.value })} rows={5} placeholder="A thought, the next step, or notes" />
              </Field>
            )}
          </FieldGroup>
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter className="items-center">
            <span className="mr-auto hidden text-xs text-muted-foreground sm:block"><Kbd>⌘</Kbd> <Kbd>Enter</Kbd> saves</span>
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : parent && draft.typeId !== 'tag' ? 'Save' : 'Save to Inbox'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
