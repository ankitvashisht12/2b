import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import type { AddressInfo } from 'node:net';
import { createProject, createTask, createNote, appendLog, localDate, writeEntry } from '../src/store.ts';
import { openDashboard, startDashboard } from '../src/dash.ts';

async function fixture(context: TestContext, options: { bodyTimeoutMs?: number; startRun?: (taskId: string) => void } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '2b-dashboard-'));
  const agentsDir = path.join(root, 'agents');
  const project = createProject(root, 'sample', { area: 'work', title: 'Sample project' });
  const task = createTask(root, project.id, 'task', { title: 'Sample task', body: 'A useful task description with more than forty non-space characters for the reader.' });
  const job = createTask(root, project.id, 'job', { title: 'Sample job', every: 'hourly', run: 'command', command: 'true' });
  const server = startDashboard(root, 0, { agentsDir, load: false, startRun: () => {}, ...options });
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

test('GET state reads each entry and log once and refreshes on the next request', async context => {
  const { get, root, task, project } = await fixture(context);
  const reads = new Map<string, number>();
  const readFile = fs.readFileSync;
  context.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    const file = String(args[0]);
    if (file.startsWith(root + path.sep)) reads.set(file, (reads.get(file) ?? 0) + 1);
    return Reflect.apply(readFile, fs, args);
  });
  assert.equal((await get('/api/state')).status, 200);
  for (const [file, count] of reads) assert.equal(count, 1, file);
  assert.equal(reads.get(path.join(project.dir, 'readme.md')), 1);
  assert.equal(reads.get(path.join(task.dir, 'readme.md')), 1);
  assert.equal(reads.get(path.join(task.dir, 'log.md')), 1);
  task.fields.title = 'Updated task';
  writeEntry(task);
  appendLog(task.dir, 'updated', 'New activity', '2030-01-01 12:00');
  const state = await (await get('/api/state')).json();
  assert.equal(state.tasks.find((entry: any) => entry.id === task.id).title, 'Updated task');
  assert.equal(state.projects[0].lastActivity, '2030-01-01 12:00');
});

test('GET state artifact counts match details for nested, registered, and linked files', async context => {
  const { get, root, task } = await fixture(context);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), '2b-artifact-outside-'));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'outside.md'), '# Outside');
  fs.mkdirSync(path.join(task.dir, 'nested'));
  fs.mkdirSync(path.join(task.dir, 'runs'));
  fs.writeFileSync(path.join(task.dir, 'nested', 'report.csv'), 'value\n1');
  fs.writeFileSync(path.join(task.dir, 'nested', 'readme.md'), '# Excluded');
  fs.writeFileSync(path.join(task.dir, 'runs', 'output.txt'), 'Excluded');
  fs.writeFileSync(path.join(task.dir, 'report.html'), 'Report');
  fs.symlinkSync(path.join(task.dir, 'report.html'), path.join(task.dir, 'linked.html'));
  fs.symlinkSync(outside, path.join(task.dir, 'outside'));
  fs.symlinkSync(path.join(outside, 'outside.md'), path.join(task.dir, 'outside.md'));
  task.fields.artifacts = ['report.html', 'report.html', './report.html', 'linked.html', 'missing.md',
    'outside.md', 'outside/outside.md', '../outside.md', 'runs/output.txt', 'nested/readme.md']
    .map(file => ({ path: file, title: file, about: '', why: '', added: '' }));
  writeEntry(task);
  const detail = await (await get('/api/entry?id=' + encodeURIComponent(task.id))).json();
  const expected = Object.values(detail.artifacts).reduce((total: number, group: any) => total + group.length, 0);
  assert.equal(expected, 4);
  const state = await (await get('/api/state')).json();
  assert.equal(state.tasks.find((entry: any) => entry.id === task.id).artifactCount, expected);
  assert.ok(!JSON.stringify(state).includes(path.join(outside, 'outside.md')));
});

