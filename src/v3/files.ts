import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import type { ObjectRecord } from './models.ts';
import { ObjectStore, type PropertyPatch } from './store.ts';
import { loadConfig, metadataDirectory, sourceVaults } from './config.ts';

export function vaultRoot(input = process.env.TWOB_V3_HOME || loadConfig().vaultPath): string {
  const root = path.resolve(input.replace(/^~(?=\/|$)/, os.homedir()));
  for (const source of Object.values(sourceVaults())) {
    if (root === source || root.startsWith(source + path.sep) || source.startsWith(root + path.sep)) throw new Error('V3 cannot write in or around a source vault. Use ~/obsidian/2b.');
  }
  let existing = root;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const actual = fs.realpathSync(existing);
  if (actual !== existing) return vaultRoot(path.join(actual, path.relative(existing, root)));
  return root;
}

export function contentPath(rootInput: string, relative: string): string {
  const root = vaultRoot(rootInput);
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(segment => segment === '..' || segment === '.') || ['.2b', '.obsidian', '.git'].includes(relative.split(/[\\/]/)[0])) throw new Error('Invalid content path');
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw new Error('Content path escapes vault');
  let cursor = target;
  while (!fs.existsSync(cursor)) cursor = path.dirname(cursor);
  if (fs.realpathSync(cursor) !== cursor) throw new Error('Content paths cannot traverse symbolic links');
  return target;
}

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export function readBody(root: string, object: ObjectRecord): string {
  if (!object.path || !/\.(md|txt|csv)$/i.test(object.path)) return '';
  const target = contentPath(root, object.path);
  if (!fs.existsSync(target)) return '';
  if (fs.statSync(target).size > 2_000_000) return '[Large file: open the original file to read all content.]';
  const text = fs.readFileSync(target, 'utf8');
  return text.replace(/\n?<!-- 2b:connections:start -->[\s\S]*?<!-- 2b:connections:end -->\n?/g, '\n');
}

export function atomicWrite(target: string, body: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, body, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

/** A readable file name: the object's name without characters that files or Obsidian links reject. */
export const fileTitle = (name: string) =>
  name.normalize('NFC').replace(/[\x00-\x1f<>:"/\\|?*#^[\]]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 100).trim() || 'Untitled';

/** objects/<type>/<Name>.md, with " (2)", " (3)" when the name is taken. The ID stays in the database. */
function freePagePath(root: string, object: ObjectRecord): string {
  const base = `objects/${object.type}/${fileTitle(object.name)}`;
  for (let copy = 1; ; copy++) {
    const relative = copy === 1 ? `${base}.md` : `${base} (${copy}).md`;
    if (!fs.existsSync(contentPath(root, relative))) return relative;
  }
}

export async function writeBody(root: string, store: ObjectStore, object: ObjectRecord, body: string): Promise<ObjectRecord> {
  const relative = object.path || freePagePath(root, object);
  if (object.path && !/\.(md|txt)$/i.test(relative)) throw new Error('Only Markdown and text content can be edited');
  const target = contentPath(root, relative);
  if (relative.startsWith('sources/') || relative.startsWith('archive/')) throw new Error('Preserved source copies are read-only. Create a new note to develop this content.');
  const journalDir = path.join(metadataDirectory(vaultRoot(root)), 'pending-writes');
  fs.mkdirSync(journalDir, { recursive: true });
  const operation = path.join(journalDir, `${randomUUID()}.json`);
  atomicWrite(operation, JSON.stringify({ id: object.id, path: relative, body, hash: digest(body) }));
  atomicWrite(target, body);
  const updated = await store.update(object.id, { path: relative, properties: { contentHash: digest(body), fileModifiedAt: fs.statSync(target).mtime.toISOString() } });
  fs.unlinkSync(operation);
  return updated;
}

export async function reconcileFiles(rootInput: string, store: ObjectStore) {
  const root = vaultRoot(rootInput);
  const journal = path.join(metadataDirectory(root), 'pending-writes');
  const recovered: string[] = [];
  if (fs.existsSync(journal)) for (const name of fs.readdirSync(journal).filter(name => name.endsWith('.json'))) {
    const journalPath = path.join(journal, name);
    const operation = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    const object = await store.get(operation.id);
    if (!object) continue;
    const target = contentPath(root, operation.path);
    if (!fs.existsSync(target) || digest(fs.readFileSync(target, 'utf8')) !== operation.hash) {
      if (fs.existsSync(target)) continue;
      atomicWrite(target, operation.body);
    }
    await store.update(object.id, { path: operation.path, properties: { contentHash: operation.hash, fileModifiedAt: fs.statSync(target).mtime.toISOString() } });
    fs.unlinkSync(journalPath); recovered.push(object.id);
  }
  const objects = await store.list();
  const missing: string[] = [], changed: string[] = [], unregistered: string[] = [];
  const updates: PropertyPatch[] = [];
  const known = new Set(objects.flatMap(object => [object.path, typeof object.properties.indexPath === 'string' ? object.properties.indexPath : null].filter((file): file is string => Boolean(file))));
  for (const object of objects) {
    if (!object.path) continue;
    try {
      const target = contentPath(root, object.path);
      if (!fs.existsSync(target)) { missing.push(object.id); continue; }
      const stat = fs.statSync(target);
      const previous = object.properties.fileModifiedAt;
      const actual = stat.mtime.toISOString();
      if (previous && previous !== actual) changed.push(object.id);
      if (!previous || previous !== actual) {
        const now = new Date().toISOString();
        updates.push({ id: object.id, expectedPath: object.path, expectedProperties: { fileModifiedAt: previous }, ...(previous ? { modifiedAt: now } : {}), properties: { fileModifiedAt: actual, ...(previous ? { activityAt: now } : {}) } });
      }
    } catch { missing.push(object.id); }
  }
  await store.patchPropertiesMany(updates);
  function walk(folder: string) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['sources', 'archive', 'connections', 'migration'].includes(entry.name)) continue;
      const target = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) {
        const relative = path.relative(root, target);
        if (!known.has(relative)) unregistered.push(relative);
      }
    }
  }
  walk(root);
  return { recovered, missing, changed, unregistered, checked: objects.length };
}
