import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight } from 'lucide-react'
import { TodayDemo } from './demo.tsx'
import { InstallSteps, Upkeep, quickStart } from './install.tsx'
import { Command, Entry, GitHubMark, SectionHead, SiteFooter, SiteHeader, repo } from './ui.tsx'
import { versions } from './versions.tsx'
import './site.css'

function Landing() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="page spine">
        <Entry className="hero" mark="strong" label={<span className="numeric">v3.0.0</span>}>
          <h1>A second brain that lives on your Mac.</h1>
          <div className="hero-grid">
            <div className="hero-copy">
              <p>
                2b keeps your <strong>projects, tasks, notes, people, and books</strong> in one local folder. You see your day in the dashboard. Your coding
                agent reads and writes the same items from the terminal.
              </p>
              <div className="hero-start">
                <h2>Quick start</h2>
                <Command primary label="quick start commands" code={quickStart} />
                <p className="hero-needs">Needs macOS on Apple silicon and Node.js 22 or later. New to Terminal? Follow the five steps below.</p>
              </div>
              <div className="hero-links">
                <a className="button" href="#install">
                  Step-by-step install
                  <ArrowRight aria-hidden="true" />
                </a>
                <a className="button" href={repo}>
                  <GitHubMark />
                  View on GitHub
                </a>
              </div>
            </div>
            <TodayDemo />
          </div>
        </Entry>

        <section className="section" aria-labelledby="how">
          <SectionHead id="how" title="How 2b keeps things">
            No folders to choose and no pages to keep tidy. You save an item, give it a type, and link it to other items.
          </SectionHead>
          <Entry label={<strong>Items</strong>}>
            <p>
              Everything you save is an <strong>item</strong> with a <strong>type</strong>: project, task, note, person, book, meeting, reminder, and more. Add
              your own type, such as Course, with its own fields.
            </p>
          </Entry>
          <Entry label={<strong>Links</strong>}>
            <p>Items connect by name. A task is part of a project. A meeting has attendees. A note mentions a person. Each item shows what links to it.</p>
          </Entry>
          <Entry label={<strong>Work and Personal</strong>}>
            <p>Each item belongs to Work, Personal, or both. One switch filters every page the same way, as in the sample above.</p>
          </Entry>
          <Entry label={<strong>Days</strong>}>
            <p>Today shows the schedule, open tasks, and what you did. Pick any date to see that day. Timeline and Calendar show longer stretches.</p>
          </Entry>
          <Entry label={<strong>Plain files</strong>}>
            <p>
              Notes stay as Markdown files in <code>~/obsidian/2b</code>. Open them in Obsidian or any editor. 2b runs only on <code>127.0.0.1</code>: no
              account, no cloud sync.
            </p>
          </Entry>
        </section>

        <section className="section" aria-labelledby="agent">
          <SectionHead id="agent" title="Ask your agent to use it">
            2b comes with a skill for Claude Code and Codex. Your agent runs the same <code>2b</code> commands you can run. Some examples:
          </SectionHead>
          <Entry label={<strong>You say</strong>}>
            <dl className="pairs agent">
              <dt>Save this idea: a weekly review template</dt>
              <dd>2b capture "A weekly review template"</dd>
              <dt>What is still in my inbox?</dt>
              <dd>2b inbox</dd>
              <dt>Start a project for the website relaunch</dt>
              <dd>2b object create project "Website relaunch" --properties '{'{"kind":"finite","status":"active"}'}'</dd>
              <dt>Mark the export task done</dt>
              <dd>2b status TASK_ID done</dd>
            </dl>
            <p className="note">
              Run <code>2b help</code> for every command. The <a href={`${repo}/blob/main/skill/SKILL.md`}>skill file</a> tells the agent how to use them.
            </p>
          </Entry>
        </section>

        <InstallSteps />
        <Upkeep />

        <section className="section" aria-labelledby="versions">
          <SectionHead id="versions" title="Versions">
            Each version has its own page with what it does and how to install it.
          </SectionHead>
          <Entry label={<strong>Release log</strong>}>
            <div className="versions">
              {versions.map((version) => (
                <a key={version.id} className="version-row" href={`/${version.id}/`}>
                  <strong>{version.id}</strong>
                  <p>
                    <b>{version.title}</b>
                    {version.current && <span className="badge">Current</span>}
                    <br />
                    <span className="numeric">{version.released}</span> · {version.summary}
                  </p>
                  <span className="go">
                    Read
                    <ArrowRight aria-hidden="true" />
                  </span>
                </a>
              ))}
            </div>
          </Entry>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
)
