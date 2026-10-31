# 2b v3: objects and ordinary files

V3 is an isolated major-version implementation. V2 modules remain available for compatibility tests. The main checkout, global launcher, source vaults, and existing launchd jobs are unchanged.

## Storage ownership

SurrealDB owns object types, objects, custom properties, named graph edges, tag context, work state, reminders, and agent run state. Content remains ordinary Markdown, HTML, images, audio, source files, and other attachments. An object can have no file (tags), one file (notes), or refer to artifacts through graph edges. Collections group objects by reference. No graph database file belongs in Obsidian Sync.

`~/.2b/config.json` is editable app configuration. It holds the default content `vaultPath`, dashboard port, timezone, primary agent and model, optional fallback agent and model, and worker settings. Model null means use that agent CLI's own configured model. Fallback is used when the primary executable is not installed; a partially executed job is never automatically repeated with another agent.

`~/.2b/vaults/<vault-id>/` contains the live SurrealDB data, private credentials, server state, logs, and recovery journal. A tiny hidden `<vault>/.2b/vault.json` holds the stable vault ID. Moving the vault and changing `vaultPath` keeps the database. A copied marker cannot be active from two existing locations; copies need independent vault identities. Back up the app metadata AND content, not just one.

The Mac launcher starts a persistent loopback-only database automatically. Credentials are generated locally, stored in private files, and sent over local HTTP authentication. No database credentials appear in normal API output. The dashboard is also loopback-only; no Docker or cloud account is needed. A pinned SurrealDB 2.3.10 macOS arm64 archive is SHA-256 checked by the installer. V3 currently targets this Mac; other architectures need a supported installer build.

## Objects and types

Common fields: stable `id`, `type`, `name`, `description`, typed/custom `properties`, `tags`, optional vault-relative `path`, `createdAt`, `modifiedAt`. The filename is not identity. Built-in types: area, project, task, note, collection, person, book, organization, repository, meeting, artifact, tag, reminder, agent-job, agent-run. A new custom type defines reusable properties; defining one does not require application code. Schema edits validate existing objects before accepting the edit. Unknown properties are allowed as JSON for migration fidelity; declared properties validate their value type.

Areas are objects. `area:work` and `area:personal` are the top areas; sub-areas (Health, Travel, Career…) are `part-of` one of them. An item's Work/Personal scope comes from its own `in-area` links: a direct link to `area:work`/`area:personal` wins, else its sub-area links decide, else the first scope found up its part-of chain. So a collection in Career (Personal) can still be Work. The API takes `scope: work|personal|none` and keeps one `in-area` link to a top area. Tags are only for topics that cross projects. Projects have `kind=ongoing|finite`. A trip is a collection with place, dates, and tripStatus. A release can be a linked note/collection or property before a dedicated custom Release type is needed. The Tars monorepo is a Repository object, linked by several projects with `uses-repository`.

Code repos live outside the vault in `reposPath` (default `~/2b/repos/<name>`, config `reposPath`, test override `TWOB_REPOS_HOME`). The vault keeps one artifact with `localPath`. `2b repo create` makes new ones; `2b repo extract` moves imported repos out (a folder with .git, package.json, tsconfig.json, pyproject.toml, requirements.txt, go.mod, Cargo.toml, node_modules, .next, or .vite) and removes imported secret files. People and books can exist independently of any project. Named relationships link stable IDs, and reverse queries find backlinks.

## Files and Obsidian

2b resolves content paths inside the selected vault. It rejects path traversal and symlink escapes. Markdown is readable without the database. Each page is `objects/<type>/<Name>.md`; the stable ID lives only in the database (and the page frontmatter). Same names in one folder get the owner's name, then the source folder, then a number. After an import, `2b tidy` renames pages to this form, rewrites links, removes `archive/` and `connections/`, and moves `migration/` to the app data folder. Imported artifacts then keep `localPath` to their file in the original vault; Obsidian links use `file://`, and the dashboard opens them read-only through `/api/source`. Links visible in Obsidian are a readable projection; SurrealDB remains the metadata authority. The dashboard watches content changes and refreshes a managed related-object section in each canonical Markdown page. No duplicate page is created for each object. Use `2b graph rebuild` after a CLI-only batch of relationship changes.

