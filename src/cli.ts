import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as store from './store.ts';
import type { Entry } from './store.ts';
import { addRule, assertRuleKey, formatRules, removeRule, rulesFile, rulesFor } from './rules.ts';
import { notify, parseEvery, runTask, syncSchedules } from './schedule.ts';
import { isoWeek, weekEvents, type LogEvent } from './week.ts';
import { findInStore } from './find.ts';
import { checkStore } from './check.ts';
import { DEFAULT_PORT, openDashboard, startDashboard } from './dash.ts';
import { trashTask, restoreTask, listTrash } from './trash.ts';
import { createReminder, listReminders, cancelReminder, dispatchReminders, reminderDir } from './reminders.ts';
import { applyPlan, scanSources } from './importer.ts';

const USAGE = `2b — second brain v2.0.0

  2b init
  2b new project <slug> --area work|personal [--title T] [--deadline D] [--priority P1|P2|P3|P4|P5] [--body TEXT]
  2b new task <project> <slug> [--title T] [--due D] [--priority high|med|low] [--repo R] [--branch B] [--body TEXT]
  2b new task <project> <slug> --every "daily 19:00" --run agent|command [--agent codex|claude] [--output COLLECTION] [--command CMD] [--body RULE]
  2b new collection <project> <slug> [--title T] [--body TEXT]
  2b collection ls [--project P]
  2b note add <collection> <slug> [--title T] [--body TEXT] [--type general|journal|research|decision|meeting|reflection|learning] [--source TASK]
  2b note ls [<collection>]
  2b note edit <note> --body TEXT
  2b reminder add <slug> --message TEXT (--at "yyyy-mm-dd HH:MM" | --every "daily 19:00") [--timezone Asia/Kolkata] [--project P] [--task T]
  2b reminder ls | show <id> | cancel <id>
  2b reminder dispatch
  2b path [<project|task>]
  2b status <project|task> <status> [--reason R]
  2b set <project|task> <field> <value>
  2b add <project|task> pr <url> | resource <title> <path-or-url> | link <target> depends-on|follow-up|related|produces|produced-by
  2b log <project|task> <note>
  2b ls [--tasks] [--priority V] [--status S] [--area A] [--project P] [--due-before D|+Nd] [--all] [--short]
  2b show <project|task|collection|note>
  2b artifact add <task|collection|note> <file-or-name> [--title T] --about A --why W [--source TASK]
  2b find <text>
  2b week [yyyy-mm-dd]
  2b dump <slug> [--title T]        2b learn <slug> [--title T]
  2b rules [<project|task>]
  2b rule add global|<project|task> [--key K] <text>
  2b rule rm global|<project|task> <key-or-text>
  2b dash [--port N] [--open]
  2b delete <task>
  2b restore <trashId>
  2b trash ls
  2b run <task>
  2b schedule sync | ls
  2b notify <text> [--title T]
  2b check
  2b import scan <folder>...         2b import apply <plan.json> [--dry-run]

Read commands accept --json. Put -- before text that starts with a dash.`;

type Options = Record<string, string | boolean | undefined>;
let options: Options = {};
let rest: string[] = [];
let root: string;

function output(data: unknown, text: string): void {
  console.log(options.json ? JSON.stringify(data, null, 2) : text);
}

function need(value: string | undefined, what: string): string {
  if (!value) throw new store.UserError(`missing ${what} (see "2b help")`);
  return value;
}

const text = (name: string) => options[name] as string | undefined;
const summary = (entry: Entry) => ({ id: entry.id, path: entry.dir, ...entry.fields, ...(store.priorityOf(entry) ? { priority: store.priorityOf(entry) } : {}) });
const sortEntries = (entries: Entry[]) => entries.sort((left, right) => {
  const rank = store.priorityRank(store.priorityOf(left)) - store.priorityRank(store.priorityOf(right));
  const dateField = left.kind === 'project' ? 'deadline' : 'due';
  const date = (entry: Entry) => store.DATE.test(String(entry.fields[dateField])) ? String(entry.fields[dateField]) : '9999-99-99';
  return rank || date(left).localeCompare(date(right)) || left.id.localeCompare(right.id);
});
const isOpen = (status: unknown) => !store.CLOSED_STATUSES.includes(String(status));

