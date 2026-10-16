import fs from 'node:fs';
import path from 'node:path';
import { parse } from './frontmatter.ts';
import { listProjects, listTasks } from './store.ts';

export type LogEvent = { project: string; task: string | null; at: string; event: string; detail: string };

const LOG_LINE = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) ([^|]+?)(?: \| (.*))?$/;

export function parseLog(text: string, project: string, task: string | null): LogEvent[] {
  return text.split('\n').flatMap(line => {
    const match = line.match(LOG_LINE);
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

export function readAllEvents(root: string): LogEvent[] {
  return [
    ...listProjects(root).flatMap(project => parseLog(readLog(project.dir), project.id, null)),
    ...listTasks(root).flatMap(task => parseLog(readLog(task.dir), task.project, task.id)),
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
