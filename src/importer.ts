import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  AREAS, PROJECT_STATUSES, REASON_REQUIRED, TASK_STATUSES, UserError, appendLog, assertOneOf, assertSlug,
  createProject, expandHome, localDate, localDateTime, readEntry, writeEntry, type Artifact, type Entry,
} from './store.ts';

const SKIPPED_NAMES = new Set(['CLAUDE.md', 'AGENTS.md', '.obsidian', '.DS_Store', '.git']);
const JUNK_FOLDERS = new Set(['node_modules', '__pycache__']);
const RECORD_FILES = new Set(['readme.md', 'log.md']);
const DATED_SLUG = /^\d{4}-\d{2}-\d{2}-/;

export type ScanItem = {
  source: string; group: string; type: 'dir' | 'file'; files: number; bytes: number;
  dateGuess: string; title: string | null; statusLine: string | null; topFiles: string[];
};
export type PlanProject = { slug: string; title: string; area: string; status: string; statusReason?: string; started?: string; description?: string };
export type PlanArtifact = { path: string; title?: string; about?: string; why?: string };
export type PlanItem = {
  source: string; project?: string; task?: string; inbox?: string; title?: string; status?: string; statusReason?: string;
  repo?: string; branch?: string; prs?: string[]; artifacts?: PlanArtifact[];
};
export type ImportPlan = { projects: PlanProject[]; items: PlanItem[] };
export type ImportReport = { copied: number; files: number; skippedJunkBytes: number; problems: string[] };

const isJunkFile = (name: string) => name.endsWith('.map') || name === '.DS_Store';
const isJunk = (target: string) => JUNK_FOLDERS.has(path.basename(target)) || isJunkFile(path.basename(target));
const isDirectory = (target: string) => fs.statSync(target).isDirectory();

