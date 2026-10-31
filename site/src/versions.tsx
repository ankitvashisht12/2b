import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { InstallSteps, Upkeep } from './install.tsx'
import { Command, Entry, GitHubMark, SectionHead, SiteFooter, SiteHeader, repo } from './ui.tsx'

export type VersionId = 'v1' | 'v2' | 'v3'

export const versions: { id: VersionId; title: string; released: string; summary: string; current?: boolean }[] = [
  {
    id: 'v3',
    title: 'Typed items and links',
    released: '31 Oct 2026',
    summary: 'Everything is an item with a type. A local database keeps the links. New dashboard.',
    current: true,
  },
  {
    id: 'v2',
    title: 'Collections, notes, and reminders',
    released: '29 Oct 2026',
    summary: 'Releases 2.0 and 2.1. Notes without tasks, standalone reminders, a refined dashboard.',
  },
  {
    id: 'v1',
    title: 'The first 2b',
    released: '16–22 Oct 2026',
    summary: 'A CLI for projects, tasks, artifacts, rules, and recurring agent jobs, with a local dashboard.',
  },
]

const v1Commit = '7b7cf7dc7d7032921490ec4b2f7d264682319038'

function oldInstall(folder: string, ref: string) {
  return `git clone ${repo}.git ${folder}
cd ${folder}
git checkout ${ref}
mkdir -p ~/.local/bin ~/.claude/skills ~/.agents/skills
ln -s "$PWD/bin/2b" ~/.local/bin/2b
ln -s "$PWD/skill" ~/.claude/skills/2b  # Claude Code
ln -s "$PWD/skill" ~/.agents/skills/2b  # Codex
2b init`
}

function VersionHero({ id, title, facts, children }: { id: VersionId; title: string; facts: ReactNode; children: ReactNode }) {
  const current = versions.find((version) => version.id === id)!
  return (
    <Entry className="hero version-hero" mark="strong" label={<span className="numeric">{current.released}</span>}>
      <div>
        <h1>
          2b {id}: {title}
        </h1>
        <p className="lede">{children}</p>
        <div className="facts">{facts}</div>
      </div>
    </Entry>
  )
}

function OlderVersionNotice() {
  return (
    <Entry label={<strong>Note</strong>}>
      <p className="warning">
        <strong>This is an older version.</strong> For a new install, use <a href="/v3/">2b v3</a>. Install an old version only to read old data or to compare.
      </p>
    </Entry>
  )
}

function SharedFolderWarning({ version }: { version: VersionId }) {
  return (
    <p className="warning">
      <strong>{version} and v3 use the same data folder,</strong> <code>~/obsidian/2b</code>. To run {version} on a Mac that also has v3, set another folder
      first: <code>export TWOB_HOME=~/obsidian/2b-{version}</code>. If a <code>2b</code> link already exists, <code>ln -s</code> stops with “File exists”. Keep
      the old link, or remove it with <code>rm ~/.local/bin/2b</code>.
    </p>
  )
}

function SourceLinks({ links }: { links: { href: string; label: string }[] }) {
  return (
    <section className="section" aria-labelledby="source">
      <SectionHead id="source" title="Source" />
      <Entry label={<strong>On GitHub</strong>}>
        <div className="hero-links" style={{ marginTop: 0 }}>
          {links.map((link) => (
            <a key={link.href} className="button" href={link.href}>
              <GitHubMark />
              {link.label}
            </a>
          ))}
        </div>
      </Entry>
      <Entry label={<strong>Other versions</strong>}>
        <div className="hero-links" style={{ marginTop: 0 }}>
          {versions.map((version) => (
            <a key={version.id} className="button" href={`/${version.id}/`}>
              2b {version.id}
              <ArrowRight aria-hidden="true" />
            </a>
          ))}
        </div>
      </Entry>
    </section>
  )
}

