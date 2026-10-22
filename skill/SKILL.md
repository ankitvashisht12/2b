---
name: 2b
description: The user's second brain for projects, tasks, deadlines, statuses, artifacts, notes, learnings, rules, and recurring jobs. Use for "2b", "second brain", "save this", "put this in 2b", "artifact", "what is active / paused / due", "what did I do this week", "every day at 7pm do X", "remind me", "rule for this task", or when starting work on something that may already be a 2b task.
---

# 2b

All of the user's work state lives in the 2b store (`2b path` prints it; default `~/obsidian/2b`). Change it only through the `2b` CLI. Read files directly when you need their content. Never hand-edit `readme.md` frontmatter or `log.md`.

## Model

- **Project**: lasts weeks or months. Area `work` or `personal`. Status `active | paused | on-hold | done | archived`.
- **Task**: the atomic unit, about one PR or one investigation. Status `todo | doing | blocked | done | dropped | paused`. Kind `normal` or `recurring`.
- **Artifact**: a file in a task folder, registered with `about` and `why`.
- **Log**: every CLI write appends a dated line. `2b week` reads these.
- `paused`, `on-hold`, `blocked`, `dropped` need `--reason`.
- Task ids accept any unique part of the name: `2b show limiter-recovery`.

## Requests and commands

| The user says | You run |
|---|---|
| "New project X" | `2b new project <slug> --area work --title "X" --body "<what, why, current state>"` |
| "Add a task to X" | `2b new task <project> <slug> --title "..." --body "<what, why, current state>" [--due yyyy-mm-dd]` |
| "Pause X because Y" | `2b status <project> paused --reason "Y"` |
| "Task T depends on U" | `2b add <T> link <U> depends-on` |
| "This PR is part of T" | `2b add <T> pr <url>` |
| "Save this / put it in 2b" | find or create the task, then `2b artifact add <task> <name.html> --about "..." --why "..."`, then write the content to the printed path |
| "What's active / paused / due?" | `2b ls --json`, `2b ls --status paused --json`, `2b ls --tasks --status blocked --json`, `2b ls --tasks --due-before +7d --json` |
| "What did I do this week / last week?" | `2b week [any day in that week] --json` |
| "Find the thing about Z" | `2b find "Z"` |
| "Quick note / dump" | `2b dump <slug> --title "..."`, then write to the printed path |
| "I learned X" | `2b learn <slug> --title "..."` |
| "Open the dashboard" | `2b dash --open` |

## Priority and descriptions

- Projects: 🔥 P1 = urgent, ⚡ P2 = high, 🎯 P3 = normal (default), 🌱 P4 = low, 💤 P5 = someday.
- Tasks: `high`, `med` (default), `low`. Map an urgent or important task to `high`.
- Pass `--priority P1` on `new project`, or `--priority high` on `new task`.
- Use `2b set <ref> priority <value>` to change it. Use `2b ls --priority P1` or `2b ls --tasks --priority high` to filter.
- Include priority in answers about active work. Project lists sort by priority then deadline. Task lists sort by priority then due date then id.
- Every project and task must have a readme body at creation. Explain what it is, why it exists, and its current state. Pass `--body "..."` at creation. Keep the body current as the work changes. Edit the body only; keep frontmatter and logs under CLI control.

## Before you work on a task

1. `2b show <task>` — read status, links, artifacts, and recent log.
2. `2b rules <task>` — follow every rule. If rules conflict, the more specific level wins: task > project > global.
3. When you finish a step that matters, `2b log <task> "<one line>"`. When done, `2b status <task> done`.

## Rules

- "For this task never do X" → `2b rule add <task> --key <short-key> "Never do X."`
- "Globally, always do Y" → `2b rule add global --key <short-key> "Always do Y."`
- Use the same key as the rule you want to override at a less specific level.

## Recurring tasks

- "Every day at 7pm, do X" → `2b new task <project> <slug> --title "..." --every "daily 19:00" --run agent --body "<what, why, current state, and the full instruction>"`
- "On weekdays at 2pm open the dashboard" → `2b new task <project> <slug> --title "Open dashboard" --every "weekdays 14:00" --run command --command "2b dash --open" --body "What: Open the dashboard on weekdays. Why: Review active work. Current state: Scheduled."`
- `2b delete <task>` moves a recurring task to `.trash/` and stops its schedule. It prints a trash id.
- `2b trash ls` lists deleted tasks. `2b restore <trashId>` brings one back as `paused`, with reason `restored from trash`. Resume it with `2b status <task> doing` when ready.
- Schedule format: `daily HH:MM`, `weekdays HH:MM`, `mon,fri HH:MM`, `hourly`.
- `2b schedule ls` shows last results. `2b run <task>` runs one now. A failed run sends a notification and shows on the dashboard; read its `last-log`, fix the cause, and run it again.

## Saving output

- Explainers and reports are HTML. Notes are Markdown.
- Always give `--about` (what it is) and `--why` (why it was made). Do not invent them; ask if you do not know.

## Answers

Short, plain terms. For "what did I do", group by project, one line per meaningful event, and skip noise such as `set` and `created` lines unless asked.

## Gotchas

- Put `--` before text that starts with a dash: `2b log <task> -- "--force was wrong"`.
- `2b check` reports broken links, missing reasons, and bad names. Run it after bulk changes.
