import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createProject, createTask, createNote, appendLog, localDate, writeEntry } from '../src/store.ts';
import { openDashboard, startDashboard } from '../src/dash.ts';

async function fixture(context: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '2b-dashboard-'));
  const agentsDir = path.join(root, 'agents');
  const project = createProject(root, 'sample', { area: 'work', title: 'Sample project' });
  const task = createTask(root, project.id, 'task', { title: 'Sample task', body: 'A useful task description with more than forty non-space characters for the reader.' });
  const job = createTask(root, project.id, 'job', { title: 'Sample job', every: 'hourly', run: 'command', command: 'true' });
  const server = startDashboard(root, 0, { agentsDir, load: false });
  await new Promise<void>(done => server.once('listening', done));
  context.after(async () => {
    await new Promise<void>(done => server.close(() => done()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const get = (route: string) => fetch(base + route);
  const post = (route: string, body: unknown, headers = { 'content-type': 'application/json', 'X-2b': '1' }) =>
    fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body) });
  return { root, agentsDir, project, task, job, port, get, post };
}

test('GET state returns summaries, range events, jobs, defaults, and legacy week', async context => {
  const { get, task, job } = await fixture(context);
  job.fields['last-result'] = 'error';
  writeEntry(job);
  appendLog(task.dir, 'updated', 'description', '2026-10-15 10:00');
  const response = await get('/api/state?from=2026-10-14&to=2026-10-16');
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.from, '2026-10-14');
  assert.equal(state.to, '2026-10-16');
  assert.equal(state.projects[0].priority, 'P3');
  assert.deepEqual(state.projects[0].taskCounts, { open: 2, done: 0, total: 2 });
  assert.equal(state.tasks.find((item: any) => item.id === task.id).hasReadme, true);
  assert.equal(state.tasks[0].priority, 'med');
  assert.equal(state.events[0].taskTitle, 'Sample task');
  assert.equal(state.jobs.length, 1);
  assert.equal(state.failed[0].id, job.id);
  assert.equal(state.trash, 0);
  const defaults = await (await get('/api/state')).json();
  assert.equal(defaults.to, localDate());
  const legacy = await (await get('/api/state?week=2026-10-16')).json();
  assert.equal(legacy.from, '2026-10-12');
  assert.equal(legacy.to, '2026-10-18');
});

test('GET entry renders safe markdown and groups registered and unregistered artifacts', async context => {
  const { get, root, task } = await fixture(context);
  fs.writeFileSync(path.join(task.dir, 'extra.md'), '# Extra\n\n<script>alert(1)</script>');
  fs.writeFileSync(path.join(task.dir, 'report.html'), 'report');
  task.fields.artifacts = [{ path: 'report.html', title: 'Report', about: 'Results', why: 'Review', added: '2026-10-16' }];
  writeEntry(task);
  const detail = await (await get('/api/entry?id=' + encodeURIComponent(task.id))).json();
  assert.match(detail.bodyHtml, /useful task/);
  assert.equal(detail.priorityLabel, 'med');
  assert.equal(detail.artifacts.markdown[0].path, path.relative(root, path.join(task.dir, 'extra.md')));
  assert.equal(detail.artifacts.html[0].about, 'Results');
  assert.equal(detail.artifacts.html[0].size, 6);
  assert.equal(detail.job, null);
  assert.ok(detail.recentEvents.length);
  assert.match(detail.rules, /No rules/);
});

test('GET render returns sanitized HTML and title', async context => {
  const { get, root } = await fixture(context);
  fs.writeFileSync(path.join(root, 'note.md'), '# Note\n\n<script>alert(1)</script>\n\n[Link](other.md)');
  const response = await get('/api/render?path=note.md');
  assert.equal(response.status, 200);
  const rendered = await response.json();
  assert.equal(rendered.title, 'Note');
  assert.ok(!rendered.html.includes('<script>'));
  assert.match(rendered.html, /api\/file\?path=/);
});

test('GET inbox includes inbox and learning notes newest first', async context => {
  const { get, root } = await fixture(context);
  createNote(root, 'inbox', 'note', 'Inbox note');
  createNote(root, 'learnings', 'lesson', 'Lesson');
  const { notes } = await (await get('/api/inbox')).json();
  assert.equal(notes.length, 2);
  assert.deepEqual(new Set(notes.map((note: any) => note.folder)), new Set(['inbox', 'learnings']));
  assert.ok(notes.every((note: any) => note.title && note.created && !path.isAbsolute(note.path)));
});