An interrupted content write is recorded before the file changes, then completed in metadata. `2b reconcile` recovers safe pending writes, reports missing content, changed file timestamps, and unregistered files. It does not guess ambiguous renames or silently replace external edits. The dashboard runs a debounced file watcher; the CLI can also reconcile explicitly. Ambiguous file renames remain a review item.

## Daily flow

Today is a mixed view of dated notes, ideas, tasks, and reminders. Inbox is `processingState=inbox`, independent of storage folders. Capture writes an object; processing it updates that same object. A reminder is a notification, not a second task. Personal recurring actions remain tasks/routines, distinct from agent-job execution.

Agent jobs and notifications run only through the explicit V3 worker. Imported jobs keep their original configuration but `enabled=false`, with migration review pending. Existing V2 jobs remain untouched. The V3 worker is not registered for login or scheduled by this migration. `worker --once` is available for explicit review/testing. A job lock prevents overlapping runs; abandoned locks require review rather than unsafe automatic removal.

## Local API

`GET /api/state`, `GET /api/activity?from=YYYY-MM-DD&to=YYYY-MM-DD`, `GET /api/object?id=`, `POST /api/objects`, `PATCH /api/objects/:id`, `POST /api/relationships`, `POST /api/types`, `POST /api/reconcile`, `GET /api/file?path=`, `GET /api/health`.

`/api/state` sends object summaries, schemas, and relationships. The database query omits bulky import provenance. `/api/object` returns the full object and content when opened.

Mutations are local-only with Host/Origin checks. Imported HTML is served with a sandbox Content Security Policy and scripts disabled. The dashboard does not offer arbitrary command execution. External file access is confined to the V3 vault.

## Isolation and tests

Temporary tests set `TWOB_APP_HOME` and use temporary vaults. Direct source and overlapping vault roots are rejected. The copy migration takes before/after source manifests and verifies archive checksums. No source files, source metadata, source logs, or existing schedules should change as a result of migration.

## Activity history

The timeline reads dated log lines from the copied V3 files. Each event keeps the original local time in Asia/Kolkata, its task or project, and Work/Personal tags. It does not use the import date as the event time. The reader caches parsed files by file timestamp, size, and current item context. Date ranges are limited to one year. It never opens the original source vaults.

## Safe filing and metadata refresh

Changing an item type keeps its stable ID, content path, body, and relationships. The store validates the target schema before the change. Inbox processing can set a type, scope, project link, and due date without copying the note. File reconciliation and graph projection patch only their metadata fields against the latest record under the writer lock. A changed file path or expected metadata value skips a stale patch. CLI and REST property edits merge only the submitted fields.

## Progressive startup

`GET /api/startup` returns a partial snapshot for the daily view: meaningful items, all tasks/projects/schedules, Inbox items, the links between these records, type definitions, and exact full-vault statistics. Bulk artifacts and archived evidence load later through `/api/state`. The response marks itself `partial: true`; callers must not treat it as the complete library. Startup properties are limited to daily context and required schema fields. Opening an item still retrieves its full record.

The graph module loads only when the graph route opens. The client must preserve local saves while background data arrives and show an explicit loading or retry state for views that require the complete vault.

The first browser measurements with progressive loading show actionable Today rows at about 1.38 seconds, versus 2.4–2.9 seconds with full-state loading first. Full background completion takes about 3.7–4.3 seconds. These are local headless-browser measurements, not a fixed guarantee. The client starts today's log query first and defers wider history ranges until the full metadata snapshot is available. Local changes are replayed over late snapshots, and only the latest reload response may update the page.
