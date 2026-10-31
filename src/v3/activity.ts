import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { contentPath } from './files.ts';
import type { ObjectRecord } from './models.ts';

export interface ActivityEvent {
  id: string;
  at: string;
  kind: string;
  detail: string;
  objectId: string;
  objectName: string;
  projectId: string | null;
  projectName: string | null;
  tags: string[];
  source: 'log';
}

const validDay = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export function activityRange(from: string, to: string) {
  if (!validDay(from) || !validDay(to) || from > to) throw new Error('Choose a valid start and end date.');
  if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) throw new Error('Choose a date range of one year or less.');
  return { from, to };
}

/** Read dated log lines from the copied vault, never the original source vault. */
export class ActivityReader {
  private cache = new Map<string, { stamp: string; events: ActivityEvent[] }>();

  read(root: string, objects: ObjectRecord[], from: string, to: string): ActivityEvent[] {
    activityRange(from, to);
    const bySource = new Map(objects.filter(object => object.properties.sourcePath).map(object => [`${object.properties.sourceVault}:${String(object.properties.sourcePath).toLowerCase()}`, object]));
    const events: ActivityEvent[] = [];
    const active = new Set<string>();
    for (const object of objects) {
      const sourcePath = String(object.properties.sourcePath || '');
      if (!/(^|\/)log\.md$/i.test(sourcePath) || !object.path?.endsWith('.md')) continue;
      const filename = contentPath(root, object.path);
      if (!fs.existsSync(filename)) continue;
      const stat = fs.statSync(filename);
      if (!stat.isFile() || stat.size > 2_000_000) continue;
      const containerPath = path.posix.dirname(sourcePath);
      const prefix = `${object.properties.sourceVault}:`;
      const owner = bySource.get(prefix + (containerPath + '/readme.md').toLowerCase()) || bySource.get(prefix + (containerPath + '/index.md').toLowerCase()) || object;
      const projectPath = /^projects\/([^/]+)/i.exec(sourcePath);
      const project = projectPath ? bySource.get(prefix + `projects/${projectPath[1]}/readme.md`.toLowerCase()) : undefined;
      const tags = [...new Set([...owner.tags, ...object.tags, ...(project?.tags || [])])];
      const stamp = JSON.stringify([stat.mtimeMs, stat.size, object.path, owner.id, owner.name, project?.name, tags]);
      active.add(object.id);
      let cached = this.cache.get(object.id);
      if (cached?.stamp !== stamp) {
        const lines = fs.readFileSync(filename, 'utf8').split('\n');
        const parsed: ActivityEvent[] = [];
        for (const [lineNumber, line] of lines.entries()) {
          const match = /^\s*[-*]\s+(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::\d{2})?)?(?:\s+IST)?(?:\s+|$)(.*)$/.exec(line);
          if (!match || !validDay(match[1]) || (match[2] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(match[2]))) continue;
          const [, day, time, text] = match;
          const typed = /^([A-Za-z][\w-]*)(?:\s*\|\s*|\s+|$)(.*)$/.exec(text);
          const kind = typed?.[1] || 'note';
          const detail = typed ? typed[2] : text.replace(/^[—–|]\s*/, '');
          const id = createHash('sha256').update(`${object.id}:${lineNumber}:${line}`).digest('hex').slice(0, 24);
          parsed.push({ id, at: time ? `${day}T${time}:00+05:30` : day, kind, detail, objectId: owner.id, objectName: owner.name, projectId: project?.id || null, projectName: project?.name || null, tags, source: 'log' });
        }
        cached = { stamp, events: parsed };
        this.cache.set(object.id, cached);
      }
      events.push(...cached.events.filter(event => event.at.slice(0, 10) >= from && event.at.slice(0, 10) <= to));
    }
    for (const id of this.cache.keys()) if (!active.has(id)) this.cache.delete(id);
    return events.sort((left, right) => right.at.localeCompare(left.at) || left.id.localeCompare(right.id));
  }
}