function keptFiles(target: string): string[] {
  if (!isDirectory(target)) return isJunkFile(path.basename(target)) ? [] : [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap(item => {
    const fullPath = path.join(target, item.name);
    if (item.isDirectory()) return JUNK_FOLDERS.has(item.name) ? [] : keptFiles(fullPath);
    return item.isFile() && !isJunkFile(item.name) ? [fullPath] : [];
  });
}

function folderBytes(target: string): number {
  return fs.readdirSync(target, { withFileTypes: true }).reduce((total, item) => {
    const fullPath = path.join(target, item.name);
    if (item.isDirectory()) return total + folderBytes(fullPath);
    return total + (item.isFile() ? fs.statSync(fullPath).size : 0);
  }, 0);
}

function guessDate(name: string, text: string, files: string[]): string {
  const fromName = name.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? name.match(/(20\d{2})(\d{2})(\d{2})/)?.slice(1).join('-');
  if (fromName) return fromName;
  const fromText = text.match(/started:?\s*(\d{4}-\d{2}-\d{2})/i)?.[1];
  if (fromText) return fromText;
  const earliest = files.reduce((oldest, file) => Math.min(oldest, fs.statSync(file).mtimeMs), Infinity);
  return localDate(Number.isFinite(earliest) ? new Date(earliest) : new Date());
}

function describe(target: string, group: string): ScanItem {
  const isDir = isDirectory(target);
  const files = keptFiles(target);
  const readmeName = isDir ? fs.readdirSync(target).find(name => name.toLowerCase() === 'readme.md') : undefined;
  const textFile = isDir ? (readmeName ? path.join(target, readmeName) : null) : (target.endsWith('.md') ? target : null);
  const text = textFile ? fs.readFileSync(textFile, 'utf8') : '';
  return {
    source: target,
    group,
    type: isDir ? 'dir' : 'file',
    files: files.length,
    bytes: files.reduce((total, file) => total + fs.statSync(file).size, 0),
    dateGuess: guessDate(path.basename(target), text, files),
    title: text.match(/^# (.+)$/m)?.[1].trim() ?? null,
    statusLine: text.match(/^status:.*$/im)?.[0].trim() ?? null,
    topFiles: isDir ? fs.readdirSync(target).filter(name => !SKIPPED_NAMES.has(name) && !JUNK_FOLDERS.has(name)).slice(0, 15) : [],
  };
}

export function scanSources(sources: string[]): ScanItem[] {
  return sources.map(expandHome).flatMap(sourceRoot => {
    if (!fs.existsSync(sourceRoot) || !isDirectory(sourceRoot)) throw new UserError(`${sourceRoot} is not a folder`);
    return fs.readdirSync(sourceRoot).sort()
      .filter(name => !SKIPPED_NAMES.has(name))
      .map(name => describe(path.join(sourceRoot, name), path.basename(sourceRoot)));
  });
}

function catchProblem(problems: string[], label: string, check: () => void): void {
  try {
    check();
  } catch (error) {
    problems.push(`${label}: ${(error as Error).message}`);
  }
}

function inboxTarget(root: string, item: PlanItem, source: string): string {
  return path.join(root, 'inbox', item.inbox + (isDirectory(source) ? '' : path.extname(source)));
}

export function validatePlan(root: string, plan: ImportPlan): string[] {
  const problems: string[] = [];
  const plannedProjects = new Set(plan.projects.map(project => project.slug));
  for (const project of plan.projects) {
    catchProblem(problems, project.slug, () => {
      assertSlug(project.slug, 'project');
      assertOneOf(project.area, AREAS, 'area');
      assertOneOf(project.status, PROJECT_STATUSES, 'project status');
    });
    if (REASON_REQUIRED.includes(project.status) && !project.statusReason) problems.push(`${project.slug}: status ${project.status} needs statusReason`);
  }
  const folderTargets = new Set<string>();
  for (const item of plan.items) {
    const source = expandHome(item.source);
    if (!fs.existsSync(source)) {
      problems.push(`${item.source}: source does not exist`);
      continue;
    }
    if (Boolean(item.inbox) === Boolean(item.task)) {
      problems.push(`${item.source}: give either project and task, or inbox`);
      continue;
    }
    if (item.inbox) {
      catchProblem(problems, item.source, () => assertSlug(item.inbox!, 'inbox name'));
      if (!DATED_SLUG.test(item.inbox)) problems.push(`${item.source}: inbox name must start with yyyy-mm-dd-`);
      if (fs.existsSync(inboxTarget(root, item, source))) problems.push(`${item.source}: inbox/${item.inbox} already exists`);
      continue;
    }
    const projectExists = item.project && (plannedProjects.has(item.project) || fs.existsSync(path.join(root, 'projects', item.project, 'readme.md')));
    if (!projectExists) problems.push(`${item.source}: project "${item.project}" is not in the plan or the store`);
    catchProblem(problems, item.source, () => assertSlug(item.task!, 'task'));
    if (!DATED_SLUG.test(item.task!)) problems.push(`${item.source}: task "${item.task}" must start with yyyy-mm-dd-`);
    if (item.status) {
      catchProblem(problems, item.source, () => assertOneOf(item.status!, TASK_STATUSES, 'task status'));
      if (REASON_REQUIRED.includes(item.status) && !item.statusReason) problems.push(`${item.source}: status ${item.status} needs statusReason`);
    }
    const target = path.join(root, 'projects', item.project ?? '', 'tasks', item.task!);
    if (fs.existsSync(target)) problems.push(`${item.source}: ${path.relative(root, target)} already exists`);
    if (isDirectory(source)) {
      if (folderTargets.has(target)) problems.push(`${item.source}: two folders target ${item.task}`);
      folderTargets.add(target);
    }
  }
  return problems;
}

function checksums(target: string): Map<string, string> {
  const base = isDirectory(target) ? target : path.dirname(target);
  return new Map(keptFiles(target).map(file => [
    path.relative(base, file),
    crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  ]));
}

function junkBytes(target: string): number {
  if (!isDirectory(target)) return isJunkFile(path.basename(target)) ? fs.statSync(target).size : 0;
  return fs.readdirSync(target, { withFileTypes: true }).reduce((total, item) => {
    const fullPath = path.join(target, item.name);
    if (item.isDirectory()) return total + (JUNK_FOLDERS.has(item.name) ? folderBytes(fullPath) : junkBytes(fullPath));
    return total + (item.isFile() && isJunkFile(item.name) ? fs.statSync(fullPath).size : 0);
  }, 0);
}

function copyWithoutJunk(source: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, {
    recursive: true, preserveTimestamps: true, errorOnExist: true, force: false,
    filter: candidate => candidate === source || !isJunk(candidate),
  });
}

function latestChange(dir: string): string {
  const latest = keptFiles(dir).reduce((newest, file) => Math.max(newest, fs.statSync(file).mtimeMs), 0);
  return localDateTime(latest ? new Date(latest) : new Date());
}

function writeTaskRecord(item: PlanItem, taskDir: string, originalReadme: string | null): void {
  const existingName = fs.readdirSync(taskDir).find(name => name.toLowerCase() === 'readme.md');
  if (existingName && existingName !== 'readme.md') {
    fs.renameSync(path.join(taskDir, existingName), path.join(taskDir, 'readme.md.tmp'));
    fs.renameSync(path.join(taskDir, 'readme.md.tmp'), path.join(taskDir, 'readme.md'));
  }
  const title = item.title ?? item.task!;
  const started = item.task!.slice(0, 10);
  const plannedArtifacts = new Map((item.artifacts ?? []).map(artifact => [artifact.path, artifact]));
  const artifacts: Artifact[] = fs.readdirSync(taskDir)
    .filter(name => !RECORD_FILES.has(name.toLowerCase()) && fs.statSync(path.join(taskDir, name)).isFile())
    .sort()
    .map(name => {
      const planned = plannedArtifacts.get(name);
      return { path: name, title: planned?.title ?? name, about: planned?.about ?? '', why: planned?.why ?? '', added: started };
    });
  const status = item.status ?? 'done';
  const entry: Entry = {
    kind: 'task', id: `${item.project}/${item.task}`, project: item.project!, dir: taskDir,
    body: originalReadme ?? `\n# ${title}\n`,
    fields: {
      title, kind: 'normal', status, 'status-reason': item.statusReason ?? null, started, due: null,
      repo: item.repo ?? null, branch: item.branch ?? null, prs: item.prs ?? [], resources: [], links: [], artifacts,
    },
  };
  writeEntry(entry);
  appendLog(taskDir, 'created', title, `${started} 00:00`);
  if (status !== 'todo') appendLog(taskDir, `status todo -> ${status}`, 'imported', latestChange(taskDir));
}

function registerLooseArtifact(item: PlanItem, taskDir: string, fileName: string): void {
  const entry = readEntry('task', item.project!, taskDir);
  const planned = item.artifacts?.find(artifact => artifact.path === fileName);
  const artifact: Artifact = {
    path: fileName, title: planned?.title ?? item.title ?? fileName, about: planned?.about ?? '', why: planned?.why ?? '', added: localDate(),
  };
  entry.fields.artifacts = [...((entry.fields.artifacts as Artifact[] | null) ?? []), artifact];
  writeEntry(entry);
  appendLog(taskDir, `artifact ${fileName}`, 'imported');
}

function verify(before: Map<string, string>, newPathFor: (relative: string) => string, label: string, originals: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const [relative, hash] of before) {
    const newPath = newPathFor(relative);
    if (!fs.existsSync(newPath)) {
      problems.push(`${label}: ${relative} is missing after the copy`);
      continue;
    }
    const original = originals.get(relative);
    if (original !== undefined) {
      const current = fs.readFileSync(newPath, 'utf8');
      const isReadme = /^readme\.md$/i.test(relative);
      const isPreserved = isReadme ? current.endsWith(original) : current.startsWith(original);
      if (!isPreserved) problems.push(`${label}: ${relative} lost its original text`);
      continue;
    }
    if (crypto.createHash('sha256').update(fs.readFileSync(newPath)).digest('hex') !== hash) problems.push(`${label}: ${relative} changed during the copy`);
  }
  return problems;
}

