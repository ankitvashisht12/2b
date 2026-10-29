import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  NODE_COMMAND, UserError, CLOSED_STATUSES, PRIORITY_LABELS, addDays, appendLog, assertDay, assertSlug,
  createNote, createProject, createTask, createCollection, createCollectionNote, listCollections, listNotes, listProjects, listTasks, localDate, priorityOf, priorityRank, resolve, reverseLinks,
  setField, setStatus, withStoreReadCache, type Entry, type Artifact,
} from './store.ts';
import { createReminder, listReminders, cancelReminder, reminderDir } from './reminders.ts';
import { isoWeek, readAllEvents } from './week.ts';
import { formatRules, rulesFor } from './rules.ts';
import { jobsOverview, syncSchedules, parseEvery } from './schedule.ts';
import { listTrash, restoreTask, trashTask } from './trash.ts';
import { renderMarkdown } from './markdown.ts';
import { parse } from './frontmatter.ts';

export const DEFAULT_PORT = 4422;
type ScheduleOptions = { agentsDir?: string; load?: boolean };
type DashboardOptions = ScheduleOptions & { bodyTimeoutMs?: number; startRun?: (taskId: string) => void };
const DASH_DIR = path.join(import.meta.dirname, '..', 'dash');
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};
const flatten = (entry: Entry) => ({ ...entry.fields, id: entry.id, type: entry.kind, project: entry.project, body: entry.body });
const readLog = (entry: Entry) => {
  const file = path.join(entry.dir, 'log.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};
const hasReadme = (entry: Entry) => entry.body.replace(/^\s*# [^\n]*(?:\n|$)/, '').replace(/\s/g, '').length >= 40;

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

type PathValidation = { realRoot: string; checked: Set<string> };

function assertInsideStore(root: string, targetPath: string, validation?: PathValidation): void {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(targetPath);
  let existingPath = absoluteTarget;
  if (existingPath !== absoluteRoot && !existingPath.startsWith(absoluteRoot + path.sep)) throw new ApiError(404, 'not found');
  const realRoot = validation?.realRoot ?? fs.realpathSync(root);
  for (;;) {
    if (validation?.checked.has(existingPath)) {
      validation.checked.add(absoluteTarget);
      return;
    }
    try {
      const information = fs.lstatSync(existingPath, { throwIfNoEntry: false });
      if (information) {
        // A regular child stays inside its checked parent. Resolve symbolic links separately.
        if (!information.isSymbolicLink() && validation?.checked.has(path.dirname(existingPath))) {
          validation.checked.add(absoluteTarget);
          return;
        }
        const realTarget = fs.realpathSync(existingPath);
        if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) throw new ApiError(404, 'not found');
        validation?.checked.add(absoluteTarget);
        return;
      }
    } catch { throw new ApiError(404, 'not found'); }
    const parent = path.dirname(existingPath);
    if (parent === existingPath) throw new ApiError(404, 'not found');
    existingPath = parent;
  }
}

function assertEntryPaths(root: string, dir: string, validation?: PathValidation): void {
  assertInsideStore(root, dir, validation);
  for (const file of ['readme.md', 'log.md', 'rules.md', 'runs']) assertInsideStore(root, path.join(dir, file), validation);
}

function assertStoreEntries(root: string): void {
  const validation: PathValidation = { realRoot: fs.realpathSync(root), checked: new Set([path.resolve(root)]) };
  assertInsideStore(root, path.join(root, 'rules.md'), validation);
  const directories = (dir: string) => {
    assertInsideStore(root, dir, validation);
    return fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true })
      .filter(item => item.isDirectory() || item.isSymbolicLink())
      .map(item => path.join(dir, item.name)) : [];
  };
  for (const projectDir of directories(path.join(root, 'projects'))) {
    assertEntryPaths(root, projectDir, validation);
    for (const taskDir of directories(path.join(projectDir, 'tasks'))) assertEntryPaths(root, taskDir, validation);
    for (const collectionDir of directories(path.join(projectDir, 'collections'))) {
      assertEntryPaths(root, collectionDir, validation);
      for (const noteDir of directories(path.join(collectionDir, 'notes'))) assertEntryPaths(root, noteDir, validation);
    }
  }
  for (const dir of directories(path.join(root, 'reminders'))) assertEntryPaths(root, dir, validation);
}