function V3Page() {
  return (
    <>
      <VersionHero
        id="v3"
        title="typed items and links"
        facts={
          <>
            <span>
              Git tag <b>v3.0.0</b>
            </span>
            <span>
              Needs <b>macOS on Apple silicon</b> and <b>Node.js 22+</b>
            </span>
            <span className="badge">Current</span>
          </>
        }
      >
        Every saved thing is an item with a type and an ID. Items link to each other by name. Notes stay as ordinary files; a local SurrealDB database keeps
        types, links, and status.
      </VersionHero>

      <section className="section" aria-labelledby="new">
        <SectionHead id="new" title="What is new in v3" />
        <Entry label={<strong>Changes</strong>}>
          <ul className="feature-list">
            <li>
              <b>15 built-in types</b>: area, project, task, note, collection, person, book, organization, repository, meeting, artifact, tag, reminder, agent
              job, and agent run.
            </li>
            <li>
              <b>Your own types</b> with typed fields, such as a Course with progress.
            </li>
            <li>
              <b>Named links</b> between items, with backlinks on every item.
            </li>
            <li>
              <b>Work and Personal areas</b>, and one scope switch that filters every page.
            </li>
            <li>
              <b>A new dashboard</b>: Today, Timeline, Calendar, Inbox, Projects, Library, Tags, Types, and Graph.
            </li>
            <li>
              <b>Keyboard first</b>: <code>N</code> for a new item, <code>/</code> or <code>⌘K</code> to search.
            </li>
            <li>
              <b>Plain files stay plain</b>: notes are Markdown pages you can open in Obsidian.
            </li>
            <li>
              <b>Agent jobs are off by default.</b> The worker runs only when you turn it on.
            </li>
          </ul>
        </Entry>
      </section>

      <InstallSteps />
      <Upkeep />

      <section className="section" aria-labelledby="from-v2">
        <SectionHead id="from-v2" title="Coming from v2" />
        <Entry label={<strong>Data folder</strong>}>
          <p>
            v2 and v3 both use <code>~/obsidian/2b</code> by default. Do not start v3 on a v2 folder. Before the first <code>./bin/2b start</code>, move the v2
            data away, or set <code>"vaultPath"</code> to a new folder in <code>~/.2b/config.json</code>:
          </p>
          <Command label="move the v2 folder" code="mv ~/obsidian/2b ~/obsidian/2bv2" />
        </Entry>
        <Entry label={<strong>Migration</strong>}>
          <p>
            <code>2b migrate</code> copies v2 data into v3 and never changes the source. It is built for the author’s own two vaults and needs both{' '}
            <code>~/obsidian/2bv2</code> and <code>~/obsidian/personal</code>. Always look at the dry run first:
          </p>
          <Command label="migrate from v2" code={'./bin/2b migrate --dry-run\n./bin/2b migrate'} />
          <p className="note">Imported jobs and reminders stay off until you review them. A general importer for a single v2 folder is not ready yet.</p>
        </Entry>
      </section>

      <SourceLinks
        links={[
          { href: `${repo}/tree/v3.0.0`, label: 'Code at v3.0.0' },
          { href: `${repo}/blob/v3.0.0/docs/v3-architecture.md`, label: 'Architecture' },
          { href: `${repo}/blob/v3.0.0/CHANGELOG.md`, label: 'Changelog' },
        ]}
      />
    </>
  )
}

function V2Page() {
  return (
    <>
      <VersionHero
        id="v2"
        title="collections, notes, and reminders"
        facts={
          <>
            <span>
              Git tags <b>v2.0.0</b> and <b>v2.1.0</b>
            </span>
            <span>
              Needs <b>Node.js 22.14+</b>
            </span>
          </>
        }
      >
        A local CLI and dashboard for projects, tasks, saved knowledge, reminders, and scheduled AI work. Use it yourself or ask your agent to use it.
      </VersionHero>
      <OlderVersionNotice />

      <section className="section" aria-labelledby="model">
        <SectionHead id="model" title="The model" />
        <Entry label={<strong>Parts</strong>}>
          <dl className="pairs">
            <dt>Project</dt>
            <dd>A home for related work and knowledge, marked work or personal.</dd>
            <dt>Task</dt>
            <dd>An action in a project. A recurring task is a scheduled job that runs an agent or a command.</dd>
            <dt>Collection</dt>
            <dd>A named group of notes and files in a project.</dd>
            <dt>Note</dt>
            <dd>Written content in a collection: journal, reflection, learning, research, decision, or meeting. A note does not need a task.</dd>
            <dt>Artifact</dt>
            <dd>A file saved with a task, collection, or note, with its purpose.</dd>
            <dt>Reminder</dt>
            <dd>A notification at a time you choose, once or on a repeat.</dd>
            <dt>Event</dt>
            <dd>A dated log line. The timeline and weekly report read these.</dd>
          </dl>
        </Entry>
      </section>

      <section className="section" aria-labelledby="changes">
        <SectionHead id="changes" title="Releases" />
        <Entry label={<strong>2.1.0</strong>}>
          <ul className="plain-list">
            <li>Dashboard filters and search work per view, including text inside notes.</li>
            <li>Dialogs to capture projects, tasks, jobs, and Inbox notes, with draft recovery.</li>
            <li>Human tasks and scheduled jobs are in separate groups on Home.</li>
            <li>Every page is reachable on a phone through a five-item bar and a More menu.</li>
          </ul>
        </Entry>
        <Entry label={<strong>2.0.0</strong>}>
          <ul className="plain-list">
            <li>Projects hold collections. Collections hold typed notes and files.</li>
            <li>Standalone reminders, once or on a repeat, with delivery history and retry.</li>
            <li>A local reminder worker checks every minute and catches up after downtime.</li>
            <li>New AI jobs use Codex by default. Existing jobs keep their agent.</li>
          </ul>
          <p className="note">
            <a href={`${repo}/blob/v2.1.0/docs/media/2b-demo.mp4`}>Watch the demo video on GitHub</a>: an agent creates a project, and the dashboard shows it.
          </p>
        </Entry>
      </section>

      <section className="section" aria-labelledby="install-v2">
        <SectionHead id="install-v2" title="Install v2.1">
          v2 needs no build step and no database. Scheduled jobs and notifications need macOS. AI jobs need the Claude Code or Codex CLI, signed in.
        </SectionHead>
        <Entry label={<strong>Install</strong>}>
          <Command label="install 2b v2.1" code={oldInstall('2b-v2', 'v2.1.0')} />
          <p className="note">Git prints a “detached HEAD” note after the checkout. That is expected.</p>
          <SharedFolderWarning version="v2" />
        </Entry>
        <Entry label={<strong>Try it</strong>}>
          <Command
            label="try 2b v2"
            code={
              '2b new project sample --area personal --title "Sample" --body "What: Build a tool. Why: Save time."\n2b new task sample review --priority high --body "What: Review the design."\n2b status review doing\n2b dash --open'
            }
          />
          <p className="note">
            <code>2b help</code> lists every command.
          </p>
        </Entry>
      </section>

      <SourceLinks
        links={[
          { href: `${repo}/tree/v2.1.0`, label: 'Code at v2.1.0' },
          { href: `${repo}/blob/v2.1.0/README.md`, label: 'v2.1 README' },
          { href: `${repo}/tree/v2.0.0`, label: 'Code at v2.0.0' },
        ]}
      />
    </>
  )
}