test('GET state responds within 500 ms for 50 projects with 20 tasks each', async context => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '2b-dashboard-performance-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let projectNumber = 0; projectNumber < 50; projectNumber += 1) {
    const project = createProject(root, `project-${projectNumber}`, { area: 'work' });
    for (let taskNumber = 0; taskNumber < 20; taskNumber += 1) {
      const task = createTask(root, project.id, `task-${taskNumber}`, { due: '2030-01-01' });
      for (let artifactNumber = 0; artifactNumber < 13; artifactNumber += 1) {
        fs.writeFileSync(path.join(task.dir, `artifact-${artifactNumber}.md`), '# Artifact');
      }
    }
  }
  const server = startDashboard(root, 0, { agentsDir: path.join(root, 'agents'), load: false });
  await new Promise<void>(done => server.once('listening', done));
  context.after(() => new Promise<void>(done => server.close(() => done())));
  const port = (server.address() as AddressInfo).port;
  const stateUrl = `http://127.0.0.1:${port}/api/state`;
  const warmupResponse = await fetch(stateUrl);
  await warmupResponse.json();
  assert.equal(warmupResponse.status, 200);
  const samples: number[] = [];
  for (let sampleNumber = 0; sampleNumber < 7; sampleNumber += 1) {
    const started = performance.now();
    const response = await fetch(stateUrl);
    const state = await response.json();
    samples.push(performance.now() - started);
    assert.equal(response.status, 200);
    assert.equal(state.projects.length, 50);
    assert.equal(state.tasks.length, 1000);
    assert.ok(state.projects.every((project: any) => project.taskCounts.total === 20 && project.nextDue === '2030-01-01'));
    assert.ok(state.tasks.every((task: any) => task.artifactCount === 13));
  }
  samples.sort((left, right) => left - right);
  const median = samples[3];
  context.diagnostic(`/api/state median: ${median.toFixed(1)} ms`);
  assert.ok(median < 500, `/api/state median was ${median.toFixed(1)} ms; expected less than 500 ms`);
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

test('POST run starts recurring tasks without waiting and rejects normal tasks', async context => {
  const startedTasks: string[] = [];
  const { post, get, job, task } = await fixture(context, { startRun: taskId => { startedTasks.push(taskId); } });
  job.fields.command = 'sleep 5';
  writeEntry(job);
  assert.equal((await post('/api/run', { id: task.id })).status, 400);
  const startedAt = Date.now();
  const response = await post('/api/run', { id: 'job' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, started: true });
  assert.ok(Date.now() - startedAt < 1000);
  assert.deepEqual(startedTasks, [job.id]);
  assert.equal((await get('/api/ping')).status, 200);
  const detail = await (await get('/api/entry?id=' + job.id)).json();
  assert.equal(detail.job.runs.length, 0);
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

test('task sources accept learnings and reject paths outside both note folders', async context => {
  const { root, post, get } = await fixture(context);
  const source = createNote(root, 'learnings', 'source', 'Learning');
  fs.appendFileSync(source, '\nLearning description.\n');
  const response = await post('/api/task', { project: 'sample', slug: 'learning', title: 'Learning', fromNote: path.relative(root, source) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.match((await (await get('/api/entry?id=' + result.entry.id)).json()).body, /Learning description/);
  assert.ok(fs.existsSync(source));
  fs.mkdirSync(path.join(root, 'inbox'), { recursive: true });
  const outside = path.join(root, 'outside.md');
  fs.writeFileSync(outside, '# Outside');
  fs.symlinkSync(outside, path.join(root, 'inbox', 'link.md'));
  fs.symlinkSync(outside, path.join(root, 'learnings', 'link.md'));
  for (const fromNote of ['outside.md', 'inbox/../outside.md', 'inbox/link.md', 'learnings/link.md']) {
    const response = await post('/api/task', { project: 'sample', slug: 'unsafe', title: 'Unsafe', fromNote });
    assert.ok([400, 404].includes(response.status));
  }
});

test('stalled POST bodies return 408 JSON and close the connection', { timeout: 3000 }, async context => {
  const { port, get } = await fixture(context, { bodyTimeoutMs: 200 });
  const startedAt = Date.now();
  const result = await new Promise<{ status?: number; body: string }>((done, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: '/api/set', method: 'POST', headers: {
      'X-2b': '1', 'content-type': 'application/json', 'content-length': '100',
    } }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => done({ status: response.statusCode, body }));
    });
    context.after(() => request.destroy());
    request.on('error', reject);
    request.setTimeout(2000, () => request.destroy(new Error('server did not time out the request body')));
    request.write('{"id":');
  });
  assert.equal(result.status, 408);
  assert.deepEqual(JSON.parse(result.body), { error: 'request body timed out' });
  assert.ok(Date.now() - startedAt < 2000);
  assert.equal((await get('/api/ping')).status, 200);
});

