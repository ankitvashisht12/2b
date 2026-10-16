import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createTask, writeEntry } from '../src/store.ts';

const CLI = path.join(import.meta.dirname, '..', 'src', 'cli.ts');

function makeRunner(environment: NodeJS.ProcessEnv = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '2b-cli-'));
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', CLI, ...args], {
      encoding: 'utf8', timeout: 3000,
      env: { ...process.env, ...environment, HOME: root, TWOB_HOME: root, TWOB_NO_NOTIFY: '1', TWOB_DEBUG: environment.TWOB_DEBUG ?? '' },
    });
    return { code: result.status, out: result.stdout.trim(), err: result.stderr.trim() };
  };
  return Object.assign(run, { root });
}

test('end to end: init, create, status, list, rules', () => {
  const twob = makeRunner();
  assert.match(twob('ls').err, /run "2b init"/);
  assert.equal(twob('init').code, 0);
  assert.equal(twob('new', 'project', 'search-ranking', '--area', 'work', '--title', 'Search ranking').code, 0);
  assert.equal(twob('new', 'task', 'search-ranking', '2026-10-15-limiter-recovery', '--due', '2026-10-20').code, 0);

  const refused = twob('status', 'search-ranking', 'paused');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /needs --reason/);
  assert.equal(twob('status', 'search-ranking', 'paused', '--reason', 'Waiting for feedback').code, 0);

  const tasks = JSON.parse(twob('ls', '--tasks', '--json').out);
  assert.equal(tasks[0].id, 'search-ranking/2026-10-15-limiter-recovery');
  assert.equal(twob('ls', '--due-before', '2026-10-19', '--json').out, '[]');
  assert.match(twob('ls').out, /paused: Waiting for feedback/);

  assert.equal(twob('rule', 'add', 'global', '--key', 'tsc', 'Run tsc one at a time.').code, 0);
  assert.equal(twob('rule', 'add', 'limiter', '--key', 'tsc', 'Do not run tsc.').code, 0);
  assert.match(twob('rules', 'limiter').out, /\(task\) \[tsc\] Do not run tsc\./);
  assert.doesNotMatch(twob('rules', 'limiter').out, /one at a time/);

  assert.match(twob('show', 'limiter').out, /Rules:/);
  assert.equal(twob('check').out, 'No problems.');
  assert.match(twob('nope').err, /unknown command/);
});


test('bad inputs return one error line', async context => {
  const twob = makeRunner();
  assert.equal(twob('init').code, 0);
  const missingPlan = path.join(twob.root, 'missing.json');
  const invalidPlan = path.join(twob.root, 'invalid.json');
  fs.writeFileSync(invalidPlan, '{');
  const cases = [
    { args: ['show'], message: 'missing project or task (see "2b help")' },
    { args: ['nope'], message: 'unknown command "nope" (see "2b help")' },
    { args: ['ls', '--unknown'], message: 'Unknown option' },
    { args: ['import', 'apply', missingPlan], message: `cannot read plan ${missingPlan}:` },
    { args: ['import', 'apply', invalidPlan], message: `cannot read plan ${invalidPlan}:` },
    ...['abc', '0', '65536', '1.5', '-1', ''].map(port => ({
      args: ['dash', `--port=${port}`], message: '--port must be an integer from 1 to 65535',
    })),
    { args: ['ls', '--status', 'todo'], message: 'active, paused, on-hold, done, archived' },
    { args: ['ls', '--tasks', '--status', 'active'], message: 'todo, doing, blocked, done, dropped' },
    { args: ['ls', '--due-before', '+1d', '--status', 'active'], message: 'todo, doing, blocked, done, dropped' },
  ];
  for (const { args, message } of cases) {
    await context.test(args.join(' '), () => {
      const result = twob(...args);
      assert.equal(result.code, 1);
      assert.match(result.err, /^2b: [^\r\n]+$/);
      assert.ok(result.err.includes(message), result.err);
      assert.equal(result.out, '');
    });
  }
});

test('read commands return valid JSON', () => {
  const twob = makeRunner();
  assert.equal(twob('init').code, 0);
  assert.equal(twob('new', 'project', 'sample', '--area', 'work').code, 0);
  assert.equal(twob('new', 'task', 'sample', 'example').code, 0);
  for (const args of [
    ['ls'], ['ls', '--tasks'], ['show', 'sample'], ['week'],
    ['rules'], ['find', 'sample'], ['check'], ['schedule', 'ls'],
  ]) {
    const result = twob(...args, '--json');
    assert.equal(result.code, 0, `${args.join(' ')}: ${result.err}`);
    assert.equal(result.err, '');
    assert.doesNotThrow(() => JSON.parse(result.out), args.join(' '));
  }
});

test('help remains available and stacks require TWOB_DEBUG', () => {
  const twob = makeRunner();
  for (const args of [[], ['help'], ['--help']]) {
    const result = twob(...args);
    assert.equal(result.code, 0);
    assert.match(result.out, /^2b — second brain/);
    assert.equal(result.err, '');
  }
  const debug = makeRunner({ TWOB_DEBUG: '1' });
  assert.equal(debug('init').code, 0);
  const result = debug('import', 'apply', path.join(debug.root, 'missing.json'));
  assert.equal(result.code, 1);
  assert.match(result.err, /^2b: cannot read plan /);
  assert.match(result.err, /\n\s+at /);
});

test('import apply lists skipped symbolic links', () => {
  const twob = makeRunner();
  assert.equal(twob('init').code, 0);
  const source = fs.mkdtempSync(path.join(os.tmpdir(), '2b-cli-source-'));
  fs.writeFileSync(path.join(source, 'note.txt'), 'Keep this.');
  const link = path.join(source, 'link.txt');
  fs.symlinkSync(path.join(source, 'note.txt'), link);
  const planFile = path.join(twob.root, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify({ projects: [], items: [{ source, inbox: '2026-10-16-copy' }] }));
  const result = twob('import', 'apply', planFile);
  assert.equal(result.code, 0, result.err);
  assert.ok(result.out.includes(`\nLinks skipped: 1\n  ${link}`), result.out);
});

test('schedule sync lists failures and exits with code 1', () => {
  const twob = makeRunner();
  assert.equal(twob('init').code, 0);
  assert.equal(twob('new', 'project', 'ops', '--area', 'work').code, 0);
  const task = createTask(twob.root, 'ops', 'job', { every: 'hourly', run: 'command', command: 'true' });
  task.fields.status = 'doing';
  writeEntry(task);
  const fakeBin = path.join(twob.root, 'fake-bin');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'launchctl'), '#!/bin/sh\necho "test launchctl failure" >&2\nexit 7\n', { mode: 0o755 });
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', CLI, 'schedule', 'sync'], {
    encoding: 'utf8', timeout: 3000,
    env: { ...process.env, HOME: twob.root, TWOB_HOME: twob.root, TWOB_DEBUG: '', TWOB_NO_NOTIFY: '1', PATH: fakeBin },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Failed: com\.2b\.ops\.[^\n]+ — .+/);
});


test('unexpected file errors also return one error line', () => {
  const twob = makeRunner();
  assert.equal(twob('init').code, 0);
  assert.equal(twob('new', 'project', 'broken', '--area', 'work').code, 0);
  const logFile = path.join(twob.root, 'projects', 'broken', 'log.md');
  fs.unlinkSync(logFile);
  fs.mkdirSync(logFile);
  const result = twob('show', 'broken');
  assert.equal(result.code, 1);
  assert.match(result.err, /^2b: [^\r\n]+$/);
  assert.match(result.err, /EISDIR/);
});
