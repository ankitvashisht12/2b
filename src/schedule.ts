import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  UserError, NODE_COMMAND, appendLog, fileTimestamp, listTasks, localDate, localDateTime, readEntry, writeEntry,
  type Entry,
} from './store.ts';
import { formatRules, rulesFor } from './rules.ts';

export type CalendarInterval = { Minute: number; Hour?: number; Weekday?: number };

const WEEKDAY_NUMBERS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const WORKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

export function parseEvery(spec: string): CalendarInterval[] {
  const text = spec.trim().toLowerCase();
  if (text === 'hourly') return [{ Minute: 0 }];
  const match = text.match(/^([a-z,]+) (\d{1,2}):(\d{2})$/);
  if (!match) throw new UserError(`schedule "${spec}" must look like "daily 19:00", "weekdays 14:00", "mon,fri 10:00", or "hourly"`);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour > 23 || minute > 59) throw new UserError(`schedule "${spec}" has an invalid time`);
  if (match[1] === 'daily') return [{ Hour: hour, Minute: minute }];
  const days = match[1] === 'weekdays' ? WORKDAYS : match[1].split(',');
  return days.map(day => {
    if (!(day in WEEKDAY_NUMBERS)) throw new UserError(`unknown day "${day}" in schedule "${spec}"`);
    return { Weekday: WEEKDAY_NUMBERS[day], Hour: hour, Minute: minute };
  });
}

export function labelFor(taskId: string): string {
  return `com.2b.${taskId.replace(/\//g, '.')}`;
}

const xmlEscape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function plistFor(
  label: string, programArguments: string[], intervals: CalendarInterval[],
  environment: Record<string, string>, logFile: string,
): string {
  const argumentsXml = programArguments.map(argument => `    <string>${xmlEscape(argument)}</string>`).join('\n');
  const environmentXml = Object.entries(environment)
    .map(([key, value]) => `    <key>${xmlEscape(key)}</key><string>${xmlEscape(value)}</string>`).join('\n');
  const intervalsXml = intervals.map(interval => {
    const keys = Object.entries(interval).map(([key, value]) => `      <key>${key}</key><integer>${value}</integer>`).join('\n');
    return `    <dict>\n${keys}\n    </dict>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${environmentXml}
  </dict>
  <key>StartCalendarInterval</key>
  <array>
${intervalsXml}
  </array>
  <key>StandardOutPath</key><string>${xmlEscape(logFile)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(logFile)}</string>
</dict>
</plist>
`;
}

function launchctl(action: 'bootstrap' | 'bootout', plistFile: string): void {
  spawnSync('launchctl', [action, `gui/${process.getuid?.() ?? 501}`, plistFile], { stdio: 'ignore' });
}

export function syncSchedules(
  root: string,
  { agentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents'), load = true } = {},
): { written: string[]; removed: string[] } {
  const logsDir = path.join(os.homedir(), 'Library', 'Logs', '2b');
  fs.mkdirSync(agentsDir, { recursive: true });
  if (load) fs.mkdirSync(logsDir, { recursive: true });
  const wanted = new Map<string, string>();
  for (const task of listTasks(root)) {
    if (task.fields.kind !== 'recurring' || task.fields.status !== 'doing') continue;
    const label = labelFor(task.id);
    const environment = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: os.homedir(), TWOB_HOME: root };
    const programArguments = [...NODE_COMMAND, 'run', task.id];
    wanted.set(label, plistFor(label, programArguments, parseEvery(String(task.fields.every)), environment, path.join(logsDir, `${label}.log`)));
  }
  const written: string[] = [];
  const removed: string[] = [];
  for (const fileName of fs.readdirSync(agentsDir)) {
    if (!fileName.startsWith('com.2b.') || !fileName.endsWith('.plist')) continue;
    const label = fileName.slice(0, -'.plist'.length);
    if (wanted.has(label)) continue;
    const plistFile = path.join(agentsDir, fileName);
    if (load) launchctl('bootout', plistFile);
    fs.rmSync(plistFile);
    removed.push(label);
  }
  for (const [label, plist] of wanted) {
    const plistFile = path.join(agentsDir, `${label}.plist`);
    if (fs.existsSync(plistFile) && fs.readFileSync(plistFile, 'utf8') === plist) continue;
    if (load && fs.existsSync(plistFile)) launchctl('bootout', plistFile);
    fs.writeFileSync(plistFile, plist);
    if (load) launchctl('bootstrap', plistFile);
    written.push(label);
  }
  return { written, removed };
}

export function agentArgv(agent: string, prompt: string, root: string): string[] {
  if (agent === 'codex') return ['codex', 'exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-C', root, prompt];
  const home = os.homedir();
  return [
    'claude', '-p', prompt,
    '--allowedTools', 'Bash(2b:*)', 'Bash(sqlite3:*)', 'Read', 'Glob', 'Grep',
    '--add-dir', root, path.join(home, '.claude', 'projects'), path.join(home, '.codex', 'sessions'), path.join(home, '.t3', 'userdata'),
  ];
}

export function buildPrompt(root: string, task: Entry): string {
  const parts = [
    task.body.trim(),
    '',
    'Rules:',
    formatRules(rulesFor(root, task)),
    '',
    `You run as the recurring 2b task "${task.id}". Today is ${localDate()}. Use the 2b CLI for every change to the store.`,
  ];
  if (task.fields['last-result'] === 'error' && task.fields['last-log']) {
    const lastLog = path.join(task.dir, String(task.fields['last-log']));
    parts.push('', `The previous run failed. Read its log first and avoid the same failure: ${lastLog}`);
  }
  return parts.join('\n');
}

export function notify(title: string, message: string): void {
  if (process.env.TWOB_NO_NOTIFY) return;
  spawnSync('osascript', ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`]);
}

export function runTask(root: string, task: Entry, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}): { ok: boolean; logFile: string } {
  if (task.fields.kind !== 'recurring') throw new UserError(`${task.id} is not a recurring task`);
  const argv = task.fields.run === 'command'
    ? ['/bin/sh', '-c', String(task.fields.command ?? '')]
    : agentArgv(String(task.fields.agent ?? 'claude'), buildPrompt(root, task), root);
  const runsDir = path.join(task.dir, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const logFile = path.join(runsDir, `${fileTimestamp()}.log`);
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: root, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, TWOB_HOME: root },
  });
  const ok = result.status === 0 && !result.error;
  const failure = result.error ? `error: ${result.error.message}\n` : '';
  fs.writeFileSync(logFile, `$ ${argv.join(' ')}\n\n${result.stdout ?? ''}\n${result.stderr ?? ''}\n${failure}exit: ${result.status ?? result.signal}\n`);

  const fresh = readEntry('task', task.project, task.dir);
  fresh.fields['last-run'] = localDateTime();
  fresh.fields['last-result'] = ok ? 'ok' : 'error';
  fresh.fields['last-log'] = path.relative(task.dir, logFile);
  writeEntry(fresh);
  appendLog(task.dir, ok ? 'run ok' : 'run error', path.relative(task.dir, logFile));
  if (!ok) notify(`2b: ${fresh.fields.title} failed`, `See the dashboard or ${logFile}`);
  return { ok, logFile };
}
