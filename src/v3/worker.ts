import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ObjectStore } from './store.ts';
import { ensureConfig, metadataDirectory, type AgentChoice } from './config.ts';
import { vaultRoot, readBody } from './files.ts';
import { parseEvery } from '../schedule.ts';
import type { ObjectRecord } from './models.ts';

export function nextOccurrence(spec: string, timezone: string, after: Date): string {
  const intervals = parseEvery(spec);
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let timestamp = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  for (let minute = 0; minute < 15 * 24 * 60; minute++, timestamp += 60_000) {
    const fields = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
    if (intervals.some(interval => interval.Minute === Number(fields.minute) && (interval.Hour === undefined || interval.Hour === Number(fields.hour)) && (interval.Weekday === undefined || interval.Weekday === weekdays.indexOf(fields.weekday)))) return new Date(timestamp).toISOString();
  }
  throw new Error('No schedule occurrence in the next fifteen days');
}
function executable(provider: string): boolean { return spawnSync('/usr/bin/which', [provider], { stdio: 'ignore' }).status === 0; }
function chooseAgent(job: ObjectRecord): AgentChoice {
  const config = ensureConfig();
  const provider = String(job.properties.provider || job.properties.agent || config.agents.primary.provider);
  const inheritedModel = provider === config.agents.primary.provider ? config.agents.primary.model : provider === config.agents.fallback?.provider ? config.agents.fallback.model : null;
  const primary = { provider, model: job.properties.model === undefined ? inheritedModel : job.properties.model };
  if (!['codex', 'claude'].includes(primary.provider)) throw new Error('Agent provider must be codex or claude');
  if (executable(primary.provider)) return primary as AgentChoice;
  if (config.agents.fallback && executable(config.agents.fallback.provider)) return config.agents.fallback;
  throw new Error('Configured agent is not installed. Set agents.primary or agents.fallback in ~/.2b/config.json.');
}
async function withJobLock<T>(root: string, id: string, action: () => Promise<T>): Promise<T> {
  const directory = path.join(metadataDirectory(root), 'job-locks'); fs.mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, createHash('sha256').update(id).digest('hex') + '.lock');
  let handle: number;
  try { handle = fs.openSync(lock, 'wx', 0o600); } catch (error: any) { if (error.code === 'EEXIST') throw new Error('Job is already running or its lock needs review: ' + lock); throw error; }
  fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); fs.closeSync(handle);
  try { return await action(); } finally { fs.unlinkSync(lock); }
}
export async function runAgentJob(rootInput: string, ref: string, dueOnly = false) {
  const root = vaultRoot(rootInput);
  const lookup = await ObjectStore.open(root);
  let canonicalId: string;
  try { const object = await lookup.get(ref); if (!object || object.type !== 'agent-job') throw new Error('Object must be an agent-job'); canonicalId = object.id; } finally { await lookup.close(); }
  return withJobLock(root, canonicalId, async () => {
    const store = await ObjectStore.open(root);
    try {
      const job = await store.get(canonicalId);
      if (!job || job.type !== 'agent-job') throw new Error('Object must be an agent-job');
      if (job.properties.enabled !== true || job.properties.migrationReview === 'pending') throw new Error('Job is disabled. Review its instructions, then explicitly enable it. Imported jobs never run automatically.');
      if (dueOnly && (!job.properties.nextRunAt || Date.parse(String(job.properties.nextRunAt)) > Date.now())) return { runId: null, status: 'skipped', logPath: null };
      const choice = chooseAgent(job);
      const instructions = String(job.properties.instructions || readBody(root, job));
      if (!instructions.trim()) throw new Error('Job instructions are empty');
      const runId = randomUUID(); const now = new Date().toISOString();
      const logPath = `runs/${runId}.log`; const absoluteLog = path.join(root, logPath);
      fs.mkdirSync(path.dirname(absoluteLog), { recursive: true });
      const run = await store.upsert({ id: runId, type: 'agent-run', name: `${job.name} — ${now}`, description: '', tags: job.tags, path: logPath, createdAt: now, modifiedAt: now, properties: { status: 'running', provider: choice.provider, model: choice.model, startedAt: now, job: job.id } });
      await store.relate(run.id, 'run-of', job.id);
      const prompt = `You are running a 2b v3 local job. Work only in ${root}. The original ~/obsidian/2bv2 and ~/obsidian/personal vaults are read-only. Use the V3 CLI at ${fileURLToPath(new URL('../../bin/2b', import.meta.url))} with --root ${root}. Follow the saved job instruction below. Do not send messages externally unless explicitly authorized in that instruction.\n\n${instructions}`;
      const args = choice.provider === 'codex' ? ['exec', '--skip-git-repo-check', '--cd', root, ...(choice.model ? ['--model', choice.model] : []), prompt] : ['-p', ...(choice.model ? ['--model', choice.model] : []), prompt];
      const log = fs.openSync(absoluteLog, 'a', 0o600);
      const result = await new Promise<{ code: number; error?: string }>(resolve => {
        let settled = false;
        const child = spawn(choice.provider, args, { cwd: root, stdio: ['ignore', log, log], env: { ...process.env, TWOB_V3_HOME: root } });
        const timeout = setTimeout(() => child.kill('SIGTERM'), 15 * 60_000);
        const finish = (result: { code: number; error?: string }) => { if (settled) return; settled = true; clearTimeout(timeout); resolve(result); };
        child.once('error', error => finish({ code: 1, error: error.message }));
        child.once('exit', code => finish({ code: code ?? 1 }));
      });
      fs.closeSync(log);
      const finishedAt = new Date().toISOString();
      await store.update(run.id, { properties: { status: result.code === 0 ? 'succeeded' : 'failed', finishedAt, exitCode: result.code, error: result.error || null } });
      await store.update(job.id, { properties: { lastRun: finishedAt, lastRunId: run.id, ...(job.properties.every ? { nextRunAt: nextOccurrence(String(job.properties.every), String(job.properties.timezone || ensureConfig().timezone), new Date()) } : {}) } });
      return { runId: run.id, status: result.code === 0 ? 'succeeded' : 'failed', logPath };
    } finally { await store.close(); }
  });
}
export async function workerTick(rootInput: string) {
  const root = vaultRoot(rootInput), store = await ObjectStore.open(root);
  const dueJobs: string[] = []; const notifications: string[] = []; const now = new Date();
  try {
    const candidates = (await store.list()).filter(object => ['agent-job', 'reminder'].includes(object.type) && object.properties.enabled === true && object.properties.migrationReview !== 'pending');
    for (const object of candidates) {
      const properties = object.properties;
      const next = properties.nextRunAt || properties.at;
      if (!next) {
        if (properties.every) await store.update(object.id, { properties: { nextRunAt: nextOccurrence(String(properties.every), String(properties.timezone || ensureConfig().timezone), now) } });
        continue;
      }
      if (!Number.isFinite(Date.parse(String(next))) || Date.parse(String(next)) > now.getTime()) continue;
      if (object.type === 'agent-job') dueJobs.push(object.id);
      else await withJobLock(root, object.id, async () => {
        const current = await store.get(object.id);
        if (!current || current.properties.enabled !== true || current.properties.migrationReview === 'pending' || current.properties.lastNotifiedFor === next) return;
        notifications.push(object.name);
        const notification = process.platform === 'darwin' ? spawnSync('osascript', ['-e', 'on run argv\ndisplay notification (item 1 of argv) with title "2b"\nend run', String(properties.message || object.name)], { stdio: 'ignore', timeout: 10_000 }) : null;
        if (notification && notification.status !== 0) {
          await store.update(object.id, { properties: { status: 'failed', notificationError: notification.error?.message || 'macOS notification command failed' } });
          return;
        }
        await store.update(object.id, { properties: { lastNotifiedFor: next, lastNotifiedAt: now.toISOString(), status: 'sent', ...(properties.every ? { nextRunAt: nextOccurrence(String(properties.every), String(properties.timezone || ensureConfig().timezone), now) } : { enabled: false }) } });
      });
    }
  } finally { await store.close(); }
  const runs = [];
  for (const id of dueJobs) {
    try { runs.push(await runAgentJob(root, id, true)); } catch (error: any) { runs.push({ job: id, error: error.message }); }
  }
  return { notifications, runs };
}
export async function runWorker(root: string, once = false) {
  if (once) { console.log(JSON.stringify(await workerTick(root), null, 2)); return; }
  if (!ensureConfig().worker.enabled) throw new Error('Background worker is disabled. Set worker.enabled=true in ~/.2b/config.json after reviewing your V3 schedules.');
  console.log('2b V3 worker running locally. Only enabled, reviewed jobs can run.');
  while (true) { await workerTick(root); await new Promise(resolve => setTimeout(resolve, ensureConfig().worker.pollSeconds * 1000)); }
}
