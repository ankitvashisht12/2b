# Product
<!-- impeccable:product-schema 1 -->

> Inferred from the delegated V3 brief and the user's feedback on the first V3 dashboard (no live interview). Confirm or correct.

## Platform
web

## Users
One person, Ankit, on a local Mac. He uses 2b as his personal second brain for work and life: projects, tasks, notes, ideas, reminders, people, books, and AI agent jobs. He opens it many times a day to see his day, pick up the thread, capture something, and read back what he wrote.

## Product Purpose
2b V3 keeps every piece of personal knowledge as a typed item in one local vault (`~/obsidian/2b`). The dashboard lets him see a day, find, capture, edit, and connect items. Success: he sees what happened and what is due on any date in seconds, finds any item, captures without friction, and trusts that nothing is lost or invented.

## Positioning
Typed items with free links, not folders. A task, a note, and a book are peers. Tags are light labels with a name and a description, not forced pages. Collections group linked items without forced project ownership. Projects are ongoing (for example "AI Analytics", with releases and PRs inside) or finite.

## User feedback that sets the direction (2026-10-30)
- The first V3 dashboard was hard to use. V1 and V2 were simple: a timeline, a date picker, and visible events. Do not revert to V2; bring that simplicity to V3.
- Work and Personal filtering must be visible and the same everywhere (Today, Calendar, Timeline, Projects, Library, search).
- Use a real shadcn dashboard with smooth, restrained motion.
- "New type" is a button that opens a dialog, not a full-width panel.
- Say **item** for a saved thing and **type** for its category. Use Projects, People, Books, and Notes where the type is known.

## Operating Context
- Local only: `127.0.0.1`, no external services, no uploads.
- Data comes from a real migration: about 9,400 items (about 7,600 artifacts and 380 evidence records), 26 projects, 141 tasks, and copied log files. Rendering must stay bounded.
- Source vaults `~/obsidian/2bv2` and `~/obsidian/personal` never change. Only the V3 vault changes, through the backend.
- Time zone: Asia/Kolkata.
- History uses the original source timestamps and the copied logs. Import time never counts as activity; only an edit made in 2b (`activityAt`) does.
- `~/.2b/config.json` holds vault path and agent settings. Infrastructure stays out of everyday flows.

## Capabilities and Constraints
- Built-in types: project, task, note, collection, person, book, organization, system, meeting, artifact, tag, reminder, agent-job, agent-run. Custom types with typed and required fields.
- Today is a day view with a date picker: schedule (deadlines, meetings, reminders), overdue and in-progress tasks, and the day's activity. Timeline groups history by day over a chosen range. Calendar shows a month with the lines of each day.
- Inbox: items with `processingState: inbox`, across all dates.
- Imported agent jobs and reminders are disabled pending review. The UI must never say they are active.
- Imported HTML or scripts never run in the app origin. Files open through the sandboxed `/api/file` route.
- No fake data. No sample content.

## Evidence on Hand
Real migrated vault only. No testimonials or metrics exist; do not make them.

## Product Principles
1. Day first: any date, its schedule, and its history are one click or one key away.
2. Scope always visible: All, Work, or Personal is in view and means the same thing on every page.
3. Honest state: real counts, real dates, real empty and error states.
4. Read first: plain content, source, dates, and links are easy to read.
5. Fast capture: one key to capture; it persists or says why not.
6. Bounded: never render the whole vault at once; fold bulk files.
7. Local and safe: no source vault writes, no script execution, no lost edits.

## Accessibility & Inclusion
Full keyboard use, visible focus, reduced motion, mobile layout.
