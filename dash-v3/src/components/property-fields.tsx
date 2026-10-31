import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ItemPicker } from '@/components/item-picker'
import { dayKey, fromLocalInput, isDayKey, toLocalInput } from '@/lib/dates'
import { useVault } from '@/lib/store'
import { fieldLabel, valueLabel, type PropertyDefinition } from '@/lib/vault'

/** Form values as typed by the user; `parseProperties` turns them into stored values. */
export type RawValues = Record<string, string | boolean>

const NONE = '__none__'

export function rawValue(definition: PropertyDefinition, value: unknown): string | boolean {
  if (definition.type === 'boolean') return value === true
  if (value === undefined || value === null) return ''
  switch (definition.type) {
    case 'date': return isDayKey(value) ? value : dayKey(value)
    case 'datetime': return toLocalInput(value)
    case 'json': return JSON.stringify(value)
    case 'relation': return Array.isArray(value) ? value.join(',') : String(value)
    default: return String(value)
  }
}

export function rawValues(definitions: PropertyDefinition[], properties: Record<string, unknown>) {
  return Object.fromEntries(definitions.map(definition => [definition.key, rawValue(definition, properties[definition.key])])) as RawValues
}

/** True when a stored value suits the field, so an item can change type without a rejected save. */
export function fits(definition: PropertyDefinition, value: unknown) {
  if (value === undefined || value === null) return true
  switch (definition.type) {
    case 'text': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'boolean': return typeof value === 'boolean'
    case 'select': return (definition.options ?? []).includes(value as string)
    case 'date': return isDayKey(value)
    case 'datetime': return typeof value === 'string' && Number.isFinite(Date.parse(value))
    default: return true
  }
}

/** Throws an Error that names the field when a value is missing or invalid. */
export function parseProperties(definitions: PropertyDefinition[], raw: RawValues, locked: string[] = []) {
  const properties: Record<string, unknown> = {}
  for (const definition of definitions) {
    if (locked.includes(definition.key)) continue
    const input = raw[definition.key]
    const text = typeof input === 'string' ? input.trim() : ''
    let value: unknown
    switch (definition.type) {
      case 'boolean': value = input === true; break
      case 'number':
        value = text === '' ? null : Number(text)
        if (value !== null && !Number.isFinite(value)) throw new Error(`${fieldLabel(definition.key)} must be a number.`)
        break
      case 'datetime': value = text ? fromLocalInput(text) : null; break
      case 'json':
        try { value = text === '' ? null : JSON.parse(text) } catch { throw new Error(`${fieldLabel(definition.key)} is not valid JSON.`) }
        break
      case 'relation': {
        const ids = text.split(',').map(part => part.trim()).filter(Boolean)
        value = ids.length === 0 ? null : ids.length === 1 ? ids[0] : ids
        break
      }
      default: value = text === '' ? null : text
    }
    if (definition.required && (value === null || value === '')) throw new Error(`${fieldLabel(definition.key)} is required.`)
    properties[definition.key] = value
  }
  return properties
}

interface PropertyFieldsProps {
  definitions: PropertyDefinition[]
  values: RawValues
  onChange: (key: string, value: string | boolean) => void
  locked?: string[]
  idPrefix: string
}

export function PropertyFields({ definitions, values, onChange, locked = [], idPrefix }: PropertyFieldsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {definitions.map(definition => (
        <PropertyField
          key={definition.key}
          id={`${idPrefix}-${definition.key}`}
          definition={definition}
          value={values[definition.key] ?? (definition.type === 'boolean' ? false : '')}
          onChange={value => onChange(definition.key, value)}
          locked={locked.includes(definition.key)}
        />
      ))}
    </div>
  )
}

function PropertyField({ id, definition, value, onChange, locked }: { id: string; definition: PropertyDefinition; value: string | boolean; onChange: (value: string | boolean) => void; locked: boolean }) {
  const vault = useVault()
  const label = (
    <FieldLabel htmlFor={id}>
      {fieldLabel(definition.key)}
      {definition.required && <span className="font-normal text-muted-foreground">(required)</span>}
      {definition.type === 'datetime' && <span className="font-normal text-muted-foreground">(IST)</span>}
    </FieldLabel>
  )
  const text = typeof value === 'string' ? value : ''
  switch (definition.type) {
    case 'boolean':
      return (
        <Field orientation="horizontal" className="self-end">
          <Checkbox id={id} checked={value === true} disabled={locked} onCheckedChange={checked => onChange(checked === true)} />
          {label}
        </Field>
      )
    case 'select': {
      const options = definition.options ?? []
      const imported = text && !options.includes(text) ? text : null
      return (
        <Field>
          {label}
          <Select value={text || NONE} onValueChange={next => onChange(next === NONE ? '' : next)} disabled={locked}>
            <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {imported && <SelectItem value={imported}>{imported} (imported value)</SelectItem>}
              {options.map(option => <SelectItem key={option} value={option}>{valueLabel(option)}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      )
    }
    case 'relation': {
      const ids = text.split(',').map(part => part.trim()).filter(Boolean)
      return (
        <Field className="sm:col-span-2">
          {label}
          {ids.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {ids.map(itemId => (
                <li key={itemId} className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs">
                  {vault.byId.get(itemId)?.name ?? itemId}
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${vault.byId.get(itemId)?.name ?? itemId}`} onClick={() => onChange(ids.filter(other => other !== itemId).join(','))} disabled={locked}>
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <ItemPicker id={id} label={fieldLabel(definition.key)} targetTypes={definition.targetType ? [definition.targetType] : undefined} value={null} placeholder={definition.targetType ? `Add a ${definition.targetType}` : 'Add an item'} onPick={item => onChange([...new Set([...ids, item.id])].join(','))} />
        </Field>
      )
    }
    case 'json':
      return <Field className="sm:col-span-2">{label}<Textarea id={id} rows={2} value={text} disabled={locked} onChange={event => onChange(event.target.value)} className="font-mono text-xs" /></Field>
    default: {
      const type = definition.type === 'number' ? 'number' : definition.type === 'date' ? 'date' : definition.type === 'datetime' ? 'datetime-local' : 'text'
      return (
        <Field>
          {label}
          <Input id={id} type={type} step={definition.type === 'number' ? 'any' : undefined} value={text} disabled={locked} autoComplete="off" onChange={event => onChange(event.target.value)} />
        </Field>
      )
    }
  }
}
