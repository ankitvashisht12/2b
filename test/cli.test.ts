import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = path.join(import.meta.dirname, '..', 'src', 'cli.ts');

function makeRunner() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '2b-cli-'));
  return (...args: string[]) => {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', CLI, ...args], {
      encoding: 'utf8', env: { ...process.env, TWOB_HOME: root, TWOB_NO_NOTIFY: '1' },
    });
    return { code: result.status, out: result.stdout.trim(), err: result.stderr.trim() };
  };
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
