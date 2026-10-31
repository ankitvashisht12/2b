import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { metadataDirectory } from '../src/v3/config.ts';
import { ObjectStore } from '../src/v3/store.ts';
import { findRepoRoots, repoName, extractRepos, createRepo } from '../src/v3/repos.ts';
import type { ObjectRecord } from '../src/v3/models.ts';

const temporaryRoot = await realpath(tmpdir());
const appHome = await mkdtemp(join(temporaryRoot, '2bv3-app-'));
const reposHome = await mkdtemp(join(temporaryRoot, '2bv3-repos-'));
process.env.TWOB_APP_HOME = appHome;
process.env.TWOB_REPOS_HOME = reposHome;
after(async () => { await rm(appHome, { recursive: true, force: true }); await rm(reposHome, { recursive: true, force: true }); });

test('repo roots are the shallowest folder with a marker', () => {
  const roots = findRepoRoots([
    'projects/a/tasks/2026-01-02-demo/app/package.json',
    'projects/a/tasks/2026-01-02-demo/app/web/.vite/deps/x.js',
    'projects/a/tasks/2026-01-03-site/.next/build.json',
    'projects/a/tasks/2026-01-04-plain/report.html',
  ]);
  assert.deepEqual(roots, ['projects/a/tasks/2026-01-02-demo/app', 'projects/a/tasks/2026-01-03-site']);
  assert.equal(repoName(roots[0]), 'demo-app');
  assert.equal(repoName(roots[1]), 'site');
});

test('extract moves repos out, keeps task notes and standalone artifacts, drops secrets', async () => {
  const root = await mkdtemp(join(temporaryRoot, '2bv3-repo-vault-'));
  const store = await ObjectStore.open(root);
  try {
    const now = '2026-01-01T00:00:00.000Z';
    const file = (id: string, type: string, sourcePath: string, body: string): ObjectRecord => {
      const archivePath = `archive/legacy/${id}/${sourcePath}`;
      fs.mkdirSync(dirname(join(root, archivePath)), { recursive: true });
      fs.writeFileSync(join(root, archivePath), body);
      const sha256 = createHash('sha256').update(body).digest('hex');
      return { id, type, name: id, description: '', properties: { sourcePath, archivePath, sha256 }, tags: ['work'], path: archivePath, createdAt: now, modifiedAt: now };
    };
    const task = 'projects/a/tasks/2026-01-03-site';
    await store.upsertMany([
      file('task', 'task', `${task}/readme.md`, '# Site'),
      file('pkg', 'artifact', `${task}/package.json`, '{}'),
      file('page', 'artifact', `${task}/app/page.tsx`, 'export {}'),
      file('env', 'artifact', `${task}/.env.local`, 'TOKEN=x'),
      file('report', 'artifact', 'projects/a/tasks/2026-01-04-plain/report.html', '<p>ok</p>'),
      file('key', 'artifact', 'projects/a/tasks/2026-01-04-plain/.openrouter-key', 'sk-x'),
      file('note', 'note', 'projects/a/notes/idea.md', '# Idea'),
    ]);
    for (const id of ['pkg', 'page', 'env']) await store.relate(id, 'part-of', 'task');
    await store.relate('note', 'links-to', 'page');

    const plan = await extractRepos(root, store, true);
    assert.deepEqual(plan.repos.map(repo => [repo.name, repo.files]), [['site', 3]]);
    assert.deepEqual(plan.secretFilesRemoved, ['projects/a/tasks/2026-01-04-plain/.openrouter-key']);
    assert.ok(await store.get('pkg'), 'dry run changes nothing');

    await extractRepos(root, store);
    assert.equal(await readFile(join(reposHome, 'site/app/page.tsx'), 'utf8'), 'export {}');
    assert.equal(await readFile(join(reposHome, 'site/.env.local'), 'utf8'), 'TOKEN=x');
    for (const id of ['pkg', 'page', 'env', 'key']) assert.equal(await store.get(id), null);
    for (const id of ['task', 'report', 'note']) assert.ok(await store.get(id));
    assert.ok(!fs.existsSync(join(root, 'archive/legacy/env')));
    assert.ok(!fs.existsSync(join(root, 'archive/legacy/key')));

    const repo = await store.get('v3-repo:site');
    assert.equal(repo?.properties.localPath, join(reposHome, 'site'));
    const edges = (await store.relationships(repo!.id)).map(edge => `${edge.from} ${edge.kind} ${edge.to}`).sort();
    assert.deepEqual(edges, ['note links-to v3-repo:site', 'task has-artifact v3-repo:site']);

    const made = await createRepo(store, 'new-tool', { link: 'task' });
    assert.ok(fs.statSync(join(reposHome, 'new-tool')).isDirectory());
    assert.equal(made.linkedTo, 'task');
    await assert.rejects(createRepo(store, 'new-tool'), /already/);
  } finally {
    await store.close();
    try { process.kill(JSON.parse(await readFile(join(metadataDirectory(root), 'server.json'), 'utf8')).pid, 'SIGTERM'); } catch {}
    await rm(root, { recursive: true, force: true });
  }
});

test('scope is one in-area link to Work or Personal; sub-area links stay', async () => {
  const { setScope } = await import('../src/v3/server.ts');
  const root = await mkdtemp(join(temporaryRoot, '2bv3-scope-'));
  const store = await ObjectStore.open(root);
  try {
    const now = '2026-01-01T00:00:00.000Z';
    const record = (id: string, type: string): ObjectRecord => ({ id, type, name: id, description: '', properties: {}, tags: [], path: null, createdAt: now, modifiedAt: now });
    await store.upsertMany([record('health', 'area'), record('item', 'note')]);
    await store.relate('item', 'in-area', 'health');
    const areaLinks = async () => (await store.relationships('item')).filter(edge => edge.kind === 'in-area').map(edge => edge.to).sort();
    await setScope(store, 'item', 'work');
    assert.deepEqual(await areaLinks(), ['area:work', 'health']);
    await setScope(store, 'item', 'personal');
    assert.deepEqual(await areaLinks(), ['area:personal', 'health']);
    await setScope(store, 'item', 'none');
    assert.deepEqual(await areaLinks(), ['health']);
    await assert.rejects(setScope(store, 'item', 'office'), /Scope must be/);
  } finally {
    await store.close();
    try { process.kill(JSON.parse(await readFile(join(metadataDirectory(root), 'server.json'), 'utf8')).pid, 'SIGTERM'); } catch {}
    await rm(root, { recursive: true, force: true });
  }
});
