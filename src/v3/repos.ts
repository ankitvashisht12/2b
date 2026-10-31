import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { loadConfig } from './config.ts';
import { vaultRoot } from './files.ts';
import type { ObjectStore } from './store.ts';
import type { ObjectRecord, Relationship } from './models.ts';

/** A folder holding one of these is a code repo. Repos live in reposRoot(), never in the vault. */
const REPO_MARKER = /(?:^|\/)(?:\.git|package\.json|tsconfig\.json|pyproject\.toml|requirements\.txt|go\.mod|Cargo\.toml|node_modules|\.next|\.vite)(?:\/|$)/;
/** Credentials are never stored as vault content. */
export const SECRET_FILE = /(?:^|\/)(?:\.env[^/]*|[^/]+\.env|\.[^/]*-key|[^/]+\.pem)$/;
/** A task's own Markdown (readme, log) stays in the vault even when the task folder is the repo. */
const TASK_OWNED = /\/tasks\/[^/]+\/[^/]+\.md$/;
const REPO_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

export function reposRoot(): string {
  return path.resolve((process.env.TWOB_REPOS_HOME || loadConfig().reposPath).replace(/^~(?=\/|$)/, os.homedir()));
}

/** Shallowest folder that holds a repo marker. Nested repos merge into their outer one. */
export function findRepoRoots(sourcePaths: string[]): string[] {
  const candidates = new Set<string>();
  for (const sourcePath of sourcePaths) {
    const marker = sourcePath.match(REPO_MARKER);
    if (marker && marker.index! > 0) candidates.add(sourcePath.slice(0, marker.index));
  }
  return [...candidates].sort().filter((root, position, sorted) => !sorted.slice(0, position).some(outer => root.startsWith(outer + '/')));
}

