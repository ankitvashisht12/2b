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
import { applyPlan, scanSources } from './importer.ts';

const USAGE = `2b — second brain

  2b init
  2b new project <slug> --area work|personal [--title T] [--deadline D]
  2b new task <project> <slug> [--title T] [--due D] [--repo R] [--branch B] [--body TEXT]
  2b new task <project> <slug> --every "daily 19:00" --run agent|command [--agent claude|codex] [--command CMD] [--body RULE]
  2b path [<project|task>]
  2b status <project|task> <status> [--reason R]
  2b set <project|task> <field> <value>
  2b add <project|task> pr <url> | resource <title> <path-or-url> | link <target> depends-on|follow-up|related
  2b log <project|task> <note>
  2b ls [--tasks] [--status S] [--area A] [--project P] [--due-before D|+Nd] [--all] [--short]
  2b show <project|task>
  2b artifact add <task> <file-or-name> [--title T] --about A --why W
  2b find <text>
  2b week [yyyy-mm-dd]
  2b dump <slug> [--title T]        2b learn <slug> [--title T]
  2b rules [<project|task>]
  2b rule add global|<project|task> [--key K] <text>
  2b rule rm global|<project|task> <key-or-text>
  2b dash [--port N] [--open]
  2b run <task>
  2b schedule sync | ls
  2b notify <text> [--title T]
  2b check
  2b import scan <folder>...         2b import apply <plan.json> [--dry-run]

Read commands accept --json. Put -- before text that starts with a dash.`;

type Options = Record<string, string | boolean | undefined>;
let options: Options = {};
let rest: string[] = [];
const root = store.storeRoot();

function output(data: unknown, text: string): void {
  console.log(options.json ? JSON.stringify(data, null, 2) : text);
}

function need(value: string | undefined, what: string): string {
  if (!value) throw new store.UserError(`missing ${what} (see "2b help")`);
  return value;
}

const text = (name: string) => options[name] as string | undefined;
const summary = (entry: Entry) => ({ id: entry.id, path: entry.dir, ...entry.fields });
const isOpen = (status: unknown) => !store.CLOSED_STATUSES.includes(String(status));

function dueLimit(value: string): string {
  const relative = value.match(/^\+(\d+)d$/);
  if (relative) return store.addDays(store.localDate(), Number(relative[1]));
  store.assertDay(value, '--due-before', false);
  return value;
}

function taskLine(task: Entry, short: boolean): string {
  const due = store.DATE.test(String(task.fields.due)) ? `due ${task.fields.due}` : '';
  if (short) return `${task.fields.title}${due ? ` (${due})` : ''}`;
  return `  ${String(task.fields.status).padEnd(7)} ${task.id}  ${task.fields.title}  ${due}`.trimEnd();
}

function projectLine(project: Entry): string {
  const reason = project.fields['status-reason'] ? `: ${project.fields['status-reason']}` : '';
  return `${project.id} — ${project.fields.title}  [${project.fields.status}${reason}]  ${project.fields.area}  deadline ${project.fields.deadline ?? 'unknown'}`;
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
  if (entry.fields.kind === 'recurring') syncSchedules(root);
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
        area: need(text('area'), '--area work|personal'), title: text('title'), deadline: text('deadline'),
      });
      output(summary(entry), entry.dir);
      return;
    }
    if (what === 'task') {
      if (text('every')) parseEvery(text('every')!);
      const entry = store.createTask(root, need(first, 'project'), need(second, 'task slug'), {
        title: text('title'), due: text('due'), repo: text('repo'), branch: text('branch'), body: text('body'),
        every: text('every'), run: text('run'), agent: text('agent'), command: text('command'),
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
    store.setField(entry, field, value);
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
    if (statusFilter !== undefined) {
      const allowed = options.tasks || text('due-before') ? store.TASK_STATUSES : store.PROJECT_STATUSES;
      store.assertOneOf(statusFilter, allowed, '--status');
    }
    const matchesStatus = (status: unknown) => (statusFilter ? status === statusFilter : options.all || isOpen(status));
    if (options.tasks || text('due-before')) {
      const limit = text('due-before') ? dueLimit(text('due-before')!) : null;
      const tasks = store.listTasks(root, text('project')).filter(task =>
        shownProjectIds.has(task.project)
        && matchesStatus(task.fields.status)
        && (!limit || (store.DATE.test(String(task.fields.due)) && String(task.fields.due) <= limit)));
      output(tasks.map(summary), tasks.map(task => taskLine(task, Boolean(options.short)).trim()).join('\n') || 'No tasks.');
      return;
    }
    const shown = projects.filter(project => (!text('project') || project.id === text('project')) && matchesStatus(project.fields.status));
    const withTasks = shown.map(project => ({
      project, tasks: store.listTasks(root, project.id).filter(task => options.all || isOpen(task.fields.status)),
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
    output(
      { ...summary(entry), body: entry.body, reverseLinks: reverse, rules, tasks: tasks.map(summary), recentLog },
      [
        `${entry.id} (${entry.kind})`,
        ...Object.entries(entry.fields).map(([key, value]) => `${key}: ${typeof value === 'string' || value === null ? value ?? '' : JSON.stringify(value)}`),
        `path: ${entry.dir}`,
        ...(tasks.length ? ['', 'Tasks:', ...tasks.map(task => taskLine(task, false))] : []),
        ...(reverse.length ? ['', 'Linked from:', ...reverse.map(link => `  ${link.from} (${link.type})`)] : []),
        '', 'Rules:', formatRules(rules),
        '', 'Recent log:', ...recentLog,
      ].join('\n'),
    );
  },

  artifact() {
    if (rest[0] !== 'add') throw new store.UserError('usage: 2b artifact add <task> <file-or-name> --about A --why W');
    const entry = store.resolve(root, need(rest[1], 'task'));
    const file = store.addArtifact(entry, need(rest[2], 'file or name'), { title: text('title'), about: text('about'), why: text('why') });
    output({ path: file }, file);
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
    const file = need(scope, 'global or a project/task') === 'global' ? rulesFile(root, null) : rulesFile(root, store.resolve(root, scope));
    const ruleText = words.join(' ');
    if (action === 'add') {
      if (text('key')) assertRuleKey(text('key')!);
      addRule(file, text('key') ?? null, need(ruleText, 'rule text'));
      output({ file }, `Rule saved in ${path.relative(root, file)}`);
      return;
    }
    if (action === 'rm') {
      if (!removeRule(file, need(ruleText, 'rule key or text'))) throw new store.UserError(`no rule "${ruleText}" in ${path.relative(root, file)}`);
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
      output(report, `Items copied: ${report.copied}. Files: ${report.files}. Junk skipped: ${Math.round(report.skippedJunkBytes / 1e6)} MB.${report.problems.length ? `\nProblems:\n${report.problems.join('\n')}` : ' Verified.'}`);
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
      ...['json', 'tasks', 'all', 'short', 'open', 'dry-run', 'help'].map(name => [name, { type: 'boolean' as const }]),
      ...['area', 'title', 'deadline', 'due', 'repo', 'branch', 'reason', 'status', 'project', 'due-before', 'about', 'why',
        'key', 'every', 'run', 'agent', 'command', 'body', 'port'].map(name => [name, { type: 'string' as const }]),
    ]),
  });
  options = parsed.values as Options;
  const [command, ...positionals] = parsed.positionals;
  rest = positionals;
  if (!command || command === 'help' || options.help) {
    console.log(USAGE);
    return;
  }
  const handler = commands[command];
  if (!handler) throw new store.UserError(`unknown command "${command}" (see "2b help")`);
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
