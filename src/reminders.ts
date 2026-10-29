import fs from 'node:fs';
import path from 'node:path';
import { parse, serialize } from './frontmatter.ts';
import { appendLog, assertDay, assertSlug, localDateTime, resolve, UserError } from './store.ts';
import { notify, parseEvery } from './schedule.ts';

export type Reminder = {
  id: string; title: string; message: string; timezone: string; at: string | null; every: string | null;
  nextAt: string | null; status: 'scheduled' | 'sent' | 'cancelled'; project: string | null; task: string | null;
  created: string; lastSent: string | null; lastError: string | null;
};
export type ReminderOptions = { message: string; title?: string; at?: string; every?: string; timezone?: string; project?: string; task?: string };

export function assertTimezone(timezone: string): void {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); }
  catch { throw new UserError(`invalid timezone "${timezone}"`); }
}


export function reminderTime(at: string, timezone: string): Date {
  assertTimezone(timezone);
  assertDay(at.slice(0, 10), 'at', false);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(at)) {
    const result = new Date(at);
    if (Number.isFinite(result.getTime())) return result;
  }
  const match = at.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/);
  if (!match) throw new UserError('at must be yyyy-mm-dd HH:MM in the chosen timezone, or an ISO timestamp with offset');
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (hour > 23 || minute > 59) throw new UserError('at has an invalid time');
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let offsetMinutes = -18 * 60; offsetMinutes <= 18 * 60; offsetMinutes += 1) {
    const candidate = new Date(guess + offsetMinutes * 60000);
    const parts = Object.fromEntries(formatter.formatToParts(candidate).map(part => [part.type, part.value]));
    if (+parts.year === year && +parts.month === month && +parts.day === day && +parts.hour === hour && +parts.minute === minute) return candidate;
  }
  throw new UserError('at is an invalid date or a local time skipped by daylight saving');
}

export function nextReminderTime(every: string, timezone: string, after = new Date()): Date {
  assertTimezone(timezone);
  const intervals = parseEvery(every);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const wallKey = (parts: Record<string, string>) => `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  const afterKey = wallKey(Object.fromEntries(formatter.formatToParts(after).map(part => [part.type, part.value])));
  const start = Math.floor(after.getTime() / 60000) * 60000 + 60000;
  for (let minuteOffset = 0; minuteOffset < 9 * 24 * 60; minuteOffset += 1) {
    const candidate = new Date(start + minuteOffset * 60000);
    const parts = Object.fromEntries(formatter.formatToParts(candidate).map(part => [part.type, part.value]));
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    if (intervals.some(interval => (interval.Hour === undefined || wallKey(parts) > afterKey) && interval.Minute === +parts.minute
      && (interval.Hour === undefined || interval.Hour === +parts.hour)
      && (interval.Weekday === undefined || interval.Weekday === weekday))) return candidate;
  }
  throw new UserError('cannot find the next reminder time');
}

export function reminderDir(root: string, id: string): string {
  const slug = id.replace(/^reminders\//, '');
  assertSlug(slug, 'reminder');
  return path.join(root, 'reminders', slug);
}

export function readReminder(root: string, slug: string): Reminder {
  const { fields } = parse(fs.readFileSync(path.join(reminderDir(root, slug), 'readme.md'), 'utf8'));
  const id = `reminders/${path.basename(reminderDir(root, slug))}`;
  if (fields.id !== id) throw new UserError(`${id}: invalid reminder id`);
  return fields as Reminder;
}

export function listReminders(root: string): Reminder[] {
  const dir = path.join(root, 'reminders');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(item => item.isDirectory() && !item.name.startsWith('.')).map(item => readReminder(root, item.name)).sort((first, second) => (first.nextAt ?? '9999').localeCompare(second.nextAt ?? '9999') || first.id.localeCompare(second.id));
}

function saveReminder(root: string, reminder: Reminder): void {
  fs.writeFileSync(path.join(reminderDir(root, reminder.id), 'readme.md'), serialize(reminder, `\n# ${reminder.title}\n\n${reminder.message}\n`));
}

