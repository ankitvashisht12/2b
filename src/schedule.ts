import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  UserError, NODE_COMMAND, appendLog, fileTimestamp, listTasks, localDate, localDateTime, readEntry, writeEntry,
  priorityOf, type Entry,
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

export function nextRun(intervals: CalendarInterval[], from: Date): Date {
  if (!Number.isFinite(from.getTime()) || !intervals.length || intervals.some(interval =>
    !Number.isInteger(interval.Minute) || interval.Minute < 0 || interval.Minute > 59
    || (interval.Hour !== undefined && (!Number.isInteger(interval.Hour) || interval.Hour < 0 || interval.Hour > 23))
    || (interval.Weekday !== undefined && (!Number.isInteger(interval.Weekday) || interval.Weekday < 0 || interval.Weekday > 7)))) {
    throw new UserError('invalid calendar intervals or start time');
  }
  const candidate = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000);
  for (let minute = 0; minute < 15 * 24 * 60; minute += 1) {
    if (intervals.some(interval => candidate.getMinutes() === interval.Minute
      && (interval.Hour === undefined || candidate.getHours() === interval.Hour)
      && (interval.Weekday === undefined || candidate.getDay() === interval.Weekday % 7))) return candidate;
    candidate.setTime(candidate.getTime() + 60_000);
  }
  throw new UserError('no matching calendar time in the next fifteen days');
}