export function applyPlan(root: string, plan: ImportPlan, { dryRun = false } = {}): ImportReport {
  const planProblems = validatePlan(root, plan);
  if (planProblems.length) throw new UserError(`plan has problems:\n${planProblems.map(problem => `  ${problem}`).join('\n')}`);
  const items = [...plan.items].sort((first, second) =>
    Number(!isDirectory(expandHome(first.source))) - Number(!isDirectory(expandHome(second.source))));
  const before = items.map(item => checksums(expandHome(item.source)));
  const files = before.reduce((total, map) => total + map.size, 0);
  const skippedJunkBytes = items.reduce((total, item) => total + junkBytes(expandHome(item.source)), 0);
  if (dryRun) return { copied: items.length, files, skippedJunkBytes, problems: [] };

  for (const project of plan.projects) {
    if (fs.existsSync(path.join(root, 'projects', project.slug, 'readme.md'))) continue;
    const started = project.started ?? localDate();
    const entry = createProject(root, project.slug, { area: project.area, title: project.title, started });
    entry.fields.status = project.status;
    entry.fields['status-reason'] = project.statusReason ?? null;
    if (project.description) entry.body = `\n# ${project.title}\n\n${project.description}\n`;
    writeEntry(entry);
    fs.writeFileSync(path.join(entry.dir, 'log.md'), '# Log\n\n');
    appendLog(entry.dir, 'created', project.title, `${started} 00:00`);
  }

  const problems: string[] = [];
  items.forEach((item, index) => {
    const source = expandHome(item.source);
    const sourceIsDir = isDirectory(source);
    if (item.inbox) {
      const destination = inboxTarget(root, item, source);
      copyWithoutJunk(source, destination);
      const newPathFor = (relative: string) => sourceIsDir ? path.join(destination, relative) : destination;
      problems.push(...verify(before[index], newPathFor, item.source, new Map()));
      return;
    }
    const taskDir = path.join(root, 'projects', item.project!, 'tasks', item.task!);
    const originals = new Map<string, string>();
    if (sourceIsDir) {
      for (const name of fs.readdirSync(source)) {
        if (RECORD_FILES.has(name.toLowerCase())) originals.set(name, fs.readFileSync(path.join(source, name), 'utf8'));
      }
      copyWithoutJunk(source, taskDir);
      const readmeName = [...originals.keys()].find(name => name.toLowerCase() === 'readme.md');
      writeTaskRecord(item, taskDir, readmeName ? originals.get(readmeName)! : null);
      const newPathFor = (relative: string) => path.join(taskDir, /^readme\.md$/i.test(relative) ? 'readme.md' : relative);
      problems.push(...verify(before[index], newPathFor, item.source, originals));
    } else {
      const isNewTask = !fs.existsSync(taskDir);
      copyWithoutJunk(source, path.join(taskDir, path.basename(source)));
      if (isNewTask) writeTaskRecord(item, taskDir, null);
      else registerLooseArtifact(item, taskDir, path.basename(source));
      problems.push(...verify(before[index], relative => path.join(taskDir, relative), item.source, new Map()));
    }
  });
  return { copied: items.length, files, skippedJunkBytes, problems };
}
