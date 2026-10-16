import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { makeStore } from './helpers.ts';
import { UserError, initStore, readEntry } from '../src/store.ts';
import { applyPlan, scanSources, validatePlan, type ImportPlan } from '../src/importer.ts';

type TreeEntry = { path: string; type: 'file' | 'dir' | 'link'; sha256?: string; target?: string };

function snapshotTree(root: string): TreeEntry[] {
  function walk(target: string): TreeEntry[] {
    const relative = path.relative(root, target);
    const stats = fs.lstatSync(target);
    if (stats.isSymbolicLink()) return [{ path: relative, type: 'link', target: fs.readlinkSync(target) }];
    if (stats.isDirectory()) return [
      { path: relative, type: 'dir' },
      ...fs.readdirSync(target).sort().flatMap(name => walk(path.join(target, name))),
    ];
    return [{ path: relative, type: 'file', sha256: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') }];
  }
  return walk(root);
}

function makeSources() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), '2b-src-'));
  const artifacts = path.join(base, 'artifacts');
  const work = path.join(artifacts, 'work');
  const alpha = path.join(work, '2026-10-01-alpha');
  fs.mkdirSync(path.join(alpha, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(alpha, 'README.md'), '# Alpha\n\nStatus: done. Started 2026-10-01.\n');
  fs.writeFileSync(path.join(alpha, 'log.md'), '## [2026-10-01 10:00] codex — started | ok');
  fs.writeFileSync(path.join(alpha, 'notes.md'), 'notes');
  fs.writeFileSync(path.join(alpha, 'bundle.js.map'), 'map');
  fs.writeFileSync(path.join(alpha, 'node_modules', 'pkg', 'index.js'), 'x'.repeat(1000));
  fs.writeFileSync(path.join(work, 'loose-report.html'), '<h1>Loose</h1>');
  fs.writeFileSync(path.join(work, 'CLAUDE.md'), 'skip me');
  const ai = path.join(base, 'ai');
  fs.mkdirSync(path.join(ai, '.obsidian'), { recursive: true });
  fs.writeFileSync(path.join(ai, '2026-07-24-dump.md'), '# Dump');
  return { work, ai, alpha };
}

const planFor = (sources: ReturnType<typeof makeSources>): ImportPlan => ({
  projects: [{ slug: 'topics', title: 'Topics', area: 'work', status: 'active' }],
  items: [
    { source: sources.alpha, project: 'topics', task: '2026-10-01-alpha', title: 'Alpha', status: 'done',
      artifacts: [{ path: 'notes.md', about: 'Working notes', why: 'Kept during the fix' }] },
    { source: path.join(sources.work, 'loose-report.html'), project: 'topics', task: '2026-10-01-alpha' },
    { source: path.join(sources.ai, '2026-07-24-dump.md'), inbox: '2026-07-24-dump' },
  ],
});

test('scan lists the children of each source and skips agent files', () => {
  const sources = makeSources();
  const items = scanSources([sources.work, sources.ai]);
  assert.deepEqual(items.map(item => path.basename(item.source)), ['2026-10-01-alpha', 'loose-report.html', '2026-07-24-dump.md']);
  const alpha = items[0];
  assert.equal(alpha.group, 'work');
  assert.throws(() => scanSources(['/nope']), /not a folder/);
  assert.equal(alpha.dateGuess, '2026-10-01');
  assert.equal(alpha.title, 'Alpha');
  assert.match(String(alpha.statusLine), /^Status: done/);
  assert.equal(alpha.files, 3);
});

