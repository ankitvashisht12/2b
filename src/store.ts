import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { parse, serialize, type Fields } from './frontmatter.ts';

export class UserError extends Error {}

export const AREAS = ['work', 'personal'];
export const PROJECT_STATUSES = ['active', 'paused', 'on-hold', 'done', 'archived'];
export const TASK_STATUSES = ['todo', 'doing', 'blocked', 'done', 'dropped', 'paused'];
export const PROJECT_PRIORITIES = ['P1', 'P2', 'P3', 'P4', 'P5'];
export const TASK_PRIORITIES = ['high', 'med', 'low'];
export const PRIORITY_LABELS: Record<string, string> = { P1: '🔥 P1', P2: '⚡ P2', P3: '🎯 P3', P4: '🌱 P4', P5: '💤 P5', high: 'high', med: 'med', low: 'low' };
export const CLOSED_STATUSES = ['done', 'archived', 'dropped'];
export const REASON_REQUIRED = ['paused', 'on-hold', 'blocked', 'dropped'];
export const LINK_TYPES = ['depends-on', 'follow-up', 'related'];
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const CLI_PATH = path.join(import.meta.dirname, 'cli.ts');
// ponytail: Node 22 needs the flag; drop it on Node 23.6+
export const NODE_COMMAND = [process.execPath, '--experimental-strip-types', '--no-warnings', CLI_PATH];

const SLUG = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;
const RECURRING_FIELDS = ['every', 'run', 'agent', 'command'];
const SETTABLE_FIELDS = {
  project: ['title', 'area', 'started', 'deadline', 'priority'],
  task: ['title', 'started', 'due', 'repo', 'branch', 'priority', ...RECURRING_FIELDS],
};

export type Kind = 'project' | 'task';
export type Entry = { kind: Kind; id: string; project: string; dir: string; fields: Fields; body: string };
export type Artifact = { path: string; title: string; about: string; why: string; added: string };
export type Link = { to: string; type: string };

export function priorityOf(entry: Entry): string {
  return String(entry.fields.priority ?? (entry.kind === 'project' ? 'P3' : 'med'));
}

export function priorityRank(value: string): number {
  const position = (value.startsWith('P') ? PROJECT_PRIORITIES : TASK_PRIORITIES).indexOf(value);
  return position < 0 ? Number.POSITIVE_INFINITY : position + 1;
}

export function expandHome(filePath: string): string {
  return filePath === '~' || filePath.startsWith('~/') ? path.join(os.homedir(), filePath.slice(1)) : filePath;
}

export function storeRoot(): string {
  if (process.env.TWOB_HOME) return path.resolve(expandHome(process.env.TWOB_HOME));
  const configFile = path.join(os.homedir(), '.config', '2b', 'config.json');
  if (fs.existsSync(configFile)) {
    try {
      const configuredHome = JSON.parse(fs.readFileSync(configFile, 'utf8')).home;
      if (configuredHome) return path.resolve(expandHome(configuredHome));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new UserError(`~/.config/2b/config.json is not valid: ${reason}`);
    }
  }
  return path.join(os.homedir(), 'obsidian', '2b');
}

export function initStore(root: string): void {
  for (const folder of ['projects', 'inbox', 'learnings']) fs.mkdirSync(path.join(root, folder), { recursive: true });
  const rulesFile = path.join(root, 'rules.md');
  if (!fs.existsSync(rulesFile)) fs.writeFileSync(rulesFile, '# Global rules\n\n');
  if (!fs.existsSync(path.join(root, '.git'))) spawnSync('git', ['init', '-q', root]);
}

const pad = (value: number) => String(value).padStart(2, '0');

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localDateTime(date = new Date()): string {
  return `${localDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fileTimestamp(date = new Date()): string {
  return `${localDate(date)}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function addDays(day: string, count: number): string {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, dayOfMonth + count)).toISOString().slice(0, 10);
}

export function assertSlug(slug: string, what: string): void {
  if (!SLUG.test(slug)) throw new UserError(`${what} "${slug}" must use lowercase letters, digits, hyphens, and dots only`);
}