function dueLimit(value: string): string {
  const relative = value.match(/^\+(\d+)d$/);
  if (relative) return store.addDays(store.localDate(), Number(relative[1]));
  store.assertDay(value, '--due-before', false);
  return value;
}

function taskLine(task: Entry, short: boolean): string {
  const due = store.DATE.test(String(task.fields.due)) ? `due ${task.fields.due}` : '';
  if (short) return `${store.PRIORITY_LABELS[store.priorityOf(task)]} ${task.fields.title}${due ? ` (${due})` : ''}`;
  return `  ${String(task.fields.status).padEnd(7)} ${task.id}  ${store.PRIORITY_LABELS[store.priorityOf(task)]} ${task.fields.title}  ${due}`.trimEnd();
}

function projectLine(project: Entry): string {
  const reason = project.fields['status-reason'] ? `: ${project.fields['status-reason']}` : '';
  return `${project.id} — ${project.fields.title}  [${project.fields.status}${reason}]  ${project.fields.area}  ${store.PRIORITY_LABELS[store.priorityOf(project)]}  deadline ${project.fields.deadline ?? 'unknown'}`;
}

function formatWeek(start: string, end: string, events: LogEvent[]): string {
  if (events.length === 0) return `Week ${start} – ${end}: no activity recorded.`;
  const byProject = new Map<string, LogEvent[]>();
  for (const event of events) byProject.set(event.project, [...(byProject.get(event.project) ?? []), event]);
  const sections = [...byProject].map(([project, projectEvents]) => [
    project,
    ...projectEvents.map(event => {
      const where = event.task ? `${event.task.split('/')[1]}  ` : '';
      return `  ${event.at.slice(5)}  ${where}${event.event}${event.detail ? ` — ${event.detail}` : ''}`;
    }),
  ].join('\n'));
  return [`Week ${start} – ${end}`, ...sections].join('\n\n');
}

function syncIfRecurring(entry: Entry): void {
  if (entry.fields.kind !== 'recurring') return;
  const { failed } = syncSchedules(root);
  for (const failure of failed) console.error(`Failed: ${failure.label} — ${failure.reason}`);
  if (failed.length) process.exitCode = 1;
}

