# 2b

Second brain CLI: projects, tasks, artifacts, rules, recurring jobs, and a local dashboard. Data lives in `~/obsidian/2b` (override with `TWOB_HOME` or `~/.config/2b/config.json` `{ "home": "..." }`).

Design: `docs/specs/2026-10-16-2b-design.md`.

## Install

    ln -s "$PWD/bin/2b" ~/.local/bin/2b      # run from the repo root
    ln -s "$PWD/skill" ~/.claude/skills/2b
    ln -s "$PWD/skill" ~/.agents/skills/2b   # Codex
    2b init

## Use

`2b help` lists every command. Agents use the `2b` skill.

## Test

    npm test
