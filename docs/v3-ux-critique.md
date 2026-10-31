# V3 dashboard critique and response

Two independent Claude Opus 5.5 agents reviewed the first shadcn build with Emil and Impeccable. Assessment A covered user flows and design. Assessment B covered rendered controls, errors, keyboard access, motion, and detector results. Assessment A was complete before the parent read B. Both inspected the same frozen bundle, `index-CV6kDJcr.js`. Original vaults were read-only. Writes used an isolated fixture.

A scored the initial build 24/40. B scored its technical audit 12/20. These are review scores, not accessibility certifications. Detailed private evidence stays in `local/validation/ux-rebuild/review-A.md` and `review-B.md`. The source detector returned no findings, but rendered-page checks found real contrast, small-text, and long-word defects.

| Before | Required change | Why |
| --- | --- | --- |
| Filing a task needs a manually named link | Process form and context-aware Add task/Add note | Common work should not need schema knowledge. |
| Saved detail shows the old status | Render the saved item returned by each action | A saved action must be visible at once. |
| Complete and Processed have no undo | Undo restores the prior state | Common quick actions need cheap recovery. |
| Scope arrows also change the date | Respect handled keys and calendar focus | One key press must do one thing. |
| Type dialog extends below a phone | Bounded, scrollable shadcn dialog | The form must be possible to finish. |
| Reduced motion speeds infinite animations to 1 ms | Stop infinite motion | Reduced motion must not produce flicker. |
| Long filenames expand the app | Minimum width constraints and word wrapping | Navigation must stay reachable. |
| Scope and area disagree in Edit | One scope control, initialized from tags or area | A description edit must not erase scope. |
| Search has no no-match message | Explicit empty-result text | Users need to see that the search ran. |
| Timeline omits scheduled meetings | Use the same schedule data as the day view | A date should mean the same thing in each view. |

The parent fixed a watcher race by patching fresh metadata under the writer lock. It also reduced the history metadata query from the full item list to a 211 KB projection, and fixed IST/dash parsing in copied logs. Date-only entries remain all-day. Explicit midnight timestamps are retained because they exist in the original logs.

Questions skipped: the implementation brief and the user's live feedback supply the requirements.

## Fix pass

Claude implemented the P1/P2 fixes and the selected P3 improvements. The fixed build adds Inbox filing, contextual creation, Undo, immediate detail state, calendar focus, phone dialogs, scope-safe editing, clearer labels, and reduced-motion handling. The parent added a local DELETE relationship endpoint so Undo also removes a project link created by Process. A failed item save rolls that new link back. Moving an already-filed item to another parent remains a CLI operation in this version.

The full item list still needs about 2.4–3.7 seconds on a cold load. Actual phone hardware, screen readers, Safari, and Firefox have not been checked.

## Final validation

- Production build and backend/frontend checks pass.
- 222 unit/integration tests pass; one optional full-scale test is skipped.
- 27 isolated browser checks pass, including removing the newly created project link on Undo.
- The real vault passes its integrity check: 9,404 items, no missing registered files, no broken relationships.
- The real-vault browser check used GET only: no page errors, no horizontal overflow on the tested desktop/phone layouts, and Matt/Abhinav pages open correctly.
- No commits, pushes, PRs, or source-vault writes were made.