test('GET trash lists deleted recurring tasks', async context => {
  const { get, post, job } = await fixture(context);
  const deleted = await (await post('/api/delete', { id: job.id })).json();
  const trash = await (await get('/api/trash')).json();
  assert.equal(trash[0].trashId, deleted.trashId);
});

test('POST status changes status and uses isolated schedule options', async context => {
  const { post, get, job, agentsDir } = await fixture(context);
  const response = await post('/api/status', { id: job.id, status: 'paused', reason: 'Review' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.entry.status, 'paused');
  assert.ok(fs.existsSync(agentsDir));
  assert.equal((await (await get('/api/entry?id=' + job.id)).json()).fields['status-reason'], 'Review');
});

test('POST set updates permitted fields', async context => {
  const { post, task, project } = await fixture(context);
  for (const [id, field, value] of [[task.id, 'due', '2026-11-01'], [project.id, 'deadline', '2026-12-01'], [task.id, 'priority', 'high'], [task.id, 'title', 'New title']]) {
    const response = await post('/api/set', { id, field, value });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).entry[field], value);
  }
});

test('POST run runs recurring tasks and rejects normal tasks', async context => {
  const { post, get, job, task } = await fixture(context);
  assert.equal((await post('/api/run', { id: task.id })).status, 400);
  const response = await post('/api/run', { id: job.id });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).entry['last-result'], 'ok');
  const detail = await (await get('/api/entry?id=' + job.id)).json();
  assert.equal(detail.job.runs.length, 1);
});

test('POST delete moves a recurring task to trash', async context => {
  const { post, root, job, task } = await fixture(context);
  assert.equal((await post('/api/delete', { id: task.id })).status, 400);
  const result = await (await post('/api/delete', { id: job.id })).json();
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(path.join(root, '.trash', result.trashId)));
  assert.ok(!fs.existsSync(job.dir));
});

test('POST restore restores a task paused', async context => {
  const { post, job } = await fixture(context);
  const deleted = await (await post('/api/delete', { id: job.id })).json();
  const response = await post('/api/restore', { trashId: deleted.trashId });
  assert.equal(response.status, 200);
  const restored = await response.json();
  assert.equal(restored.entry.status, 'paused');
  assert.equal(restored.entry.id, job.id);
});

test('POST task copies a note body, logs its source, and retains the note', async context => {
  const { post, root, get } = await fixture(context);
  const note = createNote(root, 'inbox', 'source', 'Source');
  fs.appendFileSync(note, '\nCopied description.\n');
  const response = await post('/api/task', { project: 'sample', slug: 'converted', title: 'Converted', fromNote: path.relative(root, note) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.entry.title, 'Converted');
  const detail = await (await get('/api/entry?id=' + result.entry.id)).json();
  assert.match(detail.body, /Copied description/);
  assert.match(detail.log, /inbox/);
  assert.ok(fs.existsSync(note));
});

test('POST requires X-2b and JSON content type', async context => {
  const { post, task } = await fixture(context);
  const response = await post('/api/status', { id: task.id, status: 'done' }, { 'content-type': 'application/json' } as any);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'missing X-2b header' });
  assert.equal((await post('/api/status', {}, { 'content-type': 'text/plain', 'X-2b': '1' })).status, 400);
});