export function createReminder(root: string, slug: string, options: ReminderOptions, now = new Date()): Reminder {
  const dir = reminderDir(root, slug);
  if (fs.existsSync(dir)) throw new UserError(`reminder "${slug}" already exists`);
  if (!options.message.trim()) throw new UserError('reminder message is empty');
  if (Boolean(options.at) === Boolean(options.every)) throw new UserError('give exactly one of --at or --every');
  const timezone = options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  assertTimezone(timezone);
  const next = options.at ? reminderTime(options.at, timezone) : nextReminderTime(options.every!, timezone, now);
  if (next <= now) throw new UserError('reminder time must be in the future');
  const project = options.project ? resolve(root, options.project) : null;
  const task = options.task ? resolve(root, options.task) : null;
  if (project && project.kind !== 'project') throw new UserError('project must be a project');
  if (task && task.kind !== 'task') throw new UserError('task must be a task');
  if (project && task && project.id !== task.project) throw new UserError('task must belong to the selected project');
  const reminder: Reminder = { id: `reminders/${slug}`, title: options.title ?? options.message, message: options.message,
    timezone, at: options.at ? next.toISOString() : null, every: options.every ?? null, nextAt: next.toISOString(), status: 'scheduled',
    project: project?.id ?? task?.project ?? null, task: task?.id ?? null, created: localDateTime(now), lastSent: null, lastError: null };
  fs.mkdirSync(dir, { recursive: true });
  saveReminder(root, reminder);
  appendLog(dir, 'reminder created', reminder.message);
  return reminder;
}

export function cancelReminder(root: string, id: string): Reminder {
  const reminder = listReminders(root).find(item => item.id === id || item.id === `reminders/${id}`);
  if (!reminder) throw new UserError(`no reminder matches "${id}"`);
  if (reminder.status === 'sent') throw new UserError('this reminder was already sent');
  if (reminder.status !== 'cancelled') {
    reminder.status = 'cancelled';
    reminder.nextAt = null;
    saveReminder(root, reminder);
    appendLog(reminderDir(root, reminder.id), 'reminder cancelled', reminder.message);
  }
  return reminder;
}

export function dispatchReminders(root: string, now = new Date(), deliver = notify): { sent: string[]; failed: string[] } {
  const dir = path.join(root, 'reminders');
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, '.dispatch.lock');
  try { fs.mkdirSync(lock); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // A dead process must not prevent future reminders after a crash.
    const owner = path.join(lock, 'pid');
    const pid = fs.existsSync(owner) ? Number(fs.readFileSync(owner, 'utf8')) : 0;
    if (!pid && Date.now() - fs.statSync(lock).mtimeMs < 60000) return { sent: [], failed: [] };
    if (pid) {
      try { process.kill(pid, 0); return { sent: [], failed: [] }; }
      catch (probeError) { if ((probeError as NodeJS.ErrnoException).code !== 'ESRCH') return { sent: [], failed: [] }; }
    }
    fs.rmSync(lock, { recursive: true });
    return dispatchReminders(root, now, deliver);
  }
  fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
  const sent: string[] = [], failed: string[] = [];
  try {
    for (const reminder of listReminders(root)) {
      if (reminder.status !== 'scheduled' || !reminder.nextAt || new Date(reminder.nextAt) > now) continue;
      try {
        deliver(reminder.title, reminder.message);
        reminder.lastSent = now.toISOString();
        reminder.lastError = null;
        reminder.nextAt = reminder.every ? nextReminderTime(reminder.every, reminder.timezone, now).toISOString() : null;
        reminder.status = reminder.every ? 'scheduled' : 'sent';
        saveReminder(root, reminder);
        appendLog(reminderDir(root, reminder.id), 'reminder sent', reminder.message, localDateTime(now));
        sent.push(reminder.id);
      } catch (error) {
        reminder.lastError = error instanceof Error ? error.message : String(error);
        saveReminder(root, reminder);
        appendLog(reminderDir(root, reminder.id), 'reminder failed', reminder.lastError, localDateTime(now));
        failed.push(reminder.id);
      }
    }
  } finally { fs.rmSync(lock, { recursive: true }); }
  return { sent, failed };
}
