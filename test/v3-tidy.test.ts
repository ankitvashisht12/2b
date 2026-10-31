import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { metadataDirectory } from '../src/v3/config.ts';
import { ObjectStore } from '../src/v3/store.ts';
import { tidyVault } from '../src/v3/tidy.ts';
import type { ObjectRecord } from '../src/v3/models.ts';

const temporaryRoot = await realpath(tmpdir());
const appHome = await mkdtemp(join(temporaryRoot, '2bv3-app-'));
const sources = await mkdtemp(join(temporaryRoot, '2bv3-sources-'));
process.env.TWOB_APP_HOME = appHome;
process.env.TWOB_SOURCES_HOME = sources;
after(async () => { await rm(appHome, { recursive: true, force: true }); await rm(sources, { recursive: true, force: true }); });

test('tidy gives plain names, follows links, and removes the import folders', async () => {
  const root = await mkdtemp(join(temporaryRoot, '2bv3-tidy-'));
  const store = await ObjectStore.open(root);
  const write = (relative: string, text: string) => { fs.mkdirSync(dirname(join(root, relative)), { recursive: true }); fs.writeFileSync(join(root, relative), text); };
  const hex = (digit: string) => digit.repeat(64);
  try {
    const now = '2026-01-01T00:00:00.000Z';
    const object = (id: string, type: string, name: string, filePath: string | null, properties: Record<string, unknown> = {}): ObjectRecord => ({ id, type, name, description: '', properties, tags: [], path: filePath, createdAt: now, modifiedAt: now });
    fs.mkdirSync(join(sources, '2bv2/r'), { recursive: true });
    fs.writeFileSync(join(sources, '2bv2/r/report.html'), '<p>report</p>');
    write(`archive/legacy/${hex('a')}/notes/idea.md`, '# Idea');
    write(`archive/legacy/${hex('b')}/notes/other.md`, '# Other');
    write(`archive/legacy/${hex('c')}/r/report.html`, '<p>report</p>');
    write('objects/artifact/report--c1.md', 'index page');
    write('migration/report.json', '{}');
    fs.mkdirSync(join(root, 'connections'));
    write('objects/note/Idea--a1.md', `---\nid: idea\n---\n[Original file](../../archive/legacy/${hex('a')}/notes/idea.md)\n\n# Idea\nSee [report](../../archive/legacy/${hex('c')}/r/report.html), [[objects/note/Other--b1|other]] and [contract](../../archive/legacy/${hex('b')}/notes/other.md#part).\n`);
    write('objects/note/Other--b1.md', '# Other\n');
    write('objects/note/Log--d1.md', '# Log\n');
    write('objects/note/Log--e1.md', '# Log\n');
    await store.upsertMany([
      object('idea', 'note', 'Idea', 'objects/note/Idea--a1.md', { sourceVault: 'legacy', sourcePath: 'notes/idea.md', archivePath: `archive/legacy/${hex('a')}/notes/idea.md` }),
      object('other', 'note', 'Other', 'objects/note/Other--b1.md', { sourceVault: 'legacy', sourcePath: 'notes/other.md', archivePath: `archive/legacy/${hex('b')}/notes/other.md` }),
      object('report', 'artifact', 'report', `archive/legacy/${hex('c')}/r/report.html`, { sourceVault: 'legacy', sourcePath: 'r/report.html', archivePath: `archive/legacy/${hex('c')}/r/report.html`, indexPath: 'objects/artifact/report--c1.md' }),
      object('task-a', 'task', 'Task A', null), object('task-b', 'task', 'Task B', null),
      object('log-a', 'note', 'Log', 'objects/note/Log--d1.md'), object('log-b', 'note', 'Log', 'objects/note/Log--e1.md'),
    ]);
    await store.relate('log-a', 'part-of', 'task-a');
    await store.relate('log-b', 'part-of', 'task-b');

    const plan = await tidyVault(root, store, true);
    assert.equal(plan.unresolvedArchiveLinks, 0);
    assert.ok(fs.existsSync(join(root, 'archive')), 'dry run changes nothing');

    await tidyVault(root, store);
    assert.equal((await store.get('idea'))?.path, 'objects/note/Idea.md');
    assert.equal((await store.get('log-a'))?.path, 'objects/note/Log — Task A.md');
    assert.equal((await store.get('log-b'))?.path, 'objects/note/Log — Task B.md');
    const report = await store.get('report');
    assert.equal(report?.path, null);
    assert.equal(report?.properties.localPath, join(sources, '2bv2/r/report.html'));
    assert.equal(report?.properties.archivePath, undefined);

    const idea = await readFile(join(root, 'objects/note/Idea.md'), 'utf8');
    assert.ok(!idea.includes('Original file') && !idea.includes('archive/'));
    assert.ok(idea.includes(`[report](file://${join(sources, '2bv2/r/report.html')})`));
    assert.ok(idea.includes('[[objects/note/Other|other]]'));
    assert.ok(idea.includes('[contract](Other.md#part)'));
    for (const folder of ['archive', 'connections', 'migration', 'objects/artifact']) assert.ok(!fs.existsSync(join(root, folder)), folder);
    assert.ok(fs.existsSync(join(metadataDirectory(root), 'import-migration/report.json')));
  } finally {
    await store.close();
    try { process.kill(JSON.parse(await readFile(join(metadataDirectory(root), 'server.json'), 'utf8')).pid, 'SIGTERM'); } catch {}
    await rm(root, { recursive: true, force: true });
  }
});
