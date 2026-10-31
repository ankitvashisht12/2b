import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { TypeIcon } from '@/components/item-bits'
import { PageHeader } from '@/components/page'
import { navigate, withQuery, type Route } from '@/lib/router'
import { useVault, useVaultContext } from '@/lib/store'
import { api, countBy, errorText, PROPERTY_KINDS, typeLabel, type PropertyDefinition, type PropertyKind, type TypeDefinition } from '@/lib/vault'

export function TypesView({ route }: { route: Route }) {
  const vault = useVault()
  const counts = useMemo(() => new Map(countBy(vault.items, item => [item.type])), [vault])
  const types = [...vault.types].sort((left, right) => typeLabel(vault, left.id).localeCompare(typeLabel(vault, right.id)))
  const creating = route.query.get('new') === '1'
  const setCreating = (open: boolean) => navigate(open ? '#types?new=1' : '#types', { replace: true })
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Types"
        description="Every item has one type. A type defines the fields its items carry."
        actions={<Button onClick={() => setCreating(true)}><PlusIcon />New type</Button>}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>ID</TableHead>
            <TableHead>Fields</TableHead>
            <TableHead className="text-right">Items</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {types.map(type => (
            <TableRow key={type.id}>
              <TableCell className="align-top">
                <a className="spine-link inline-flex items-center gap-2 font-medium" href={withQuery('#library', { type: type.id })}><TypeIcon type={type.id} />{typeLabel(vault, type.id)}</a>
                {type.description && !/^Built-in /.test(type.description) && <p className="mt-0.5 max-w-xs whitespace-normal text-xs text-muted-foreground">{type.description}</p>}
              </TableCell>
              <TableCell className="align-top"><code className="text-xs text-muted-foreground">{type.id}</code></TableCell>
              <TableCell className="align-top whitespace-normal">
                <div className="flex max-w-xl flex-wrap gap-1">
                  {type.properties.length ? type.properties.map(property => (
                    <Badge key={property.key} variant="outline" className="font-normal">
                      {property.key}<span className="text-muted-foreground">{KIND_LABELS[property.type] ?? property.type}{property.required ? ', required' : ''}</span>
                    </Badge>
                  )) : <span className="text-xs text-muted-foreground">No fields</span>}
                </div>
              </TableCell>
              <TableCell className="text-right align-top tabular-nums">{(counts.get(type.id) ?? 0).toLocaleString('en-IN')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <NewTypeDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

interface FieldDraft { key: string; kind: PropertyKind; extra: string; required: boolean }
const emptyField = (): FieldDraft => ({ key: '', kind: 'text', extra: '', required: false })
const KIND_LABELS: Record<PropertyKind, string> = { text: 'Text', number: 'Number', boolean: 'Yes or no', date: 'Date', datetime: 'Date and time', select: 'Choice', relation: 'Link to an item', json: 'JSON' }
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '')

function NewTypeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const vault = useVault()
  const { addType } = useVaultContext()
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<FieldDraft[]>([emptyField()])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) return
    setName(''); setId(''); setIdTouched(false); setDescription(''); setFields([emptyField()]); setError('')
  }, [open])

  const update = (index: number, change: Partial<FieldDraft>) => setFields(current => current.map((field, position) => (position === index ? { ...field, ...change } : field)))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      const typeId = id.trim()
      if (!name.trim()) throw new Error('Give the type a name.')
      if (!/^[a-z][a-z0-9-]*$/.test(typeId)) throw new Error('The ID uses lowercase letters, digits, and dashes, and starts with a letter.')
      if (vault.typeById.has(typeId)) throw new Error(`The type “${typeId}” exists already.`)
      const properties: PropertyDefinition[] = fields.filter(field => field.key.trim()).map(field => {
        const key = field.key.trim()
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) throw new Error(`Field “${key}” must start with a letter and use only letters, digits, and _.`)
        const definition: PropertyDefinition = { key, type: field.kind, ...(field.required ? { required: true } : {}) }
        if (field.kind === 'select') {
          definition.options = field.extra.split(',').map(value => value.trim()).filter(Boolean)
          if (!definition.options.length) throw new Error(`Give the choices for “${key}”, separated by commas.`)
        }
        if (field.kind === 'relation' && field.extra.trim()) definition.targetType = field.extra.trim()
        return definition
      })
      if (new Set(properties.map(property => property.key)).size !== properties.length) throw new Error('Each field needs a different key.')
      setSaving(true)
      const created = await api<TypeDefinition>('/api/types', { method: 'POST', body: JSON.stringify({ id: typeId, name: name.trim(), description: description.trim(), properties }) })
      addType(created)
      toast.success(`Created the type “${created.name}”. You can add ${created.name} items now.`)
      onOpenChange(false)
    } catch (problem) {
      setError(errorText(problem))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>New type</DialogTitle>
            <DialogDescription>Items of this type carry the fields you add here. A required field must have a value when you save an item.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="type-name">Name</FieldLabel>
                <Input id="type-name" value={name} placeholder="Recipe" autoComplete="off" onChange={event => { setName(event.target.value); if (!idTouched) setId(slug(event.target.value)) }} autoFocus />
              </Field>
              <Field>
                <FieldLabel htmlFor="type-id">ID</FieldLabel>
                <Input id="type-id" value={id} placeholder="recipe" autoComplete="off" onChange={event => { setId(event.target.value); setIdTouched(true) }} />
                <FieldDescription>Used by the CLI. It cannot change later.</FieldDescription>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="type-description">Description</FieldLabel>
              <Input id="type-description" value={description} placeholder="What items of this type hold" autoComplete="off" onChange={event => setDescription(event.target.value)} />
            </Field>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Fields</legend>
              {fields.map((field, index) => (
                <div key={index} className="grid items-end gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_8.5rem_minmax(0,1fr)_auto_auto]">
                  <Field>
                    <FieldLabel htmlFor={`field-key-${index}`} className="text-xs">Key</FieldLabel>
                    <Input id={`field-key-${index}`} value={field.key} placeholder="author" autoComplete="off" onChange={event => update(index, { key: event.target.value })} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`field-kind-${index}`} className="text-xs">Kind</FieldLabel>
                    <Select value={field.kind} onValueChange={kind => update(index, { kind: kind as PropertyKind })}>
                      <SelectTrigger id={`field-kind-${index}`} className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{PROPERTY_KINDS.map(kind => <SelectItem key={kind} value={kind}>{KIND_LABELS[kind]}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`field-extra-${index}`} className="text-xs">{field.kind === 'relation' ? 'Target type' : 'Choices'}</FieldLabel>
                    <Input id={`field-extra-${index}`} value={field.extra} disabled={!['select', 'relation'].includes(field.kind)} placeholder={field.kind === 'relation' ? 'person' : field.kind === 'select' ? 'a, b, c' : 'Only for select or relation'} autoComplete="off" onChange={event => update(index, { extra: event.target.value })} />
                  </Field>
                  <Field orientation="horizontal" className="h-8 items-center">
                    <Checkbox id={`field-required-${index}`} checked={field.required} onCheckedChange={value => update(index, { required: value === true })} />
                    <FieldLabel htmlFor={`field-required-${index}`} className="text-xs font-normal">Required</FieldLabel>
                  </Field>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove field ${field.key || index + 1}`} onClick={() => setFields(current => current.filter((_, position) => position !== index))}><Trash2Icon /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setFields(current => [...current, emptyField()])}><PlusIcon />Add field</Button>
            </fieldset>
          </FieldGroup>
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create type'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