export function assertOneOf(value: string, allowed: string[], what: string): void {
  if (!allowed.includes(value)) throw new UserError(`${what} must be one of: ${allowed.join(', ')}`);
}

export function assertDay(value: string, what: string, allowUnknown = true): void {
  if (allowUnknown && (value === 'unknown' || value === '')) return;
  if (DATE.test(value)) {
    const date = new Date(value + 'T00:00:00Z');
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value) return;
  }
  throw new UserError(`${what} must be yyyy-mm-dd${allowUnknown ? ' or "unknown"' : ''}`);
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'untitled';
}

export function readEntry(kind: Kind, project: string, dir: string): Entry {
  const { fields, body } = parse(fs.readFileSync(path.join(dir, 'readme.md'), 'utf8'));
  const id = kind === 'project' ? project : `${project}/${path.basename(dir)}`;
  return { kind, id, project, dir, fields, body };
}

export function writeEntry(entry: Entry): void {
  fs.writeFileSync(path.join(entry.dir, 'readme.md'), serialize(entry.fields, entry.body));
}

function foldersWithReadme(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().filter(name => fs.existsSync(path.join(dir, name, 'readme.md')));
}

const entryReadCache = new AsyncLocalStorage<Map<string, Entry[]>>();

export function withStoreReadCache<Result>(read: () => Result): Result {
  return entryReadCache.run(new Map(), read);
}

function cachedEntries(key: string, read: () => Entry[]): Entry[] {
  const cache = entryReadCache.getStore();
  const existing = cache?.get(key);
  if (existing) return existing;
  const entries = read();
  cache?.set(key, entries);
  return entries;
}

export function listProjects(root: string): Entry[] {
  const projectsDir = path.join(root, 'projects');
  return cachedEntries(JSON.stringify(['projects', root]), () =>
    foldersWithReadme(projectsDir).map(slug => readEntry('project', slug, path.join(projectsDir, slug))));
}

export function listTasks(root: string, project?: string): Entry[] {
  return cachedEntries(JSON.stringify(['tasks', root, project]), () => {
    const projectSlugs = project ? [project] : foldersWithReadme(path.join(root, 'projects'));
    return projectSlugs.flatMap(slug => {
      const tasksDir = path.join(root, 'projects', slug, 'tasks');
      return foldersWithReadme(tasksDir).map(folder => readEntry('task', slug, path.join(tasksDir, folder)));
    });
  });
}

export function listEntries(root: string): Entry[] {
  return [...listProjects(root), ...listTasks(root)];
}

export function resolve(root: string, ref: string): Entry {
  const project = listProjects(root).find(entry => entry.id === ref);
  if (project) return project;
  const tasks = listTasks(root);
  const exact = tasks.filter(task => task.id === ref || path.basename(task.dir) === ref);
  const matches = exact.length > 0 ? exact : tasks.filter(task => task.id.includes(ref));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new UserError(`no project or task matches "${ref}"`);
  throw new UserError(`"${ref}" matches more than one task:\n${matches.map(task => `  ${task.id}`).join('\n')}`);
}

export function appendLog(dir: string, event: string, detail = '', at = localDateTime()): void {
  const logFile = path.join(dir, 'log.md');
  const current = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '# Log\n\n';
  if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, current);
  const separator = current.endsWith('\n') ? '' : '\n';
  const cleanDetail = detail.replace(/\s+/g, ' ').trim();
  fs.appendFileSync(logFile, `${separator}- ${at} ${event}${cleanDetail ? ` | ${cleanDetail}` : ''}\n`);
}

export type ProjectOptions = { area: string; title?: string; deadline?: string; started?: string; priority?: string; body?: string };