test('apply copies into the 2b format, skips junk, keeps readme and log text, and leaves sources untouched', () => {
  const sources = makeSources();
  const root = makeStore();
  const workBefore = snapshotTree(sources.work);
  const aiBefore = snapshotTree(sources.ai);
  const report = applyPlan(root, planFor(sources));
  assert.deepEqual(snapshotTree(sources.work), workBefore);
  assert.deepEqual(snapshotTree(sources.ai), aiBefore);
  assert.deepEqual(report.skippedLinks, []);
  assert.deepEqual(report.problems, []);
  assert.equal(report.files, 5);
  assert.ok(report.skippedJunkBytes >= 1000);

  const taskDir = path.join(root, 'projects', 'topics', 'tasks', '2026-10-01-alpha');
  const task = readEntry('task', 'topics', taskDir);
  assert.equal(task.fields.status, 'done');
  assert.ok(task.body.endsWith('# Alpha\n\nStatus: done. Started 2026-10-01.\n'));
  assert.ok(fs.readdirSync(taskDir).includes('readme.md'));
  assert.ok(!fs.readdirSync(taskDir).includes('README.md'));
  assert.ok(fs.readFileSync(path.join(taskDir, 'log.md'), 'utf8').startsWith('## [2026-10-01 10:00] codex'));
  assert.ok(fs.existsSync(path.join(taskDir, 'loose-report.html')));
  assert.ok((task.fields.artifacts as { path: string }[]).some(artifact => artifact.path === 'loose-report.html'));
  assert.ok(!fs.existsSync(path.join(taskDir, 'node_modules')));
  assert.ok(!fs.existsSync(path.join(taskDir, 'bundle.js.map')));
  const notes = (task.fields.artifacts as { path: string; about: string }[]).find(artifact => artifact.path === 'notes.md');
  assert.equal(notes?.about, 'Working notes');
  assert.ok(fs.existsSync(path.join(root, 'inbox', '2026-07-24-dump.md')));
  assert.ok(fs.existsSync(path.join(sources.alpha, 'README.md')));
  assert.ok(fs.existsSync(path.join(sources.alpha, 'node_modules', 'pkg', 'index.js')));
  assert.ok(fs.existsSync(path.join(sources.alpha, 'bundle.js.map')));
  assert.equal(fs.readFileSync(path.join(sources.alpha, 'log.md'), 'utf8'), '## [2026-10-01 10:00] codex — started | ok');
  assert.ok(fs.existsSync(path.join(sources.work, 'loose-report.html')));
  assert.ok(fs.existsSync(path.join(sources.ai, '2026-07-24-dump.md')));
  assert.match(fs.readFileSync(path.join(taskDir, 'log.md'), 'utf8'), /- 2026-10-01 00:00 created \| Alpha/);
});

test('validate refuses unknown projects, existing targets, and missing sources', () => {
  const sources = makeSources();
  const root = makeStore();
  const plan = planFor(sources);
  plan.items.push({ source: '/nope/missing', project: 'topics', task: '2026-10-02-missing' });
  plan.items.push({ source: path.join(sources.ai, '2026-07-24-dump.md'), project: 'ghost', task: '2026-10-03-x' });
  const problems = validatePlan(root, plan).join('\n');
  assert.match(problems, /source does not exist/);
  assert.match(problems, /project "ghost"/);
  assert.throws(() => applyPlan(root, plan), /plan has problems/);
  assert.ok(fs.existsSync(sources.alpha));
});

test('dry run moves nothing', () => {
  const sources = makeSources();
  const root = makeStore();
  const report = applyPlan(root, planFor(sources), { dryRun: true });
  assert.equal(report.files, 5);
  assert.ok(fs.existsSync(sources.alpha));
  assert.ok(!fs.existsSync(path.join(root, 'projects', 'topics')));
});


test('apply skips source links and preserves their targets; dry run reports the same links', () => {
  const sources = makeSources();
  fs.unlinkSync(path.join(sources.alpha, 'README.md'));
  fs.unlinkSync(path.join(sources.alpha, 'log.md'));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), '2b-link-target-'));
  const readmeTarget = path.join(external, 'original.md');
  const logTarget = path.join(external, 'original-log.md');
  fs.writeFileSync(readmeTarget, '# External original\n');
  fs.writeFileSync(logTarget, 'Original log\n');
  const readmeLink = path.join(sources.alpha, 'readme.md');
  const logLink = path.join(sources.alpha, 'log.md');
  const folderLink = path.join(sources.alpha, 'linked-folder');
  fs.symlinkSync(readmeTarget, readmeLink);
  fs.symlinkSync(logTarget, logLink);
  fs.symlinkSync(external, folderLink);
  fs.symlinkSync(path.join(external, 'missing.md'), path.join(sources.alpha, 'broken-link'));
  fs.symlinkSync(external, path.join(sources.alpha, 'node_modules', 'ignored-link'));
  const expectedLinks = [readmeLink, logLink, folderLink, path.join(sources.alpha, 'broken-link')].sort();
  const sourceBefore = snapshotTree(sources.work);
  const targetsBefore = snapshotTree(external);
  const root = makeStore();
  const storeBefore = snapshotTree(root);
  const plan = planFor(sources);
  const dryReport = applyPlan(root, plan, { dryRun: true });
  assert.deepEqual(dryReport.skippedLinks?.slice().sort(), expectedLinks);
  assert.deepEqual(snapshotTree(root), storeBefore);
  const report = applyPlan(root, plan);
  assert.deepEqual(snapshotTree(external), targetsBefore);
  assert.deepEqual(snapshotTree(sources.work), sourceBefore);
  assert.deepEqual(report.problems, []);
  assert.equal(report.files, 3);
  assert.deepEqual(report.skippedLinks.slice().sort(), expectedLinks);
  const taskDir = path.join(root, 'projects', 'topics', 'tasks', '2026-10-01-alpha');
  assert.ok(snapshotTree(taskDir).every(entry => entry.type !== 'link'));
  assert.ok(!fs.existsSync(path.join(taskDir, 'node_modules')));
});

