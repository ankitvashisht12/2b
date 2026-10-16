import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import vm from 'node:vm';
import type { AddressInfo } from 'node:net';
import { makeStore } from './helpers.ts';
import { UserError, createProject, createTask, writeEntry } from '../src/store.ts';
import { openDashboard, startDashboard } from '../src/dash.ts';

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


test('sandboxes file responses, including missing artifacts', async () => {
  const root = makeStore();
  fs.writeFileSync(path.join(root, 'artifact.html'), '<script>fetch("/api/state")</script>');
  const server = startDashboard(root, 0);
  await new Promise(done => server.once('listening', done));
  const port = (server.address() as AddressInfo).port;
  try {
    for (const artifact of ['artifact.html', 'missing.html']) {
      const response = await fetch(`http://127.0.0.1:${port}/api/file?path=${artifact}`);
      assert.equal(response.status, artifact === 'artifact.html' ? 200 : 404);
      assert.equal(response.headers.get('content-security-policy'), 'sandbox');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
  } finally {
    server.close();
  }
});

test('rejects files reached through a symlink outside the store', async () => {
  const root = makeStore();
  const outsideRoot = makeStore();
  const outsideFile = path.join(outsideRoot, 'secret.html');
  fs.writeFileSync(outsideFile, 'private store data');
  fs.symlinkSync(outsideFile, path.join(root, 'linked.html'));
  const server = startDashboard(root, 0);
  await new Promise(done => server.once('listening', done));
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/file?path=linked.html`);
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});

test('accepts only loopback Host headers with the listening port', async () => {
  const server = startDashboard(makeStore(), 0);
  await new Promise(done => server.once('listening', done));
  const port = (server.address() as AddressInfo).port;
  try {
    for (const host of [`evil.example:${port}`, 'localhost:0', '127.0.0.1', `localhost:${port}`, `127.0.0.1:${port}`]) {
      const result = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
        const request = http.request({ hostname: '127.0.0.1', port, path: '/api/ping', headers: { Host: host } }, response => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', chunk => { body += chunk; });
          response.on('end', () => resolve({ status: response.statusCode, body }));
        });
        request.on('error', reject);
        request.end();
      });
      const allowed = host === `localhost:${port}` || host === `127.0.0.1:${port}`;
      assert.equal(result.status, allowed ? 200 : 403, host);
      if (!allowed) assert.deepEqual(JSON.parse(result.body), { error: 'forbidden host' });
    }
  } finally {
    server.close();
  }
});

test('refuses to reuse a port for another store or program', async context => {
  const root = makeStore();
  const otherRoot = makeStore();
  context.mock.method(childProcess, 'spawnSync', () => { throw new Error('browser launch must not run'); });
  context.mock.method(childProcess, 'spawn', () => { throw new Error('server launch must not run'); });
  syncBuiltinESMExports();
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, root: otherRoot }));
  });
  server.listen(0, '127.0.0.1');
  await new Promise(done => server.once('listening', done));
  const port = (server.address() as AddressInfo).port;
  try {
    await assert.rejects(openDashboard(root, port), error =>
      error instanceof UserError && error.message === `port ${port} is used by another 2b store or program`);
  } finally {
    server.close();
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('shows state response errors as page text', async () => {
  const page = fs.readFileSync(new URL('../dash/index.html', import.meta.url), 'utf8');
  const script = page.match(/<script>([\s\S]*?)<\/script>/)![1];
  const elements = new Map();
  const document = {
    getElementById(id: string) {
      if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '' });
      return elements.get(id);
    },
    addEventListener() {},
  };
  const sandbox = vm.createContext({ document, fetch: async () => ({ ok: false, text: async () => 'Store error <details>' }) });
  vm.runInContext(script.slice(0, script.lastIndexOf('load(new URLSearchParams')), sandbox);
  await vm.runInContext("load('2026-10-16')", sandbox);
  assert.ok([...elements.values()].some(element => element.textContent.includes('Store error <details>')));
});
