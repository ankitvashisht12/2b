import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Kbd } from '@/components/ui/kbd'
import { PARENT_TYPES, ParentField, ScopeChoiceField, TypeSelect, captureFields } from '@/components/capture-dialog'
import { PropertyFields, fits, parseProperties, rawValue, type RawValues } from '@/components/property-fields'
import { offerUndo, reversePatch } from '@/lib/actions'
import type { ProcessOptions } from '@/lib/app-actions'
import { itemHref } from '@/lib/markdown'
import { patchItem, useVault, useVaultContext } from '@/lib/store'
import { api, errorText, typeLabel, type Item, type PropertyDefinition, type Relationship } from '@/lib/vault'

// The values the server gives a new item of each type. A changed item gets them where it has no valid value.
const TYPE_DEFAULTS: Record<string, Record<string, unknown>> = {
  project: { kind: 'ongoing', status: 'active' },
  task: { status: 'todo', priority: 'med' },
  note: { noteType: 'general' },
  book: { readingState: 'to-read' },
  reminder: { enabled: false, status: 'pending' },
  'agent-job': { enabled: false },
}

type ScopeState = 'work' | 'personal' | 'none' | 'both'

function startValues(fields: PropertyDefinition[], item: Item, typeId: string): RawValues {
  return Object.fromEntries(fields.map(field => {
    const stored = item.properties[field.key]
    const usable = stored !== undefined && stored !== null && fits(field, stored)
    return [field.key, rawValue(field, usable ? stored : TYPE_DEFAULTS[typeId]?.[field.key])]
  }))
}

/** `id` is new on each open, so the form starts again from the item. */
export interface ProcessRequest { id: number; item: Item; options: ProcessOptions }

export function ProcessDialog({ open, request, onClose }: { open: boolean; request: ProcessRequest | null; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
      {request && <ProcessForm key={request.id} request={request} onClose={onClose} />}
    </Dialog>
  )
}