export function createProject(root: string, slug: string, options: ProjectOptions): Entry {
  assertSlug(slug, 'project');
  assertOneOf(options.area, AREAS, 'area');
  if (options.priority !== undefined) assertOneOf(options.priority, PROJECT_PRIORITIES, 'project priority');
  if (options.deadline) assertDay(options.deadline, 'deadline');
  const dir = path.join(root, 'projects', slug);
  if (fs.existsSync(dir)) throw new UserError(`project "${slug}" already exists`);
  fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
  const title = options.title ?? slug;
  const entry: Entry = {
    kind: 'project', id: slug, project: slug, dir, body: `\n# ${title}\n${options.body ? `\n${options.body}\n` : ''}`,
    fields: {
      title, priority: options.priority ?? 'P3', area: options.area, status: 'active', 'status-reason': null,
      started: options.started ?? localDate(), deadline: options.deadline ?? 'unknown',
      repos: [], prs: [], resources: [], links: [],
    },
  };
  writeEntry(entry);
  appendLog(dir, 'created', title);
  return entry;
}

export type TaskOptions = {
  title?: string; priority?: string; due?: string; repo?: string; branch?: string; started?: string; body?: string;
  every?: string; run?: string; agent?: string; command?: string;
};

export function createTask(root: string, project: string, slug: string, options: TaskOptions = {}): Entry {
  assertSlug(project, 'project');
  assertSlug(slug, 'task');
  const projectDir = path.join(root, 'projects', project);
  if (!fs.existsSync(path.join(projectDir, 'readme.md'))) throw new UserError(`project "${project}" does not exist`);
  if (options.due) assertDay(options.due, 'due');
  if (options.priority !== undefined) assertOneOf(options.priority, TASK_PRIORITIES, 'task priority');
  const started = options.started ?? localDate();
  const folder = DATE_PREFIX.test(slug) ? slug : `${started}-${slug}`;
  const dir = path.join(projectDir, 'tasks', folder);
  if (fs.existsSync(dir)) throw new UserError(`task "${project}/${folder}" already exists`);
  const title = options.title ?? slug;
  const isRecurring = Boolean(options.every);
  const fields: Fields = {
    title, priority: options.priority ?? 'med', kind: isRecurring ? 'recurring' : 'normal', status: isRecurring ? 'doing' : 'todo', 'status-reason': null,
    started, due: options.due ?? null, repo: options.repo ?? null, branch: options.branch ?? null,
    prs: [], resources: [], links: [], artifacts: [],
  };
  if (isRecurring) {
    const run = options.run ?? 'agent';
    assertOneOf(run, ['agent', 'command'], 'run');
    if (run === 'command' && !options.command) throw new UserError('a command task needs --command');
    if (run === 'agent' && !options.body) throw new UserError('an agent task needs --body with the rule the agent follows');
    const agent = options.agent ?? 'claude';
    assertOneOf(agent, ['claude', 'codex'], 'agent');
    Object.assign(fields, {
      every: options.every, run, agent: run === 'agent' ? agent : null, command: options.command ?? null,
      'last-run': null, 'last-result': null, 'last-log': null,
    });
  }
  fs.mkdirSync(dir, { recursive: true });
  const body = `\n# ${title}\n${options.body ? `\n${options.body}\n` : ''}`;
  const entry: Entry = { kind: 'task', id: `${project}/${folder}`, project, dir, fields, body };
  writeEntry(entry);
  appendLog(dir, 'created', title);
  return entry;
}

export function setStatus(entry: Entry, status: string, reason?: string): void {
  assertOneOf(status, entry.kind === 'project' ? PROJECT_STATUSES : TASK_STATUSES, `${entry.kind} status`);
  if (REASON_REQUIRED.includes(status) && !reason) throw new UserError(`status "${status}" needs --reason`);
  const previous = entry.fields.status;
  entry.fields.status = status;
  entry.fields['status-reason'] = reason ?? null;
  writeEntry(entry);
  appendLog(entry.dir, `status ${previous} -> ${status}`, reason ?? '');
}

