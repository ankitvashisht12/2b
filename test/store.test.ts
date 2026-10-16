import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeStore } from './helpers.ts';
import {
  createProject, createTask, resolve, setStatus, setField, addLink, addPr,
  reverseLinks, addArtifact, createNote, readEntry, localDate, UserError,
} from '../src/store.ts';

const readLog = (dir: string) => fs.readFileSync(path.join(dir, 'log.md'), 'utf8');

test('creates a project and a dated task, both logged', () => {
  const root = makeStore();
  const project = createProject(root, 'search-ranking', { area: 'work', title: 'Search ranking' });
  const task = createTask(root, 'search-ranking', 'limiter-recovery', { title: 'Limiter recovery', due: '2026-10-20' });
  assert.equal(project.fields.status, 'active');
  assert.equal(project.fields.deadline, 'unknown');
  assert.equal(task.id, `search-ranking/${localDate()}-limiter-recovery`);
  assert.equal(task.fields.status, 'todo');
  assert.equal(task.fields.kind, 'normal');
  assert.match(readLog(task.dir), /created \| Limiter recovery/);
  assert.equal(readEntry('task', 'search-ranking', task.dir).fields.due, '2026-10-20');
});

test('a task slug that already has a date keeps it', () => {
  const root = makeStore();
  createProject(root, 'p', { area: 'personal' });
  assert.equal(createTask(root, 'p', '2026-01-02-old').id, 'p/2026-01-02-old');
});

test('paused needs a reason, and the change is logged', () => {
  const root = makeStore();
  const project = createProject(root, 'p', { area: 'work' });
  assert.throws(() => setStatus(project, 'paused'), UserError);
  setStatus(project, 'paused', 'Waiting for user feedback');
  assert.equal(project.fields['status-reason'], 'Waiting for user feedback');
  assert.match(readLog(project.dir), /status active -> paused \| Waiting for user feedback/);
  assert.throws(() => setStatus(project, 'doing'), /active, paused/);
});

test('resolve: project, exact task, unique part, and ambiguous part', () => {
  const root = makeStore();
  createProject(root, 'p', { area: 'work' });
  createTask(root, 'p', '2026-10-01-review-backend');
  createTask(root, 'p', '2026-10-02-review-frontend');
  assert.equal(resolve(root, 'p').kind, 'project');
  assert.equal(resolve(root, '2026-10-01-review-backend').id, 'p/2026-10-01-review-backend');
  assert.equal(resolve(root, 'frontend').id, 'p/2026-10-02-review-frontend');
  assert.throws(() => resolve(root, 'review'), /review-backend[\s\S]*review-frontend/);
  assert.throws(() => resolve(root, 'nothing'), /no project or task/);
});

test('links are stored one way and found in reverse', () => {
  const root = makeStore();
  createProject(root, 'p', { area: 'work' });
  const first = createTask(root, 'p', '2026-10-01-first');
  createTask(root, 'p', '2026-10-02-second');
  addLink(root, first, 'second', 'depends-on');
  assert.deepEqual(first.fields.links, [{ to: 'p/2026-10-02-second', type: 'depends-on' }]);
  assert.deepEqual(reverseLinks(root, 'p/2026-10-02-second'), [{ from: 'p/2026-10-01-first', type: 'depends-on' }]);
  assert.throws(() => addLink(root, first, 'second', 'blocks'), /depends-on/);
  addPr(first, 'https://github.com/o/r/pull/1');
  addPr(first, 'https://github.com/o/r/pull/1');
  assert.deepEqual(first.fields.prs, ['https://github.com/o/r/pull/1']);
});

test('setField validates dates and refuses unknown fields', () => {
  const root = makeStore();
  createProject(root, 'p', { area: 'work' });
  const task = createTask(root, 'p', 't');
  setField(task, 'due', 'unknown');
  assert.equal(task.fields.due, 'unknown');
  assert.throws(() => setField(task, 'due', 'next week'), /yyyy-mm-dd/);
  assert.throws(() => setField(task, 'color', 'red'), /field must be one of/);
  assert.throws(() => setField(task, 'every', 'daily 19:00'), /recurring/);
});

test('artifact gets a standard name and metadata', () => {
  const root = makeStore();
  createProject(root, 'p', { area: 'work' });
  const task = createTask(root, 'p', 't');
  const source = path.join(root, 'Scale Design.MD');
  fs.writeFileSync(source, '# Scale');
  const target = addArtifact(task, source, { about: 'How it scales', why: 'User asked' });
  assert.equal(path.basename(target), `${localDate()}-scale-design.md`);
  assert.equal(fs.readFileSync(target, 'utf8'), '# Scale');
  const artifact = (task.fields.artifacts as { about: string }[])[0];
  assert.equal(artifact.about, 'How it scales');
  assert.throws(() => addArtifact(task, source, {}), /already exists/);
});

test('notes go to inbox and to a monthly learnings folder', () => {
  const root = makeStore();
  const dump = createNote(root, 'inbox', 'idea', 'An idea');
  const learning = createNote(root, 'learnings', 'sqlite-indexes');
  assert.equal(path.relative(root, dump), `inbox/${localDate()}-idea.md`);
  assert.equal(path.relative(root, learning), `learnings/${localDate().slice(0, 7)}/${localDate()}-sqlite-indexes.md`);
});

test('bad names are refused', () => {
  const root = makeStore();
  assert.throws(() => createProject(root, 'Topic Analysis', { area: 'work' }), /lowercase/);
  assert.throws(() => createProject(root, 'p', { area: 'fun' }), /work, personal/);
});
