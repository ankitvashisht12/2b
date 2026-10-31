import { useEffect, useMemo, useState } from 'react'
import { SearchIcon, XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ItemRow, TagBadges, TypeIcon } from '@/components/item-bits'
import { EmptyState, OtherScopeHint, PageHeader, ShowMore } from '@/components/page'
import { useTaskToggle } from '@/lib/actions'
import { navigate, withQuery, type Route } from '@/lib/router'
import { useScope, useVault } from '@/lib/store'
import { byRecent, countBy, inScope, isBulk, SCOPE_LABELS, typeLabel } from '@/lib/vault'
import { cn } from '@/lib/utils'

const PAGE = 100
const ORDER = ['note', 'task', 'project', 'collection', 'person', 'book', 'meeting', 'reminder', 'organization', 'repository', 'area', 'agent-job', 'tag']
const LAST = ['artifact', 'evidence', 'agent-run']
const ALL = '__all__'

export function LibraryView({ route }: { route: Route }) {
  const vault = useVault()
  const [scope] = useScope()
  const { toggle, busyId } = useTaskToggle()
  const type = route.query.get('type') ?? ''
  const tag = route.query.get('tag') ?? ''
  const query = route.query.get('q') ?? ''
  const sort = route.query.get('sort') === 'name' ? 'name' : 'recent'
  const [text, setText] = useState(query)
  const [limit, setLimit] = useState(PAGE)
  useEffect(() => setText(query), [query])
  useEffect(() => setLimit(PAGE), [type, tag, query, sort, scope])

  const update = (changes: Record<string, string | null>) => {
    const next = { type, tag, q: query, sort: sort === 'name' ? 'name' : '', ...changes }
    navigate(withQuery('#library', next), { replace: true })
  }
  useEffect(() => {
    if (text.trim() === query) return
    const timer = setTimeout(() => update({ q: text.trim() }), 150)
    return () => clearTimeout(timer)
    // `update` reads the current route; the timer only depends on the typed text.
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps

  const scoped = useMemo(() => vault.items.filter(item => inScope(vault.scopeOf.get(item.id) ?? null, scope)), [vault, scope])
  const typeCounts = useMemo(() => new Map(countBy(scoped, item => [item.type])), [scoped])
  // "All items" counts what its list shows: files (artifacts, evidence, agent runs, archived records) have their own entries.
  const allCount = useMemo(() => scoped.filter(item => !isBulk(item)).length, [scoped])
  const typeIds = useMemo(() => {
    const known = [...new Set([...ORDER, ...vault.types.map(definition => definition.id), ...typeCounts.keys()])]
    const rank = (id: string) => (LAST.includes(id) ? 200 + LAST.indexOf(id) : ORDER.includes(id) ? ORDER.indexOf(id) : 100)
    return known.filter(id => (typeCounts.get(id) ?? 0) > 0 || id === type).sort((left, right) => rank(left) - rank(right) || left.localeCompare(right))
  }, [vault, typeCounts, type])
  const tagCounts = useMemo(() => countBy(scoped.filter(item => !type || item.type === type), item => item.tags.filter(entry => !['work', 'personal'].includes(entry.toLowerCase()))).slice(0, 80), [scoped, type])

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const results = useMemo(() => {
    const list = scoped.filter(item =>
      (type ? item.type === type : terms.length > 0 || !isBulk(item)) &&
      (!tag || item.tags.includes(tag)) &&
      (!terms.length || terms.every(term => (vault.searchText.get(item.id) ?? '').includes(term))))
    return sort === 'name' ? list.sort((left, right) => left.name.localeCompare(right.name)) : list.sort(byRecent(vault))
  }, [scoped, type, tag, terms.join(' '), sort, vault]) // eslint-disable-line react-hooks/exhaustive-deps
  const hiddenBulk = !type && !terms.length ? scoped.filter(item => isBulk(item) && (!tag || item.tags.includes(tag))).length : 0
  const outside = vault.items.filter(item => (!type || item.type === type) && (!tag || item.tags.includes(tag))).length - scoped.filter(item => (!type || item.type === type) && (!tag || item.tags.includes(tag))).length

  const heading = type ? typeLabel(vault, type, true) : 'Library'
  const filtered = Boolean(query || tag)
  return (
    <div className="flex gap-8">
      <nav aria-label="Types" className="sticky top-16 hidden w-48 shrink-0 self-start lg:block">
        <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">Types</p>
        <ul className="grid gap-0.5">
          <li>
            <a href={withQuery('#library', { tag, q: query })} aria-current={!type ? 'page' : undefined} className={cn('type-link', !type && 'is-current')}>
              <span className="flex-1">All items</span>
              <span className="tabular-nums">{allCount.toLocaleString('en-IN')}</span>
            </a>
          </li>
          {typeIds.map(id => (
            <li key={id}>
              <a href={withQuery('#library', { type: id, tag, q: query })} aria-current={type === id ? 'page' : undefined} className={cn('type-link', type === id && 'is-current')}>
                <TypeIcon type={id} className="size-3.5" />
                <span className="flex-1 truncate">{typeLabel(vault, id, true)}</span>
                <span className="tabular-nums">{(typeCounts.get(id) ?? 0).toLocaleString('en-IN')}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          title={heading}
          description={`${results.length.toLocaleString('en-IN')} ${results.length === 1 ? 'item' : 'items'}${filtered ? ' match' : ''}${scope === 'all' ? '' : ` in ${SCOPE_LABELS[scope]}`}, ${sort === 'name' ? 'by name' : 'most recently changed first'}.`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <InputGroup className="w-full sm:w-72">
              <InputGroupAddon><SearchIcon /></InputGroupAddon>
              <InputGroupInput aria-label={`Filter ${heading.toLowerCase()}`} placeholder={`Filter ${heading.toLowerCase()}`} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && text) { event.stopPropagation(); setText('') } }} />
            </InputGroup>
            <Select value={type || ALL} onValueChange={value => update({ type: value === ALL ? '' : value })}>
              <SelectTrigger className="w-40 lg:hidden" aria-label="Type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All items</SelectItem>
                {typeIds.map(id => <SelectItem key={id} value={id}>{typeLabel(vault, id, true)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={tag || ALL} onValueChange={value => update({ tag: value === ALL ? '' : value })}>
              <SelectTrigger className="w-44" aria-label="Tag"><SelectValue placeholder="Any tag" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any tag</SelectItem>
                {tag && !tagCounts.some(([name]) => name === tag) && <SelectItem value={tag}>#{tag}</SelectItem>}
                {tagCounts.map(([name, count]) => <SelectItem key={name} value={name}>#{name} <span className="text-muted-foreground tabular-nums">{count}</span></SelectItem>)}
              </SelectContent>
            </Select>
            <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={sort} onValueChange={value => value && update({ sort: value === 'name' ? 'name' : '' })} aria-label="Sort" className="ml-auto">
              <ToggleGroupItem value="recent">Recent</ToggleGroupItem>
              <ToggleGroupItem value="name">Name</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {(tag || query) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {tag && <Badge variant="secondary" className="gap-1">#{tag}<button type="button" aria-label={`Remove tag filter ${tag}`} onClick={() => update({ tag: '' })}><XIcon className="size-3" /></button></Badge>}
              {query && <Badge variant="secondary" className="gap-1">“{query}”<button type="button" aria-label="Clear the text filter" onClick={() => { setText(''); update({ q: '' }) }}><XIcon className="size-3" /></button></Badge>}
            </div>
          )}
        </PageHeader>

        {results.length ? (
          <>
            <ul>
              {results.slice(0, limit).map(item => (
                <ItemRow
                  key={item.id}
                  item={item}
                  showType={!type}
                  onToggleTask={toggle}
                  busy={busyId === item.id}
                  date={vault.changedTime.get(item.id) ? new Date(vault.changedTime.get(item.id)!).toISOString() : null}
                  meta={<TagBadges tags={item.tags} limit={3} />}
                />
              ))}
            </ul>
            <ShowMore shown={Math.min(limit, results.length)} total={results.length} onMore={() => setLimit(value => value + PAGE)} />
          </>
        ) : (
          <EmptyState title="No match" description={filtered ? 'Try fewer words, or clear a filter.' : 'Nothing of this type in this scope.'}>
            {filtered && <Button variant="outline" onClick={() => { setText(''); update({ q: '', tag: '' }) }}>Clear filters</Button>}
          </EmptyState>
        )}
        {hiddenBulk > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {hiddenBulk.toLocaleString('en-IN')} artifacts, evidence files, and archived records are not in this list. Open them from <a className="spine-link" href={withQuery('#library', { type: 'artifact' })}>Artifacts</a> or <a className="spine-link" href={withQuery('#library', { type: 'evidence' })}>Evidence</a>, or search by name.
          </p>
        )}
        <OtherScopeHint hidden={outside} />
      </div>
    </div>
  )
}