function ProcessForm({ request, onClose }: { request: ProcessRequest; onClose: () => void }) {
  const vault = useVault()
  const { saveItem, addRelationship, removeRelationship } = useVaultContext()
  const { item, options } = request
  const markProcessed = options.markProcessed !== false
  const ownScope = vault.ownScopeOf.get(item.id) ?? null
  const initialScope: ScopeState = ownScope ?? 'none'
  const parentId = vault.parentOf.get(item.id)
  const currentParent = parentId ? vault.byId.get(parentId) : undefined
  const existingParent = currentParent && PARENT_TYPES.includes(currentParent.type) ? currentParent : null
  const [typeId, setTypeId] = useState(item.type)
  const [scope, setScope] = useState<ScopeState>(initialScope)
  const [parent, setParent] = useState<Item | null>(existingParent)
  const type = vault.typeById.get(typeId)
  const fields = captureFields(type)
  const [values, setValues] = useState<RawValues>(() => startValues(fields, item, typeId))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (saving) return
    setError('')
    let properties: Record<string, unknown>
    try {
      properties = parseProperties(fields, values)
    } catch (problem) {
      setError(errorText(problem))
      return
    }
    // A new type: stored values that do not suit it become its default or empty; other fields stay as they are.
    if (typeId !== item.type) {
      for (const definition of type?.properties ?? []) {
        if (definition.key in properties) continue
        const stored = item.properties[definition.key]
        const fallback = TYPE_DEFAULTS[typeId]?.[definition.key]
        if (!fits(definition, stored)) properties[definition.key] = fallback ?? null
        else if ((stored === undefined || stored === null) && fallback !== undefined) properties[definition.key] = fallback
      }
    }
    if (markProcessed) properties.processingState = 'processed'
    const scopeChanged = scope !== initialScope
    const patch: Record<string, unknown> = { properties }
    if (typeId !== item.type) patch.type = typeId
    if (scopeChanged && scope !== 'both') patch.scope = scope
    const newParent = parent && parent.id !== existingParent?.id ? parent : null

    setSaving(true)
    // The link first. If it fails, nothing changed and the item stays where it was.
    let createdRelation: Relationship | null = null
    if (newParent) {
      try {
        createdRelation = await api<Relationship>('/api/relationships', { method: 'POST', body: JSON.stringify({ from: item.id, kind: 'part-of', to: newParent.id }) })
        addRelationship(createdRelation)
      } catch (problem) {
        setError(`Not saved: ${errorText(problem)}. Nothing changed.`)
        setSaving(false)
        return
      }
    }
    // Then type, scope, fields, and the Inbox state in one save. Saving again repeats both steps safely.
    let saved: Item
    try {
      saved = await patchItem(item.id, patch)
    } catch (problem) {
      if (createdRelation) {
        try {
          await api('/api/relationships/' + encodeURIComponent(createdRelation.id), { method: 'DELETE' })
          removeRelationship(createdRelation.id)
        } catch {
          setError(`The link to “${newParent!.name}” was saved, but the other changes failed: ${errorText(problem)}. Reopen this item to review it.`)
          setSaving(false)
          return
        }
      }
      setError(`Not saved: ${errorText(problem)}. Your choices are still here.`)
      setSaving(false)
      return
    }
    saveItem(saved)
    setSaving(false)
    onClose()
    options.onSaved?.(saved)
    const asType = typeId !== item.type ? ` as a ${typeLabel(vault, typeId).toLowerCase()}` : ''
    const inParent = parent ? ` in “${parent.name}”` : ''
    offerUndo(`${markProcessed ? 'Processed' : 'Saved'} “${item.name}”${asType}${inParent}.`, async () => {
      try {
        saveItem(await patchItem(item.id, reversePatch(item, patch)))
        if (createdRelation) {
          await api('/api/relationships/' + encodeURIComponent(createdRelation.id), { method: 'DELETE' })
          removeRelationship(createdRelation.id)
        }
        toast.success(`Undone. “${item.name}” is as it was.`)
      } catch (problem) {
        toast.error(`Undo failed: ${errorText(problem)}`)
      }
    })
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <form onSubmit={submit} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit() }} noValidate className="grid gap-4" aria-label={markProcessed ? `Process ${item.name}` : `Change type or project of ${item.name}`}>
        <DialogHeader>
          <DialogTitle>{markProcessed ? 'Process' : 'Change type or project'}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">
            “{item.name}”. Choose what it is and where it belongs.{markProcessed ? ' Saving marks it processed, so it leaves the Inbox.' : ''}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <Field>
              <FieldLabel htmlFor="process-type">Type</FieldLabel>
              <TypeSelect
                id="process-type"
                value={typeId}
                exclude={item.path ? ['tag'] : []}
                onChange={next => { setTypeId(next); setValues(startValues(captureFields(vault.typeById.get(next)), item, next)) }}
              />
            </Field>
            {scope === 'both'
              ? <Field><FieldLabel>Scope</FieldLabel><p className="text-sm">Work and Personal</p></Field>
              : <ScopeChoiceField id="process-scope-label" value={scope} onChange={setScope} />}
          </div>
          {existingParent ? (
            <Field>
              <FieldLabel>Project or collection</FieldLabel>
              <p className="text-sm">In <a className="spine-link font-medium" href={itemHref(existingParent.id)}>{existingParent.name}</a>.</p>
            </Field>
          ) : (
            <ParentField
              id="process-parent"
              parent={parent}
              excludeId={item.id}
              onChange={next => {
                setParent(next)
                const nextScope = next ? vault.scopeOf.get(next.id) : null
                if (scope === 'none' && (nextScope === 'work' || nextScope === 'personal')) setScope(nextScope)
              }}
            />
          )}
          {fields.length > 0 && <PropertyFields idPrefix="process" definitions={fields} values={values} onChange={(key, value) => setValues(current => ({ ...current, [key]: value }))} />}
        </FieldGroup>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter className="items-center">
          <span className="mr-auto hidden text-xs text-muted-foreground sm:block"><Kbd>⌘</Kbd> <Kbd>Enter</Kbd> saves</span>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : markProcessed ? 'Save and mark processed' : 'Save'}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
