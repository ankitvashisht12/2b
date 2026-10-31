# 2b V3 dashboard: direction, views, and review

Source: `dash-v3/src` (React, shadcn/ui on Radix, Tailwind 4, Vite). Build output: `dash-v3/dist` (`npm run build`). Mode: Operate, with Read for item content. Product truth: `PRODUCT.md`. Tokens and components: `DESIGN.md`.

## Why this rebuild

The user found the first V3 dashboard hard to use. V1 and V2 were simple: a timeline, a date picker, and visible events. Work and Personal filtering was missing. The "New type" form was a full-width accordion. Labels mixed "object" and "type". This rebuild keeps every V3 capability and changes the shape of the app.

## Direction contract

- The product is a working app of its category: a collapsible sidebar, a top bar with the current place, standard shadcn controls. The world lends only type, palette, density, and one signature move.
- World: a calm day book. Warm paper ground, ink text, blue for Work, green for Personal, a warm red margin rule.
- Signature move: the day spine. Times in the gutter, one thin margin rule, icons on the rule. The same spine carries Today, Timeline, the Calendar day panel, and an item's History.
- Density: compact rows (one name line, one meta line), 14px UI.
- Refused: card walls, hero metrics, decorative motion, animation on keyboard actions.

## Views

| Route | Contents | Bound |
|---|---|---|
| `#today`, `#day/YYYY-MM-DD` | Previous/next/today buttons, a date picker (opens on the shown day, with busy-day dots), ← → keys, `T` for today. Overdue and In progress (foldable, only on today). Schedule with "Add task" (due on that day). Activity: item dates and copied log lines on the spine. Bulk files fold under their parent. Side month with dots and "Coming up" for 14 days; below 1280 px "Coming up" and the Inbox count show under the day. | 80 activity lines, then "Show more" |
| `#timeline?days=7\|30\|90` or `?from=&to=` | Each day: its schedule, then its history, newest day first, with presets, a range picker (up to one year), Earlier and Later. An empty range offers the nearest earlier day with lines | 30 lines a day; 31 days at a time |
| `#calendar?month=YYYY-MM&date=` | Month grid (react-day-picker) with up to three lines a day and "+N more" (phone: a red mark for a deadline, a grey mark for other lines, and the count); the selected day's schedule and activity beside it. Arrow keys move the focused day; each pick is a history entry | One month |
| `#inbox` | `processingState: inbox`, newest first. "Process…" on each row sets type, scope, project or collection, due date, and required fields in one save, then marks the item processed. A check button marks it processed with no other change. Both offer Undo | 100 rows per step |
| `#projects` | Ongoing, Finite, Kind not set; Paused or on hold; Done or archived (folded). Open task count and latest activity; the order uses the same latest date. "New project" | |
| `#library?type=&tag=&q=&sort=` | Type list with counts, text filter, tag filter, Recent or Name sort. Bulk files stay out of "All items" unless searched | 100 rows per step |
| `#item/<id>` | Reader (Markdown subset, wiki links, tables), Edit with typed fields, scope, tags, and body, Facts (plain field labels), Links with plain group names ("Part of", "Contains", "Mentioned in") and an "Add link" popover, project tasks with "Add task", "Add note" on a collection, "Change type or project…" in the menu, History from logs | Link groups 10, then 50 more |
| `#tags` | Tags with counts in scope and descriptions (dialog) | 100 rows per step |
| `#types` | Types table; "New type" button opens a dialog with typed and required fields | |
| `#graph`, `#graph/<id>` | Most linked items; local radial graph of one item, tag links hidden until asked | 40 neighbours |
| `#settings` | Vault facts, server health, schedules waiting for review (always "Disabled"), Check files | |

Old links still work: `#object/<id>`, `#objects`, `#people`, `#books`, `#collections`.

## Rules held by the code

- History uses source timestamps for imported items (`sourceCreatedAt`, `sourceModifiedAt`), `contentDate`, `completedAt`, and `activityAt` for edits made in 2b. `createdAt`/`modifiedAt` of an imported item never count, so import time does not flood a day. Log lines come from `GET /api/activity`; when it fails, the page says so and still shows item dates.
- One request loads the past year of log lines at start, in parallel with `/api/state`. Older ranges load on demand (the server allows up to 366 days per request).
- Scope: `work`/`personal` tags or a project's `area`; an item without either takes its project's scope through `part-of`. Capture and Edit set the scope tag (and `area` for projects).
- Item pages drop a late answer for an item the user already left (`AbortController` plus an id check). A page that throws shows "This page did not load" with Try again, Reload, and Today; the shell stays.
- Edit keeps unsaved text: leaving asks first (route guard and `beforeunload`); a failed save keeps the text and names the problem.
- Markdown is escaped first; the renderer adds only its own tags. Imported HTML and scripts never run. Files open through the sandboxed `/api/file` route in a new tab.
- Imported schedules show "Imported schedule: disabled until you review it" with the CLI review path (`2b show ID`, `2b object set ID migrationReview reviewed`, `2b object set ID enabled true`). `enabled` is locked only while `migrationReview` is `pending`. A reminder made in 2b and not enabled shows "Disabled" and can be enabled in Edit. No page says a schedule runs; an enabled one runs only with `2b worker`.
- New items take their context: Projects makes a project, a project page adds a task in the project, a collection adds a note in it, a day page adds a task due that day. Capture has an optional "Project or collection" picker; it lists them before any typing. An item filed under a project or collection skips the Inbox. The link is saved first; if it fails, the item stays in the Inbox and the toast offers Try again.
- Process and "Change type or project" keep the same item ID, file, content, and links. A type change gives fields that do not fit the new type its default or nothing. The link is saved first and the processed state last, so a failure never hides an unfiled item.
- Complete, reopen, and process offer Undo in the toast and on ⌘Z. Undo puts back the earlier status, `completedAt`, type, scope tags, and Inbox state. A task completed in a list stays for 1.5 s, struck through, then folds away; focus moves to the next task box.
- Each open of New item starts clean from its context. Closing it with typed text shows "Draft discarded" with Restore.
- Keyboard: `?` lists the shortcuts; `G` then a letter opens a page; search lists matching pages. Day arrow keys do nothing while a radio, grid, tab list, or other control owns them. Dialogs return focus to the control that opened them.
- All dates are Asia/Kolkata. `datetime` fields read and write IST.

