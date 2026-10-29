import fs from 'node:fs';
import path from 'node:path';
import { listReminders, reminderDir } from './reminders.ts';
import { parse } from './frontmatter.ts';

export type LogEvent = { project: string; task: string | null; at: string; event: string; detail: string; entry?: string; reminder?: string };

const LOG_LINE = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) ([^|]+?)(?: \| (.*))?$/;

export function parseLog(text: string, project: string, task: string | null): LogEvent[] {
  return text.split('\n').flatMap(line => {
    const match = line.replace(/\r$/, '').match(LOG_LINE);
    return match ? [{ project, task, at: match[1], event: match[2].trim(), detail: match[3] ?? '' }] : [];
  });
}

function readLog(dir: string): string {
  const logFile = path.join(dir, 'log.md');
  return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
}

function noteEvents(root: string, folder: 'inbox' | 'learnings'): LogEvent[] {
  const dir = path.join(root, folder);
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter(file => file.endsWith('.md'))
    .flatMap(file => {
      try {
        const { fields } = parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        if (typeof fields.created !== 'string') return [];
        return [{ project: folder, task: null, at: fields.created, event: folder === 'inbox' ? 'dump' : 'learning', detail: String(fields.title ?? file) }];
      } catch {
        return [];
      }
    });
}

function subfolders(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(item => item.isDirectory() && !item.name.startsWith('.'))
    .map(item => item.name)
    .sort();
}

export function readAllEvents(root: string): LogEvent[] {
  const projectsDir = path.join(root, 'projects');
  const logEvents = subfolders(projectsDir).flatMap(project => {
    const projectDir = path.join(projectsDir, project);
    const tasksDir = path.join(projectDir, 'tasks');
    return [
      ...parseLog(readLog(projectDir), project, null),
      ...subfolders(path.join(projectDir, 'collections')).flatMap(collection => {
        const dir = path.join(projectDir, 'collections', collection);
        const id = `${project}/collections/${collection}`;
        return [...parseLog(readLog(dir), project, null).map(event => ({ ...event, entry: id })), ...subfolders(path.join(dir, 'notes')).flatMap(note =>
          parseLog(readLog(path.join(dir, 'notes', note)), project, null).map(event => ({ ...event, entry: `${id}/notes/${note}` })))];
      }),
      ...subfolders(tasksDir).flatMap(task => parseLog(readLog(path.join(tasksDir, task)), project, `${project}/${task}`)),
    ];
  });
  return [
    ...logEvents,
    ...listReminders(root).flatMap(reminder => parseLog(readLog(reminderDir(root, reminder.id)), reminder.project ?? 'reminders', reminder.task).map(event => ({ ...event, reminder: reminder.id }))),
    ...noteEvents(root, 'inbox'),
    ...noteEvents(root, 'learnings'),
  ].sort((first, second) => first.at.localeCompare(second.at));
}

export function isoWeek(day: string): { start: string; end: string } {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth));
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, month - 1, dayOfMonth - daysSinceMonday));
  const end = new Date(Date.UTC(year, month - 1, dayOfMonth - daysSinceMonday + 6));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function weekEvents(root: string, day: string): LogEvent[] {
  const { start, end } = isoWeek(day);
  return readAllEvents(root).filter(event => {
    const eventDay = event.at.slice(0, 10);
    return eventDay >= start && eventDay <= end;
  });
}
