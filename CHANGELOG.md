# Changelog

## Unreleased

- Replace inline collection, note, and reminder forms with creation dialogs.
- Add clear scheduling modes, inline errors, save progress, and keyboard focus handling.
- Keep every dashboard page reachable through a five-item phone bar and More menu.
- Use accessible form borders and correct collection and note drawer labels.
- Add the independent dashboard UX review and move store configuration below installation.

## 2.0.0

- New AI jobs use Codex by default. Existing explicit agent settings stay unchanged.
- Projects can hold collections. Collections hold typed notes and registered artifacts.
- Notes can exist without tasks. Task and job outputs can link to their source.
- Standalone reminders support one-time and repeat schedules, saved time zones, optional project or task links, cancellation, delivery history, and retry after delivery errors.
- A local reminder worker checks due items every minute and after login. It catches up after downtime without an AI run.
- The dashboard adds Collections and Reminders tabs, content forms, reminder cancellation and history, and project collection lists.
- Search, timeline, weekly reports, CLI help, and store checks include the new content.
- The v1 store layout remains valid. Existing tasks, artifacts, inbox, learnings, and rules need no migration.
