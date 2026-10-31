import { useState, type ComponentType } from 'react'
import { Bell, BookOpen, Check, CircleCheck, FileText, Flag, Users } from 'lucide-react'

type Scope = 'work' | 'personal'
type Line = {
  id: string
  time: string
  icon?: ComponentType<{ 'aria-hidden'?: boolean }>
  name: string
  meta: string
  tone?: 'warn' | 'progress'
  scope: Scope
  task?: boolean
}

// Sample data only. It shows how a day looks in 2b; none of it comes from a real vault.
const groups: { title: string; source: string; lines: Line[] }[] = [
  {
    title: 'Schedule',
    source: 'schedule',
    lines: [
      { id: 'review', time: '09:30', icon: Users, name: 'Design review with Priya', meta: 'Meeting · Website relaunch', scope: 'work' },
      { id: 'dentist', time: '13:00', icon: Bell, name: 'Call the dentist', meta: 'Reminder', scope: 'personal' },
      { id: 'notes', time: '18:00', icon: Flag, name: 'Send the launch notes', meta: 'Due today · Website relaunch', tone: 'warn', scope: 'work' },
    ],
  },
  {
    title: 'Open tasks',
    source: 'tasks',
    lines: [
      { id: 'passport', time: '28 Oct', name: 'Renew passport', meta: 'Overdue 3 days · Travel', tone: 'warn', scope: 'personal', task: true },
      { id: 'guide', time: '', name: 'Draft the onboarding guide', meta: 'In progress · Website relaunch', tone: 'progress', scope: 'work', task: true },
    ],
  },
  {
    title: 'Activity',
    source: 'activity',
    lines: [
      {
        id: 'learning',
        time: '10:12',
        icon: FileText,
        name: 'Learning: keep links in the database, text in files',
        meta: 'Note · tagged learning',
        scope: 'work',
      },
      { id: 'export', time: '11:40', icon: CircleCheck, name: 'Fix the export path', meta: 'Task done · Website relaunch', scope: 'work' },
      { id: 'book', time: '16:05', icon: BookOpen, name: 'Started “The Design of Everyday Things”', meta: 'Book · Reading', scope: 'personal' },
    ],
  },
]

const scopes: { value: 'all' | Scope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'work', label: 'Work' },
  { value: 'personal', label: 'Personal' },
]

export function TodayDemo() {
  const [scope, setScope] = useState<'all' | Scope>('all')
  const [done, setDone] = useState<Set<string>>(() => new Set())
  const hiddenCount = groups.flatMap((group) => group.lines).filter((line) => scope !== 'all' && line.scope !== scope).length

  function toggle(id: string) {
    setDone((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  return (
    <figure className="demo" aria-label="Sample of the 2b Today page">
      <div className="demo-bar">
        <div className="demo-title">
          <strong>Today</strong>
          <span className="numeric">Saturday, 31 October</span>
        </div>
        <div className="scope-switch" role="group" aria-label="Scope">
          {scopes.map((option) => (
            <button key={option.value} type="button" aria-pressed={scope === option.value} onClick={() => setScope(option.value)}>
              {option.value !== 'all' && <span className="scope-dot" data-scope={option.value} />}
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="demo-body">
        {groups.map((group) => (
          <section key={group.title} className="demo-group" aria-label={group.title}>
            <h3>{group.title}</h3>
            {group.lines.map((line) => {
              const hidden = scope !== 'all' && line.scope !== scope
              const isDone = done.has(line.id)
              const Icon = line.icon
              return (
                <div key={line.id} className="fold" data-hidden={hidden || undefined} inert={hidden} aria-hidden={hidden || undefined}>
                  <div>
                    <div className="demo-line" data-source={group.source} data-done={isDone || undefined}>
                      <span className="demo-time">{line.time}</span>
                      <span className="demo-mark">
                        {line.task ? (
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={isDone}
                            aria-label={`Done: ${line.name}`}
                            className="demo-check"
                            onClick={() => toggle(line.id)}
                          >
                            <Check aria-hidden={true} strokeWidth={3} />
                          </button>
                        ) : (
                          Icon && <Icon aria-hidden={true} />
                        )}
                      </span>
                      <span className="demo-text">
                        <span className="demo-name">{line.name}</span>
                        <span className="demo-meta">
                          <span data-tone={isDone ? undefined : line.tone}>{isDone ? 'Done just now' : line.meta}</span>
                        </span>
                      </span>
                      <span className="scope-dot" data-scope={line.scope} title={line.scope === 'work' ? 'Work' : 'Personal'} />
                    </div>
                  </div>
                </div>
              )
            })}
          </section>
        ))}
        <p className="demo-hidden" aria-live="polite">
          {hiddenCount > 0 && (
            <>
              {hiddenCount} lines from {scope === 'work' ? 'Personal' : 'Work'} are hidden.
              <button type="button" onClick={() => setScope('all')}>
                Show all scopes
              </button>
            </>
          )}
        </p>
      </div>
      <figcaption className="demo-foot">
        Sample data. Try the scope switch and the task boxes. The real dashboard runs on your Mac at 127.0.0.1:4423.
      </figcaption>
    </figure>
  )
}
