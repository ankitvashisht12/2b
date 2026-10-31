import test, { after } from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startDashboard } from '../src/v3/server.ts';
import { vaultRoot, contentPath, reconcileFiles } from '../src/v3/files.ts';
import { metadataDirectory, loadConfig, ensureConfig } from '../src/v3/config.ts';
import { nextOccurrence, runAgentJob, workerTick } from '../src/v3/worker.ts';
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), '2bv3-app-')));
process.env.TWOB_APP_HOME = path.join(temporary, 'app');

test('dashboard persists typed capture, content, relations and custom schema, and rejects unsafe requests', async () => {
  const root = path.join(temporary, 'vault');
  const { server, port, store } = await startDashboard(root, 0);
  const url = `http://127.0.0.1:${port}`;
  const request = async (route: string, body?: unknown, method = 'POST') => {
    const response = await fetch(url + route, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { response, data: await response.json() };
  };
  try {
    const capture = await request('/api/objects', { type: 'note', name: 'A reusable insight', properties: { processingState: 'inbox', sourceMetadata: { detailOnly: true } }, body: '# Insight\nKeep context linked.' });
    assert.equal(capture.response.status, 201);
    assert.ok(capture.data.path.endsWith('.md'));
    assert.match(fs.readFileSync(path.join(root, capture.data.path), 'utf8'), /Keep context/);
    const person = await request('/api/objects', { type: 'person', name: 'A person' });
    const relation = await request('/api/relationships', { from: capture.data.id, kind: 'mentions', to: person.data.id });
    assert.equal(relation.response.status, 201);
    await store.upsert({ id: 'bulk-startup-fixture', type: 'artifact', name: 'Background file', description: '', properties: {}, tags: [], path: null, createdAt: capture.data.createdAt, modifiedAt: capture.data.modifiedAt });
    const bulkRelation = await store.relate(capture.data.id, 'references', 'bulk-startup-fixture');
    const startup = await request('/api/startup', undefined, 'GET');
    assert.equal(startup.response.status, 200);
    assert.equal(startup.data.partial, true);
    assert.equal(startup.data.stats.objects, 3);
    assert.equal(startup.data.stats.relationships, 2);
    assert.equal(startup.data.objects.length, 2);
    assert.equal(startup.data.relationships.length, 1);
    assert.ok(startup.data.objects.some((item: any) => item.id === capture.data.id));
    await store.removeRelationship(bulkRelation.id);
    const detail = await request('/api/object?id=' + capture.data.id, undefined, 'GET');
    assert.equal(detail.data.relationships.length, 1);
    assert.equal(detail.data.object.properties.sourceMetadata.detailOnly, true);
    const state = await request('/api/state', undefined, 'GET');
    assert.equal(state.response.status, 200, JSON.stringify(state.data));
    assert.equal(state.data.objects.find((object: any) => object.id === capture.data.id).properties.sourceMetadata, undefined);
    const schema = await request('/api/types', { id: 'course', name: 'Course', description: 'Learning courses', properties: [{ key: 'progress', type: 'number' }] });
    assert.equal(schema.response.status, 201);
    const invalid = await request('/api/objects', { type: 'course', name: 'Invalid course', properties: { progress: 'wrong' } });
    assert.equal(invalid.response.status, 400);
    const valid = await request('/api/objects', { type: 'course', name: 'Useful course', properties: { progress: 10 } });
    assert.equal(valid.response.status, 201);
    const processed = await request('/api/objects/' + capture.data.id, { properties: { processingState: 'processed' } }, 'PATCH');
    assert.equal(processed.data.properties.processingState, 'processed');
    assert.ok(Number.isFinite(Date.parse(processed.data.properties.activityAt)));
    const refreshedState = await request('/api/state', undefined, 'GET');
    assert.equal(refreshedState.data.objects.find((object: any) => object.id === capture.data.id).properties.activityAt, processed.data.properties.activityAt);
    await request('/api/objects', { type: 'note', name: 'Copied activity log', properties: { sourcePath: 'projects/analytics/log.md', sourceVault: 'legacy' }, body: '# Log\n- 2026-10-29 10:45 note | Original dated event\n' });
    const history = await request('/api/activity?from=2026-10-29&to=2026-10-29', undefined, 'GET');
    assert.equal(history.response.status, 200);
    assert.equal(history.data.events.length, 1);
    assert.equal(history.data.events[0].at, '2026-10-29T10:45:00+05:30');
    assert.equal(history.data.events[0].detail, 'Original dated event');
    assert.equal((await request('/api/activity?from=2026-02-30&to=2026-10-29', undefined, 'GET')).response.status, 400);
    assert.equal((await fetch(url + '/src/v3/server.ts')).status, 404);
    const converted = await request('/api/objects/' + capture.data.id, { type: 'task', properties: { status: 'todo', due: '2026-11-01' } }, 'PATCH');
    assert.equal(converted.response.status, 200);
    assert.equal(converted.data.type, 'task');
    assert.equal(converted.data.path, capture.data.path);
    const convertedDetail = await request('/api/object?id=' + capture.data.id, undefined, 'GET');
    assert.match(convertedDetail.data.body, /Keep context linked/);
    assert.equal(convertedDetail.data.relationships.length, 1);
    assert.equal((await request('/api/objects/' + capture.data.id, { type: 'not-defined' }, 'PATCH')).response.status, 400);
    assert.equal((await store.get(capture.data.id))!.type, 'task');
    const removed = await request('/api/relationships/' + relation.data.id, undefined, 'DELETE');
    assert.equal(removed.data.removed, true);
    assert.equal((await store.relationships(capture.data.id)).length, 0);
    assert.equal((await request('/api/relationships/' + relation.data.id, undefined, 'DELETE')).data.removed, false);
    const unsafe = await fetch(url + '/api/file?path=../secret'); assert.equal(unsafe.status, 400);
    const privateFile = await fetch(url + '/api/file?path=.2b/vault.json'); assert.equal(privateFile.status, 400);
    const crossOrigin = await fetch(url + '/api/objects', { method: 'POST', headers: { origin: 'https://example.com' }, body: '{}' }); assert.equal(crossOrigin.status, 403);
    const forgedStatus = await new Promise<number>(resolve => { http.get(url + '/api/health', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode!); }); }); assert.equal(forgedStatus, 403);
    fs.writeFileSync(path.join(root, 'external-note.md'), '# Created in Obsidian');
    const report = await reconcileFiles(root, store); assert.ok(report.unregistered.includes('external-note.md'));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('vault and content paths cannot reach protected sources or symlink targets', () => {
  assert.throws(() => vaultRoot(path.join(os.homedir(), 'obsidian/2bv2')), /cannot write/);
  assert.throws(() => vaultRoot(path.join(os.homedir(), 'obsidian/personal/child')), /cannot write/);
  const root = path.join(temporary, 'paths'); fs.mkdirSync(root);
  fs.symlinkSync(path.join(os.homedir(), 'obsidian/personal'), path.join(root, 'shortcut'));
  assert.throws(() => contentPath(root, 'shortcut/notes.md'), /symbolic/);
  assert.throws(() => contentPath(root, '../escape.md'), /Invalid/);
});

test('config uses separate app home, editable vault path, and stable vault relocation', () => {
  ensureConfig(); const config = loadConfig(); assert.equal(config.agents.primary.provider, 'codex');
  const root = path.join(temporary, 'move-from'); fs.mkdirSync(root);
  const first = metadataDirectory(root);
  const moved = path.join(temporary, 'move-to'); fs.renameSync(root, moved);
  assert.equal(metadataDirectory(moved), first);
});

test('human reminders and imported agent jobs cannot execute as agent jobs', async () => {
  const root = path.join(temporary, 'disabled'); const { ObjectStore } = await import('../src/v3/store.ts'); const store = await ObjectStore.open(root);
  const now = new Date().toISOString();
  try {
    await store.upsert({ id: 'disabled-job', type: 'agent-job', name: 'Imported job', description: '', properties: { enabled: false, migrationReview: 'pending', nextRunAt: '2000-01-01T00:00:00Z' }, tags: [], path: null, createdAt: now, modifiedAt: now });
    await assert.rejects(runAgentJob(root, 'disabled-job'), /disabled/);
    assert.deepEqual(await workerTick(root), { notifications: [], runs: [] });
  } finally { await store.close(); }
  assert.equal(nextOccurrence('daily 19:00', 'Asia/Kolkata', new Date('2026-10-30T10:00:00Z')), '2026-10-30T13:30:00.000Z');
});

after(() => {
  const folder = path.join(temporary, 'app', 'vaults');
  if (fs.existsSync(folder)) for (const id of fs.readdirSync(folder)) {
    try { const state = JSON.parse(fs.readFileSync(path.join(folder, id, 'server.json'), 'utf8')); process.kill(state.pid, 'SIGTERM'); } catch {}
  }
  fs.rmSync(temporary, { recursive: true, force: true });
});
