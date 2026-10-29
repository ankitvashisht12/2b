# Changelog

## 2.0.0

- New AI jobs use Codex by default. Existing explicit agent settings stay unchanged.
- Projects can hold collections. Collections hold typed notes and registered artifacts.
- Notes can exist without tasks. Task and job outputs can link to their source.
- Standalone reminders support one-time and repeat schedules, saved time zones, optional project or task links, cancellation, delivery history, and retry after delivery errors.
- A local reminder worker checks due items every minute and after login. It catches up after downtime without an AI run.
- The dashboard adds Collections and Reminders tabs, content forms, reminder cancellation and history, and project collection lists.
- Search, timeline, weekly reports, CLI help, and store checks include the new content.
- The v1 store layout remains valid. Existing tasks, artifacts, inbox, learnings, and rules need no migration.