function assertTrashPaths(root: string): void {
  const trashDir = path.join(root, '.trash');
  assertInsideStore(root, trashDir);
  if (!fs.existsSync(trashDir)) return;
  for (const item of fs.readdirSync(trashDir, { withFileTypes: true })) {
    if (!item.isDirectory() && !item.isSymbolicLink()) continue;
    const dir = path.join(trashDir, item.name);
    assertInsideStore(root, path.join(dir, 'meta.json'));
    assertEntryPaths(root, path.join(dir, 'task'));
  }
}

function storeFile(root: string, relativePath: string): string {
  const absolute = path.resolve(root, relativePath);
  assertInsideStore(root, absolute);
  if (!absolute.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(absolute)
    || !fs.statSync(absolute).isFile()
    || !fs.realpathSync(absolute).startsWith(fs.realpathSync(root) + path.sep)) {
    throw new ApiError(404, 'not found');
  }
  return absolute;
}

function findEntry(root: string, id: string): Entry {
  if (!id.trim()) throw new ApiError(404, 'entry not found');
  assertStoreEntries(root);
  try {
    const entry = resolve(root, id);
    assertEntryPaths(root, entry.dir);
    return entry;
  } catch (error) {
    if (error instanceof UserError) throw new ApiError(/more than one/.test(error.message) ? 400 : 404, error.message);
    throw error;
  }
}

function eventsWithTitles(root: string) {
  const projects = new Map(listProjects(root).map(entry => [entry.id, entry]));
  const tasks = new Map([...listTasks(root), ...listCollections(root), ...listNotes(root)].map(entry => [entry.id, entry]));
  return readAllEvents(root).map(event => ({
    ...event, projectTitle: String(projects.get(event.project)?.fields.title ?? event.project),
    entryTitle: event.entry ? String(tasks.get(event.entry)?.fields.title ?? event.entry) : null,
    taskTitle: event.task ? String(tasks.get(event.task)?.fields.title ?? event.task) : null,
  })).sort((first, second) => second.at.localeCompare(first.at));
}

function artifactsFor(root: string, entry: Entry) {
  const groups: Record<'markdown' | 'html' | 'data' | 'images' | 'other', {
    path: string; title: string; about: string; why: string; added: string; size: number;
  }[]> = { markdown: [], html: [], data: [], images: [], other: [] };
  if (!['task', 'collection', 'note'].includes(entry.kind)) return groups;
  const registered = new Map(((entry.fields.artifacts as Artifact[] | null) ?? []).map(item => [item.path, item]));
  const files = new Set(registered.keys());
  const walk = (dir: string, prefix = '') => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = path.join(prefix, item.name);
      if (item.isDirectory() && !['runs', 'notes'].includes(item.name)) walk(path.join(dir, item.name), relative);
      else if (item.isFile() && !['readme.md', 'log.md', 'rules.md'].includes(item.name)) files.add(relative);
    }
  };
  walk(entry.dir);
  for (const file of files) {
    if (file.split(/[\\/]/).includes('runs') || ['readme.md', 'log.md', 'rules.md'].includes(path.basename(file))) continue;
    const relative = path.relative(root, path.resolve(entry.dir, file));
    let absolute: string;
    try { absolute = storeFile(root, relative); } catch { continue; }
    if (!absolute.startsWith(entry.dir + path.sep)) continue;
    const meta = registered.get(file);
    const extension = path.extname(file).toLowerCase();
    const group = extension === '.md' ? 'markdown' : ['.html', '.htm'].includes(extension) ? 'html'
      : ['.csv', '.tsv', '.json', '.xlsx', '.xls', '.yaml', '.yml', '.xml'].includes(extension) ? 'data'
      : ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.avif'].includes(extension) ? 'images' : 'other';
    groups[group].push({ path: relative, title: meta?.title ?? path.basename(file), about: meta?.about ?? '',
      why: meta?.why ?? '', added: meta?.added ?? '', size: fs.statSync(absolute).size });
  }
  return groups;
}

