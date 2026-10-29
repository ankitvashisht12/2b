# Dashboard UI and UX review — 29 October 2026

Method: two independent reviewers. A assessed design and task flow. B assessed code, accessibility, and browser evidence. They reviewed local main at `bb1f799`, before the changes in this report. Their findings were combined only after both finished.

Sources: [Impeccable critique](https://github.com/pbakaus/impeccable/blob/main/.agents/skills/impeccable/reference/critique.md), [Impeccable Operate guidance](https://github.com/pbakaus/impeccable/blob/main/.agents/skills/impeccable/reference/operate.md), and [Emil Kowalski design engineering](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md). These were read as upstream instructions. No skill was installed globally.

## Overall assessment

The project, task, collection, and output model fits a second brain. Source links, backlinks, a quiet palette, and shared controls give it a useful identity. The main gap is task order: returning users need to find content or choose an action before they see a creation form or a large backlog. The best next investment is reliable search and filters, then a clearer Home page. Extra decoration or animation would not solve those problems.

## Baseline design health

Scores use 0 for failed support and 4 for excellent support. These are baseline scores, not a new score after the fixes below. Some checks were limited to source and DOM evidence.

| Heuristic | Score / 4 | Main finding |
| --- | --- | --- |
| System status | 3 | Loading and recovery exist; save progress was generic. |
| Real-world terms | 2 | Some job service and drawer labels expose implementation terms. |
| Control and freedom | 3 | Close and undo patterns exist; cancellation has no restore UI. |
| Consistency | 2 | Shared filters have different effects across pages. |
| Error prevention | 2 | Reminder date and repeat fields could both be filled. |
| Recognition | 2 | Repeat syntax and CLI capture require recall. |
| Efficiency | 3 | Keyboard shortcuts and the palette help frequent use. |
| Minimal design | 2 | Forms and the full open-task list compete with content. |
| Error recovery | 3 | Retry works; form failures relied mainly on toasts. |
| Help | 3 | Shortcut help exists; scheduling needs local guidance. |
| **Total** | **25/40** | **A useful base with clarity gaps.** |

The baseline technical audit scored 10/20: accessibility 2, performance 3, theming 2, responsive design 1, implementation integrity 2. No full accessibility conformance claim is made.

## What works

- Output links and backlinks connect saved knowledge with the action that produced it.
- Due groups urgent work before later work and collapses undated items.
- Shared tokens, visible focus, skeleton loading, retry controls, and reduced-motion support are sound foundations.

## Changes made in this pass

| Before | After | Why |
| --- | --- | --- |
| Collection, note, and reminder forms occupy their pages | New collection, New note, and New reminder open dialogs | Saved content is visible first. |
| Date and repeat are both enabled | One-time or repeating mode enables only the relevant field | Prevent an invalid timing combination. |
| Errors appear mainly as toasts | Dialog errors preserve input and receive focus; saving has a progress label | The user can recover in place. |
| Eight phone destinations use six columns | Home, Projects, Collections, Reminders, and More use one row | All pages remain reachable. More contains Due, Timeline, Jobs, and Inbox. |
| New forms use a separator border token | Form fields use the control border token in both themes | Editable regions stay visible. |
| Collection and note drawers announce Task detail | Drawers announce their entry kind | Screen reader context matches the content. |
| Empty filtered collections ask users to create content | Filtered emptiness offers filter reset | Hidden content is not presented as missing content. |
| Timeline copy implies measured time | Copy describes activity and changes | Logs do not measure time spent. |

Dialogs support Cancel, close, Escape, backdrop dismissal, initial focus, native modal focus containment, and return focus. Project-level collection creation selects that project. Optional reminder links are disclosed on request.

## Priority improvements still recommended

1. **P1 — Make filters and search truthful.** The toolbar shows Priority on Reminders, which has no priority field. Inbox ignores several shared controls. Collection search matches the collection rather than searching all nested note content. Show only supported filters. Name search scope. Return matching notes with their collection context. Baseline locations: `dash/app.js:164`, `:312`, `:321`, `:468`, `:487`.
2. **P2 — Make Home help choose a next action.** Now includes every todo and doing task. Due soon starts today, so overdue work is not called out there. Show overdue and in-progress work first, then a small next-action group with access to the full backlog. Baseline locations: `dash/app.js:216`, `:219`, `:225`.
3. **P2 — Add direct capture where users need it.** Creating projects, tasks, jobs, and inbox notes still often leads to CLI instructions. Add quick capture and project-based task creation. Keep CLI help available. Baseline locations: `dash/app.js:224`, `:258`, `:305`, `:459`, `:474`, `:964`.
4. **P2 — Use controls for common repeat schedules.** The dialog now separates one-time and repeat modes, but repeats still use text syntax. Offer daily, weekdays, or selected days with a time picker. Keep custom syntax under an advanced option. Explain local delivery timing. Baseline location: `dash/app.js:329`.
5. **P3 — Use clearer job and save feedback.** Replace Loaded in launchd with a plain service readiness state and a repair action. Name the saved object and offer Open when useful. Baseline locations: `dash/app.js:347`, `:460`.

Suggested Impeccable follow-ups: clarify for filter/search scope; layout for Home; onboard for direct capture; harden for scheduling controls. These are recommendations, not completed changes.

## User tasks and cognitive load

- A first-time user needs a direct way to create a project or capture a thought. CLI-only routes force a tool switch.
- A frequent user needs each active filter to have a predictable effect. Inert controls weaken trust.
- A user returning after interruption needs a short, clear next-action view. The full todo list asks them to rebuild priorities.

The baseline exposed eight navigation choices, five toolbar groups, eight project columns, and the full open-task set. Counts alone do not prove poor usability. The stronger evidence is a missing next-action hierarchy, hidden content, and controls that do not match the page. Group related choices and disclose advanced controls when needed.

## Evidence and limits

Each reviewer used a separate browser tab and did not read the other report. A finished before B's findings entered synthesis. The Impeccable launcher is absent. The real detector attempt returned exit 127: `zsh:1: no such file or directory: .agents/skills/impeccable/scripts/impeccable`. No detector rules, overlay, generated slug, or trend data are claimed. No ignore file existed. Product context came from README and incumbent code; PRODUCT.md and DESIGN.md do not exist.

T3 browser snapshots timed out. Reviewers used source, computed styles, DOM measurements, safe navigation, and no store writes. Their measured viewport was 1402 × 877. A requested phone viewport did not apply, so their phone findings were source-based. B measured the original light form boundary contrast at 1.257:1. Its resource timing sample was one local run, not a field benchmark.

The implementation was then checked separately with installed Playwright Chromium. Tests used an isolated store with scheduler loading disabled. At 1440px, dialogs were visually inspected. At a measured 390px width, the reminder dialog was 356px wide, stayed within the viewport, and had no horizontal overflow. Light and dark captures were checked. Creation, validation recovery, cancellation, Escape, focus return, focus containment, schedule mode switching, project selection, and the mobile More menu were exercised. No page JavaScript errors occurred. Physical touch and screen reader testing remain untested.

Temporary review and test output lived under `/tmp`. No real reminder was scheduled and no real journal entry was created. The isolated preview server is stopped after verification. This file is the saved review; Impeccable's own storage and trend commands are unavailable.

Questions skipped: the requested creation flow is complete. Broader changes are listed for the next pass rather than assumed to be approved.

## Dashboard refinement follow-up

The toolbar now names its search scope. Inbox hides unrelated filters. Collections hide status and priority. Reminders hide priority. Navigation clears search, status, and priority to prevent a task filter from hiding projects or reminders. Unsupported stored filter parameters are ignored. Collection results include matching nested notes and their body text. Inbox search includes body text.

Home separates overdue tasks, in-progress work, and up to five next actions. The full task list remains in each project. Projects and project tasks have direct creation dialogs. Inbox has direct note capture. Jobs have a creation dialog with the existing schedule syntax and local time zone guidance. Reminder repeats offer common schedules and a time control, with an advanced syntax option. Save feedback names the saved entry type. Job service labels use plain readiness terms.

Creation dialogs retain drafts in memory when closed. Successful saves clear that draft. Drafts do not survive a page reload. Existing native dialog focus, Escape, errors, and project preselection remain.

Validation uses a separate DEMO store with schedule loading disabled. Browser checks cover measured 1440px and 390px widths, both themes, all primary routes, overflow, nested body search, filter scope, and reminder draft recovery. T3 snapshots failed twice with `Preview automation snapshot timed out after 15000ms.` The installed Playwright Chromium was used. Evidence lives in `/tmp/2b-dashboard-evidence`. These checks do not establish full accessibility conformance. Real store writes and job runs were not used.

Further review should check capture forms, long content, job recovery wording, and filter behavior across mixed project/task views. The job form still uses advanced text schedule syntax. Reminder day selection currently offers Monday and Friday presets; arbitrary day combinations use advanced syntax. Service repair remains available through the CLI schedule sync command.

## Implementation follow-up after independent review round 1

Both reports were read: `/tmp/2b-dashboard-refinement-review-a-r1.md` and `/tmp/2b-dashboard-refinement-review-b-r1.md`. This is the implementation response, not a new independent review.

1. Jobs uses one shared action group in populated, empty, and filtered states. New job remains available. Empty Jobs offers a direct action. Phone headings stack above wrapping actions.
2. Draft keys include kind and project, collection, or capture folder context. Explicit destinations take precedence. Learnings capture defaults to Learnings. A save clears only its submitted draft when that draft has not since changed. The browser exercised closing a pending save, opening and closing another project's draft, then completing the save.
3. `dash/policy.js` defines filter controls, accepted values, and search scopes. All links and view actions share route transition handling. Local query, status, and priority do not carry to another view. Supported area/project context does. URL normalization uses replaceState, so Back retains prior view history. Jobs accepts paused. Mixed views retain project and task status values. Priority menus use the correct view's values.
4. Home personal groups exclude recurring jobs. Each action group, On hold, and Due soon show five rows, with remaining rows behind Show more. The Home badge also excludes recurring jobs. Empty next actions and filtered dates have clear copy. Timeline shows twelve activity groups per day before Show more; existing repeated-event folds remain.
5. Collection detail has local New note with the collection selected. Collection groups show project titles and one linked collection heading, without repeating the collection as its own content row.
6. Jobs and reminders share schedule controls for daily, weekdays, selected weekdays/weekly, hourly, and advanced syntax. Jobs retain the Mac's local time zone. Reminders retain their saved time zone. No schedule format changed.
7. Successful creation clears detail/document caches and refreshes summaries; capture also refreshes Inbox. Browser saves verified fresh project collections and collection notes immediately after creation.
8. The capture API validates the exact dated note path before writing. Tests cover dangling and existing outside symlink targets, with no outside write. The task API calls parseEvery before createTask. An invalid schedule test proves that no task directory is added.

Validation: 193 tests passed with serial files. Focused tests passed (42). The installed Playwright browser checked all main routes at measured 1440 and 390 CSS pixels in light and dark, with no page script errors or horizontal document overflow. It also exercised creation, selected-day submissions, draft context, the pending-save race, cache refresh, URL normalization, navigation, and Back. DEMO store only; notifications disabled and scheduler loading false. T3 snapshots failed twice with `Preview automation snapshot timed out after 15000ms.` Evidence and scripts: `/tmp/2b-dashboard-evidence/r2-*`.

Limits: no physical touch or screen reader test; no accessibility conformance claim. Drafts remain in memory until reload. Body search covers stored notes, not arbitrary registered binary file contents. Large real-store content was not read for this pass. Parent review supplies the separate read-only real-data smoke test. No PR, push, or main merge was made.
