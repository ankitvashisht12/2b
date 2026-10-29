import { checkStore } from '../src/check.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { makeStore } from './helpers.ts';
import { createProject, createTask, readEntry, setStatus, localDate, writeEntry } from '../src/store.ts';
import { addRule, rulesFile } from '../src/rules.ts';
import { nextRun, humanSchedule, jobsOverview, parseEvery, syncSchedules, runTask, buildPrompt, labelFor, plistFor } from '../src/schedule.ts';

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
  fs.writeFileSync(path.join(agentsDir, 'com.2b.ops.stale.plist'), plistFor('com.2b.ops.stale', [], [], { TWOB_HOME: root }, ''));
  const foreignFile = path.join(agentsDir, 'com.2b.other.stale.plist');
  const foreignPlist = plistFor('com.2b.other.stale', [], [], { TWOB_HOME: root + '-other' }, '');
  fs.writeFileSync(foreignFile, foreignPlist);

  const result = syncSchedules(root, { agentsDir, load: false });
  const plist = fs.readFileSync(path.join(agentsDir, `com.2b.ops.${path.basename(task.dir)}.plist`), 'utf8');
  assert.deepEqual(result.removed, ['com.2b.ops.stale']);
  assert.deepEqual(result.failed, []);
  assert.equal(fs.readFileSync(foreignFile, 'utf8'), foreignPlist);
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
  const task = createTask(root, 'ops', 'digest', { every: 'daily 19:00', body: '-Summarize today.' });
  task.body = '-Summarize today.';
  addRule(rulesFile(root, task), 'tsc', 'Do not run tsc.');
  task.fields['last-result'] = 'error';
  task.fields['last-log'] = 'runs/2026-10-16-190000.log';
  const prompt = buildPrompt(root, task);
  assert.ok(prompt.startsWith(
    `You run as the recurring 2b task "${task.id}". Today is ${localDate()}. Use the 2b CLI for every change to the store.\n\n-Summarize today.\n\nRules:\n`,
  ));
  assert.match(prompt, /\(task\) \[tsc\] Do not run tsc\./);
  assert.match(prompt, /previous run failed[\s\S]*runs\/2026-10-16-190000\.log/);
});

test('sync reports invalid schedules and continues with valid tasks', () => {
  const root = makeStore();
  const agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), '2b-agents-'));
  createProject(root, 'ops', { area: 'personal' });
  const invalid = createTask(root, 'ops', 'invalid', { every: 'daily 25:00', body: 'Check status.' });
  const valid = createTask(root, 'ops', 'valid', { every: 'hourly', body: 'Check status.' });
  const result = syncSchedules(root, { agentsDir, load: false });
  assert.deepEqual(result.written, [labelFor(valid.id)]);
  assert.deepEqual(result.failed, [{
    label: labelFor(invalid.id), reason: 'schedule "daily 25:00" has an invalid time',
  }]);
});

for (const retrySucceeds of [false, true]) {
  test(`sync retries bootstrap and reports ${retrySucceeds ? 'success' : 'stderr failure'}`, context => {
    const root = makeStore();
    const agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), '2b-agents-'));
    createProject(root, 'ops', { area: 'personal' });
    const task = createTask(root, 'ops', 'retry', { every: 'hourly', body: 'Check status.' });
    const label = labelFor(task.id);
    let attempts = 0;
    context.mock.method(os, 'homedir', () => root);
    const wait = context.mock.method(Atomics, 'wait', () => 'timed-out');
    context.mock.method(childProcess, 'spawnSync', (command, args, options) => {
      assert.equal(command, 'launchctl');
      assert.equal(args[0], 'bootstrap');
      assert.equal(args[2], path.join(agentsDir, `${label}.plist`));
      assert.equal(options.encoding, 'utf8');
      attempts += 1;
      const ok = retrySucceeds && attempts === 2;
      return { status: ok ? 0 : 5, stderr: ok ? '' : 'bootstrap denied\n' };
    });
    syncBuiltinESMExports();
    context.after(() => {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const result = syncSchedules(root, { agentsDir, load: true });
    assert.equal(attempts, 2);
    assert.equal(wait.mock.callCount(), 1);
    assert.equal(wait.mock.calls[0].arguments[3], 1000);
    assert.deepEqual(result.written, retrySucceeds ? [label] : []);
    assert.deepEqual(result.failed, retrySucceeds ? [] : [{ label, reason: 'bootstrap denied' }]);
    if (!retrySucceeds) {
      assert.equal(fs.existsSync(path.join(agentsDir, `${label}.plist`)), false);
      const nextResult = syncSchedules(root, { agentsDir, load: true });
      assert.deepEqual(nextResult.written, []);
      assert.deepEqual(nextResult.failed, [{ label, reason: 'bootstrap denied' }]);
      assert.equal(attempts, 4);
      assert.equal(fs.existsSync(path.join(agentsDir, `${label}.plist`)), false);
    }
  });
}