function artifactCount(root: string, entry: Entry): number {
  const included = (file: string) => !file.split(/[\\/]/).includes('runs')
    && !['readme.md', 'log.md', 'rules.md'].includes(path.basename(file));
  const files = new Set<string>();
  const walk = (dir: string, prefix = '') => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = path.join(prefix, item.name);
      if (item.isDirectory() && !['runs', 'notes'].includes(item.name)) walk(path.join(dir, item.name), relative);
      else if (item.isFile() && included(relative)) files.add(relative);
    }
  };
  // Entry paths are validated before this walk. Dirents avoid resolving every regular file again.
  walk(entry.dir);
  let count = files.size;
  const registered = new Set(((entry.fields.artifacts as Artifact[] | null) ?? []).map(item => item.path));
  for (const file of registered) {
    if (!included(file) || files.has(file)) continue;
    try {
      const absolute = storeFile(root, path.relative(root, path.resolve(entry.dir, file)));
      if (absolute.startsWith(entry.dir + path.sep)) count += 1;
    } catch { /* Missing or outside registered files are omitted, as in artifact details. */ }
  }
  return count;
}

function rangeFor(params: URLSearchParams) {
  const today = localDate();
  let from = params.get('from') ?? addDays(today, -6);
  let to = params.get('to') ?? today;
  let week: { start: string; end: string } | undefined;
  if (params.has('week')) {
    const day = params.get('week')!;
    assertDay(day, 'week', false);
    week = isoWeek(day);
    if (!params.has('from') && !params.has('to')) { from = week.start; to = week.end; }
  }
  assertDay(from, 'from', false);
  assertDay(to, 'to', false);
  const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (days < 1 || days > 400) throw new UserError('date range must contain 1 to 400 days');
  return { from, to, ...(week ? { week } : {}) };
}

export function dashboardState(root: string, range: string | URLSearchParams = new URLSearchParams(), options: ScheduleOptions = {}) {
  return withStoreReadCache(() => readDashboardState(root, range, options));
}

function readDashboardState(root: string, range: string | URLSearchParams, options: ScheduleOptions) {
  const selected = rangeFor(typeof range === 'string' ? new URLSearchParams({ week: range }) : range);
  assertStoreEntries(root);
  assertTrashPaths(root);
  const events = eventsWithTitles(root);
  const projects = listProjects(root);
  const tasks = listTasks(root);
  const projectMap = new Map(projects.map(project => [project.id, project]));
  const projectActivity = new Map<string, string>();
  const taskActivity = new Map<string, string>();
  for (const event of events) {
    if (!projectActivity.has(event.project)) projectActivity.set(event.project, event.at);
    if (event.task && !taskActivity.has(event.task)) taskActivity.set(event.task, event.at);
  }
  const lastActivity = (entry: Entry) => (entry.kind === 'project' ? projectActivity : taskActivity).get(entry.id) ?? null;
  const priority = (entry: Entry) => ({ priority: priorityOf(entry), priorityLabel: PRIORITY_LABELS[priorityOf(entry)] });
  const dateOrder = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '9999-99-99';
  const projectTotals = new Map(projects.map(project => [project.id, { open: 0, done: 0, total: 0, nextDue: '9999-99-99' }]));
  for (const task of tasks) {
    const totals = projectTotals.get(task.project)!;
    totals.total += 1;
    if (task.fields.status === 'done') totals.done += 1;
    if (!CLOSED_STATUSES.includes(String(task.fields.status))) {
      totals.open += 1;
      const due = dateOrder(task.fields.due);
      if (due < totals.nextDue) totals.nextDue = due;
    }
  }
  const jobs = jobsOverview(root, options);
  return {
    today: localDate(), ...selected,
    projects: projects.map(project => {
      const totals = projectTotals.get(project.id)!;
      return { id: project.id, title: project.fields.title, area: project.fields.area,
        status: project.fields.status, statusReason: project.fields['status-reason'] ?? null, ...priority(project),
        started: project.fields.started ?? null, deadline: project.fields.deadline ?? null,
        taskCounts: { open: totals.open, done: totals.done, total: totals.total },
        nextDue: totals.nextDue !== '9999-99-99' ? totals.nextDue : null, lastActivity: lastActivity(project), hasReadme: hasReadme(project) };
    }).sort((first, second) => priorityRank(first.priority) - priorityRank(second.priority)
      || dateOrder(first.deadline).localeCompare(dateOrder(second.deadline)) || first.id.localeCompare(second.id)),
    tasks: tasks.map(task => {
      const project = projectMap.get(task.project)!;
      return { id: task.id, project: task.project, projectTitle: project.fields.title, area: project.fields.area,
        title: task.fields.title, kind: task.fields.kind, status: task.fields.status,
        statusReason: task.fields['status-reason'] ?? null, ...priority(task), started: task.fields.started ?? null,
        due: task.fields.due ?? null, prs: task.fields.prs ?? [], lastActivity: lastActivity(task), hasReadme: hasReadme(task),
        artifactCount: artifactCount(root, task) };
    }).sort((first, second) => priorityRank(first.priority) - priorityRank(second.priority)
      || dateOrder(first.due).localeCompare(dateOrder(second.due))
      || (second.lastActivity ?? '').localeCompare(first.lastActivity ?? '') || first.id.localeCompare(second.id)),
    events: events.filter(event => event.at.slice(0, 10) >= selected.from && event.at.slice(0, 10) <= selected.to),
    collections: listCollections(root).map(flatten), notes: listNotes(root).map(flatten), reminders: listReminders(root),
    jobs, failed: jobs.filter(job => job.lastResult === 'error'), trash: listTrash(root).length,
  };
}

