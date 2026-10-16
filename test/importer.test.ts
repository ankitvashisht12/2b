import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeStore } from './helpers.ts';
import { readEntry } from '../src/store.ts';
import { applyPlan, scanSources, validatePlan, type ImportPlan } from '../src/importer.ts';

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
  const report = applyPlan(root, planFor(sources));
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
