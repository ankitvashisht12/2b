// Every date in the UI is a calendar day or clock time in Asia/Kolkata.
export const TIME_ZONE = 'Asia/Kolkata'

const dayParts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const clockParts = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const inputParts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export const isDayKey = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

/** YYYY-MM-DD in Asia/Kolkata, or '' when the value is missing or not a date. */
export function dayKey(value: unknown): string {
  if (!value) return ''
  if (isDayKey(value)) return value
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '' : dayParts.format(date)
}

export const todayKey = () => dayParts.format(new Date())

/** HH:mm in Asia/Kolkata; a date-only value has no time. */
export function clockTime(value: unknown): string | null {
  if (!value || isDayKey(value)) return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : clockParts.format(date)
}

const noonUtc = (day: string) => new Date(day + 'T12:00:00Z')

export function addDays(day: string, amount: number) {
  const date = noonUtc(day)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

export const daysBetween = (from: string, to: string) => Math.round((noonUtc(to).getTime() - noonUtc(from).getTime()) / 86_400_000)

export const monthStart = (day: string) => day.slice(0, 8) + '01'

export function monthEnd(day: string) {
  const date = noonUtc(monthStart(day))
  date.setUTCMonth(date.getUTCMonth() + 1, 0)
  return date.toISOString().slice(0, 10)
}

export function addMonths(day: string, amount: number) {
  const date = noonUtc(monthStart(day))
  date.setUTCMonth(date.getUTCMonth() + amount)
  return date.toISOString().slice(0, 10)
}

export function formatDay(day: string, style: 'short' | 'long' = 'short') {
  if (!isDayKey(day)) return ''
  const sameYear = day.slice(0, 4) === todayKey().slice(0, 4)
  return noonUtc(day).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    month: style === 'long' ? 'long' : 'short',
    ...(sameYear && style === 'short' ? {} : { year: 'numeric' }),
  })
}

export const formatMonth = (day: string) => noonUtc(day).toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' })

export function relativeDay(day: string) {
  const offset = daysBetween(todayKey(), day)
  return offset === 0 ? 'Today' : offset === -1 ? 'Yesterday' : offset === 1 ? 'Tomorrow' : ''
}

/** Short date for list rows: "Today", "Yesterday", or "28 Oct". */
export function shortDay(value: unknown) {
  const day = dayKey(value)
  if (!day) return ''
  const relative = relativeDay(day)
  if (relative) return relative
  const sameYear = day.slice(0, 4) === todayKey().slice(0, 4)
  return noonUtc(day).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

export function formatDateTime(value: unknown) {
  if (!value) return ''
  if (isDayKey(value)) return formatDay(value)
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('en-IN', { timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// The calendar component works with local Date objects. Noon keeps a day stable in any time zone.
export function dayToDate(day: string) {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date, 12)
}
export const dateToDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** Value for <input type="datetime-local">, shown in IST. */
export function toLocalInput(value: unknown) {
  if (!value) return ''
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(inputParts.formatToParts(date).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
export const fromLocalInput = (value: string) => (value ? new Date(value + ':00+05:30').toISOString() : null)