export function humanSchedule(spec: string): string {
  const intervals = parseEvery(spec);
  const normalized = spec.trim().toLowerCase();
  if (normalized === 'hourly') return 'Hourly';
  const time = `${String(intervals[0].Hour).padStart(2, '0')}:${String(intervals[0].Minute).padStart(2, '0')}`;
  if (normalized.startsWith('daily ')) return `Daily ${time}`;
  if (normalized.startsWith('weekdays ')) return `Weekdays ${time}`;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${intervals.map(interval => names[interval.Weekday!]).join(', ')} ${time}`;
}

export type Job = {
  id: string; title: string; project: string; every: string; schedule: string;
  run: string; agent: string | null; command: string | null; status: string; priority: string;
  loaded: boolean; nextRun: string | null; lastRun: string | null; lastResult: string | null; lastLog: string | null;
  runs: { file: string; at: string; ok: boolean | null }[];
};

export function jobsOverview(
  root: string,
  { agentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents') } = {},
): Job[] {
  const nullable = (value: unknown) => value === null || value === undefined ? null : String(value);
  return listTasks(root).filter(task => task.fields.kind === 'recurring').map(task => {
    const fields = task.fields;
    const every = String(fields.every ?? '');
    let schedule = every;
    let upcoming: string | null = null;
    try {
      schedule = humanSchedule(every);
      if (fields.status === 'doing') upcoming = localDateTime(nextRun(parseEvery(every), new Date()));
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
    }
    const plist = path.join(agentsDir, `${labelFor(task.id)}.plist`);
    const loaded = fs.existsSync(plist) && fs.readFileSync(plist, 'utf8')
      .includes(`<key>TWOB_HOME</key><string>${xmlEscape(root)}</string>`);
    const runsDir = path.join(task.dir, 'runs');
    const runs = (fs.existsSync(runsDir) ? fs.readdirSync(runsDir, { withFileTypes: true }) : [])
      .filter(item => item.isFile() && /^\d{4}-\d{2}-\d{2}-\d{6}(?:-\d+)*\.log$/.test(item.name))
      .map(item => item.name).sort((left, right) => right.localeCompare(left, 'en', { numeric: true })).slice(0, 20)
      .map(file => {
        const contents = fs.readFileSync(path.join(runsDir, file), 'utf8');
        const exits = [...contents.matchAll(/^exit: (.+)$/gm)];
        const result = exits.at(-1)?.[1].trim();
        const at = `${file.slice(0, 10)} ${file.slice(11, 13)}:${file.slice(13, 15)}`;
        return { file: path.posix.join('runs', file), at, ok: result === undefined ? null : result === '0' };
      });
    return {
      id: task.id, title: String(fields.title ?? ''), project: task.project, every, schedule,
      run: String(fields.run ?? ''), agent: nullable(fields.agent), command: nullable(fields.command),
      status: String(fields.status ?? ''), priority: priorityOf(task), loaded, nextRun: upcoming,
      lastRun: nullable(fields['last-run']), lastResult: nullable(fields['last-result']), lastLog: nullable(fields['last-log']), runs,
    };
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

function launchctl(action: 'bootstrap' | 'bootout', plistFile: string): { ok: boolean; reason: string } {
  const result = spawnSync('launchctl', [action, `gui/${process.getuid?.() ?? 501}`, plistFile], { encoding: 'utf8' });
  const ok = result.status === 0 && !result.error;
  return {
    ok,
    reason: ok ? '' : result.stderr?.trim() || result.error?.message || `launchctl ${action} failed: ${result.status ?? result.signal}`,
  };
}

export function syncSchedules(
  root: string,
  { agentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents'), load = true } = {},
): { written: string[]; removed: string[]; failed: { label: string; reason: string }[] } {
  const logsDir = path.join(os.homedir(), 'Library', 'Logs', '2b');
  fs.mkdirSync(agentsDir, { recursive: true });
  if (load) fs.mkdirSync(logsDir, { recursive: true });
  const wanted = new Map<string, string>();
  const failed: { label: string; reason: string }[] = [];
  for (const task of listTasks(root)) {
    if (task.fields.kind !== 'recurring' || task.fields.status !== 'doing') continue;
    const label = labelFor(task.id);
    const environment = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: os.homedir(), TWOB_HOME: root };
    const programArguments = [...NODE_COMMAND, 'run', task.id];
    let intervals: CalendarInterval[];
    try {
      intervals = parseEvery(String(task.fields.every));
    } catch (error) {
      failed.push({ label, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    wanted.set(label, plistFor(label, programArguments, intervals, environment, path.join(logsDir, `${label}.log`)));
  }
  const written: string[] = [];
  const removed: string[] = [];
  for (const fileName of fs.readdirSync(agentsDir)) {
    if (!fileName.startsWith('com.2b.') || !fileName.endsWith('.plist')) continue;
    const label = fileName.slice(0, -'.plist'.length);
    if (wanted.has(label)) continue;
    const plistFile = path.join(agentsDir, fileName);
    if (!fs.readFileSync(plistFile, 'utf8').includes(`<key>TWOB_HOME</key><string>${xmlEscape(root)}</string>`)) continue;
    if (load) {
      const result = launchctl('bootout', plistFile);
      if (!result.ok) {
        failed.push({ label, reason: result.reason });
        continue;
      }
    }
    fs.rmSync(plistFile);
    removed.push(label);
  }
  for (const [label, plist] of wanted) {
    const plistFile = path.join(agentsDir, `${label}.plist`);
    if (fs.existsSync(plistFile) && fs.readFileSync(plistFile, 'utf8') === plist) continue;
    if (load && fs.existsSync(plistFile)) launchctl('bootout', plistFile);
    fs.writeFileSync(plistFile, plist);
    if (load) {
      let result = launchctl('bootstrap', plistFile);
      if (!result.ok) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
        result = launchctl('bootstrap', plistFile);
      }
      if (!result.ok) {
        fs.rmSync(plistFile);
        failed.push({ label, reason: result.reason });
        continue;
      }
    }
    written.push(label);
  }
  return { written, removed, failed };
}

export function agentArgv(agent: string, prompt: string, root: string): string[] {
  if (agent === 'codex') return ['codex', 'exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-C', root, prompt];
  const home = os.homedir();
  return [
    'claude', '-p', prompt,
    '--allowedTools', 'Bash(2b:*)', 'Read', 'Glob', 'Grep',
    '--add-dir', root, path.join(home, '.claude', 'projects'), path.join(home, '.codex', 'sessions'), path.join(home, '.t3', 'userdata'),
  ];
}

export function buildPrompt(root: string, task: Entry): string {
  const parts = [
    `You run as the recurring 2b task "${task.id}". Today is ${localDate()}. Use the 2b CLI for every change to the store.`,
    '',
    task.body.trim(),
    '',
    'Rules:',
    formatRules(rulesFor(root, task)),
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
  const logName = `${fileTimestamp()}-${String(Date.now() % 1000).padStart(3, '0')}`;
  let logFile = path.join(runsDir, `${logName}.log`);
  const missingCommand = task.fields.run === 'command' && !String(task.fields.command ?? '').trim();
  const result = missingCommand
    ? { status: 1, stdout: '', stderr: 'no command set', error: undefined, signal: null }
    : spawnSync(argv[0], argv.slice(1), {
      cwd: root, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, TWOB_HOME: root },
    });
  const ok = result.status === 0 && !result.error;
  const failure = result.error ? `error: ${result.error.message}\n` : '';
  const log = `$ ${argv.join(' ')}\n\n${result.stdout ?? ''}\n${result.stderr ?? ''}\n${failure}exit: ${result.status ?? result.signal}\n`;
  for (let suffix = 1; ; suffix += 1) {
    try {
      fs.writeFileSync(logFile, log, { flag: 'wx' });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      logFile = path.join(runsDir, `${logName}-${suffix}.log`);
    }
  }

  const fresh = readEntry('task', task.project, task.dir);
  fresh.fields['last-run'] = localDateTime();
  fresh.fields['last-result'] = ok ? 'ok' : 'error';
  fresh.fields['last-log'] = path.relative(task.dir, logFile);
  writeEntry(fresh);
  appendLog(task.dir, ok ? 'run ok' : 'run error', path.relative(task.dir, logFile));
  if (!ok) notify(`2b: ${fresh.fields.title} failed`, `See the dashboard or ${logFile}`);
  return { ok, logFile };
}