test('bad Host is forbidden for GET and POST', async context => {
  const { port } = await fixture(context);
  for (const method of ['GET', 'POST']) {
    const status = await new Promise<number | undefined>((done, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port, path: '/api/state', method, headers: { Host: `evil.example:${port}` } }, response => {
        response.resume();
        response.on('end', () => done(response.statusCode));
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(status, 403);
  }
});

test('bad fields and malformed JSON return one-line 400 errors', async context => {
  const { post, task, get } = await fixture(context);
  for (const body of [{ id: task.id, field: 'command', value: 'true' }, { id: task.id, field: 'priority', value: 'P1' }, { id: task.id, field: 'title', value: [] }, { id: task.id, field: 'title', value: 'Title', command: 'true' }]) {
    const response = await post('/api/set', body);
    assert.equal(response.status, 400);
    assert.ok(!(await response.json()).error.includes('\n'));
  }
  const response = await fetch(new URL('/api/set', (await get('/api/ping')).url), { method: 'POST', headers: { 'X-2b': '1', 'content-type': 'application/json' }, body: '{' });
  assert.equal(response.status, 400);
});

test('bad dates and ranges return 400', async context => {
  const { get, post, task } = await fixture(context);
  for (const query of ['week=bad', 'week=2026-02-30', 'from=unknown', 'from=2026-02-30', 'from=2026-10-16&to=2026-10-14', 'from=2024-01-01&to=2026-01-01', 'to=']) {
    assert.equal((await get('/api/state?' + query)).status, 400, query);
  }
  assert.equal((await post('/api/set', { id: task.id, field: 'due', value: '2026-02-30' })).status, 400);
});

test('unknown ids return 404 on reads and writes', async context => {
  const { get, post } = await fixture(context);
  assert.equal((await get('/api/entry?id=ghost')).status, 404);
  assert.equal((await get('/api/entry?id=')).status, 404);
  assert.equal((await post('/api/status', { id: 'ghost', status: 'done' })).status, 404);
});

test('POST body limit is 64 KB including multibyte text', async context => {
  const { post, task } = await fixture(context);
  assert.equal((await post('/api/set', { id: task.id, field: 'title', value: 'é'.repeat(33000) })).status, 413);
});

test('render and file reject traversal and outside symlinks; files keep sandbox headers', async context => {
  const { get, root } = await fixture(context);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), '2b-outside-'));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'secret.md'), '# Secret');
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'linked.md'));
  fs.writeFileSync(path.join(root, 'safe.html'), '<script>alert(1)</script>');
  for (const endpoint of ['/api/render', '/api/file']) {
    for (const file of ['../../etc/passwd', '../secret.md', 'linked.md', 'missing.md']) {
      assert.equal((await get(endpoint + '?path=' + encodeURIComponent(file))).status, 404);
    }
  }
  assert.equal((await get('/api/render?path=safe.html')).status, 400);
  for (const file of ['safe.html', 'missing.html']) {
    const response = await get('/api/file?path=' + file);
    assert.equal(response.headers.get('content-security-policy'), 'sandbox');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  assert.equal(await (await get('/api/file?path=safe.html')).text(), '<script>alert(1)</script>');
});

test('serves page, CSS, JavaScript, and ping with correct types', async context => {
  const { get, root } = await fixture(context);
  for (const [route, type] of [['/', 'text/html'], ['/app.css', 'text/css'], ['/app.js', 'text/javascript']]) {
    const response = await get(route);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.startsWith(type));
    assert.ok((await response.text()).length);
  }
  assert.deepEqual(await (await get('/api/ping')).json(), { ok: true, root });
});

test('chunked oversized POST returns 413 without closing the response socket', async context => {
  const { port } = await fixture(context);
  const result = await new Promise<{ status?: number; body: string }>((done, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: '/api/set', method: 'POST', headers: {
      'X-2b': '1', 'content-type': 'application/json', 'transfer-encoding': 'chunked',
    } }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => done({ status: response.statusCode, body }));
    });
    request.on('error', reject);
    request.write(' '.repeat(32768));
    request.end(' '.repeat(32769));
  });
  assert.equal(result.status, 413);
  assert.deepEqual(JSON.parse(result.body), { error: 'body exceeds 64 KB' });
});

test('status schedule failures return success with warnings after saving', async context => {
  const { post, job } = await fixture(context);
  job.fields.every = 'invalid';
  writeEntry(job);
  const response = await post('/api/status', { id: job.id, status: 'doing' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.entry.status, 'doing');
  assert.ok(result.warnings.length);
});

test('task source must remain inside inbox and cannot escape through symlinks', async context => {
  const { root, post } = await fixture(context);
  const source = createNote(root, 'learnings', 'source', 'Learning');
  fs.mkdirSync(path.join(root, 'inbox'), { recursive: true });
  fs.symlinkSync(source, path.join(root, 'inbox', 'link.md'));
  for (const fromNote of [path.relative(root, source), 'inbox/../' + path.relative(root, source), 'inbox/link.md']) {
    const response = await post('/api/task', { project: 'sample', slug: 'unsafe', title: 'Unsafe', fromNote });
    assert.ok([400, 404].includes(response.status));
  }
});


test('openDashboard refuses a port owned by another store', async context => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '2b-port-check-'));
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, root: root + '-other' }));
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>(done => server.once('listening', done));
  context.after(async () => {
    await new Promise<void>(done => server.close(() => done()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const port = (server.address() as AddressInfo).port;
  await assert.rejects(openDashboard(root, port), { message: `port ${port} is used by another 2b store or program` });
});
