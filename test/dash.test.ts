import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { makeStore } from './helpers.ts';
import { createProject, createTask, writeEntry } from '../src/store.ts';
import { startDashboard } from '../src/dash.ts';

test('serves state, entry detail, and files inside the store only', async () => {
  const root = makeStore();
  createProject(root, 'p', { area: 'work', title: 'Project P' });
  const failing = createTask(root, 'p', '2026-10-10-job', { every: 'hourly', run: 'command', command: 'false' });
  failing.fields['last-result'] = 'error';
  writeEntry(failing);
  fs.writeFileSync(path.join(failing.dir, 'notes.md'), 'hello');

  const server = startDashboard(root, 0);
  await new Promise(done => server.once('listening', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const state = await (await fetch(`${base}/api/state?week=2026-10-16`)).json();
    assert.deepEqual(state.week, { start: '2026-10-12', end: '2026-10-18' });
    assert.equal(state.projects[0].title, 'Project P');
    assert.equal(state.failed[0].id, 'p/2026-10-10-job');

    const detail = await (await fetch(`${base}/api/entry?id=p`)).json();
    assert.equal(detail.tasks.length, 1);
    assert.match(detail.rules, /No rules/);

    assert.equal(await (await fetch(`${base}/api/file?path=projects/p/tasks/2026-10-10-job/notes.md`)).text(), 'hello');
    assert.equal((await fetch(`${base}/api/file?path=../../etc/passwd`)).status, 404);
    assert.equal((await fetch(`${base}/api/entry?id=ghost`)).status, 404);
    assert.match(await (await fetch(base)).text(), /<title>2b<\/title>/);
  } finally {
    server.close();
  }
});
