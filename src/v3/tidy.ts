import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { ObjectStore } from './store.ts';
import { vaultRoot, contentPath, fileTitle } from './files.ts';
import { metadataDirectory } from './config.ts';
import type { ObjectRecord } from './models.ts';

/** The original vaults the import read. They stay read-only; artifacts are opened from there. */
export function sourceVaultRoots(): Record<string, string> {
  const base = process.env.TWOB_SOURCES_HOME || path.join(os.homedir(), 'obsidian');
  return { legacy: path.join(base, '2bv2'), personal: path.join(base, 'personal') };
}
export function sourceFile(vault: unknown, relative: unknown): string | null {
  const root = sourceVaultRoots()[String(vault)];
  if (!root || typeof relative !== 'string' || !relative || path.isAbsolute(relative)) return null;
  const file = path.resolve(root, relative);
  return file.startsWith(root + path.sep) ? file : null;
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const fileUrl = (file: string) => 'file://' + encodeURI(file).replace(/[()#?]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
const relativeLink = (fromPage: string, toPath: string) => encodeURI(path.posix.relative(path.posix.dirname(fromPage), toPath)).replace(/[()]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
/** archive/<vault>/<sha256>/<escaped source path> → vault and source path. */
function parseArchive(relative: string) {
  const match = relative.match(/^archive\/(legacy|personal)\/[0-9a-f]{64}\/(.+)$/);
  if (!match) return null;
  return { vault: match[1], sourcePath: match[2].split('/').map(part => part.replace(/^%2E2b$/, '.2b').replace(/%25/g, '%')).join('/') };
}

/**
 * Makes the vault plain: pages get readable names under objects/<type>/, links follow them, and the
 * import folders (archive, migration, connections) leave the vault. Artifacts keep their original file
 * in the source vault, referenced by localPath.
 */
export async function tidyVault(rootInput: string, store: ObjectStore, dryRun = false) {
  const root = vaultRoot(rootInput);
  const objects = await store.list();
  const relationships = await store.relationships();
  const byId = new Map(objects.map(object => [object.id, object]));
  const ownerOf = new Map<string, string>();
  for (const edge of relationships) if (edge.kind === 'part-of' && !ownerOf.has(edge.from)) ownerOf.set(edge.from, edge.to);
  for (const edge of relationships) if (edge.kind === 'has-artifact' && !ownerOf.has(edge.to)) ownerOf.set(edge.to, edge.from);

  const retired = objects.filter(object => object.path?.startsWith('migration/'));
  const pages = objects.filter(object => object.path?.endsWith('.md') && !/^(archive|migration)\//.test(object.path));

  // 1. New page paths. Same name in one folder: add the owner's name, then a number.
  const newPath = new Map<string, string>();
  const keep = (object: ObjectRecord) => !object.path!.includes('/');
  const groups = new Map<string, ObjectRecord[]>();
  for (const object of pages) {
    if (keep(object)) { newPath.set(object.id, object.path!); continue; }
    const key = `objects/${object.type}/${fileTitle(object.name).toLowerCase()}`;
    groups.set(key, [...(groups.get(key) || []), object]);
  }
  const taken = new Set([...newPath.values()].map(file => file.toLowerCase()));
  let disambiguated = 0, numbered = 0;
  for (const group of groups.values()) {
    for (const object of group.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))) {
      const owner = byId.get(ownerOf.get(object.id) ?? '');
      let base = fileTitle(object.name);
      if (group.length > 1 && owner) { base = fileTitle(`${object.name} — ${owner.name}`); disambiguated++; }
      let candidate = `objects/${object.type}/${base}.md`;
      const sourceFolder = path.posix.basename(path.posix.dirname(String(object.properties.sourcePath || '')));
      if (taken.has(candidate.toLowerCase()) && sourceFolder && sourceFolder !== '.') base = fileTitle(`${base} — ${sourceFolder}`), candidate = `objects/${object.type}/${base}.md`;
      if (taken.has(candidate.toLowerCase())) numbered++;
      for (let copy = 2; taken.has(candidate.toLowerCase()); copy++) candidate = `objects/${object.type}/${base} (${copy}).md`;
      taken.add(candidate.toLowerCase());
      newPath.set(object.id, candidate);
    }
  }

  // 2. Where each old location now leads: a renamed page, or an original file in a source vault.
  const pageBySource = new Map<string, string>();
  for (const object of pages) if (object.type !== 'artifact' && object.properties.sourceVault && object.properties.sourcePath) pageBySource.set(`${object.properties.sourceVault}:${object.properties.sourcePath}`, newPath.get(object.id)!);
  const movedPage = new Map<string, string>();
  for (const object of pages) movedPage.set(object.path!, newPath.get(object.id)!);
  for (const object of retired) { const target = byId.get(String(object.properties.redirectTo)); if (target && newPath.has(target.id)) movedPage.set(object.path!, newPath.get(target.id)!); }
  const indexTarget = new Map<string, string>();
  for (const object of objects) {
    const file = sourceFile(object.properties.sourceVault, object.properties.sourcePath);
    if (typeof object.properties.indexPath === 'string' && file) indexTarget.set(object.properties.indexPath, file);
  }
  type Target = { page: string } | { file: string } | null;
  const resolve = (vaultPath: string): Target => {
    const clean = vaultPath.replace(/\.md$/i, '');
    for (const candidate of [vaultPath, `${clean}.md`]) {
      if (movedPage.has(candidate)) return { page: movedPage.get(candidate)! };
      if (indexTarget.has(candidate)) return { file: indexTarget.get(candidate)! };
    }
    const archived = parseArchive(vaultPath);
    if (archived) {
      const page = pageBySource.get(`${archived.vault}:${archived.sourcePath}`);
      if (page) return { page };
      const file = sourceFile(archived.vault, archived.sourcePath);
      return file ? { file } : null;
    }
    return null;
  };

  // 3. Rewrite links in every page.
  const stats = { pagesRenamed: 0, linksRewritten: 0, originalHeadersRemoved: 0, unresolvedArchiveLinks: [] as string[] };
  const contents = new Map<string, string>();
  for (const object of pages) {
    const oldFile = object.path!, nextFile = newPath.get(object.id)!;
    if (oldFile !== nextFile) stats.pagesRenamed++;
    const absolute = contentPath(root, oldFile);
    if (!fs.existsSync(absolute)) continue;
    const before = fs.readFileSync(absolute, 'utf8');
    let text = before.replace(/^\[Original file\]\([^)\n]*\)\n\n?/m, () => { stats.originalHeadersRemoved++; return ''; });
    text = text.replace(/(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/g, (whole, bang, label, target) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) return whole;
      let decoded: string;
      try { decoded = decodeURIComponent(target.split('#')[0]); } catch { return whole; }
      const anchor = target.includes('#') ? '#' + target.split('#').slice(1).join('#') : '';
      const vaultPath = path.posix.normalize(path.posix.join(path.posix.dirname(oldFile), decoded));
      const found = resolve(vaultPath);
      if (found) { stats.linksRewritten++; return 'page' in found ? `${bang}[${label}](${relativeLink(nextFile, found.page)}${anchor})` : `[${label}](${fileUrl(found.file)})`; }
      if (vaultPath.startsWith('archive/')) { stats.unresolvedArchiveLinks.push(`${oldFile} → ${vaultPath}`); return label; }
      if (oldFile !== nextFile && fs.existsSync(path.join(root, vaultPath))) { stats.linksRewritten++; return `${bang}[${label}](${relativeLink(nextFile, vaultPath)}${anchor})`; }
      return whole;
    });
    text = text.replace(/\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (whole, target, anchor = '', label) => {
      const found = resolve(target.trim());
      if (!found) {
        if (target.startsWith('archive/')) { stats.unresolvedArchiveLinks.push(`${oldFile} → ${target}`); return label || path.posix.basename(target); }
        return whole;
      }
      stats.linksRewritten++;
      if ('page' in found) return `[[${found.page.replace(/\.md$/, '')}${anchor}${label ? `|${label}` : ''}]]`;
      return `[${label || path.basename(found.file)}](${fileUrl(found.file)})`;
    });
    if (text !== before || oldFile !== nextFile) contents.set(object.id, text);
  }

  const artifactsOutside = objects.filter(object => object.path?.startsWith('archive/'));
  const indexPages = objects.map(object => object.properties.indexPath).filter((file): file is string => typeof file === 'string' && fs.existsSync(path.join(root, file)));
  const report = {
    dryRun, ...stats, unresolvedArchiveLinks: stats.unresolvedArchiveLinks.length, unresolvedExamples: stats.unresolvedArchiveLinks.slice(0, 10),
    disambiguated, numbered, artifactsNowInSourceVault: artifactsOutside.length, indexPagesDeleted: indexPages.length, retiredObjectsDeleted: retired.length,
    foldersRemoved: ['archive', 'connections', 'migration'].filter(folder => fs.existsSync(path.join(root, folder))),
    examples: pages.filter(object => object.path !== newPath.get(object.id)).slice(0, 8).map(object => `${object.path} → ${newPath.get(object.id)}`),
  };
  if (dryRun) return report;

  // 4. Apply: plan journal first, then files, then metadata, then the folders.
  const metadata = metadataDirectory(root);
  fs.writeFileSync(path.join(metadata, `tidy-plan-${Date.now()}.json`), JSON.stringify(pages.map(object => [object.id, object.path, newPath.get(object.id)])));
  const updated: ObjectRecord[] = [];
  const dropImportPaths = (properties: Record<string, unknown>) => Object.fromEntries(Object.entries(properties).filter(([key]) => !['archivePath', 'archiveVersions', 'indexPath'].includes(key)));
  for (const object of pages) {
    const oldFile = object.path!, nextFile = newPath.get(object.id)!;
    const text = contents.get(object.id);
    const properties = dropImportPaths(object.properties);
    if (text !== undefined) {
      const target = contentPath(root, nextFile), temporary = `${target}.tidy.tmp`;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const previous = fs.readFileSync(contentPath(root, oldFile), 'utf8');
      fs.writeFileSync(temporary, text);
      fs.unlinkSync(contentPath(root, oldFile));
      fs.renameSync(temporary, target);
      properties.fileModifiedAt = fs.statSync(target).mtime.toISOString();
      if (properties.contentHash) properties.contentHash = hash(text);
      if (properties.generatedBodyHash === hash(previous)) properties.generatedBodyHash = hash(text);
    }
    if (text !== undefined || Object.keys(properties).length !== Object.keys(object.properties).length) updated.push({ ...object, path: nextFile, properties });
  }
  for (const object of artifactsOutside) updated.push({ ...object, path: null, properties: { ...dropImportPaths(object.properties), ...(sourceFile(object.properties.sourceVault, object.properties.sourcePath) ? { localPath: sourceFile(object.properties.sourceVault, object.properties.sourcePath) } : {}) } });
  const updatedIds = new Set(updated.map(record => record.id));
  for (const object of objects) if (!updatedIds.has(object.id) && !retired.includes(object) && ['archivePath', 'archiveVersions', 'indexPath'].some(key => key in object.properties)) updated.push({ ...object, properties: dropImportPaths(object.properties) });
  for (let offset = 0; offset < updated.length; offset += 100) await store.upsertMany(updated.slice(offset, offset + 100));
  await store.removeObjects(retired.map(object => object.id));
  for (const file of indexPages) fs.rmSync(path.join(root, file), { force: true });
  const migrationDestination = path.join(metadata, 'import-migration');
  if (fs.existsSync(path.join(root, 'migration'))) {
    if (fs.existsSync(migrationDestination)) throw new Error(`Already exists: ${migrationDestination}`);
    fs.renameSync(path.join(root, 'migration'), migrationDestination);
  }
  fs.rmSync(path.join(root, 'archive'), { recursive: true, force: true });
  fs.rmSync(path.join(root, 'connections'), { recursive: true, force: true });
  for (const folder of ['objects', 'collections']) removeEmptyFolders(path.join(root, folder));
  return { ...report, migrationMovedTo: migrationDestination, objectsUpdated: updated.length };
}

function removeEmptyFolders(folder: string) {
  if (!fs.existsSync(folder)) return;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) if (entry.isDirectory()) removeEmptyFolders(path.join(folder, entry.name));
  if (!fs.readdirSync(folder).length) fs.rmdirSync(folder);
}