function V1Page() {
  return (
    <>
      <VersionHero
        id="v1"
        title="the first 2b"
        facts={
          <>
            <span>
              No tag. Last commit <b className="numeric">7b7cf7d</b>
            </span>
            <span>
              Needs <b>Node.js 22.14+</b>
            </span>
          </>
        }
      >
        A CLI that you or your agent use to track projects, tasks, artifacts, rules, and recurring jobs, with a local dashboard to see it all.
      </VersionHero>
      <OlderVersionNotice />

      <section className="section" aria-labelledby="features">
        <SectionHead id="features" title="What it does" />
        <Entry label={<strong>Features</strong>}>
          <ul className="feature-list">
            <li>
              <b>Projects</b>, each marked work or personal, with a status.
            </li>
            <li>
              <b>Tasks</b> in a project, with status, due date, and links.
            </li>
            <li>
              <b>Priority</b>: P1 to P5 for projects, high, med, or low for tasks.
            </li>
            <li>
              <b>Readmes</b> that say what each project or task is and where it stands.
            </li>
            <li>
              <b>Artifacts</b>: notes, reports, and HTML saved with their task.
            </li>
            <li>
              <b>Logs</b> of every change, and a <b>timeline</b> by week or month.
            </li>
            <li>
              <b>Rules</b> for agents at global, project, or task level.
            </li>
            <li>
              <b>Routines</b>: recurring jobs on a schedule, with run history.
            </li>
            <li>
              <b>Trash</b> for deleted routines, with restore.
            </li>
            <li>
              <b>Inbox and learnings</b> for quick notes.
            </li>
            <li>
              <b>Search</b> by name or content.
            </li>
            <li>
              <b>Import</b> of existing folders, without changing them.
            </li>
          </ul>
        </Entry>
      </section>

      <section className="section" aria-labelledby="install-v1">
        <SectionHead id="install-v1" title="Install v1">
          v1 needs no build step and no database.
        </SectionHead>
        <Entry label={<strong>Install</strong>}>
          <Command label="install 2b v1" code={oldInstall('2b-v1', '7b7cf7d')} />
          <p className="note">Git prints a “detached HEAD” note after the checkout. That is expected.</p>
          <SharedFolderWarning version="v1" />
        </Entry>
        <Entry label={<strong>Known limit</strong>}>
          <p>
            Codex agent tasks run with <code>--sandbox workspace-write</code> in the store, so they can run commands and edit store files. Use{' '}
            <code>--agent claude</code> for untrusted input.
          </p>
        </Entry>
      </section>

      <SourceLinks
        links={[
          { href: `${repo}/tree/${v1Commit}`, label: 'Code at 7b7cf7d' },
          { href: `${repo}/blob/${v1Commit}/README.md`, label: 'v1 README' },
        ]}
      />
    </>
  )
}

export function VersionPage({ id }: { id: VersionId }) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader current={id} />
      <main id="main" className="page spine">
        {id === 'v3' ? <V3Page /> : id === 'v2' ? <V2Page /> : <V1Page />}
      </main>
      <SiteFooter />
    </>
  )
}
