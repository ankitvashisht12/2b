import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeStore } from './helpers.ts';
import { appendLog, createNote, createProject, createTask, UserError, writeEntry } from '../src/store.ts';
import { isoWeek, parseLog, weekEvents } from '../src/week.ts';
import { findInStore } from '../src/find.ts';
import { checkStore } from '../src/check.ts';

test('ISO week runs Monday to Sunday', () => {
  assert.deepEqual(isoWeek('2026-10-16'), { start: '2026-10-12', end: '2026-10-18' });
  assert.deepEqual(isoWeek('2026-10-18'), { start: '2026-10-12', end: '2026-10-18' });
  assert.deepEqual(isoWeek('2026-10-19'), { start: '2026-10-19', end: '2026-10-25' });
});

test('events at the week edges land in the right week', () => {
  const root = makeStore();
  const project = createProject(root, 'p', { area: 'work' });
  const task = createTask(root, 'p', '2026-10-10-t');
  appendLog(task.dir, 'note', 'sunday late', '2026-10-18 23:30');
  appendLog(task.dir, 'note', 'monday early', '2026-10-19 00:05');
  appendLog(project.dir, 'note', 'project note', '2026-10-14 10:00');

  const details = weekEvents(root, '2026-10-15').map(event => event.detail);
  assert.ok(details.includes('sunday late'));
  assert.ok(details.includes('project note'));
  assert.ok(!details.includes('monday early'));
  assert.equal(weekEvents(root, '2026-10-15').find(event => event.detail === 'sunday late')?.task, 'p/2026-10-10-t');
});

test('inbox notes count as activity', () => {
  const root = makeStore();
  createNote(root, 'inbox', 'idea', 'Idea');
  const today = new Date().toLocaleDateString('en-CA');
  assert.ok(weekEvents(root, today).some(event => event.project === 'inbox' && event.detail === 'Idea'));
});

test('find matches file names and content, and skips node_modules', () => {
  const root = makeStore();
  createProject(root, 'p', { area: 'work' });
  const task = createTask(root, 'p', '2026-10-10-t');
  fs.writeFileSync(path.join(task.dir, 'notes.md'), 'line one\nRate limiter conflict\n');
  fs.mkdirSync(path.join(task.dir, 'node_modules'));
  fs.writeFileSync(path.join(task.dir, 'node_modules', 'x.md'), 'rate limiter');
  const hits = findInStore(root, 'rate LIMITER');
  assert.deepEqual(hits, [{ file: 'projects/p/tasks/2026-10-10-t/notes.md', line: 2, text: 'Rate limiter conflict' }]);
  assert.equal(findInStore(root, 'notes.md')[0].line, 0);
});

test('check reports broken links, missing reasons, bad names, and bad frontmatter', () => {
  const root = makeStore();
  createProject(root, 'p', { area: 'work' });
  const task = createTask(root, 'p', '2026-10-10-t');
  task.fields.links = [{ to: 'p/ghost', type: 'related' }];
  task.fields.status = 'blocked';
  writeEntry(task);
  fs.mkdirSync(path.join(root, 'projects', 'p', 'tasks', 'No-Date'));
  fs.writeFileSync(path.join(root, 'projects', 'p', 'tasks', 'No-Date', 'readme.md'), '---\ntitle: x\nstatus: todo\n---\n');
  fs.mkdirSync(path.join(root, 'projects', 'broken'));
  fs.writeFileSync(path.join(root, 'projects', 'broken', 'readme.md'), '---\nprs: [oops\n---\n');

  const problems = checkStore(root).join('\n');
  assert.match(problems, /p\/2026-10-10-t: link to "p\/ghost" points to nothing/);
  assert.match(problems, /needs status-reason/);
  assert.match(problems, /No-Date.*lowercase/);
  assert.match(problems, /No-Date: folder name must start with yyyy-mm-dd-/);
  assert.match(problems, /broken: frontmatter field "prs"/);
  assert.deepEqual(checkStore(makeStore()), []);
});


test('week reads project and task logs despite bad or missing readmes', () => {
  const root = makeStore();
  const project = createProject(root, 'p', { area: 'work' });
  const task = createTask(root, 'p', '2026-10-10-t');
  for (const entry of [project, task]) {
    fs.writeFileSync(path.join(entry.dir, 'readme.md'), '---\nprs: [oops\n---\n');
    appendLog(entry.dir, 'note', 'still visible', '2026-10-14 10:00');
  }
  const events = weekEvents(root, '2026-10-15').filter(event => event.detail === 'still visible');
  assert.deepEqual(events.map(event => event.task), [null, 'p/2026-10-10-t']);
  for (const entry of [project, task]) fs.unlinkSync(path.join(entry.dir, 'readme.md'));
  assert.equal(weekEvents(root, '2026-10-15').filter(event => event.detail === 'still visible').length, 2);
  for (const entry of [project, task]) fs.unlinkSync(path.join(entry.dir, 'log.md'));
  assert.deepEqual(weekEvents(root, '2026-10-15'), []);
});

test('parseLog accepts CRLF lines with and without details', () => {
  assert.deepEqual(parseLog('- 2026-10-14 10:00 note | detail\r\n- 2026-10-14 10:01 done\r\n', 'p', null), [
    { project: 'p', task: null, at: '2026-10-14 10:00', event: 'note', detail: 'detail' },
    { project: 'p', task: null, at: '2026-10-14 10:01', event: 'done', detail: '' },
  ]);
});

test('check reports non-list links and artifacts', () => {
  for (const field of ['links', 'artifacts']) {
    for (const value of ['invalid', {}, 42, false, null]) {
      const root = makeStore();
      const project = createProject(root, 'p', { area: 'work' });
      project.fields[field] = value;
      writeEntry(project);
      assert.ok(checkStore(root).includes(`p: field "${field}" must be a list`));
    }
  }
});

test('check reports unknown link types', () => {
  const root = makeStore();
  const project = createProject(root, 'p', { area: 'work' });
  project.fields.links = [{ to: 'p', type: 'unknown' }];
  writeEntry(project);
  assert.deepEqual(checkStore(root), ['p: link to "p" has unknown type "unknown"']);
});

test('check skips dangling symlinks in project and task folders', () => {
  const root = makeStore();
  const project = createProject(root, 'p', { area: 'work' });
  fs.symlinkSync(path.join(root, 'missing'), path.join(root, 'projects', 'dangling'));
  fs.symlinkSync(path.join(root, 'missing'), path.join(project.dir, 'tasks', 'dangling'));
  assert.deepEqual(checkStore(root), []);
});

test('find rejects empty and whitespace search text', () => {
  const root = makeStore();
  for (const query of ['', ' ', '\t\n']) {
    assert.throws(() => findInStore(root, query), error => error instanceof UserError && error.message === 'search text is empty');
  }
});
