import { useMemo } from 'react'
import { PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ItemRow } from '@/components/item-bits'
import { EmptyState, FoldGroup, OtherScopeHint, PageHeader, Section } from '@/components/page'
import { useAppActions } from '@/lib/app-actions'
import { useScope, useVault } from '@/lib/store'
import { inScope, isBulk, isOpenTask, projectKind, SCOPE_LABELS, statusOf, valueLabel, type Item } from '@/lib/vault'

const CLOSED = ['done', 'archived']
const WAITING = ['paused', 'on-hold']

export function ProjectsView() {
  const vault = useVault()
  const [scope] = useScope()
  const { openCapture } = useAppActions()
  const all = vault.items.filter(item => item.type === 'project')

  const facts = useMemo(() => {
    const map = new Map<string, { openTasks: number; items: number; latest: number }>()
    for (const item of vault.items) {
      const projectId = vault.projectOf.get(item.id)
      if (!projectId || isBulk(item)) continue
      const entry = map.get(projectId) ?? { openTasks: 0, items: 0, latest: 0 }
      entry.items++
      if (isOpenTask(item)) entry.openTasks++
      entry.latest = Math.max(entry.latest, vault.changedTime.get(item.id) ?? 0)
      map.set(projectId, entry)
    }
    return map
  }, [vault])
  // The date on a row is the latest change to the project or to an item in it; the order uses the same date.
  const latestOf = (project: Item) => Math.max(facts.get(project.id)?.latest ?? 0, vault.changedTime.get(project.id) ?? 0)
  const projects = all.filter(item => inScope(vault.scopeOf.get(item.id) ?? null, scope)).sort((left, right) => latestOf(right) - latestOf(left))

  // Inside "Ongoing" or "Finite", the row does not repeat the kind.
  const row = (project: Item, showKind = true) => {
    const fact = facts.get(project.id)
    const latest = latestOf(project)
    return (
      <ItemRow
        key={project.id}
        item={project}
        showType={false}
        date={latest ? new Date(latest).toISOString() : null}
        meta={
          <>
            {showKind && projectKind(project) && <span>{valueLabel(projectKind(project))}</span>}
            {fact && <span className="tabular-nums">{fact.openTasks ? `${fact.openTasks} open ${fact.openTasks === 1 ? 'task' : 'tasks'}` : 'No open task'}</span>}
          </>
        }
      />
    )
  }

  const status = (project: Item) => statusOf(project).toLowerCase()
  const active = projects.filter(project => !CLOSED.includes(status(project)) && !WAITING.includes(status(project)))
  const groups: Array<[string, Item[]]> = [
    ['Ongoing', active.filter(project => projectKind(project) === 'ongoing')],
    ['Finite', active.filter(project => projectKind(project) === 'finite')],
    ['Kind not set', active.filter(project => !['ongoing', 'finite'].includes(projectKind(project)))],
  ]
  const waiting = projects.filter(project => WAITING.includes(status(project)))
  const closed = projects.filter(project => CLOSED.includes(status(project)))

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Projects"
        description={`Ongoing areas of work and projects with an end${scope === 'all' ? '' : ` · ${SCOPE_LABELS[scope]}`}. Most recent activity first.`}
        actions={<Button variant="outline" onClick={() => openCapture({ type: 'project' })}><PlusIcon />New project</Button>}
      />
      {projects.length ? (
        <>
          {groups.filter(([, list]) => list.length).map(([title, list]) => (
            <Section key={title} title={title} count={list.length}><ul>{list.map(project => row(project, title === 'Kind not set'))}</ul></Section>
          ))}
          {waiting.length > 0 && <FoldGroup id="projects-waiting" title="Paused or on hold" count={waiting.length}><ul>{waiting.map(project => row(project))}</ul></FoldGroup>}
          {closed.length > 0 && <FoldGroup id="projects-closed" title="Done or archived" count={closed.length} defaultOpen={false}><ul>{closed.map(project => row(project))}</ul></FoldGroup>}
        </>
      ) : (
        <EmptyState title="No projects in this scope" description="Add a project. Then open it and add tasks to it.">
          <Button onClick={() => openCapture({ type: 'project' })}><PlusIcon />New project</Button>
        </EmptyState>
      )}
      <OtherScopeHint hidden={all.length - projects.length} noun={['project', 'projects']} />
    </div>
  )
}
