import fs from 'node:fs';
import path from 'node:path';
import {
  AREAS, DATE, LINK_TYPES, PROJECT_PRIORITIES, TASK_PRIORITIES, PROJECT_STATUSES, REASON_REQUIRED, TASK_STATUSES, assertSlug, readEntry,
  type Entry, type Kind, type Link,
} from './store.ts';
import { parseEvery } from './schedule.ts';

function subfolders(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(item => item.isDirectory() && !item.name.startsWith('.'))
    .map(item => item.name)
    .sort();
}

function readOrReport(kind: Kind, project: string, dir: string, problems: string[]): Entry | null {
  const label = kind === 'project' ? project : `${project}/${path.basename(dir)}`;
  if (!fs.existsSync(path.join(dir, 'readme.md'))) {
    problems.push(`${label}: missing readme.md`);
    return null;
  }
  try {
    return readEntry(kind, project, dir);
  } catch (error) {
    problems.push(`${label}: ${(error as Error).message}`);
    return null;
  }
}

function checkEntry(entry: Entry, knownIds: Set<string>): string[] {
  const problems: string[] = [];
  const report = (message: string) => problems.push(`${entry.id}: ${message}`);
  const { fields } = entry;
  const folderName = path.basename(entry.dir);
  try {
    assertSlug(folderName, `${entry.kind} folder`);
  } catch (error) {
    report((error as Error).message);
  }
  if (entry.kind === 'task' && !/^\d{4}-\d{2}-\d{2}-/.test(folderName)) report('folder name must start with yyyy-mm-dd-');
  if (!fields.title) report('missing title');
  const priorities = entry.kind === 'project' ? PROJECT_PRIORITIES : TASK_PRIORITIES;
  if (fields.priority !== undefined && fields.priority !== null && !priorities.includes(String(fields.priority))) {
    report(`priority "${fields.priority}" is not one of ${priorities.join(', ')}`);
  }
  const statuses = entry.kind === 'project' ? PROJECT_STATUSES : TASK_STATUSES;
  const status = String(fields.status);
  if (!statuses.includes(status)) report(`status "${status}" is not one of ${statuses.join(', ')}`);
  if (REASON_REQUIRED.includes(status) && !fields['status-reason']) report(`status "${status}" needs status-reason`);
  if (entry.kind === 'project' && !AREAS.includes(String(fields.area))) report(`area "${fields.area}" is not one of ${AREAS.join(', ')}`);
  for (const dateField of ['deadline', 'due']) {
    const value = fields[dateField];
    if (value && value !== 'unknown' && !DATE.test(String(value))) report(`${dateField} "${value}" is not yyyy-mm-dd or unknown`);
  }
  for (const field of ['links', 'artifacts']) {
    if (field in fields && !Array.isArray(fields[field])) report(`field "${field}" must be a list`);
  }
  for (const link of (Array.isArray(fields.links) ? fields.links : []) as Link[]) {
    if (!LINK_TYPES.includes(link.type)) report(`link to "${link.to}" has unknown type "${link.type}"`);
    if (!knownIds.has(link.to)) report(`link to "${link.to}" points to nothing`);
  }
  for (const artifact of (Array.isArray(fields.artifacts) ? fields.artifacts : []) as { path: string }[]) {
    if (!fs.existsSync(path.join(entry.dir, artifact.path))) report(`artifact "${artifact.path}" is missing`);
  }
  if (fields.kind === 'recurring') {
    if (fields.run === 'command' && !String(fields.command ?? '').trim()) report('no command set');
    if (fields.run === 'agent' && !entry.body.trim()) report('agent task has an empty body');
    try {
      parseEvery(String(fields.every));
    } catch (error) {
      report((error as Error).message);
    }
  }
  return problems;
}

export function checkStore(root: string): string[] {
  const problems: string[] = [];
  const entries: Entry[] = [];
  const projectsDir = path.join(root, 'projects');
  for (const projectSlug of subfolders(projectsDir)) {
    const projectDir = path.join(projectsDir, projectSlug);
    const project = readOrReport('project', projectSlug, projectDir, problems);
    if (project) entries.push(project);
    for (const taskFolder of subfolders(path.join(projectDir, 'tasks'))) {
      const task = readOrReport('task', projectSlug, path.join(projectDir, 'tasks', taskFolder), problems);
      if (task) entries.push(task);
    }
  }
  const knownIds = new Set(entries.map(entry => entry.id));
  return [...problems, ...entries.flatMap(entry => checkEntry(entry, knownIds))];
}
