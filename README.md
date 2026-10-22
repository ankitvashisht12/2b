# 2b — your 2nd brain

<p align="center">
  <a href="docs/media/2b-demo.mp4"><img src="docs/media/2b-demo.gif" alt="2b demo: ask your agent to create a project, see it in the dashboard, check what to work on today" width="100%"></a>
  <br><sub><a href="docs/media/2b-demo.mp4">▶ Watch the full 37-second demo</a></sub>
</p>

**2b** stands for **2nd brain**. A CLI that you (or your agent) use to keep track of projects, tasks, artifacts, rules, and recurring jobs, with a local dashboard to see it all. Data lives in `~/obsidian/2b` (override with `TWOB_HOME` or `~/.config/2b/config.json` `{ "home": "..." }`).

## What it does

- **Projects** — long-running work, each marked work or personal, with a status and a reason when paused.
- **Tasks** — small units of work inside a project, with a status, a due date, and links to other tasks.
- **Priority** — 🔥 P1 to 💤 P5 for projects, high / med / low for tasks.
- **Readmes** — every project and task has a readme that says what it is, why it exists, and where it stands.
- **Artifacts** — notes, reports, and HTML explainers saved in the task they belong to, with a short note on what and why.
- **Logs** — every change is written to a log automatically, so you can see what happened and when.
- **Timeline** — see what you worked on in any week or month.
- **Rules** — instructions for agents at global, project, or task level; the most specific one wins.
- **Routines** — recurring jobs (a command or an agent) that run on a schedule, with run history and errors shown.
- **Trash** — deleting a routine moves it to trash; you can restore it.
- **Inbox and learnings** — quick notes and lessons, which you can later turn into tasks.
- **Search** — find anything by name or content.
- **Dashboard** — a local web page to read everything and make quick edits (status, due date, priority).
- **Import** — copy existing folders into 2b without touching the originals.
- **Agent skill** — any agent (Claude Code, Codex) can do all of this when you just ask.

## Install

Requires Node 22.14 or later.

    mkdir -p ~/.local/bin ~/.claude/skills ~/.agents/skills
    ln -s "$PWD/bin/2b" ~/.local/bin/2b      # run from the repo root
    ln -s "$PWD/skill" ~/.claude/skills/2b
    ln -s "$PWD/skill" ~/.agents/skills/2b   # Codex
    2b init

## Use

`2b help` lists every command. Agents use the `2b` skill.

## Priority and readmes

Projects use 🔥 P1 (urgent), ⚡ P2 (high), 🎯 P3 (normal, default), 🌱 P4 (low), and 💤 P5 (someday). Tasks use `high`, `med` (default), or `low`.

    2b new project sample --area personal --priority P2 --body "What: Build a tool. Why: Save time. State: Planning."
    2b new task sample review --priority high --body "What: Review the design. Why: Check scope. State: Ready."
    2b set review priority med
    2b ls --priority P2
    2b ls --tasks --priority high

Give each project and task a readme body with what, why, and current state. Keep it current. Project lists sort by priority then deadline. Task lists sort by priority then due date then id.

## Recurring jobs and trash

    2b new task sample digest --every "weekdays 14:00" --run command --command "echo digest" --body "What: Print a digest. Why: Check the job. State: Scheduled."
    2b schedule ls
    2b delete digest
    2b trash ls
    2b restore <trashId>

Delete stops a recurring task and moves its folder to `.trash/`. Restore brings it back as `paused`, with reason `restored from trash`. Use `2b status digest doing` to resume it. Normal tasks cannot be deleted in this release. Jobs helpers show human schedule names, the next local run time, schedule file presence for this store, and the last 20 run logs.

## Test

    npm test

## Known limits

Codex agent tasks run with `--sandbox workspace-write` in the store. They can run commands and edit store files directly. Prefer `--agent claude` for untrusted input.