test('run kills a command that ignores TERM within the timeout', () => {
  const root = makeStore();
  createProject(root, 'ops', { area: 'personal' });
  const task = createTask(root, 'ops', 'timeout', {
    every: 'hourly', run: 'command', command: 'trap "" TERM; sleep 5',
  });
  const started = performance.now();
  const result = runTask(root, task, { timeoutMs: 300 });
  assert.equal(result.ok, false);
  assert.ok(performance.now() - started < 3000);
});

test('run keeps large output within the 64 MiB buffer', () => {
  const root = makeStore();
  createProject(root, 'ops', { area: 'personal' });
  const task = createTask(root, 'ops', 'output', {
    every: 'hourly', run: 'command', command: 'head -c 2097152 /dev/zero',
  });
  const result = runTask(root, task);
  assert.equal(result.ok, true);
  assert.ok(fs.statSync(result.logFile).size > 2097152);
});

test('run preserves logs when timestamps collide', context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-16T10:00:00.123Z').getTime() });
  const root = makeStore();
  createProject(root, 'ops', { area: 'personal' });
  const task = createTask(root, 'ops', 'collision', {
    every: 'hourly', run: 'command', command: 'echo original',
  });
  const first = runTask(root, task);
  const firstLog = fs.readFileSync(first.logFile, 'utf8');
  task.fields.command = 'echo second';
  const second = runTask(root, task);
  task.fields.command = 'echo third';
  const third = runTask(root, task);
  assert.match(first.logFile, /-123\.log$/);
  assert.equal(second.logFile, first.logFile.replace(/\.log$/, '-1.log'));
  assert.equal(third.logFile, first.logFile.replace(/\.log$/, '-2.log'));
  assert.equal(fs.readFileSync(first.logFile, 'utf8'), firstLog);
  assert.match(fs.readFileSync(second.logFile, 'utf8'), /second/);
  assert.match(fs.readFileSync(third.logFile, 'utf8'), /third/);
});