for (const linkedTarget of ['readme.md', 'log.md', 'rules.md', 'folder']) {
  test(`entry reads and writes reject an outside ${linkedTarget} symlink`, async context => {
    const { job, get, post } = await fixture(context);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), '2b-entry-outside-'));
    context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    const outsideTask = path.join(outside, 'job');
    fs.cpSync(job.dir, outsideTask, { recursive: true });
    fs.writeFileSync(path.join(outsideTask, 'rules.md'), '# Rules\n\n- Outside rule\n');
    const originalFiles = new Map(['readme.md', 'log.md', 'rules.md'].map(file => [file, fs.readFileSync(path.join(outsideTask, file))]));
    if (linkedTarget === 'folder') {
      fs.rmSync(job.dir, { recursive: true });
      fs.symlinkSync(outsideTask, job.dir);
    } else {
      fs.rmSync(path.join(job.dir, linkedTarget), { force: true });
      fs.symlinkSync(path.join(outsideTask, linkedTarget), path.join(job.dir, linkedTarget));
    }
    const requests = [
      () => get('/api/state'),
      () => get('/api/entry?id=' + job.id),
      () => post('/api/status', { id: job.id, status: 'paused', reason: 'Review' }),
      () => post('/api/set', { id: job.id, field: 'title', value: 'Changed' }),
      () => post('/api/run', { id: job.id }),
      () => post('/api/delete', { id: job.id }),
    ];
    for (const send of requests) {
      const response = await send();
      assert.equal(response.status, 404);
      assert.deepEqual(Object.keys(await response.json()), ['error']);
      for (const [file, contents] of originalFiles) assert.deepEqual(fs.readFileSync(path.join(outsideTask, file)), contents);
    }
    assert.ok(!fs.existsSync(path.join(outsideTask, 'runs')));
  });

  test(`restore rejects an outside ${linkedTarget} symlink`, async context => {
    const { root, job, post } = await fixture(context);
    const deleted = await (await post('/api/delete', { id: job.id })).json();
    const trashedTask = path.join(root, '.trash', deleted.trashId, 'task');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), '2b-restore-outside-'));
    context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    const outsideTask = path.join(outside, 'job');
    fs.cpSync(trashedTask, outsideTask, { recursive: true });
    fs.writeFileSync(path.join(outsideTask, 'rules.md'), '# Rules\n');
    const originalFiles = new Map(['readme.md', 'log.md', 'rules.md'].map(file => [file, fs.readFileSync(path.join(outsideTask, file))]));
    const target = linkedTarget === 'folder' ? trashedTask : path.join(trashedTask, linkedTarget);
    fs.rmSync(target, { recursive: true, force: true });
    fs.symlinkSync(linkedTarget === 'folder' ? outsideTask : path.join(outsideTask, linkedTarget), target);
    const response = await post('/api/restore', { trashId: deleted.trashId });
    assert.equal(response.status, 404);
    assert.deepEqual(Object.keys(await response.json()), ['error']);
    for (const [file, contents] of originalFiles) assert.deepEqual(fs.readFileSync(path.join(outsideTask, file)), contents);
  });
}