/** `projects/x/tasks/2026-09-22-av-analytics-ai/frontend-replica` → `av-analytics-ai-frontend-replica`. */
export function repoName(root: string): string {
  const task = root.match(/\/tasks\/([^/]+)(?:\/(.+))?$/);
  const raw = task ? [task[1].replace(/^\d{4}-\d{2}-\d{2}-/, ''), task[2]].filter(Boolean).join('-') : root;
  return raw.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceOf = (object: ObjectRecord) => String(object.properties.sourcePath || '');
const originalOf = (object: ObjectRecord) => String(object.properties.archivePath || object.path || '');
const now = () => new Date().toISOString();

function repoArtifact(name: string, localPath: string, tags: string[], extra: Record<string, unknown> = {}): ObjectRecord {
  return { id: `v3-repo:${name}`, type: 'artifact', name, description: `Code repo outside the vault: ${localPath}`, properties: { localPath, about: 'code repo', processingState: 'processed', ...extra }, tags, path: null, createdAt: now(), modifiedAt: now() };
}

/** Rule for new code: make the folder under reposRoot() and keep only a linked artifact in 2b. */
export async function createRepo(store: ObjectStore, name: string, options: { from?: string; link?: string } = {}) {
  if (!REPO_NAME.test(name)) throw new Error('Repo name: letters, digits, dot, dash, underscore');
  const target = path.join(reposRoot(), name);
  if (await store.get(`v3-repo:${name}`)) throw new Error(`Repo already registered: ${name}`);
  const linked = options.link ? await store.get(options.link) : null;
  if (options.link && !linked) throw new Error(`Object not found: ${options.link}`);
  if (fs.existsSync(target)) throw new Error(`Folder already exists: ${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (options.from) fs.renameSync(path.resolve(options.from), target);
  else fs.mkdirSync(target);
  const artifact = await store.upsert(repoArtifact(name, target, linked?.tags || []));
  if (linked) await store.relate(linked.id, 'has-artifact', artifact.id, { provenance: 'repo-create' });
  return { ...artifact, linkedTo: linked?.id ?? null };
}

/** Moves imported code repos out of the vault and removes imported secret files. */
export async function extractRepos(rootInput: string, store: ObjectStore, dryRun = false) {
  const root = vaultRoot(rootInput);
  const objects = (await store.list()).filter(object => originalOf(object).startsWith('archive/') && sourceOf(object));
  const relationships = await store.relationships();
  const repos = findRepoRoots(objects.map(sourceOf)).map(repoRoot => {
    const members = objects.filter(object => sourceOf(object).startsWith(repoRoot + '/') && !TASK_OWNED.test(sourceOf(object)));
    return { repoRoot, name: repoName(repoRoot), members };
  });
  const moving = new Set(repos.flatMap(repo => repo.members.map(object => object.id)));
  const secrets = objects.filter(object => !moving.has(object.id) && SECRET_FILE.test(sourceOf(object)));
  const plan = { repos: repos.map(repo => ({ name: repo.name, source: repo.repoRoot, files: repo.members.length, target: path.join(reposRoot(), repo.name) })), secretFilesRemoved: secrets.map(sourceOf) };
  if (dryRun) return { dryRun: true, ...plan };

  for (const repo of repos) {
    const target = path.join(reposRoot(), repo.name);
    if (fs.existsSync(target)) throw new Error(`Folder already exists: ${target}. Move it away and run again.`);
  }
  const removed: ObjectRecord[] = [...secrets];
  for (const repo of repos) {
    const target = path.join(reposRoot(), repo.name);
    for (const member of repo.members) {
      const destination = path.join(target, sourceOf(member).slice(repo.repoRoot.length + 1));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, originalOf(member)), destination);
      if (member.properties.sha256 && sha256(destination) !== member.properties.sha256) throw new Error(`Checksum mismatch after copy: ${destination}`);
    }
    const ids = new Set(repo.members.map(object => object.id));
    const touching = relationships.filter(edge => ids.has(edge.from) !== ids.has(edge.to));
    const ownerVotes = new Map<string, number>();
    for (const edge of touching) if (edge.kind === 'part-of' && ids.has(edge.from)) ownerVotes.set(edge.to, (ownerVotes.get(edge.to) || 0) + 1);
    const owner = [...ownerVotes].sort((left, right) => right[1] - left[1])[0]?.[0];
    const artifact = await store.upsert(repoArtifact(repo.name, target, repo.members[0].tags, { sourcePath: repo.repoRoot, ...(repo.members[0].properties.sourceVault ? { sourceVault: repo.members[0].properties.sourceVault } : {}) }));
    const redirected: Relationship[] = [];
    for (const edge of touching) {
      const from = ids.has(edge.from) ? artifact.id : edge.from, to = ids.has(edge.to) ? artifact.id : edge.to;
      if (from === owner && to === artifact.id || from === artifact.id && to === owner) continue;
      redirected.push({ ...edge, id: createHash('sha256').update(JSON.stringify([from, edge.kind, to])).digest('hex'), from, to });
    }
    if (owner) await store.relate(owner, 'has-artifact', artifact.id, { provenance: 'repo-extract' });
    await store.upsertRelationships([...new Map(redirected.map(edge => [edge.id, edge])).values()]);
    removed.push(...repo.members);
  }
  await store.removeObjects(removed.map(object => object.id));
  for (const object of removed) {
    const files = new Set([object.path, originalOf(object), ...(object.properties.archiveVersions as string[] || []), object.properties.indexPath as string].filter((file): file is string => Boolean(file)));
    for (const file of files) {
      const absolute = path.join(root, file);
      fs.rmSync(absolute, { force: true });
      for (let folder = path.dirname(absolute); folder.startsWith(path.join(root, 'archive') + path.sep) && fs.existsSync(folder) && !fs.readdirSync(folder).length; folder = path.dirname(folder)) fs.rmdirSync(folder);
    }
  }
  return { dryRun: false, ...plan, objectsRemoved: removed.length };
}
