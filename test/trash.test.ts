import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeStore } from './helpers.ts';
import { createProject, createTask, listProjects, listTasks, localDate } from '../src/store.ts';
import { trashTask, restoreTask, listTrash } from '../src/trash.ts';
import { syncSchedules, labelFor } from '../src/schedule.ts';
import { checkStore } from '../src/check.ts';
import { weekEvents } from '../src/week.ts';

function taskContentsSnapshot(directory: string, relativeDirectory = ''): { name: string; sha256: string | null }[] {
  return fs.readdirSync(path.join(directory, relativeDirectory), { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap(entry => {
      if (!relativeDirectory && ['readme.md', 'log.md'].includes(entry.name)) return [];
      const name = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) return [{ name, sha256: null }, ...taskContentsSnapshot(directory, name)];
      const sha256 = createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex');
      return [{ name, sha256 }];
    });
}

test('delete and restore preserve user file names and bytes, including trash metadata names', () => {
  const root = makeStore();
  const options = { agentsDir: path.join(root, 'fake-agents'), load: false };
  createProject(root, 'ops--tools', { area: 'work' });
  const task = createTask(root, 'ops--tools', 'job--digest', { every: 'hourly', run: 'command', command: 'true' });
  fs.writeFileSync(path.join(task.dir, '.trash.json'), '{"user":"keep this exactly"}\n');
  fs.writeFileSync(path.join(task.dir, 'meta.json'), '{"user":"also keep this"}\n');
  fs.mkdirSync(path.join(task.dir, 'task', 'empty'), { recursive: true });
  fs.writeFileSync(path.join(task.dir, 'task', 'readme.md'), 'Nested user readme\n');
  fs.writeFileSync(path.join(task.dir, 'task', 'log.md'), Buffer.from([0, 255, 10, 13]));
  const originalContents = taskContentsSnapshot(task.dir);

  const deleted = trashTask(root, task, options);
  assert.deepEqual(taskContentsSnapshot(path.join(root, '.trash', deleted.trashId, 'task')), originalContents);
  assert.ok(fs.existsSync(path.join(root, '.trash', deleted.trashId, 'meta.json')));
  const restored = restoreTask(root, deleted.trashId, options);
  assert.deepEqual(taskContentsSnapshot(restored.dir), originalContents);
  assert.equal(restored.fields.status, 'paused');
  assert.equal(restored.fields['status-reason'], 'restored from trash');
  assert.equal(fs.existsSync(path.join(root, '.trash', deleted.trashId)), false);
});

test('trash stops recurring jobs and restore keeps them paused', () => {
  const root = makeStore();
  const options = { agentsDir: path.join(root, 'fake-agents'), load: false };
  const project = createProject(root, 'ops', { area: 'work' });
  const task = createTask(root, 'ops', 'job', { every: 'hourly', run: 'command', command: 'true' });
  const normal = createTask(root, 'ops', 'normal');
  assert.throws(() => trashTask(root, normal, options), /recurring/);
  syncSchedules(root, options);
  const deleted = trashTask(root, task, options);
  assert.equal(fs.existsSync(task.dir), false);
  assert.equal(fs.existsSync(path.join(options.agentsDir, `${labelFor(task.id)}.plist`)), false);
  assert.equal(listTasks(root).length, 1);
  assert.equal(listProjects(root).length, 1);
  assert.deepEqual(checkStore(root), []);
  assert.equal(weekEvents(root, localDate()).some(event => event.task === task.id), false);
  assert.equal(listTrash(root)[0].trashId, deleted.trashId);
  assert.equal(listTrash(root)[0].project, 'ops');
  assert.equal(listTrash(root)[0].task, path.basename(task.dir));
  assert.match(listTrash(root)[0].deletedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  assert.match(fs.readFileSync(path.join(project.dir, 'log.md'), 'utf8'), /deleted ops\//);
  fs.mkdirSync(task.dir);
  assert.throws(() => restoreTask(root, deleted.trashId, options), /exists/);
  fs.rmdirSync(task.dir);
  const restored = restoreTask(root, deleted.trashId, options);
  assert.equal(restored.id, task.id);
  assert.equal(restored.fields.status, 'paused');
  assert.equal(restored.fields['status-reason'], 'restored from trash');
  assert.equal(listTrash(root).length, 0);
  assert.equal(fs.existsSync(path.join(options.agentsDir, `${labelFor(task.id)}.plist`)), false);
  assert.match(fs.readFileSync(path.join(project.dir, 'log.md'), 'utf8'), /restored ops\//);
  assert.throws(() => restoreTask(root, '../escape', options), /trash/);
});

test('delete keeps the task in place when launchd cannot stop it', async context => {
  const childProcess = await import('node:child_process');
  const { syncBuiltinESMExports } = await import('node:module');
  const root = makeStore();
  const options = { agentsDir: path.join(root, 'fake-agents'), load: false };
  createProject(root, 'ops', { area: 'work' });
  const task = createTask(root, 'ops', 'job', { every: 'hourly', run: 'command', command: 'true' });
  syncSchedules(root, options);
  context.mock.method(childProcess.default, 'spawnSync', () => ({ status: 5, stderr: 'cannot stop job' }));
  const os = await import('node:os');
  context.mock.method(os.default, 'homedir', () => root);
  syncBuiltinESMExports();
  context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.throws(() => trashTask(root, task, { ...options, load: true }), /cannot stop job/);
  assert.equal(fs.existsSync(task.dir), true);
  assert.equal(listTrash(root).length, 0);
  assert.equal(fs.existsSync(path.join(options.agentsDir, `${labelFor(task.id)}.plist`)), true);
});