const commands: Record<string, () => void | Promise<void>> = {
  init() {
    store.initStore(root);
    output({ root }, `Store ready at ${root}`);
  },

  new() {
    const [what, first, second] = rest;
    if (what === 'project') {
      const entry = store.createProject(root, need(first, 'project slug'), {
        area: need(text('area'), '--area work|personal'), title: text('title'), deadline: text('deadline'), priority: text('priority'), body: text('body'),
      });
      output(summary(entry), entry.dir);
      return;
    }
    if (what === 'collection') {
      const entry = store.createCollection(root, need(first, 'project'), need(second, 'collection slug'), { title: text('title'), body: text('body') });
      output(summary(entry), entry.dir);
      return;
    }
    if (what === 'task') {
      if (text('every')) parseEvery(text('every')!);
      const entry = store.createTask(root, need(first, 'project'), need(second, 'task slug'), {
        title: text('title'), priority: text('priority'), due: text('due'), repo: text('repo'), branch: text('branch'), body: text('body'),
        output: text('output'), every: text('every'), run: text('run'), agent: text('agent'), command: text('command'),
      });
      syncIfRecurring(entry);
      output(summary(entry), entry.dir);
      return;
    }
    throw new store.UserError('usage: 2b new project <slug> --area work|personal  |  2b new task <project> <slug>');
  },

  path() {
    const target = rest[0] ? store.resolve(root, rest[0]).dir : root;
    output({ path: target }, target);
  },

  status() {
    const entry = store.resolve(root, need(rest[0], 'project or task'));
    store.setStatus(entry, need(rest[1], 'status'), text('reason'));
    syncIfRecurring(entry);
    output(summary(entry), `${entry.id}: ${entry.fields.status}`);
  },

  set() {
    const entry = store.resolve(root, need(rest[0], 'project or task'));
    const field = need(rest[1], 'field');
    const value = rest.slice(2).join(' ');
    if (field === 'every') parseEvery(value);
    let savedValue = value;
    if (field === 'output' && value) {
      const collection = store.resolve(root, value);
      if (collection.kind !== 'collection' || collection.project !== entry.project) throw new store.UserError('output must be a collection in this project');
      savedValue = collection.id;
    }
    store.setField(entry, field, savedValue);
    syncIfRecurring(entry);
    output(summary(entry), `${entry.id}: ${field} = ${value || '(empty)'}`);
  },

  add() {
    const entry = store.resolve(root, need(rest[0], 'project or task'));
    const [, what, first, second] = rest;
    if (what === 'pr') store.addPr(entry, need(first, 'PR url'));
    else if (what === 'resource') store.addResource(entry, need(first, 'title'), need(second, 'path or url'));
    else if (what === 'link') store.addLink(root, entry, need(first, 'link target'), need(second, 'link type'));
    else throw new store.UserError('usage: 2b add <project|task> pr <url> | resource <title> <path-or-url> | link <target> <type>');
    output(summary(entry), `${entry.id}: added ${what}`);
  },

  log() {
    const entry = store.resolve(root, need(rest[0], 'project or task'));
    store.appendLog(entry.dir, 'note', need(rest.slice(1).join(' '), 'note'));
    output({ id: entry.id }, `${entry.id}: logged`);
  },

  ls() {
    const projects = store.listProjects(root).filter(project => !text('area') || project.fields.area === text('area'));
    const shownProjectIds = new Set(projects.map(project => project.id));
    const statusFilter = text('status');
    const priorityFilter = text('priority');
    if (priorityFilter !== undefined) store.assertOneOf(priorityFilter, options.tasks || text('due-before') ? store.TASK_PRIORITIES : store.PROJECT_PRIORITIES, '--priority');
    if (statusFilter !== undefined) {
      const allowed = options.tasks || text('due-before') ? store.TASK_STATUSES : store.PROJECT_STATUSES;
      store.assertOneOf(statusFilter, allowed, '--status');
    }
    const matchesStatus = (status: unknown) => (statusFilter ? status === statusFilter : options.all || isOpen(status));
    if (options.tasks || text('due-before')) {
      const limit = text('due-before') ? dueLimit(text('due-before')!) : null;
      const tasks = sortEntries(store.listTasks(root, text('project')).filter(task =>
        shownProjectIds.has(task.project)
        && matchesStatus(task.fields.status)
        && (!priorityFilter || store.priorityOf(task) === priorityFilter)
        && (!limit || (store.DATE.test(String(task.fields.due)) && String(task.fields.due) <= limit))));
      output(tasks.map(summary), tasks.map(task => taskLine(task, Boolean(options.short)).trim()).join('\n') || 'No tasks.');
      return;
    }
    const shown = sortEntries(projects.filter(project => (!text('project') || project.id === text('project')) && matchesStatus(project.fields.status) && (!priorityFilter || store.priorityOf(project) === priorityFilter)));
    const withTasks = shown.map(project => ({
      project, tasks: sortEntries(store.listTasks(root, project.id).filter(task => options.all || isOpen(task.fields.status))),
    }));
    output(
      withTasks.map(({ project, tasks }) => ({ ...summary(project), tasks: tasks.map(summary) })),
      withTasks.map(({ project, tasks }) => [projectLine(project), ...tasks.map(task => taskLine(task, false))].join('\n')).join('\n\n') || 'No projects.',
    );
  },

  show() {
    const entry = store.resolve(root, need(rest[0], 'project or task'));
    const reverse = store.reverseLinks(root, entry.id);
    const rules = rulesFor(root, entry);
    const logFile = path.join(entry.dir, 'log.md');
    const recentLog = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(-10) : [];
    const tasks = entry.kind === 'project' ? store.listTasks(root, entry.id) : [];
    const collections = entry.kind === 'project' ? store.listCollections(root, entry.id) : [];
    const notes = entry.kind === 'collection' ? store.listNotes(root, entry.id) : [];
    output(
      { ...summary(entry), collections: collections.map(summary), notes: notes.map(summary), body: entry.body, reverseLinks: reverse, rules, tasks: tasks.map(summary), recentLog },
      [
        `${entry.id} (${entry.kind})`,
        ...Object.entries({ ...entry.fields, ...(store.priorityOf(entry) ? { priority: store.PRIORITY_LABELS[store.priorityOf(entry)] } : {}) }).map(([key, value]) => `${key}: ${typeof value === 'string' || value === null ? value ?? '' : JSON.stringify(value)}`),
        `path: ${entry.dir}`,
        ...([...collections, ...notes].length ? ['', entry.kind === 'project' ? 'Collections:' : 'Notes:', ...[...collections, ...notes].map(item => `  ${item.id}  ${item.fields.title}`)] : []),
        '', entry.body.trim(),
        ...(tasks.length ? ['', 'Tasks:', ...tasks.map(task => taskLine(task, false))] : []),
        ...(reverse.length ? ['', 'Linked from:', ...reverse.map(link => `  ${link.from} (${link.type})`)] : []),
        '', 'Rules:', formatRules(rules),
        '', 'Recent log:', ...recentLog,
      ].join('\n'),
    );
  },

  artifact() {
    if (rest[0] !== 'add') throw new store.UserError('usage: 2b artifact add <task|collection|note> <file-or-name> --about A --why W');
    const entry = store.resolve(root, need(rest[1], 'task'));
    const source = store.outputSource(root, text('source'));
    const file = store.addArtifact(entry, need(rest[2], 'file or name'), { title: text('title'), about: text('about'), why: text('why') });
    if (source) {
      store.linkOutput(root, source, entry);
      store.addResource(source, text('title') ?? path.basename(file), path.relative(source.dir, file));
    }
    output({ path: file }, file);
  },

  collection() {
    if (rest[0] !== 'ls') throw new store.UserError('usage: 2b collection ls [--project P]');
    const entries = store.listCollections(root, text('project'));
    output(entries.map(summary), entries.map(entry => `${entry.id}  ${entry.fields.title}`).join('\n') || 'No collections.');
  },

  note() {
    if (rest[0] === 'edit') {
      const entry = store.resolve(root, need(rest[1], 'note'));
      if (entry.kind !== 'note') throw new store.UserError('give a note id');
      const body = need(text('body'), '--body');
      entry.body = `\n# ${entry.fields.title}\n\n${body}\n`;
      store.writeEntry(entry);
      store.appendLog(entry.dir, 'note updated', String(entry.fields.title));
      output(summary(entry), path.join(entry.dir, 'readme.md'));
      return;
    }
    if (rest[0] === 'add') {
      const entry = store.createCollectionNote(root, need(rest[1], 'collection'), need(rest[2], 'note slug'), {
        title: text('title'), body: text('body'), type: text('type'), source: text('source'),
      });
      output(summary(entry), path.join(entry.dir, 'readme.md'));
      return;
    }
    if (rest[0] === 'ls') {
      const collection = rest[1] ? store.resolve(root, rest[1]) : null;
      if (collection && collection.kind !== 'collection') throw new store.UserError('give a collection id');
      const entries = store.listNotes(root, collection?.id);
      output(entries.map(summary), entries.map(entry => `${entry.id}  ${entry.fields.title}`).join('\n') || 'No notes.');
      return;
    }
    throw new store.UserError('usage: 2b note add <collection> <slug> | ls [<collection>]');
  },

  reminder() {
    if (rest[0] === 'add') {
      const reminder = createReminder(root, need(rest[1], 'reminder slug'), { message: need(text('message'), '--message'),
        title: text('title'), at: text('at'), every: text('every'), timezone: text('timezone'), project: text('project'), task: text('task') });
      const sync = syncSchedules(root);
      output({ ...reminder, scheduleFailures: sync.failed }, `${reminder.id}: ${reminder.nextAt} (${reminder.timezone})`);
      if (sync.failed.length) { console.error('Reminder saved, but scheduling failed: ' + sync.failed.map(item => item.reason).join('; ')); process.exitCode = 1; }
      return;
    }
    if (rest[0] === 'ls') {
      const reminders = listReminders(root).filter(item => !text('status') || item.status === text('status'));
      output(reminders, reminders.map(item => `${item.id}  ${item.status}  ${item.nextAt ?? '-'}  ${item.message}`).join('\n') || 'No reminders.');
      return;
    }
    if (rest[0] === 'show') {
      const id = need(rest[1], 'reminder id');
      const reminder = listReminders(root).find(item => item.id === id || item.id === `reminders/${id}`);
      if (!reminder) throw new store.UserError(`no reminder matches "${id}"`);
      const history = fs.readFileSync(path.join(reminderDir(root, reminder.id), 'log.md'), 'utf8');
      output({ ...reminder, history }, `${JSON.stringify(reminder, null, 2)}\n${history}`);
      return;
    }
    if (rest[0] === 'cancel') {
      const reminder = cancelReminder(root, need(rest[1], 'reminder id'));
      const sync = syncSchedules(root);
      output({ ...reminder, scheduleFailures: sync.failed }, `${reminder.id}: cancelled`);
      if (sync.failed.length) { console.error(sync.failed.map(item => item.reason).join('; ')); process.exitCode = 1; }
      return;
    }
    if (rest[0] === 'dispatch') {
      const result = dispatchReminders(root);
      output(result, `Sent: ${result.sent.length}. Failed: ${result.failed.length}.`);
      if (result.failed.length) process.exitCode = 1;
      return;
    }
    throw new store.UserError('usage: 2b reminder add|ls|show|cancel|dispatch');
  },

  find() {
    const hits = findInStore(root, need(rest.join(' '), 'search text'));
    output(hits, hits.map(hit => `${hit.file}${hit.line ? `:${hit.line}` : ''}  ${hit.text}`).join('\n') || 'No matches.');
  },

  week() {
    const day = rest[0] ?? store.localDate();
    store.assertDay(day, 'date', false);
    const { start, end } = isoWeek(day);
    const events = weekEvents(root, day);
    output({ start, end, events }, formatWeek(start, end, events));
  },

  dump() {
    const file = store.createNote(root, 'inbox', need(rest[0], 'slug'), text('title'));
    output({ path: file }, file);
  },

  learn() {
    const file = store.createNote(root, 'learnings', need(rest[0], 'slug'), text('title'));
    output({ path: file }, file);
  },

  rules() {
    const entry = rest[0] ? store.resolve(root, rest[0]) : null;
    const rules = rulesFor(root, entry);
    output(rules, formatRules(rules));
  },

  rule() {
    const [action, scope, ...words] = rest;
    const entry = need(scope, 'global or a project/task') === 'global' ? null : store.resolve(root, scope);
    const file = rulesFile(root, entry);
    const ruleText = words.join(' ');
    if (action === 'add') {
      if (text('key')) assertRuleKey(text('key')!);
      addRule(file, text('key') ?? null, need(ruleText, 'rule text'));
      if (entry) store.appendLog(entry.dir, `rule add${text('key') ? ` [${text('key')}]` : ''}`, ruleText);
      output({ file }, `Rule saved in ${path.relative(root, file)}`);
      return;
    }
    if (action === 'rm') {
      if (!removeRule(file, need(ruleText, 'rule key or text'))) throw new store.UserError(`no rule "${ruleText}" in ${path.relative(root, file)}`);
      if (entry) store.appendLog(entry.dir, 'rule rm', ruleText);
      output({ file }, `Rule removed from ${path.relative(root, file)}`);
      return;
    }
    throw new store.UserError('usage: 2b rule add|rm global|<project|task> ...');
  },

  async dash() {
    const port = Number(text('port') ?? DEFAULT_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new store.UserError('--port must be an integer from 1 to 65535');
    }
    if (options.open) {
      const url = await openDashboard(root, port);
      output({ url }, url);
      return;
    }
    startDashboard(root, port);
    console.log(`2b dashboard on http://127.0.0.1:${port} (Ctrl-C to stop)`);
  },

  delete() {
    const result = trashTask(root, store.resolve(root, need(rest[0], 'task')));
    output(result, result.trashId);
  },

  restore() {
    const entry = restoreTask(root, need(rest[0], 'trash id'));
    output(summary(entry), `${entry.id}: restored (paused)`);
  },

  trash() {
    if (rest[0] !== 'ls') throw new store.UserError('usage: 2b trash ls');
    const items = listTrash(root);
    output(items, items.map(item => `${item.trashId}  ${item.project}/${item.task}  ${item.deletedAt}`).join('\n') || 'Trash is empty.');
  },

  run() {
    const entry = store.resolve(root, need(rest[0], 'task'));
    const result = runTask(root, entry);
    output(result, `${entry.id}: ${result.ok ? 'ok' : 'error'} — ${result.logFile}`);
    if (!result.ok) process.exitCode = 1;
  },

  schedule() {
    if (rest[0] === 'sync') {
      const result = syncSchedules(root);
      output(result, [
        `Written: ${result.written.join(', ') || 'none'}. Removed: ${result.removed.join(', ') || 'none'}.`,
        ...result.failed.map(failure => `Failed: ${failure.label} — ${failure.reason}`),
      ].join('\n'));
      if (result.failed.length) process.exitCode = 1;
      return;
    }
    if (rest[0] === 'ls') {
      const jobs = store.listTasks(root).filter(task => task.fields.kind === 'recurring');
      output(
        jobs.map(summary),
        jobs.map(job => `${String(job.fields['last-result'] ?? 'never').padEnd(6)} ${job.id}  ${job.fields.every}  ${job.fields.status}  last run ${job.fields['last-run'] ?? '-'}`).join('\n') || 'No recurring tasks.',
      );
      return;
    }
    throw new store.UserError('usage: 2b schedule sync | ls');
  },

  notify() {
    notify(text('title') ?? '2b', need(rest.join(' '), 'notification text'));
  },

  check() {
    const problems = checkStore(root);
    output(problems, problems.length ? problems.join('\n') : 'No problems.');
    if (problems.length) process.exitCode = 1;
  },

  import() {
    if (rest[0] === 'scan') {
      need(rest[1], 'one or more source folders');
      console.log(JSON.stringify(scanSources(rest.slice(1)), null, 2));
      return;
    }
    if (rest[0] === 'apply') {
      const planFile = need(rest[1], 'plan file');
      let plan: Parameters<typeof applyPlan>[1];
      try {
        plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new store.UserError(`cannot read plan ${planFile}: ${reason}`);
      }
      const report = applyPlan(root, plan, { dryRun: Boolean(options['dry-run']) });
      output(report, `${options['dry-run'] ? `Would copy: ${report.copied} items` : `Items copied: ${report.copied}`}. Files: ${report.files}. Junk skipped: ${Math.round(report.skippedJunkBytes / 1e6)} MB.${report.problems.length ? `\nProblems:\n${report.problems.join('\n')}` : ' Verified.'}`);
      if (!options.json && report.skippedLinks?.length) {
        console.log(`Links skipped: ${report.skippedLinks.length}\n${report.skippedLinks.map(link => `  ${link}`).join('\n')}`);
      }
      if (report.problems.length) process.exitCode = 1;
      return;
    }
    throw new store.UserError('usage: 2b import scan <folder>... | 2b import apply <plan.json> [--dry-run]');
  },
};