test('validate refuses an item whose source is a symbolic link, including a broken link', () => {
  const sources = makeSources();
  const root = makeStore();
  const sourceLink = path.join(sources.work, 'source-link');
  const brokenLink = path.join(sources.work, 'broken-source-link');
  fs.symlinkSync(sources.alpha, sourceLink);
  fs.symlinkSync(path.join(sources.work, 'missing'), brokenLink);
  for (const source of [sourceLink, brokenLink]) {
    const plan = planFor(sources);
    plan.items = [{ source, project: 'topics', task: '2026-10-01-alpha' }];
    assert.deepEqual(validatePlan(root, plan), [`${source}: source is a symbolic link`]);
    const before = snapshotTree(root);
    assert.throws(() => applyPlan(root, plan), /source is a symbolic link/);
    assert.deepEqual(snapshotTree(root), before);
  }
});

test('validate refuses a source containing the store before any write', () => {
  const sources = makeSources();
  const root = path.join(sources.alpha, 'store');
  initStore(root);
  const before = snapshotTree(sources.work);
  const plan = planFor(sources);
  assert.ok(validatePlan(root, plan).includes(`${sources.alpha}: source and store overlap`));
  assert.throws(() => applyPlan(root, plan), /overlap/);
  assert.deepEqual(snapshotTree(sources.work), before);
});

test('validate resolves store aliases and refuses sources inside or equal to the store', () => {
  const root = makeStore();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), '2b-store-alias-'));
  const alias = path.join(base, 'store');
  fs.symlinkSync(root, alias);
  for (const source of [root, path.join(root, 'inbox')]) {
    const plan: ImportPlan = { projects: [], items: [{ source, inbox: '2026-10-01-copy' }] };
    const before = snapshotTree(root);
    assert.deepEqual(validatePlan(alias, plan), [`${source}: source and store overlap`]);
    assert.throws(() => applyPlan(alias, plan), /overlap/);
    assert.deepEqual(snapshotTree(root), before);
  }
});


test('validate refuses project traversal without writing outside the store', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), '2b-traversal-'));
  const root = path.join(base, 'store');
  initStore(root);
  const victim = path.join(base, 'victim');
  fs.mkdirSync(victim);
  fs.writeFileSync(path.join(victim, 'readme.md'), 'Original');
  const source = path.join(base, 'note.txt');
  fs.writeFileSync(source, 'Note');
  const plan: ImportPlan = { projects: [], items: [{ source, project: '../../victim', task: '2026-10-16-copy' }] };
  const before = snapshotTree(base);
  assert.throws(() => applyPlan(root, plan), /project.*must/);
  assert.deepEqual(snapshotTree(base), before);
});

test('scan lists top-level links without following live or broken targets', () => {
  const sources = makeSources();
  fs.symlinkSync(sources.alpha, path.join(sources.ai, 'linked-folder'));
  fs.symlinkSync(path.join(sources.ai, 'missing.md'), path.join(sources.ai, 'broken.md'));
  const links = scanSources([sources.ai]).filter(item => item.type === 'link');
  assert.equal(links.length, 2);
  for (const link of links) {
    assert.equal(link.files, 0);
    assert.equal(link.bytes, 0);
    assert.equal(link.title, null);
    assert.deepEqual(link.topFiles, []);
  }
});

test('import reports the failed source and retained targets after a copy failure', context => {
  const root = makeStore();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), '2b-unreadable-'));
  const first = path.join(base, 'first.txt');
  const second = path.join(base, 'second.txt');
  fs.writeFileSync(first, 'First');
  fs.writeFileSync(second, 'Second');
  const copy = fs.cpSync;
  context.mock.method(fs, 'cpSync', (source, destination, options) => {
    if (source === second) fs.chmodSync(second, 0o000);
    return copy(source, destination, options);
  });
  try {
    assert.throws(() => applyPlan(root, { projects: [], items: [
      { source: first, inbox: '2026-10-16-first' },
      { source: second, inbox: '2026-10-16-second' },
    ] }), error => error instanceof UserError
      && error.message.startsWith(`import stopped at ${second}:`)
      && error.message.endsWith('Targets created so far stay in the store; remove them before running again.'));
    assert.equal(fs.readFileSync(path.join(root, 'inbox', '2026-10-16-first.txt'), 'utf8'), 'First');
  } finally {
    fs.chmodSync(second, 0o600);
  }
});