test('claude agent allows only the CLI and read tools', context => {
  const root = makeStore();
  createProject(root, 'ops', { area: 'personal' });
  const task = createTask(root, 'ops', 'agent', { every: 'hourly', agent: 'claude', body: 'Check status.' });
  context.mock.method(childProcess, 'spawnSync', (command, args) => {
    assert.equal(command, 'claude');
    assert.deepEqual(args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--add-dir')), ['Bash(2b:*)', 'Read', 'Glob', 'Grep']);
    assert.ok(!args.join(' ').includes('sqlite3'));
    return { status: 0, stdout: '', stderr: '' };
  });
  syncBuiltinESMExports();
  context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.equal(runTask(root, task).ok, true);
});

test('empty command fails without launching a shell and check reports empty jobs', context => {
  const root = makeStore();
  createProject(root, 'ops', { area: 'personal' });
  context.mock.method(childProcess, 'spawnSync', () => { throw new Error('must not launch'); });
  syncBuiltinESMExports();
  context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
  for (const command of [null, '', '   ']) {
    const task = createTask(root, 'ops', `empty-${command === null ? 'null' : command.length}`, { every: 'hourly', run: 'command', command: 'true' });
    task.fields.command = command;
    writeEntry(task);
    const result = runTask(root, task);
    assert.equal(result.ok, false);
    assert.match(fs.readFileSync(result.logFile, 'utf8'), /no command set/);
    assert.equal(readEntry('task', 'ops', task.dir).fields['last-result'], 'error');
  }
  const agent = createTask(root, 'ops', 'empty-agent', { every: 'hourly', body: 'Check.' });
  agent.body = '  \n';
  writeEntry(agent);
  const problems = checkStore(root).join('\n');
  assert.match(problems, /no command set/);
  assert.match(problems, /empty-agent.*empty body/);
});


test('next run uses local daily, weekday, hourly, and multi-day intervals', () => {
  const local = (text: string) => new Date(text);
  for (const [spec, from, expected] of [
    ['daily 19:00', '2026-10-23T19:00:00', '2026-10-24T19:00:00'],
    ['weekdays 14:00', '2026-10-23T15:00:00', '2026-10-26T14:00:00'],
    ['hourly', '2026-10-23T15:25:30', '2026-10-23T16:00:00'],
    ['mon,fri 10:00', '2026-10-23T11:00:00', '2026-10-26T10:00:00'],
    ['sun 10:00', '2026-10-24T11:00:00', '2026-10-25T10:00:00'],
  ]) assert.equal(nextRun(parseEvery(spec), local(from)).getTime(), local(expected).getTime());
  assert.deepEqual(['daily 19:00', 'weekdays 14:00', 'mon,fri 10:00', 'hourly'].map(humanSchedule),
    ['Daily 19:00', 'Weekdays 14:00', 'Mon, Fri 10:00', 'Hourly']);
});

for (const scenario of [
  {
    name: 'stays after the start time in the repeated daylight saving hour',
    spec: 'hourly', from: '2026-11-01T01:15:30-05:00', expected: '2026-11-01T02:00:00-05:00',
  },
  {
    name: 'finds the next week when daylight saving skips the scheduled time',
    spec: 'sun 02:30', from: '2026-03-02T00:00:00-05:00', expected: '2026-03-15T02:30:00-04:00',
  },
]) {
  test(`next run ${scenario.name}`, () => {
    const scheduleModule = new URL('../src/schedule.ts', import.meta.url).href;
    const result = childProcess.spawnSync(process.execPath, [
      '--experimental-strip-types', '--no-warnings', '--input-type=module', '--eval',
      `import { nextRun, parseEvery } from ${JSON.stringify(scheduleModule)};
       const from = new Date(${JSON.stringify(scenario.from)});
       const next = nextRun(parseEvery(${JSON.stringify(scenario.spec)}), from);
       console.log(JSON.stringify({ from: from.getTime(), next: next.getTime(), offset: from.getTimezoneOffset() }));`,
    ], { encoding: 'utf8', timeout: 3000, env: { ...process.env, TZ: 'America/New_York' } });
    assert.equal(result.status, 0, result.stderr);
    const actual = JSON.parse(result.stdout);
    assert.equal(actual.offset, 300);
    assert.ok(actual.next > actual.from, 'next run must be after the start time');
    assert.equal(actual.next, new Date(scenario.expected).getTime());
  });
}

test('jobs overview scopes loaded plists and returns limited newest run history', () => {
  const root = makeStore();
  const agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), '2b-agents-'));
  createProject(root, 'ops', { area: 'work' });
  const task = createTask(root, 'ops', 'history', { every: 'hourly', run: 'command', command: 'true', priority: 'high' });
  syncSchedules(root, { agentsDir, load: false });
  fs.mkdirSync(path.join(task.dir, 'runs'));
  for (let number = 1; number <= 22; number += 1) {
    fs.writeFileSync(path.join(task.dir, 'runs', `2026-10-${String(number).padStart(2, '0')}-100000.log`),
      number === 22 ? 'unfinished' : `exit: ${number === 21 ? 3 : 0}\n`);
  }
  let job = jobsOverview(root, { agentsDir })[0];
  assert.equal(job.loaded, true);
  assert.equal(job.schedule, 'Hourly');
  assert.equal(job.priority, 'high');
  assert.match(job.nextRun!, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(job.runs.length, 20);
  assert.equal(job.runs[0].ok, null);
  assert.equal(job.runs[1].ok, false);
  assert.equal(job.runs[2].ok, true);
  assert.equal(job.runs[0].at, '2026-10-22 10:00');
  setStatus(task, 'paused', 'maintenance');
  fs.writeFileSync(path.join(agentsDir, `${labelFor(task.id)}.plist`), plistFor(labelFor(task.id), [], [], { TWOB_HOME: root + '-foreign' }, ''));
  job = jobsOverview(root, { agentsDir })[0];
  assert.equal(job.loaded, false);
  assert.equal(job.nextRun, null);
});

test('Codex is the default runner and missing agent metadata uses Codex', context => {
  const root = makeStore();
  createProject(root, 'ops', { area: 'personal' });
  const task = createTask(root, 'ops', 'codex-default', { every: 'hourly', body: 'Summarize the available notes.' });
  assert.equal(task.fields.agent, 'codex');
  delete task.fields.agent;
  writeEntry(task);
  context.mock.method(childProcess, 'spawnSync', (command, args) => {
    assert.equal(command, 'codex');
    assert.deepEqual(args.slice(0, 6), ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-C', root]);
    assert.match(args[6], /Summarize the available notes/);
    return { status: 0, stdout: 'Saved.', stderr: '' };
  });
  syncBuiltinESMExports();
  context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.equal(runTask(root, task).ok, true);
});