test('state accepts missing metadata and rejects dangling metadata symlinks', async context => {
  const { root, job, get } = await fixture(context);
  const log = path.join(job.dir, 'log.md');
  fs.unlinkSync(log);
  assert.equal((await get('/api/state')).status, 200);
  fs.symlinkSync(path.join(root, 'missing.md'), log);
  assert.equal((await get('/api/state')).status, 404);
});

test('task creation rejects symlinked project metadata and new task parents', async context => {
  const { project, post } = await fixture(context);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), '2b-create-outside-'));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const outsideFile = path.join(outside, 'readme.md');
  const original = fs.readFileSync(path.join(project.dir, 'readme.md'));
  fs.writeFileSync(outsideFile, original);
  for (const file of ['readme.md', 'log.md', 'rules.md']) {
    const target = path.join(project.dir, file);
    const previous = fs.existsSync(target) ? fs.readFileSync(target) : null;
    fs.rmSync(target, { force: true });
    fs.symlinkSync(outsideFile, target);
    assert.equal((await post('/api/task', { project: project.id, slug: 'unsafe', title: 'Unsafe' })).status, 404);
    assert.deepEqual(fs.readFileSync(outsideFile), original);
    fs.unlinkSync(target);
    if (previous) fs.writeFileSync(target, previous);
  }
  fs.rmSync(path.join(project.dir, 'tasks'), { recursive: true });
  fs.symlinkSync(outside, path.join(project.dir, 'tasks'));
  assert.equal((await post('/api/task', { project: project.id, slug: 'unsafe', title: 'Unsafe' })).status, 404);
  assert.deepEqual(fs.readdirSync(outside), ['readme.md']);
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

test('dashboard capture adapters preserve content and reject invalid destinations', async context => {
  const { post, get } = await fixture(context);
  assert.equal((await post('/api/project', { slug: 'direct', title: 'Direct capture', area: 'personal', body: 'Project context' })).status, 200);
  assert.equal((await post('/api/capture', { slug: 'thought', title: 'A thought', folder: 'inbox', body: 'Body-only lighthouse keyword' })).status, 200);
  const inbox = await (await get('/api/inbox')).json();
  assert.match(inbox.notes.find((note: any) => note.title === 'A thought').body, /lighthouse/);
  assert.equal((await post('/api/capture', { slug: 'unsafe', title: 'Unsafe', folder: '../projects', body: 'No write' })).status, 400);
  assert.equal((await post('/api/project', { slug: '../unsafe', title: 'Unsafe', area: 'personal' })).status, 400);
  assert.equal((await post('/api/task', { project: 'direct', slug: 'direct-task', title: 'Direct task', body: 'Task context' })).status, 200);
});

test('capture rejects exact note target symlinks and jobs reject invalid schedules before writes', async context => {
  const { root, project, post } = await fixture(context);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), '2b-outside-'));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'inbox'), { recursive: true });
  for (const existing of [false, true]) {
    const slug = existing ? 'outside-existing' : 'outside-missing';
    const target = path.join(outside, slug + '.md');
    if (existing) fs.writeFileSync(target, 'untouched');
    fs.symlinkSync(target, path.join(root, 'inbox', `${localDate()}-${slug}.md`));
    const response = await post('/api/capture', { folder: 'inbox', slug, title: 'Unsafe', body: 'Must not write' });
    assert.equal(response.status, 404);
    assert.equal(fs.existsSync(target), existing);
    if (existing) assert.equal(fs.readFileSync(target, 'utf8'), 'untouched');
  }
  const before = fs.readdirSync(path.join(project.dir, 'tasks'));
  const response = await post('/api/task', { project: project.id, slug: 'invalid-job', title: 'Invalid job', every: 'invalid schedule' });
  assert.equal(response.status, 400);
  assert.deepEqual(fs.readdirSync(path.join(project.dir, 'tasks')), before);
});
