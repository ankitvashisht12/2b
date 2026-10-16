import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeStore } from './helpers.ts';
import { createProject, createTask, readEntry, setStatus } from '../src/store.ts';
import { addRule, rulesFile } from '../src/rules.ts';
import { parseEvery, syncSchedules, runTask, buildPrompt } from '../src/schedule.ts';

process.env.TWOB_NO_NOTIFY = '1';

test('parses the schedule format', () => {
  assert.deepEqual(parseEvery('daily 19:00'), [{ Hour: 19, Minute: 0 }]);
  assert.deepEqual(parseEvery('hourly'), [{ Minute: 0 }]);
  assert.equal(parseEvery('weekdays 14:00').length, 5);
  assert.deepEqual(parseEvery('mon,fri 09:30'), [{ Weekday: 1, Hour: 9, Minute: 30 }, { Weekday: 5, Hour: 9, Minute: 30 }]);
  assert.throws(() => parseEvery('every day at 7'), /daily 19:00/);
  assert.throws(() => parseEvery('daily 25:00'), /time/);
  assert.throws(() => parseEvery('funday 10:00'), /funday/);
});

test('sync writes a plist with a full environment and removes stale ones', () => {
  const root = makeStore();
  const agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), '2b-agents-'));
  createProject(root, 'ops', { area: 'personal' });
  const task = createTask(root, 'ops', 'open-dashboard', { every: 'weekdays 14:00', run: 'command', command: '2b dash --open' });
  fs.writeFileSync(path.join(agentsDir, 'com.2b.ops.stale.plist'), '');

  const result = syncSchedules(root, { agentsDir, load: false });
  const plist = fs.readFileSync(path.join(agentsDir, `com.2b.ops.${path.basename(task.dir)}.plist`), 'utf8');
  assert.deepEqual(result.removed, ['com.2b.ops.stale']);
  assert.match(plist, new RegExp(`<string>${process.execPath}</string>`));
  assert.match(plist, /<key>PATH<\/key>/);
  assert.match(plist, /<key>HOME<\/key>/);
  assert.match(plist, new RegExp(`<key>TWOB_HOME</key><string>${root}</string>`));
  assert.equal(plist.match(/<key>Weekday<\/key>/g)?.length, 5);

  setStatus(task, 'done');
  assert.equal(syncSchedules(root, { agentsDir, load: false }).removed.length, 1);
});

test('run records ok and error results with a run log', () => {
  const root = makeStore();
  createProject(root, 'ops', { area: 'personal' });
  const passing = createTask(root, 'ops', 'pass', { every: 'hourly', run: 'command', command: 'echo hello' });
  const failing = createTask(root, 'ops', 'fail', { every: 'hourly', run: 'command', command: 'echo broken >&2; exit 3' });

  assert.equal(runTask(root, passing).ok, true);
  const failedRun = runTask(root, failing);
  assert.equal(failedRun.ok, false);
  assert.match(fs.readFileSync(failedRun.logFile, 'utf8'), /broken[\s\S]*exit: 3/);

  const failedEntry = readEntry('task', 'ops', failing.dir);
  assert.equal(failedEntry.fields['last-result'], 'error');
  assert.match(String(failedEntry.fields['last-log']), /^runs\/.+\.log$/);
  assert.equal(readEntry('task', 'ops', passing.dir).fields['last-result'], 'ok');
  assert.match(fs.readFileSync(path.join(failing.dir, 'log.md'), 'utf8'), /run error \| runs\//);
});

test('agent prompt carries the rule, merged rules, and the last error', () => {
  const root = makeStore();
  createProject(root, 'ops', { area: 'personal' });
  const task = createTask(root, 'ops', 'digest', { every: 'daily 19:00', body: 'Summarize today.' });
  addRule(rulesFile(root, task), 'tsc', 'Do not run tsc.');
  task.fields['last-result'] = 'error';
  task.fields['last-log'] = 'runs/2026-10-16-190000.log';
  const prompt = buildPrompt(root, task);
  assert.match(prompt, /Summarize today\./);
  assert.match(prompt, /\(task\) \[tsc\] Do not run tsc\./);
  assert.match(prompt, /previous run failed[\s\S]*runs\/2026-10-16-190000\.log/);
});
