# 2b — your 2nd brain

**2b** stands for **2nd brain**. A CLI that you (or your agent) use to keep track of projects, tasks, artifacts, rules, and recurring jobs, with a local dashboard to see it all. Data lives in `~/obsidian/2b` (override with `TWOB_HOME` or `~/.config/2b/config.json` `{ "home": "..." }`).

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