function markdownFile(root: string, absolute: string) {
  const source = fs.readFileSync(absolute, 'utf8');
  const { fields, body } = parse(source);
  const dir = path.relative(root, path.dirname(absolute));
  const baseUrl = '/api/file?path=' + (dir ? encodeURIComponent(dir) + '/' : '');
  return { html: renderMarkdown(body, { baseUrl }),
    title: String(fields.title ?? body.match(/^# (.+)$/m)?.[1] ?? path.basename(absolute, '.md')) };
}

export function entryDetail(root: string, id: string, options: ScheduleOptions = {}) {
  const entry = findEntry(root, id);
  const relativeDir = path.relative(root, entry.dir);
  return {
    id: entry.id, kind: entry.kind, fields: entry.fields, body: entry.body, relativeDir,
    bodyHtml: renderMarkdown(entry.body, { baseUrl: '/api/file?path=' + encodeURIComponent(relativeDir) + '/' }),
    priority: priorityOf(entry), priorityLabel: PRIORITY_LABELS[priorityOf(entry)],
    artifacts: artifactsFor(root, entry), job: jobsOverview(root, options).find(job => job.id === entry.id) ?? null,
    reverseLinks: reverseLinks(root, entry.id), rules: formatRules(rulesFor(root, entry)), log: readLog(entry),
    recentEvents: eventsWithTitles(root).filter(event => entry.kind === 'project' ? event.project === entry.id : (event.task === entry.id || event.entry === entry.id)).slice(0, 20),
    collections: entry.kind === 'project' ? listCollections(root, entry.id).map(flatten) : [],
    notes: entry.kind === 'collection' ? listNotes(root, entry.id).map(flatten) : [],
    tasks: entry.kind === 'project' ? listTasks(root, entry.id).map(flatten) : [],
  };
}

function inboxNotes(root: string) {
  return (['inbox', 'learnings'] as const).flatMap(folder => {
    const dir = path.join(root, folder);
    if (!fs.existsSync(dir)) return [];
    return (fs.readdirSync(dir, { recursive: true }) as string[]).filter(file => file.endsWith('.md')).flatMap(file => {
      try {
        const relative = path.join(folder, file);
        const { fields, body } = parse(fs.readFileSync(storeFile(root, relative), 'utf8'));
        return [{ path: relative, folder, title: String(fields.title ?? body.match(/^# (.+)$/m)?.[1] ?? path.basename(file, '.md')),
          body, created: String(fields.created ?? '') }];
      } catch { return []; }
    });
  }).sort((first, second) => second.created.localeCompare(first.created) || first.path.localeCompare(second.path));
}

async function jsonBody(request: http.IncomingMessage, timeoutMs: number): Promise<Record<string, unknown>> {
  if (request.headers['x-2b'] !== '1') throw new ApiError(403, 'missing X-2b header');
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError(400, 'content-type must be application/json');
  }
  if (Number(request.headers['content-length']) > 65536) throw new ApiError(413, 'body exceeds 64 KB');
  const chunks = await new Promise<Buffer[]>((accept, reject) => {
    let size = 0;
    const received: Buffer[] = [];
    const cleanup = () => {
      clearTimeout(timer);
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onAborted = () => onError(new ApiError(400, 'request aborted'));
    const onEnd = () => { cleanup(); accept(received); };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 65536) {
        received.length = 0;
        onError(new ApiError(413, 'body exceeds 64 KB'));
        request.resume();
      } else received.push(chunk);
    };
    const timer = setTimeout(() => onError(new ApiError(408, 'request body timed out')), timeoutMs);
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
    request.on('aborted', onAborted);
  });
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'invalid JSON body'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'body must be a JSON object');
  return body as Record<string, unknown>;
}

function textField(body: Record<string, unknown>, key: string, optional = false): string | undefined {
  if (optional && body[key] === undefined) return undefined;
  if (typeof body[key] !== 'string') throw new ApiError(400, `${key} must be a string`);
  return body[key] as string;
}

function writeRoute(root: string, route: string, body: Record<string, unknown>, options: DashboardOptions) {
  const allowed: Record<string, string[]> = {
    '/api/status': ['id', 'status', 'reason'], '/api/set': ['id', 'field', 'value'],
    '/api/run': ['id'], '/api/delete': ['id'], '/api/restore': ['trashId'],
    '/api/reminder': ['slug', 'message', 'title', 'at', 'every', 'timezone', 'project', 'task'],
    '/api/reminder/cancel': ['id'],
    '/api/collection': ['project', 'slug', 'title', 'body'],
    '/api/note': ['collection', 'slug', 'title', 'body', 'type', 'source'],
    '/api/project': ['slug', 'title', 'body', 'area'],
    '/api/capture': ['folder', 'slug', 'title', 'body'],
    '/api/task': ['project', 'slug', 'title', 'body', 'fromNote', 'every'],
  };
  if (!allowed[route]) throw new ApiError(404, 'not found');
  if (Object.keys(body).some(key => !allowed[route].includes(key))) throw new ApiError(400, 'unknown field');
  assertStoreEntries(root);
  if (route === '/api/reminder' || route === '/api/reminder/cancel') {
    let reminder;
    if (route === '/api/reminder') {
      const slug = textField(body, 'slug')!;
      assertEntryPaths(root, reminderDir(root, slug));
      reminder = createReminder(root, slug, { message: textField(body, 'message')!, title: textField(body, 'title', true),
        at: textField(body, 'at', true), every: textField(body, 'every', true), timezone: textField(body, 'timezone', true),
        project: textField(body, 'project', true), task: textField(body, 'task', true) });
    } else reminder = cancelReminder(root, textField(body, 'id')!);
    const warnings = syncSchedules(root, options).failed.map(failure => failure.reason);
    return { ok: true, reminder, warnings };
  }
  if (route === '/api/capture') {
    const folder = textField(body, 'folder')!;
    if (folder !== 'inbox' && folder !== 'learnings') throw new ApiError(400, 'folder must be inbox or learnings');
    const slug = textField(body, 'slug')!;
    assertSlug(slug, 'note');
    const directory = path.join(root, folder, ...(folder === 'learnings' ? [localDate().slice(0, 7)] : []));
    assertInsideStore(root, path.join(directory, `${localDate()}-${slug}.md`));
    const content = textField(body, 'body', true) || '';
    const file = createNote(root, folder, textField(body, 'slug')!, textField(body, 'title')!);
    fs.appendFileSync(file, '\n' + content + '\n');
    return { ok: true, path: path.relative(root, file) };
  }
  if (route === '/api/project') {
    const slug = textField(body, 'slug')!;
    assertSlug(slug, 'project');
    assertEntryPaths(root, path.join(root, 'projects', slug));
    return { ok: true, entry: flatten(createProject(root, slug, { area: textField(body, 'area')!, title: textField(body, 'title')!, body: textField(body, 'body', true) })) };
  }
  if (route === '/api/collection') {
    const project = findEntry(root, textField(body, 'project')!);
    const slug = textField(body, 'slug')!;
    assertSlug(slug, 'collection');
    assertEntryPaths(root, path.join(project.dir, 'collections', slug));
    return { ok: true, entry: flatten(createCollection(root, project.id, slug, { title: textField(body, 'title', true), body: textField(body, 'body', true) })) };
  }
  if (route === '/api/note') {
    const collection = findEntry(root, textField(body, 'collection')!);
    const slug = textField(body, 'slug')!;
    assertSlug(slug, 'note');
    assertEntryPaths(root, path.join(collection.dir, 'notes', slug));
    return { ok: true, entry: flatten(createCollectionNote(root, collection.id, slug, {
      title: textField(body, 'title', true), body: textField(body, 'body', true), type: textField(body, 'type', true), source: textField(body, 'source', true),
    })) };
  }
  if (route === '/api/restore') {
    const trashId = textField(body, 'trashId')!;
    assertTrashPaths(root);
    const item = listTrash(root).find(item => item.trashId === trashId);
    if (!item) throw new ApiError(404, 'trash entry not found');
    assertEntryPaths(root, path.join(root, 'projects', item.project, 'tasks', item.task));
    return { ok: true, entry: flatten(restoreTask(root, trashId, options)) };
  }
  if (route === '/api/task') {
    const project = findEntry(root, textField(body, 'project')!);
    if (project.kind !== 'project') throw new ApiError(400, 'project must be a project id');
    const slug = textField(body, 'slug')!;
    assertSlug(slug, 'task');
    const folder = /^\d{4}-\d{2}-\d{2}-/.test(slug) ? slug : `${localDate()}-${slug}`;
    assertEntryPaths(root, project.dir);
    assertEntryPaths(root, path.join(project.dir, 'tasks', folder));
    const title = textField(body, 'title')!;
    let description = textField(body, 'body', true);
    const fromNote = textField(body, 'fromNote', true);
    if (fromNote !== undefined) {
      if (!/^(inbox|learnings)\//.test(fromNote) || path.extname(fromNote).toLowerCase() !== '.md') throw new ApiError(400, 'fromNote must be an inbox or learnings Markdown path');
      const file = storeFile(root, fromNote);
      const realRoot = fs.realpathSync(root);
      const realFile = fs.realpathSync(file);
      if (!['inbox', 'learnings'].some(folder => realFile.startsWith(path.join(realRoot, folder) + path.sep))) throw new ApiError(404, 'not found');
      description = parse(fs.readFileSync(file, 'utf8')).body;
    }
    const every = textField(body, 'every', true);
    if (every !== undefined) parseEvery(every);
    const task = createTask(root, project.id, slug, { title, body: description, every });
    const warnings = body.every ? syncSchedules(root, options).failed.map(failure => failure.reason) : [];
    if (fromNote !== undefined) appendLog(task.dir, 'from note', fromNote);
    return { ok: true, entry: flatten(task), warnings };
  }
  const entry = findEntry(root, textField(body, 'id')!);
  if (route === '/api/status') {
    setStatus(entry, textField(body, 'status')!, textField(body, 'reason', true));
    const warnings: string[] = [];
    if (entry.fields.kind === 'recurring') {
      try { warnings.push(...syncSchedules(root, options).failed.map(failure => failure.reason)); }
      catch (error) { warnings.push(error instanceof Error ? error.message : String(error)); }
    }
    return { ok: true, entry: flatten(entry), ...(warnings.length ? { warnings: warnings.map(warning => warning.replace(/\s+/g, ' ')) } : {}) };
  }
  if (route === '/api/set') {
    const field = textField(body, 'field')!;
    if (!['due', 'deadline', 'priority', 'title'].includes(field)) throw new ApiError(400, 'field must be due, deadline, priority, or title');
    setField(entry, field, textField(body, 'value')!);
    return { ok: true, entry: flatten(entry) };
  }
  if (route === '/api/delete') {
    assertTrashPaths(root);
    return { ok: true, trashId: trashTask(root, entry, options).trashId };
  }
  if (entry.kind !== 'task' || entry.fields.kind !== 'recurring') throw new ApiError(400, 'only recurring tasks can run');
  if (options.startRun) options.startRun(entry.id);
  else spawn(NODE_COMMAND[0], [...NODE_COMMAND.slice(1), 'run', entry.id], {
    detached: true, stdio: 'ignore', env: { ...process.env, TWOB_HOME: root },
  }).unref();
  return { ok: true, started: true };
}

export function startDashboard(root: string, port: number, options: DashboardOptions = {}): http.Server {
  root = path.resolve(root);
  const server = http.createServer(async (request, response) => {
    const sendJson = (data: unknown, status = 200) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(data));
    };
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/api/file') {
        response.setHeader('Content-Security-Policy', 'sandbox');
        response.setHeader('X-Content-Type-Options', 'nosniff');
      }
      const address = server.address();
      const listeningPort = address && typeof address !== 'string' ? address.port : undefined;
      if (request.headers.host !== `127.0.0.1:${listeningPort}` && request.headers.host !== `localhost:${listeningPort}`) {
        throw new ApiError(403, 'forbidden host');
      }
      if (request.method === 'POST') {
        const body = await jsonBody(request, options.bodyTimeoutMs ?? 10000);
        sendJson(writeRoute(root, url.pathname, body, options));
        return;
      }
      if (request.method !== 'GET') throw new ApiError(405, 'method not allowed');
      if (['/', '/app.css', '/app.js'].includes(url.pathname)) {
        const file = path.join(DASH_DIR, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
        const content = fs.readFileSync(file);
        response.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(file)] });
        response.end(content);
      } else if (url.pathname === '/api/ping') sendJson({ ok: true, root });
      else if (url.pathname === '/api/state') sendJson(dashboardState(root, url.searchParams, options));
      else if (url.pathname === '/api/entry') sendJson(entryDetail(root, url.searchParams.get('id') ?? '', options));
      else if (url.pathname === '/api/reminders') {
        assertStoreEntries(root);
        sendJson({ reminders: listReminders(root).map(reminder => ({ ...reminder, history: fs.readFileSync(path.join(reminderDir(root, reminder.id), 'log.md'), 'utf8') })) });
      }
      else if (url.pathname === '/api/inbox') sendJson({ notes: inboxNotes(root) });
      else if (url.pathname === '/api/trash') { assertTrashPaths(root); sendJson(listTrash(root)); }
      else if (url.pathname === '/api/render' || url.pathname === '/api/file') {
        const file = storeFile(root, url.searchParams.get('path') ?? '');
        if (url.pathname === '/api/render') {
          if (path.extname(file).toLowerCase() !== '.md') throw new ApiError(400, 'render requires a .md file');
          sendJson(markdownFile(root, file));
        } else {
          response.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'text/plain; charset=utf-8' });
          response.end(fs.readFileSync(file));
        }
      } else throw new ApiError(404, 'not found');
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim();
      if (error instanceof ApiError && error.status === 408) {
        response.setHeader('Connection', 'close');
        response.once('finish', () => request.destroy());
      }
      sendJson({ error: message }, error instanceof ApiError ? error.status : error instanceof UserError ? 400 : 500);
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}

export async function openDashboard(root: string, port: number): Promise<string> {
  const url = `http://127.0.0.1:${port}`;
  const isRunning = async () => {
    let response: Response;
    try {
      response = await fetch(`${url}/api/ping`);
    } catch {
      return false;
    }
    if (response.ok) {
      try {
        const ping = await response.json();
        if (ping.root === root) return true;
      } catch {
        // A non-JSON response belongs to another program.
      }
    }
    throw new UserError(`port ${port} is used by another 2b store or program`);
  };
  if (!(await isRunning())) {
    spawn(NODE_COMMAND[0], [...NODE_COMMAND.slice(1), 'dash', '--port', String(port)], {
      detached: true, stdio: 'ignore', env: { ...process.env, TWOB_HOME: root },
    }).unref();
    for (let attempt = 0; attempt < 50 && !(await isRunning()); attempt += 1) {
      await new Promise(wait => setTimeout(wait, 100));
    }
  }
  spawnSync('open', [url]);
  return url;
}
