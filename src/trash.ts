import fs from 'node:fs';
import path from 'node:path';
import {
  UserError, appendLog, assertSlug, fileTimestamp, localDateTime, readEntry, setStatus, type Entry,
} from './store.ts';
import { labelFor, syncSchedules } from './schedule.ts';

type ScheduleOptions = { agentsDir?: string; load?: boolean };
type TrashItem = { trashId: string; project: string; task: string; deletedAt: string };
const METADATA = '.trash.json';

function trashDirectory(root: string, trashId: string): string {
  if (!/^\d{4}-\d{2}-\d{2}-\d{6}--[a-z0-9.-]+--[a-z0-9.-]+$/.test(trashId)) {
    throw new UserError('invalid trash id');
  }
  const dir = path.join(root, '.trash', trashId);
  if (!fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory()) throw new UserError(`trash item "${trashId}" does not exist`);
  if (fs.realpathSync(path.dirname(dir)) !== path.join(fs.realpathSync(root), '.trash')) throw new UserError('invalid trash directory');
  return dir;
}

function metadata(dir: string): { project: string; task: string; deletedAt: string } {
  const item = JSON.parse(fs.readFileSync(path.join(dir, METADATA), 'utf8'));
  assertSlug(item.project, 'trash project');
  assertSlug(item.task, 'trash task');
  if (typeof item.deletedAt !== 'string') throw new UserError('invalid trash metadata');
  return { project: item.project, task: item.task, deletedAt: item.deletedAt };
}

function syncTask(root: string, task: Entry, options: ScheduleOptions): void {
  const result = syncSchedules(root, options);
  const failure = result.failed.find(item => item.label === labelFor(task.id));
  if (failure) throw new UserError(`schedule sync failed: ${failure.reason}`);
}

export function trashTask(root: string, task: Entry, options: ScheduleOptions = {}): { trashId: string; path: string } {
  if (task.kind !== 'task' || task.fields.kind !== 'recurring') throw new UserError('only recurring tasks can be deleted');
  const folder = path.basename(task.dir);
  assertSlug(task.project, 'project');
  const source = path.join(root, 'projects', task.project, 'tasks', folder);
  if (path.resolve(task.dir) !== path.resolve(source)) throw new UserError('task is outside this store');
  const trashId = `${fileTimestamp()}--${task.project}--${folder}`;
  const destination = path.join(root, '.trash', trashId);
  if (fs.existsSync(destination)) throw new UserError(`trash item "${trashId}" already exists; retry in one second`);
  setStatus(task, 'dropped', 'deleted');
  syncTask(root, task, options);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(source, destination);
  fs.writeFileSync(path.join(destination, METADATA), JSON.stringify({ project: task.project, task: folder, deletedAt: localDateTime() }));
  appendLog(path.join(root, 'projects', task.project), `deleted ${task.id}`, `moved to .trash/${trashId}`);
  return { trashId, path: destination };
}

export function restoreTask(root: string, trashId: string, options: ScheduleOptions = {}): Entry {
  const source = trashDirectory(root, trashId);
  const item = metadata(source);
  const projectDir = path.join(root, 'projects', item.project);
  if (!fs.existsSync(path.join(projectDir, 'readme.md'))) throw new UserError(`project "${item.project}" does not exist`);
  const destination = path.join(projectDir, 'tasks', item.task);
  if (fs.existsSync(destination)) throw new UserError(`task "${item.project}/${item.task}" already exists`);
  const task = readEntry('task', item.project, source);
  if (task.fields.kind !== 'recurring') throw new UserError('only recurring tasks can be restored');
  setStatus(task, 'paused', 'restored from trash');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(source, destination);
  fs.unlinkSync(path.join(destination, METADATA));
  const restored = readEntry('task', item.project, destination);
  syncTask(root, restored, options);
  appendLog(projectDir, `restored ${restored.id}`);
  return restored;
}

export function listTrash(root: string): TrashItem[] {
  const dir = path.join(root, '.trash');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(item => item.isDirectory()).flatMap(item => {
    try {
      return [{ trashId: item.name, ...metadata(trashDirectory(root, item.name)) }];
    } catch {
      return [];
    }
  }).sort((left, right) => right.trashId.localeCompare(left.trashId));
}