export function setField(entry: Entry, field: string, value: string): void {
  assertOneOf(field, SETTABLE_FIELDS[entry.kind], `${entry.kind} field`);
  if (RECURRING_FIELDS.includes(field) && entry.fields.kind !== 'recurring') {
    throw new UserError(`"${field}" is only for recurring tasks`);
  }
  if (field === 'priority') assertOneOf(value, entry.kind === 'project' ? PROJECT_PRIORITIES : TASK_PRIORITIES, `${entry.kind} priority`);
  if (field === 'area') assertOneOf(value, AREAS, 'area');
  if (field === 'started') assertDay(value, 'started', false);
  if (field === 'deadline' || field === 'due') assertDay(value, field);
  if (field === 'run') assertOneOf(value, ['agent', 'command'], 'run');
  if (field === 'agent') assertOneOf(value, ['claude', 'codex'], 'agent');
  entry.fields[field] = value === '' ? null : value;
  writeEntry(entry);
  appendLog(entry.dir, `set ${field}`, value);
}

function pushUnique(entry: Entry, field: string, item: unknown, event: string, detail: string): void {
  const list = Array.isArray(entry.fields[field]) ? (entry.fields[field] as unknown[]) : [];
  if (list.some(existing => JSON.stringify(existing) === JSON.stringify(item))) return;
  entry.fields[field] = [...list, item];
  writeEntry(entry);
  appendLog(entry.dir, event, detail);
}

export function addPr(entry: Entry, url: string): void {
  pushUnique(entry, 'prs', url, 'pr', url);
}

export function addResource(entry: Entry, title: string, target: string): void {
  const resource = /^https?:\/\//.test(target) ? { title, url: target } : { title, path: target };
  pushUnique(entry, 'resources', resource, 'resource', `${title} ${target}`);
}

export function addLink(root: string, entry: Entry, to: string, type: string): void {
  assertOneOf(type, LINK_TYPES, 'link type');
  const target = resolve(root, to);
  if (target.id === entry.id) throw new UserError('an entry cannot link to itself');
  pushUnique(entry, 'links', { to: target.id, type }, 'link', `${type} ${target.id}`);
}

export function reverseLinks(root: string, id: string): { from: string; type: string }[] {
  return listEntries(root).flatMap(entry =>
    ((entry.fields.links as Link[] | null) ?? [])
      .filter(link => link.to === id)
      .map(link => ({ from: entry.id, type: link.type })));
}

export function addArtifact(entry: Entry, source: string, meta: { title?: string; about?: string; why?: string }): string {
  if (entry.kind !== 'task') throw new UserError('artifacts belong to a task; give a task id');
  const extension = path.extname(source).toLowerCase() || '.md';
  const baseName = path.basename(source, path.extname(source)).replace(DATE_PREFIX, '');
  const fileName = `${localDate()}-${slugify(baseName)}${extension}`;
  const target = path.join(entry.dir, fileName);
  if (fs.existsSync(target)) throw new UserError(`artifact "${fileName}" already exists in ${entry.id}`);
  if (fs.existsSync(source) && fs.statSync(source).isFile()) fs.copyFileSync(source, target);
  else fs.writeFileSync(target, '');
  const artifact: Artifact = { path: fileName, title: meta.title ?? baseName, about: meta.about ?? '', why: meta.why ?? '', added: localDate() };
  entry.fields.artifacts = [...((entry.fields.artifacts as Artifact[] | null) ?? []), artifact];
  writeEntry(entry);
  appendLog(entry.dir, `artifact ${fileName}`, artifact.about);
  return target;
}

export function createNote(root: string, folder: 'inbox' | 'learnings', slug: string, title?: string): string {
  assertSlug(slug, 'note');
  const today = localDate();
  const dir = folder === 'inbox' ? path.join(root, 'inbox') : path.join(root, 'learnings', today.slice(0, 7));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${today}-${slug}.md`);
  if (fs.existsSync(file)) throw new UserError(`${path.relative(root, file)} already exists`);
  const noteTitle = title ?? slug;
  fs.writeFileSync(file, serialize({ title: noteTitle, created: localDateTime() }, `\n# ${noteTitle}\n`));
  return file;
}
