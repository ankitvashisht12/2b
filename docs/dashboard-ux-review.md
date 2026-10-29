# Dashboard refinement review — 29 October 2026

This review covers the separate `t3/refine-dashboard-ux` branch. Its baseline is main at `d45dc1136bafe170287fa1848f70796d82c773f2`. The final reviewed code is `a76640befafbf735d99450d28880693cc1c659c4`. Documentation and screenshot commits follow that code revision. This refinement was developed separately from main. It preserves the store model and saved data. Release metadata identifies it as v2.1.0.

## Method

Three rounds used two independent reviewers each. Assessment A reviewed design and task flow. Assessment B reviewed implementation and browser evidence. The reports were combined only after A finished. Reviewers did not read the other assessment before reporting.

References: [Impeccable critique](https://github.com/pbakaus/impeccable/blob/main/.agents/skills/impeccable/reference/critique.md), [Operate guidance](https://github.com/pbakaus/impeccable/blob/main/.agents/skills/impeccable/reference/operate.md), and [Emil Kowalski design engineering](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md). The Impeccable launcher is absent. Its attempted detector command failed with `no such file or directory`. No detector result, overlay, automated design score, or accessibility certification is claimed. README and incumbent code supplied product context.

T3 preview navigation and DOM tools were used where available. Fresh review tabs hit the server tab limit, and screenshot calls timed out. After bounded failures, the installed Playwright Chromium supplied fresh contexts and measured viewports. Review contexts blocked all requests except GET.

## Review and fix rounds

| Round | Reviewed revision | Findings and response |
| --- | --- | --- |
| 1 | `9a85329` | Fixed empty Jobs losing its creation button, drafts crossing projects, inconsistent navigation filters, wrong Learnings defaults, scheduled jobs in human work, and squeezed phone headings. Added exact capture-target guards and validation before job writes. |
| 2 | `ff32746` | Fixed first-use Jobs opening an impossible form without projects, and restored capture drafts losing a user-selected destination. Aligned UI statuses with the store and improved collection headings, excerpts, counts, and copy. |
| 3 | `a76640b` | Both independent reviewers found no reproducible P0, P1, or P2 defects in their tested scope. Prior first-use and draft fixes passed browser checks. This is a bounded result, not a claim that every possible path is defect-free. |

## Resulting behavior

| Before | After | Why |
| --- | --- | --- |
| Shared filters included choices that some views ignored | One view policy governs visible controls, accepted values, URL cleanup, and navigation | Active filters have a predictable meaning. |
| A local search could follow a sidebar link but disappear through More | View changes clear local query, status, and priority consistently; Back restores the previous route | Desktop and phone navigation agree. |
| Collection search missed words inside notes | Results include nested note bodies and safe text excerpts | Users can find content and see why it matched. |
| Home mixed a backlog and automated jobs under Now | Overdue, In progress, and Next actions show ordinary tasks, with five rows before Show more | Returning users can choose a human action. |
| Long activity lists dominated the page | Extra activity groups fold behind Show more | History stays available without filling the initial page. |
| Capture often required a terminal | Project, task, job, collection, note, reminder, and Inbox creation have direct dialogs | Users can record work without switching tools. |
| A draft could reopen in the wrong project or folder | Draft keys include their opening context; restored user choices remain intact | An interruption does not silently change the destination. |
| A pending save could clear another dialog's draft | Cleanup uses the submitted form's key and snapshot | Concurrent interactions preserve unsaved work. |
| Repeat schedules required syntax recall | Jobs and reminders share named repeat choices, selected days, and a time control | Common schedules need no command syntax. |
| First-use Jobs offered a form without a usable project | Jobs explains the prerequisite and opens New project | The first action can succeed. |
| Creation could leave cached detail views stale | A save refreshes summaries and invalidates affected detail/document caches | Newly saved content appears when reopening its context. |
| Capture and schedule validation could occur too late | Exact capture paths and schedule syntax are checked before writes | Invalid requests do not leave partial work or outside files. |

The visual direction remains restrained. Shared typography, semantic colors, familiar lists, and native dialogs support frequent use. Collection titles retain heading size. Phone actions wrap below descriptions. Human project names, singular/plural counts, compact search placeholders, and local New note actions reduce translation and repetition.

## Validation

- All **195 automated tests passed**, with test files run serially to avoid contention in the existing Markdown speed check.
- Focused policy tests compare UI statuses with exported store statuses. They also cover unsupported filters, mixed views, navigation context, task groups, schedule output, drafts, and search excerpts.
- Capture tests cover existing and dangling outside symlink targets. Invalid job schedules add no task directory.
- Write-based browser regressions use an isolated DEMO store, disabled notifications, and no real scheduler loading. They cover creation, selected-day submissions, error recovery, destination drafts, the pending-save race, and detail refresh.
- Independent reviews covered all eight views at measured 1440px desktop and 390px phone widths in light and dark themes. No page JavaScript errors or document horizontal overflow occurred in those sweeps.
- Parent acceptance checks repeated draft destinations, paused-job filters, cross-project isolation, all eight views, and nested note content search without writes.
- Existing content was inspected through a separate local preview that blocks non-GET methods. No dashboard writes were made to the live store. A metadata check identified an unrelated ongoing work-log append; it was left untouched.
- Main stayed at the baseline revision during implementation and validation.

The PR body includes four main/updated screenshot pairs: Home, body-content search, repeating reminder creation, and phone Home. Both sides use the same demo snapshot and clock. No private notes appear in those images. Capture provenance is in [the screenshot manifest](media/dashboard-refinement/capture-manifest.json).

## Remaining limits

Drafts are held in memory until reload. Body search covers stored notes, not arbitrary binary artifact contents. Jobs and Projects retain locally scrollable tables on phones. Physical touch, screen reader use, and every contrast pair have not been tested. No field performance benchmark or full accessibility conformance claim is made.

The [earlier baseline review](https://github.com/ankitvashisht12/2b/blob/d45dc1136bafe170287fa1848f70796d82c773f2/docs/dashboard-ux-review.md) remains available for history. The findings above describe the current branch, rather than leaving resolved baseline issues listed as open work.
