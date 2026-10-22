# 2b — your second brain

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

## Test

    npm test

## Known limits

Codex agent tasks run with `--sandbox workspace-write` in the store. They can run commands and edit store files directly. Prefer `--agent claude` for untrusted input.