async function main(): Promise<void> {
  const parsed = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries([
      ...['json', 'tasks', 'all', 'short', 'open', 'dry-run', 'help', 'version'].map(name => [name, { type: 'boolean' as const }]),
      ...['area', 'title', 'deadline', 'due', 'repo', 'branch', 'reason', 'status', 'project', 'due-before', 'about', 'why',
        'priority', 'key', 'every', 'run', 'agent', 'command', 'body', 'port', 'output', 'source', 'type', 'message', 'at', 'timezone', 'task'].map(name => [name, { type: 'string' as const }]),
    ]),
  });
  options = parsed.values as Options;
  if (options.version) { console.log('2.0.0'); return; }
  const [command, ...positionals] = parsed.positionals;
  rest = positionals;
  if (!command || command === 'help' || options.help) {
    console.log(USAGE);
    return;
  }
  const handler = commands[command];
  if (!handler) throw new store.UserError(`unknown command "${command}" (see "2b help")`);
  root = store.storeRoot();
  if (!['init', 'notify'].includes(command) && !fs.existsSync(path.join(root, 'projects'))) {
    throw new store.UserError(`no store at ${root}; run "2b init"`);
  }
  await handler();
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`2b: ${message.replace(/[\r\n]+/g, ' ')}`);
  if (process.env.TWOB_DEBUG && error instanceof Error) console.error(error.stack);
  process.exitCode = 1;
});