## Feedback to change

| Before | After | Why |
|---|---|---|
| No Work/Personal filter | Scope switch in the top bar on every page, remembered | The user asked for visible, consistent scope |
| Today was a feed with no date control | Day view with a date picker, previous/next/today, keys, and a side month | V1/V2 simplicity: pick a date, see its events |
| No timeline or month view | Timeline with ranges; Calendar month with visible lines | "Timeline, date calendar selection, visible events" |
| Thousands of imported files on one day | Bulk files fold under their parent item with a count | A day stays readable after migration |
| "New type" full-width accordion | "New type" button and dialog | The user's screenshot feedback |
| "object" and "type" mixed | "item" and "type", with Projects, People, Books, Notes | The user's terminology |
| Hand-made HTML strings and CSS | React with shadcn/ui on Radix | "Fully use shadcn dashboard" |
| A red notice "Cannot set properties of null" on a person page | Detail loads are cancelled and checked by id; errors stay inside the page with Try again | A real bug report |
| Capture and search with open animations | No animation for keyboard-opened surfaces | Used many times a day |
| Inbox "Processed" was only a flag | "Process…" sets type, scope, project, due date, and required fields in one save; quick check kept; Undo | Processing means deciding what an item is and where it goes (review A1) |
| A task in a project took about 13 steps and the link name "part-of" | "Add task" on the project, "Add note" on a collection, "New project" on Projects, "Add task" on a day, a project picker in capture | Recognition, not recall (A2) |
| Complete and process had no undo; the item page kept the old state | Toast Undo and ⌘Z; the item page shows the newest saved record | A fast action needs a cheap way back; honest state (A5, B1) |
| ← → on the scope switch also changed the day | Day keys skip handled keys and controls that own arrows | One key does one thing (A3, B3) |
| A project's area was a second, dead scope control | One Scope control that starts from the area; area changes only with the scope | No false "Saved." and no silent scope loss (A4, B8) |
| Calendar day buttons remounted; focus fell to the page | Module-scope calendar parts; month cells take focus; pickers open on the selected day | Keyboard use of every calendar (B4, A15, A22) |
| Dialogs taller than a phone screen | Dialogs fit the viewport and scroll; the footer stays in view | "Create type" was out of reach at 375×667 (B5) |
| Reduced motion set every duration to 1 ms | Looping animations stop; fades stay; zoom, slide, height, and press scale go | Infinite animations strobed at 1 ms (B6) |
| A long word widened the page | `min-w-0` on the inset; titles, descriptions, and prose wrap anywhere; tags truncate | One real 151-character path pushed "New item" off screen (B2) |
| Raw keys ("processingState", "has-attendee (linked from)") | Plain labels ("Inbox state", "Attended"); raw keys only on Types | Plain words (A12, B17) |
| Native confirm for leave and discard | shadcn AlertDialog; the browser's own question stays only for closing the tab | One component vocabulary (A25) |

## Verification

- `npm run build`, `npm run check`, `npm run test:browser` (isolated fixture vault and app home; see the script for the checks).
- A read-only render against the real vault: the bundle is served from disk, only GET `/api` requests reach the running server, and other methods are blocked.

## Known limits

- `/api/state` returns every item (about 14 MB for the real vault). Measured on 30 Oct after the backend history change: the first page title appears 2.4–3.7 s after a cold open (headless browser, shared machine). The app does not keep a copy of the vault in the browser. A smaller first payload is the next step.
- The API cannot delete a link. Undo after Process keeps a new project link (the toast says so), and an item already in a project cannot move to another project from the UI.
- Lists that hide lines or items in another scope say how many on Today, Timeline, Calendar, Inbox, Projects, and Library. Tags and Graph show counts for the current scope only.
- There is no `j`/`k` row movement; Tab and the `G` keys move between rows and pages.
- Search and filters run in the browser over names, descriptions, tags, and paths, not file contents.
- The reader supports a Markdown subset: headings, lists, task boxes, code, quotes, rules, tables, links, and wiki links.
