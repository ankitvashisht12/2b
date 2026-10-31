import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { CheckIcon, CopyIcon, ExternalLinkIcon, InboxIcon, Link2Icon, MoreHorizontalIcon, PencilIcon, PlusIcon, RotateCcwIcon, ShapesIcon, WaypointsIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { SpineList } from '@/components/day-lines'
import { ItemPicker } from '@/components/item-picker'
import { ItemRow, plainTags, ScopeDot, TagBadges, TypeIcon } from '@/components/item-bits'
import { FoldGroup, PageHeader, Section } from '@/components/page'
import { PropertyFields, parseProperties, rawValues, type RawValues } from '@/components/property-fields'
import { useMarkProcessed, useTaskToggle } from '@/lib/actions'
import { useAppActions } from '@/lib/app-actions'
import { addDays, formatDateTime, formatDay, todayKey } from '@/lib/dates'
import { fileUrl, renderMarkdown, sourceUrl, splitFrontmatter } from '@/lib/markdown'
import { setLeaveGuard, withQuery } from '@/lib/router'
import { patchItem, useActivity, useVault, useVaultContext } from '@/lib/store'
import { logRow } from '@/lib/timeline'
import {
  api, errorText, fieldLabel, isBulk, isDisabledSchedule, isInbox, isOpenTask, isPendingReview, linkLabel, projectKind, splitTags, statusOf,
  typeLabel, valueLabel, type Item, type PropertyDefinition, type Relationship, type Vault,
} from '@/lib/vault'

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i
const SHOWN_DATES = ['sourceVault', 'sourcePath', 'localPath', 'contentDate', 'dateConfidence', 'sourceCreatedAt', 'sourceModifiedAt', 'completedAt', 'activityAt']

interface Detail { id: string; status: 'loading' | 'ready' | 'error'; item?: Item; body?: string; error?: string }

/**
 * Loads the full item and its content. A slow answer for an item the user already left is dropped,
 * so fast moves between items never write into the wrong page.
 */
function useItemDetail(id: string) {
  const [detail, setDetail] = useState<Detail>({ id, status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setDetail({ id, status: 'loading' })
    api<{ object: Item; relationships: Relationship[]; body: string }>('/api/object?id=' + encodeURIComponent(id), { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setDetail({ id, status: 'ready', item: result.object, body: result.body ?? '' }) })
      .catch(error => { if (!controller.signal.aborted) setDetail({ id, status: 'error', error: errorText(error) }) })
    return () => controller.abort()
  }, [id, attempt])
  const current: Detail = detail.id === id ? detail : { id, status: 'loading' }
  return { detail: current, setDetail, retry: () => setAttempt(value => value + 1) }
}

export function ItemView({ id }: { id: string }) {
  const vault = useVault()
  const { detail, setDetail, retry } = useItemDetail(id)
  const summary = vault.byId.get(id)
  const [editing, setEditing] = useState(false)
  useEffect(() => setEditing(false), [id])

  if (detail.status === 'error') {
    return (
      <div className="max-w-3xl">
        <PageHeader title={summary?.name ?? 'Item not available'} />
        <Alert variant="destructive">
          <AlertTitle>Could not open this item</AlertTitle>
          <AlertDescription>
            <p>{detail.error}. Your data is not changed.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={retry}><RotateCcwIcon />Try again</Button>
              <Button variant="ghost" size="sm" asChild><a href="#library">Go to Library</a></Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  // The page shows the newest saved record: a complete, reopen, process, or undo anywhere updates the list
  // index, and the page follows at once. The loaded detail has the full record and the content.
  const item = detail.item && summary && summary.modifiedAt > detail.item.modifiedAt ? summary : detail.item ?? summary
  if (!item) {
    return (
      <div className="max-w-3xl" aria-busy="true">
        <PageHeader title="Opening…" />
        <div className="grid gap-3">{[0, 1, 2].map(index => <Skeleton key={index} className="h-5" />)}</div>
      </div>
    )
  }
  return (
    <ItemPage
      key={item.id}
      item={item}
      vault={vault}
      body={detail.status === 'ready' ? detail.body ?? '' : null}
      editing={editing}
      setEditing={setEditing}
      onSaved={(saved, body) => setDetail(current => current.id === saved.id ? { ...current, item: saved, body: body ?? current.body } : current)}
    />
  )
}

function ItemPage({ item, vault, body, editing, setEditing, onSaved }: { item: Item; vault: Vault; body: string | null; editing: boolean; setEditing: (value: boolean) => void; onSaved: (item: Item, body?: string) => void }) {
  const { saveItem } = useVaultContext()
  const { openCapture, openProcess } = useAppActions()
  const { toggle, busyId } = useTaskToggle()
  const { markProcessed, busyId: processing } = useMarkProcessed()
  const type = vault.typeById.get(item.type)
  const definitions = type?.properties ?? []
  const scope = vault.scopeOf.get(item.id) ?? null
  const status = statusOf(item)
  const schedule = isDisabledSchedule(item)
  const { front, text } = splitFrontmatter(body ?? '')
  const canEditBody = item.type !== 'tag' && (!item.path || /\.(md|txt)$/i.test(item.path)) && !/^(sources|archive)\//.test(item.path ?? '')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || editing || body === null) return
      if ((event.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return
      if (event.key === 'e' || event.key === 'E') {
        event.preventDefault()
        setEditing(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, body, setEditing])

  const afterSave = (saved: Item, savedBody?: string) => {
    saveItem(saved)
    onSaved(saved, savedBody)
  }

  return (
    <article className="max-w-6xl">
      <PageHeader
        title={item.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={withQuery('#library', { type: item.type })} className="spine-link inline-flex items-center gap-1.5"><TypeIcon type={item.type} className="size-3.5" />{typeLabel(vault, item.type)}</a>
            {scope && <span className="inline-flex items-center gap-1.5"><ScopeDot scope={scope} />{scope === 'both' ? 'Work and Personal' : scope === 'work' ? 'Work' : 'Personal'}</span>}
            {schedule ? <span>Disabled</span> : status && <span>{valueLabel(status)}</span>}
            {item.type === 'project' && projectKind(item) && <span>{valueLabel(projectKind(item))}</span>}
            {isInbox(item) && <Badge variant="secondary">In Inbox</Badge>}
            {item.properties.archived === true && <Badge variant="outline">Archived</Badge>}
          </span>
        }
        actions={
          <>
            {item.type === 'task' && (
              isOpenTask(item)
                ? <Button variant="outline" onClick={() => void toggle(item, true)} disabled={busyId === item.id}><CheckIcon />Mark complete</Button>
                : <Button variant="outline" onClick={() => void toggle(item, false)} disabled={busyId === item.id}><RotateCcwIcon />Reopen</Button>
            )}
            {isInbox(item) && (
              <>
                <Button variant="outline" onClick={() => openProcess(item, { markProcessed: true })}><InboxIcon />Process…</Button>
                <Button variant="ghost" disabled={processing === item.id} onClick={() => void markProcessed(item)}><CheckIcon />Mark processed</Button>
              </>
            )}
            {item.type === 'collection' && <Button variant="outline" onClick={() => openCapture({ type: 'note', parentId: item.id })}><PlusIcon />Add note</Button>}
            {!editing && <Button onClick={() => setEditing(true)} disabled={body === null}><PencilIcon />Edit</Button>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More actions"><MoreHorizontalIcon /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => openProcess(item, { markProcessed: false })}><ShapesIcon />Change type or project…</DropdownMenuItem>
                <DropdownMenuItem asChild><a href={'#graph/' + encodeURIComponent(item.id)}><WaypointsIcon />Show connections</a></DropdownMenuItem>
                {item.path && <DropdownMenuItem asChild><a href={fileUrl(item.path)} target="_blank" rel="noopener"><ExternalLinkIcon />Open content file</a></DropdownMenuItem>}
                {sourceUrl(item.properties.sourceVault, item.properties.sourcePath) && (
                  <DropdownMenuItem asChild><a href={sourceUrl(item.properties.sourceVault, item.properties.sourcePath)!} target="_blank" rel="noopener"><ExternalLinkIcon />Open original file</a></DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => { void navigator.clipboard?.writeText(item.id).then(() => toast.success('Item ID copied.'), () => toast.error('Copy is not allowed here.')) }}><CopyIcon />Copy item ID</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {schedule && (isPendingReview(item) ? (
        <Alert className="mb-6">
          <AlertTitle>Imported schedule: disabled until you review it</AlertTitle>
          <AlertDescription>
            <p>2b does not run it. Review it from the CLI: <code className="text-xs">2b show {item.id}</code>, then <code className="text-xs">2b object set {item.id} migrationReview reviewed</code> and <code className="text-xs">2b object set {item.id} enabled true</code>. It runs only while <code className="text-xs">2b worker</code> runs.</p>
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="mb-6">
          <AlertTitle>Disabled</AlertTitle>
          <AlertDescription>2b does not run this {typeLabel(vault, item.type).toLowerCase()}. To schedule it, select Edit and turn on Enabled. It runs only while <code className="text-xs">2b worker</code> runs.</AlertDescription>
        </Alert>
      ))}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          {editing && body !== null
            ? <EditForm item={item} definitions={definitions} front={front} text={text} canEditBody={canEditBody} reviewPending={isPendingReview(item)} onCancel={() => setEditing(false)} onSaved={(saved, savedBody) => { afterSave(saved, savedBody); setEditing(false) }} />
            : <Reader item={item} vault={vault} text={text} loading={body === null} canEditBody={canEditBody} />}
          {item.type === 'project' && <ProjectSections project={item} />}
          {item.type === 'task' && <ItemHistory item={item} />}
          <LinksSection item={item} />
        </div>
        <Facts item={item} definitions={definitions} />
      </div>
    </article>
  )
}

function Reader({ item, vault, text, loading, canEditBody }: { item: Item; vault: Vault; text: string; loading: boolean; canEditBody: boolean }) {
  const leading = /^\s*#\s+(.+?)\s*#*\s*(?:\n|$)/.exec(text)
  const reading = leading && leading[1].trim().toLowerCase() === item.name.trim().toLowerCase() ? text.slice(leading[0].length) : text
  const html = useMemo(() => (reading.trim() ? renderMarkdown(reading, item, vault) : ''), [reading, item, vault])
  const original = typeof item.properties.sourcePath === 'string' && IMAGE.test(item.properties.sourcePath) ? sourceUrl(item.properties.sourceVault, item.properties.sourcePath) : null
  const preview = item.path && IMAGE.test(item.path) ? fileUrl(item.path) : original
  return (
    <div className="mb-10">
      {item.description && <p className="lede mb-5 max-w-[70ch] text-base text-muted-foreground">{item.description}</p>}
      {preview && <figure className="mb-5"><img src={preview} alt={item.name} loading="lazy" className="max-h-[28rem] rounded-lg border" /></figure>}
      {loading
        ? <div className="grid max-w-[70ch] gap-3" aria-busy="true" aria-label="Loading content">{[100, 92, 96, 60].map(width => <Skeleton key={width} className="h-4" style={{ width: `${width}%` }} />)}</div>
        : html
          ? <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
          : <p className="text-sm text-muted-foreground">{canEditBody ? 'No content yet. Select Edit to write some.' : 'No readable text. Open the original file from the menu.'}</p>}
    </div>
  )
}

function EditForm({ item, definitions, front, text, canEditBody, reviewPending, onCancel, onSaved }: {
  item: Item; definitions: PropertyDefinition[]; front: string; text: string; canEditBody: boolean; reviewPending: boolean
  onCancel: () => void; onSaved: (item: Item, body?: string) => void
}) {
  // Scope edits the item's own in-area link; an inherited scope shows as none here.
  const vault = useVault()
  const ownScope = vault.ownScopeOf.get(item.id) ?? null
  const initial = useMemo(() => ({
    name: item.name,
    description: item.description,
    tags: plainTags(item.tags).join(', '),
    scope: (ownScope === 'personal' ? 'personal' : ownScope === 'work' ? 'work' : 'none') as 'work' | 'personal' | 'none',
    values: rawValues(definitions, item.properties),
    body: text,
  }), [item, definitions, text, ownScope])
  const [form, setForm] = useState(initial)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // "leave" holds the page the user tried to open; "discard" comes from Cancel.
  const [confirm, setConfirm] = useState<{ kind: 'leave'; target: string } | { kind: 'discard' } | null>(null)
  const leaving = useRef(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const bothScopes = ownScope === 'both'
  const locked = reviewPending ? ['enabled'] : []

  useEffect(() => { nameRef.current?.focus() }, [])
  useEffect(() => {
    if (!dirty) return
    const release = setLeaveGuard(target => {
      if (leaving.current) return true
      setConfirm({ kind: 'leave', target })
      return false
    })
    // Closing or reloading the tab can only use the browser's own question.
    const onUnload = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', onUnload)
    return () => { release(); window.removeEventListener('beforeunload', onUnload) }
  }, [dirty, item.name])

  const cancel = () => {
    if (dirty) setConfirm({ kind: 'discard' })
    else onCancel()
  }
  const confirmed = () => {
    if (confirm?.kind === 'leave') {
      leaving.current = true
      window.location.hash = confirm.target
    } else onCancel()
    setConfirm(null)
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (saving) return
    setError('')
    const name = form.name.trim()
    if (!name) {
      setError('Name is required.')
      nameRef.current?.focus()
      return
    }
    let properties: Record<string, unknown>
    try { properties = parseProperties(definitions, form.values, locked) } catch (problem) { setError(errorText(problem)); return }
    const scopeChanged = !bothScopes && form.scope !== initial.scope
    const patch: Record<string, unknown> = { name, description: form.description, tags: splitTags(form.tags), properties }
    if (scopeChanged) patch.scope = form.scope
    const bodyChanged = canEditBody && form.body !== text
    if (bodyChanged) patch.body = front + form.body
    setSaving(true)
    try {
      const saved = await patchItem(item.id, patch)
      toast.success('Saved.')
      onSaved(saved, bodyChanged ? front + form.body : undefined)
    } catch (problem) {
      setError(`Not saved: ${errorText(problem)}. Your text is still here.`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mb-10" aria-label={`Edit ${item.name}`} onKeyDown={event => {
      if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'Enter')) { event.preventDefault(); void submit() }
      if (event.key === 'Escape' && !dirty) onCancel()
    }}>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="edit-name">Name</FieldLabel>
          <Input id="edit-name" ref={nameRef} value={form.name} maxLength={500} onChange={event => setForm({ ...form, name: event.target.value })} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="edit-description">Description</FieldLabel>
          <Textarea id="edit-description" rows={2} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field>
            <FieldLabel htmlFor="edit-tags">Tags</FieldLabel>
            <Input id="edit-tags" value={form.tags} autoComplete="off" onChange={event => setForm({ ...form, tags: event.target.value })} />
            <FieldDescription>Separate tags with commas.</FieldDescription>
          </Field>
          {!bothScopes && (
            <Field>
              <FieldLabel id="edit-scope-label">Scope</FieldLabel>
              <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={form.scope} onValueChange={value => value && setForm({ ...form, scope: value as typeof form.scope })} aria-labelledby="edit-scope-label">
                <ToggleGroupItem value="work"><span className="scope-dot size-2 rounded-full" data-scope="work" aria-hidden="true" />Work</ToggleGroupItem>
                <ToggleGroupItem value="personal"><span className="scope-dot size-2 rounded-full" data-scope="personal" aria-hidden="true" />Personal</ToggleGroupItem>
                <ToggleGroupItem value="none">None</ToggleGroupItem>
              </ToggleGroup>
            </Field>
          )}
        </div>
        {definitions.length > 0 && (
          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm font-medium">Properties</legend>
            <PropertyFields idPrefix="edit" definitions={definitions} values={form.values} locked={locked} onChange={(key, value) => setForm(current => ({ ...current, values: { ...current.values, [key]: value } as RawValues }))} />
            {reviewPending && <p className="text-xs text-muted-foreground">Enabled stays off until you review this imported schedule from the CLI.</p>}
          </fieldset>
        )}
        {canEditBody ? (
          <Field>
            <FieldLabel htmlFor="edit-body">Content</FieldLabel>
            <Textarea id="edit-body" rows={18} value={form.body} onChange={event => setForm({ ...form, body: event.target.value })} className="font-mono text-[0.8125rem] leading-relaxed" />
          </Field>
        ) : <p className="text-sm text-muted-foreground">This content is a preserved original. Open it from the menu, or add a new note to develop it.</p>}
      </FieldGroup>
      {error && <Alert variant="destructive" className="mt-4" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        <Button type="button" variant="ghost" onClick={cancel}>Cancel</Button>
        <span className="ml-auto text-xs text-muted-foreground"><Kbd>⌘</Kbd> <Kbd>S</Kbd> saves{dirty ? ' · Unsaved changes' : ''}</span>
      </div>
      <AlertDialog open={confirm !== null} onOpenChange={open => { if (!open) setConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === 'leave' ? 'Leave without saving?' : 'Discard your changes?'}</AlertDialogTitle>
            <AlertDialogDescription>Your changes to “{item.name}” are not saved. {confirm?.kind === 'leave' ? 'If you leave, they are lost.' : 'If you discard them, they are lost.'}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={confirmed}>{confirm?.kind === 'leave' ? 'Leave' : 'Discard'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}

function propertyText(vault: Vault, definition: PropertyDefinition | undefined, value: unknown) {
  if (value === undefined || value === null || value === '') return <span className="text-muted-foreground">—</span>
  if (definition?.type === 'date' || definition?.type === 'datetime') return formatDateTime(value)
  if (definition?.type === 'boolean' || typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (definition?.type === 'select') return valueLabel(value)
  if (definition?.type === 'relation') {
    return (Array.isArray(value) ? value : [value]).map((id, index) => {
      const target = vault.byId.get(String(id))
      return <span key={String(id)}>{index > 0 && ', '}{target ? <a className="spine-link" href={'#item/' + encodeURIComponent(target.id)}>{target.name}</a> : String(id)}</span>
    })
  }
  if (typeof value === 'object') return <code className="text-xs">{JSON.stringify(value)}</code>
  if (/^https?:\/\//i.test(String(value))) return <a className="spine-link break-all" href={String(value)} target="_blank" rel="noopener noreferrer">{String(value)}</a>
  return String(value)
}

function FactList({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="facts">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Facts({ item, definitions }: { item: Item; definitions: PropertyDefinition[] }) {
  const vault = useVault()
  const properties = item.properties
  const defined = new Set(definitions.map(definition => definition.key))
  const dates: Array<[string, string]> = ([
    ['Created', formatDateTime(item.createdAt)],
    ['Content date', properties.contentDate ? `${formatDay(String(properties.contentDate))}${properties.dateConfidence && properties.dateConfidence !== 'unknown' ? ` (${properties.dateConfidence})` : ''}` : ''],
    ['Source created', formatDateTime(properties.sourceCreatedAt)],
    ['Source changed', formatDateTime(properties.sourceModifiedAt)],
    ['Edited in 2b', formatDateTime(properties.activityAt)],
    ['Completed', formatDateTime(properties.completedAt)],
  ] as Array<[string, string]>).filter(([, value]) => value)
  const source: Array<[string, ReactNode]> = []
  if (item.path) source.push(['Content file', <a className="spine-link break-all" href={fileUrl(item.path)} target="_blank" rel="noopener">{item.path}</a>])
  const original = sourceUrl(properties.sourceVault, properties.sourcePath)
  if (original) source.push(['Original file', <a className="spine-link break-all" href={original} target="_blank" rel="noopener">{String(properties.sourceVault)} <code className="text-xs">{String(properties.sourcePath)}</code></a>])
  const other = Object.keys(properties).filter(key => !defined.has(key) && !SHOWN_DATES.includes(key) && properties[key] !== null && properties[key] !== undefined && !(item.type === 'project' && key === 'area'))
  const tags = plainTags(item.tags)

  return (
    <aside className="facts-panel grid content-start gap-6 text-sm" aria-label="Item facts">
      <section>
        <h2 className="facts-head">Properties</h2>
        {definitions.length ? <FactList rows={definitions.map(definition => [fieldLabel(definition.key), propertyText(vault, definition, properties[definition.key])])} /> : <p className="text-muted-foreground">This type has no fields.</p>}
      </section>
      <section>
        <h2 className="facts-head">Tags</h2>
        {tags.length ? <div className="flex flex-wrap gap-1.5"><TagBadges tags={tags} limit={30} /></div> : <p className="text-muted-foreground">No tags.</p>}
      </section>
      <section>
        <h2 className="facts-head">Dates</h2>
        <FactList rows={dates} />
      </section>
      {source.length > 0 && (
        <section>
          <h2 className="facts-head">Source</h2>
          <FactList rows={source} />
        </section>
      )}
      {other.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">Other metadata ({other.length})</Button></CollapsibleTrigger>
          <CollapsibleContent className="fold-content">
            <div className="mt-2 max-h-80 overflow-auto">
              <FactList rows={other.map(key => [fieldLabel(key), typeof properties[key] === 'object' ? <code className="text-xs">{JSON.stringify(properties[key])}</code> : propertyText(vault, undefined, properties[key])])} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
      <p className="text-xs text-muted-foreground">ID <code className="break-all">{item.id}</code></p>
    </aside>
  )
}

function ProjectSections({ project }: { project: Item }) {
  const vault = useVault()
  const { openCapture } = useAppActions()
  const { toggle, busyId, lingering } = useTaskToggle()
  const tasks = vault.items.filter(item => item.type === 'task' && vault.projectOf.get(item.id) === project.id)
  // A task completed here stays in "Open tasks" for a moment, struck through, before it moves to "Done tasks".
  const open = tasks.filter(task => isOpenTask(task) || lingering.has(task.id)).sort((left, right) => String(left.properties.due ?? '9999').localeCompare(String(right.properties.due ?? '9999')))
  const closed = tasks.filter(task => !isOpenTask(task) && !lingering.has(task.id)).sort((left, right) => (vault.changedTime.get(right.id) ?? 0) - (vault.changedTime.get(left.id) ?? 0))
  return (
    <>
      <Section
        title="Open tasks"
        count={open.filter(isOpenTask).length}
        actions={<Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => openCapture({ type: 'task', parentId: project.id })}><PlusIcon />Add task</Button>}
      >
        {open.length ? <ul>{open.map(task => <ItemRow key={task.id} item={task} showType={false} onToggleTask={toggle} busy={busyId === task.id} lingering={lingering.has(task.id)} date={typeof task.properties.due === 'string' ? task.properties.due : null} />)}</ul> : <p className="py-2 text-sm text-muted-foreground">No open task.</p>}
      </Section>
      {closed.length > 0 && (
        <FoldGroup id={`project-done-${project.id}`} title="Done tasks" count={closed.length} defaultOpen={false}>
          <ul>{closed.slice(0, 100).map(task => <ItemRow key={task.id} item={task} showType={false} onToggleTask={toggle} busy={busyId === task.id} />)}</ul>
        </FoldGroup>
      )}
      <ItemHistory item={project} />
    </>
  )
}

/** Log lines from the past year that belong to this task or project. */
function ItemHistory({ item }: { item: Item }) {
  const vault = useVault()
  const today = todayKey()
  const { byDay, error } = useActivity(addDays(today, -365), today)
  const rows = useMemo(() => {
    if (!byDay) return []
    const events = [...byDay.values()].flat().filter(event => event.objectId === item.id || event.projectId === item.id)
    return events.map(event => logRow(vault, event)).sort((left, right) => right.at - left.at)
  }, [byDay, vault, item.id])
  if (error || (byDay && !rows.length)) return null
  return (
    <Section title="History" count={byDay ? rows.length : undefined}>
      {byDay ? <SpineList rows={rows} limit={15} dated /> : <Skeleton className="h-10" />}
    </Section>
  )
}

function LinksSection({ item }: { item: Item }) {
  const vault = useVault()
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; ids: string[] }>()
    for (const relation of vault.outgoing.get(item.id) ?? []) {
      const group = map.get('out:' + relation.kind) ?? { label: linkLabel(relation.kind, false), ids: [] }
      group.ids.push(relation.to)
      map.set('out:' + relation.kind, group)
    }
    for (const relation of vault.incoming.get(item.id) ?? []) {
      const group = map.get('in:' + relation.kind) ?? { label: linkLabel(relation.kind, true), ids: [] }
      group.ids.push(relation.from)
      map.set('in:' + relation.kind, group)
    }
    return [...map.entries()]
  }, [vault, item.id])
  const total = groups.reduce((sum, [, group]) => sum + group.ids.length, 0)

  return (
    <Section title="Links" count={total} actions={<AddLink item={item} />}>
      {groups.length ? groups.map(([key, group]) => <LinkGroup key={key} label={group.label} ids={group.ids} />) : <p className="text-sm text-muted-foreground">No links yet.</p>}
    </Section>
  )
}

/** "Add link" opens a small form. To put an item in a project, "Change type or project" needs no link name. */
function AddLink({ item }: { item: Item }) {
  const vault = useVault()
  const { addRelationship } = useVaultContext()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('')
  const [target, setTarget] = useState<Item | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const kinds = useMemo(() => [...new Set(vault.relationships.map(relation => relation.kind))].sort(), [vault])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!kind.trim()) return setError('Name the link, for example “mentions” or “part-of”.')
    if (!target) return setError('Choose the item to link to.')
    setSaving(true)
    try {
      addRelationship(await api<Relationship>('/api/relationships', { method: 'POST', body: JSON.stringify({ from: item.id, kind: kind.trim(), to: target.id }) }))
      toast.success(`Linked to “${target.name}” as ${linkLabel(kind.trim(), false).toLowerCase()}.`)
      setTarget(null)
      setOpen(false)
    } catch (problem) {
      setError(`Not linked: ${errorText(problem)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setError('') }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground"><Link2Icon />Add link</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form onSubmit={submit} noValidate className="grid gap-3" aria-label="Add a link">
          <Field>
            <FieldLabel htmlFor="link-kind">Link name</FieldLabel>
            <Input id="link-kind" value={kind} onChange={event => setKind(event.target.value)} list="link-kinds" placeholder="mentions" autoComplete="off" autoFocus />
            <datalist id="link-kinds">{kinds.map(entry => <option key={entry} value={entry} />)}</datalist>
            <FieldDescription>Pick a name in use or type a new one. “part-of” puts this item in a project or collection.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="link-target">To item</FieldLabel>
            <ItemPicker id="link-target" label="To item" excludeId={item.id} value={target} onPick={setTarget} />
          </Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={saving}>{saving ? 'Linking…' : 'Add link'}</Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function LinkGroup({ label, ids }: { label: string; ids: string[] }) {
  const vault = useVault()
  const [limit, setLimit] = useState(10)
  const items = ids.map(id => vault.byId.get(id)).filter((entry): entry is Item => Boolean(entry))
  const missing = ids.length - items.length
  const bulk = items.filter(isBulk).sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
  const main = items.filter(entry => !isBulk(entry))
  const list = [...main, ...bulk]
  return (
    <div className="mb-4">
      <h3 className="mb-1 flex items-baseline gap-2 text-xs font-medium text-muted-foreground"><span>{label}</span><span className="tabular-nums">{ids.length}</span></h3>
      <ul>{list.slice(0, limit).map(entry => <ItemRow key={entry.id} item={entry} showDescription={false} />)}</ul>
      {list.length > limit && <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setLimit(value => value + 50)}>Show {Math.min(50, list.length - limit)} more of {list.length}</Button>}
      {missing > 0 && <p className="text-xs text-muted-foreground">{missing} linked {missing === 1 ? 'item was' : 'items were'} not found.</p>}
    </div>
  )
}
