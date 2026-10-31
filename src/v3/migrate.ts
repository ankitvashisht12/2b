import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { loadConfig, configPath, appHome, sourceVaults } from "./config.ts";
import { parse } from "../frontmatter.ts";

type SourceName = "legacy" | "personal";
type Entry = {
  vault: SourceName;
  sourcePath: string;
  bytes: number;
  sha256: string;
  createdAt: string;
  modifiedAt: string;
};
type RecordData = {
  id: string;
  type: string;
  name: string;
  description: string;
  properties: Record<string, unknown>;
  tags: string[];
  path: string | null;
  createdAt: string;
  modifiedAt: string;
};
export type MigrationReport = {
  dryRun: boolean;
  files: number;
  bytes: number;
  objects: number;
  skipped: string[];
  unresolvedLinks: string[];
  sourceUnchanged: boolean;
  manifest: Entry[];
  complete: boolean;
  retryable: boolean;
  conflicts: string[];
  errors: string[];
  maxRecordBytes: number;
  maxBatchBytes: number;
};
const excluded = new Set([
  ".git",
  ".obsidian",
  ".DS_Store",
  "node_modules",
  "__pycache__",
  ".cache",
  ".Trash",
]);
const archiveRelative = (relative: string) =>
  relative
    .split("/")
    .map((part) => part.replace(/%/g, "%25").replace(/^\.2b$/, "%2E2b"))
    .join("/");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const identity = (vault: string, relative: string) =>
  `import-${digest(`${vault}:${relative}`).slice(0, 24)}`;
const inside = (parent: string, child: string) =>
  child === parent || child.startsWith(parent + path.sep);
const slug = (name: string) =>
  name
    .replace(/[\x00-\x1f<>:"/\\|?*#[\]]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "Untitled";
async function checksum(filename: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename, { flags: "r" }))
    hash.update(chunk);
  return hash.digest("hex");
}
async function scan(
  source: string,
  vault: SourceName,
  skipped: string[],
): Promise<Entry[]> {
  const entries: Entry[] = [];
  async function visit(relative: string) {
    const filename = path.join(source, relative);
    const stat = await fs.lstat(filename);
    if (stat.isSymbolicLink()) {
      skipped.push(`${vault}:${relative} (symlink)`);
      return;
    }
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(filename)).sort()) {
        if (excluded.has(name)) {
          skipped.push(
            `${vault}:${path.posix.join(relative, name)} (excluded)`,
          );
          continue;
        }
        await visit(path.join(relative, name));
      }
    } else if (stat.isFile())
      entries.push({
        vault,
        sourcePath: relative.split(path.sep).join("/"),
        bytes: stat.size,
        sha256: await checksum(filename),
        createdAt: stat.birthtime.toISOString(),
        modifiedAt: stat.mtime.toISOString(),
      });
    else skipped.push(`${vault}:${relative} (special file)`);
  }
  await visit("");
  return entries;
}
async function writeOwned(filename: string, content: string | Buffer) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  try {
    await fs.writeFile(filename, content, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await fs.readFile(filename);
    if (!existing.equals(Buffer.from(content)))
      throw new Error(`Destination collision: ${filename}`);
  }
}
function metadata(text: string): Record<string, unknown> {
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (frontmatter && Buffer.byteLength(frontmatter[0]) > 64 * 1024)
    return { metadataArchived: true };
  try {
    return parse(text.replace(/\r\n/g, "\n")).fields;
  } catch {
    return {
      unparsedFrontmatter: text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "",
    };
  }
}
function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}
function sourceTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const local = value.match(
    /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::(\d{2}))?)?$/,
  );
  if (local && !validDate(local[1])) return null;
  const parsed = new Date(
    local
      ? `${local[1]}T${local[2] ?? "00:00"}:${local[3] ?? "00"}+05:30`
      : value,
  );
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function automationPath(relative: string): boolean {
  return /^(?:\.2b\/)?(?:jobs|reminders|schedules)(?:\/[^\n]+|)\.(?:md|json|ya?ml)$/i.test(
    relative,
  );
}
function sourceBody(text: string): string {
  try {
    return parse(text.replace(/\r\n/g, "\n")).body;
  } catch {
    return text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  }
}
const semanticPropertyKeys = new Set([
  "status",
  "contentDate",
  "archived",
  "migrationReview",
  "kind",
  "area",
  "priority",
  "due",
  "started",
  "noteType",
  "processingState",
  "links",
  "prs",
  "resources",
  "artifacts",
  "output",
  "repo",
  "repos",
  "branch",
  "every",
  "run",
  "agent",
  "model",
  "provider",
  "command",
  "instructions",
  "timezone",
  "enabled",
  "readingState",
  "author",
  "url",
  "email",
  "role",
  "aliases",
]);
function semanticSnapshot(record: RecordData): Record<string, unknown> {
  return {
    name: record.name,
    type: record.type,
    description: record.description,
    tags: record.tags,
    path: record.path,
    properties: Object.fromEntries(
      Object.entries(record.properties).filter(([key]) =>
        semanticPropertyKeys.has(key),
      ),
    ),
  };
}
function* byteBatches<T>(
  records: T[],
  maximum = 480 * 1024,
): Generator<{ records: T[]; bytes: number }> {
  let batch: T[] = [];
  let bytes = 64;
  for (const record of records) {
    const recordBytes = Buffer.byteLength(JSON.stringify(record)) + 256;
    if (recordBytes > maximum)
      throw new Error("Migration record exceeds byte limit");
    if (bytes + recordBytes > maximum || batch.length >= 100) {
      yield { records: batch, bytes };
      batch = [];
      bytes = 64;
    }
    batch.push(record);
    bytes += recordBytes;
  }
  if (batch.length) yield { records: batch, bytes };
}
function classify(relative: string, fields: Record<string, unknown>) {
  if (
    String(fields.kind).toLowerCase() === "recurring" &&
    (/^projects\/[^/]+\/tasks\/[^/]+\/(readme|index)\.md$/i.test(relative) ||
      automationPath(relative))
  )
    return "agent-job";
  if (String(fields.type) === "system") return "repository";
  if (
    /^(person|book|repository|organization|meeting|collection|project|task|note|artifact|reminder|agent-job|agent-run)$/.test(
      String(fields.type),
    )
  )
    return String(fields.type);
  if (/(^|\/)(log|rules|history|runs)(\/|\.|$)/i.test(relative))
    return "evidence";
  if (automationPath(relative)) return "automation";
  if (
    /^projects\/[^/]+\/(readme|index)\.md$/i.test(relative) ||
    /^projects\/[^/]+\.md$/i.test(relative)
  )
    return "project";
  if (
    /(^|\/)tasks\/[^/]+\/(readme|index)\.md$/i.test(relative) ||
    /^tasks\/[^/]+\.md$/i.test(relative)
  )
    return "task";
  if (
    /(^|\/)collections\/[^/]+\/(readme|index)\.md$/i.test(relative) ||
    /^collections\/[^/]+\.md$/i.test(relative)
  )
    return "collection";
  return /\.md$/i.test(relative) ? "note" : "artifact";
}
const planning =
  /(^|\/)(goals|weekly(?:-updates?)?|product-updates?)(\/|\.|-|$)/i;
const planningFront =
  /^projects\/(goals|weekly(?:-updates?)?|product-updates?)\/(readme|index)\.md$/i;

/** Reads sources only. A dry run never opens the store or creates the destination. */
export async function migrateVaults(options: {
  root: string;
  sources?: { personal: string; legacy: string };
  dryRun?: boolean;
  inventoryPath?: string;
}): Promise<MigrationReport> {
  const agentConfig = loadConfig();
  const sourceOptions = options.sources ?? sourceVaults();
  const sources = {
    legacy: await fs.realpath(sourceOptions.legacy),
    personal: await fs.realpath(sourceOptions.personal),
  };
  const root = path.resolve(options.root);
  // Resolve the nearest existing ancestor to detect destinations reached through symlinks.
  let ancestor = root;
  const suffix: string[] = [];
  while (true) {
    try {
      ancestor = await fs.realpath(ancestor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      suffix.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
  const resolvedRoot = path.join(ancestor, ...suffix);
  for (const source of [
    ...Object.values(sources),
    ...Object.values(sourceVaults()),
  ])
    if (inside(source, resolvedRoot) || inside(resolvedRoot, source))
      throw new Error("Destination and sources must not overlap");
  if (sources.legacy === sources.personal)
    throw new Error("Sources must be distinct");
  const report: MigrationReport = {
    dryRun: !!options.dryRun,
    files: 0,
    bytes: 0,
    objects: 0,
    skipped: [],
    unresolvedLinks: [],
    sourceUnchanged: false,
    manifest: [],
    complete: false,
    retryable: false,
    conflicts: [],
    errors: [],
    maxRecordBytes: 0,
    maxBatchBytes: 0,
  };
  for (const vault of ["legacy", "personal"] as const)
    report.manifest.push(
      ...(await scan(sources[vault], vault, report.skipped)),
    );
  report.files = report.manifest.length;
  report.bytes = report.manifest.reduce((sum, entry) => sum + entry.bytes, 0);
  const guidance = new Map<
    string,
    { project: string; collection: string; confidence: string; kind: string }
  >();
  try {
    const csv = await fs.readFile(
      options.inventoryPath ?? loadConfig().migration.inventoryPath ?? path.join(appHome(), "migrations", "backfill-inventory.csv"),
      "utf8",
    );
    for (const line of csv.split(/\r?\n/).slice(1)) {
      const cells = (line.match(/(?:"(?:[^"]|"")*"|[^,]*)(?:,|$)/g) ?? []).map(
        (cell) =>
          cell.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'),
      );
      if (cells[0])
        guidance.set(cells[0], {
          project: cells[1],
          collection: cells[2],
          confidence: cells[3],
          kind: cells[4],
        });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const records: RecordData[] = [];
  const bodies = new Map<string, string>();
  const bySource = new Map<string, RecordData>();
  const aliases = new Map<string, RecordData[]>();
  for (const entry of report.manifest) {
    const markdown = /\.md$/i.test(entry.sourcePath);
    const knownAutomation = automationPath(entry.sourcePath);
    const text =
      (markdown && entry.bytes <= 8 * 1024 * 1024) ||
      (knownAutomation && entry.bytes <= 64 * 1024)
        ? await fs.readFile(
            path.join(sources[entry.vault], entry.sourcePath),
            "utf8",
          )
        : "";
    let fields = markdown ? metadata(text) : {};
    if (
      knownAutomation &&
      /\.json$/i.test(entry.sourcePath) &&
      entry.bytes <= 64 * 1024
    ) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          fields = parsed;
      } catch {
        /* Exact config stays archived. */
      }
    }
    if (
      knownAutomation &&
      /\.ya?ml$/i.test(entry.sourcePath) &&
      entry.bytes <= 64 * 1024
    )
      fields = metadata(`---\n${text}\n---\n`);
    const normalized = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const hint =
      entry.vault === "personal" ? guidance.get(entry.sourcePath) : undefined;
    const type = planningFront.test(entry.sourcePath)
      ? "collection"
      : hint &&
          ["note", "artifact", "project", "task", "collection"].includes(
            hint.kind,
          )
        ? hint.kind
        : classify(entry.sourcePath, normalized);
    const dateFromPath = entry.sourcePath.match(
      /(?:^|\/)(\d{4}-\d{2})\/(\d{2})(?:\.md|\/)/,
    );
    const filenameDate = validDate(
      path.posix.basename(entry.sourcePath).match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0],
    );
    const dailyDate = validDate(
      dateFromPath ? `${dateFromPath[1]}-${dateFromPath[2]}` : undefined,
    );
    const containerDates = [
      ...path.posix
        .dirname(entry.sourcePath)
        .matchAll(/\b\d{4}-\d{2}-\d{2}\b/g),
    ];
    const containerDate = validDate(containerDates.at(-1)?.[0]);
    const contentDate = markdown
      ? (validDate(normalized.contentdate ?? normalized.date) ??
        filenameDate ??
        dailyDate)
      : null;
    const rawName = String(
      fields.title ??
        fields.name ??
        text.match(/^#\s+(.+)$/m)?.[1] ??
        (path.basename(entry.sourcePath).toLowerCase() === "readme.md"
          ? path.basename(path.dirname(entry.sourcePath))
          : path.basename(entry.sourcePath, path.extname(entry.sourcePath))),
    );
    const name = dateFromPath
      ? `${contentDate ?? dateFromPath[0]} — ${entry.sourcePath.split("/").slice(0, -3).join(" / ")}${/^\d{2}$/.test(rawName) || rawName.startsWith(String(contentDate)) ? "" : ` — ${rawName}`}`
      : rawName;
    const id = identity(entry.vault, entry.sourcePath);
    const archivePath = `archive/${entry.vault}/${entry.sha256}/${archiveRelative(entry.sourcePath)}`;
    const nativeProperties: Record<string, unknown> = {};
    for (const key of [
      "links",
      "prs",
      "resources",
      "artifacts",
      "output",
      "repo",
      "repos",
      "branch",
      "every",
      "run",
      "agent",
      "model",
      "command",
      "instructions",
      "timezone",
      "due",
      "started",
      "area",
      "priority",
    ]) {
      if (normalized[key] !== undefined && normalized[key] !== null)
        nativeProperties[key] = normalized[key];
    }
    const noteType = String(
      normalized["note-type"] ?? normalized.notetype ?? "general",
    );
    if (type === "note")
      nativeProperties.noteType = [
        "general",
        "journal",
        "reflection",
        "learning",
        "research",
        "decision",
        "meeting",
      ].includes(noteType)
        ? noteType
        : "general";
    if (noteType !== "general") nativeProperties.sourceNoteType = noteType;
    if (
      type === "task" &&
      !["high", "med", "low"].includes(String(nativeProperties.priority))
    ) {
      nativeProperties.sourcePriority = nativeProperties.priority ?? null;
      delete nativeProperties.priority;
    }
    if (!validDate(nativeProperties.due)) {
      if (nativeProperties.due)
        nativeProperties.sourceDue = nativeProperties.due;
      delete nativeProperties.due;
    }
    const statuses: Record<string, string[]> = {
      project: ["active", "paused", "on-hold", "done", "archived"],
      task: [
        "todo",
        "doing",
        "blocked",
        "done",
        "dropped",
        "paused",
        "archived",
      ],
      reminder: [
        "pending",
        "scheduled",
        "sent",
        "cancelled",
        "paused",
        "failed",
      ],
      "agent-run": [
        "pending",
        "queued",
        "running",
        "succeeded",
        "success",
        "completed",
        "failed",
        "cancelled",
        "skipped",
      ],
    };
    if (normalized.status) {
      if (!statuses[type] || statuses[type].includes(String(normalized.status)))
        nativeProperties.status = normalized.status;
      else nativeProperties.sourceStatus = normalized.status;
    }
    if (
      type === "project" &&
      ["ongoing", "finite"].includes(String(normalized.kind))
    )
      nativeProperties.kind = normalized.kind;
    const area =
      normalized.area === "work" || /^(work|tars)(\/|-)/i.test(entry.sourcePath)
        ? "work"
        : normalized.area === "personal" || entry.vault === "personal"
          ? "personal"
          : "work";
    if (type === "project") nativeProperties.area = area;
    const topic = entry.sourcePath.match(/^projects\/([^/]+)/)?.[1];
    const tags = [
      ...new Set([
        area,
        ...(topic ? [topic] : []),
        ...(Array.isArray(fields.tags) ? fields.tags.map(String) : []),
      ]),
    ];
    const created = sourceTimestamp(normalized.created ?? normalized.createdat);
    const modified = sourceTimestamp(
      normalized.modified ?? normalized.modifiedat ?? normalized.updated,
    );
    if (type === "agent-job") {
      const agent = String(
        normalized.agent ?? agentConfig.agents.primary.provider,
      );
      nativeProperties.agent = agent;
      if (["codex", "claude"].includes(agent))
        nativeProperties.provider = agent;
      const configured = [
        agentConfig.agents.primary,
        agentConfig.agents.fallback,
      ].find((choice) => choice?.provider === agent);
      if (normalized.model || configured?.model)
        nativeProperties.model = normalized.model ?? configured!.model;
      nativeProperties.agentConfigurationProvenance = {
        agent: normalized.agent ? "source-agent-field" : configPath(),
        model: normalized.model
          ? "source-model-field"
          : configured?.model
            ? configPath()
            : "unspecified",
      };
    }
    const disabled =
      type === "agent-job" ||
      type === "reminder" ||
      type === "automation" ||
      ((knownAutomation ||
        /^projects\/[^/]+\/tasks\/[^/]+\/(readme|index)\.md$/i.test(
          entry.sourcePath,
        )) &&
        (normalized.every != null ||
          normalized.run != null ||
          normalized.schedule != null ||
          normalized.reminder != null));
    const record: RecordData = {
      id,
      type,
      name: name.slice(0, 300),
      description: String(fields.description ?? "").slice(0, 4096),
      tags,
      path:
        type === "artifact"
          ? archivePath
          : `objects/${type}/${slug(name)}--${id.slice(7)}.md`,
      createdAt: created ?? entry.createdAt,
      modifiedAt: modified ?? entry.modifiedAt,
      properties: {
        ...nativeProperties,
        sourceVault: entry.vault,
        sourcePath: entry.sourcePath,
        sourceCreatedAt: entry.createdAt,
        sourceModifiedAt: entry.modifiedAt,
        sourceMetadata: fields,
        contentDate,
        containerDate,
        dateConfidence: contentDate ? "source-metadata-or-path" : "unknown",
        createdAtProvenance: created
          ? "explicit-source-created"
          : "filesystem-birth-estimate",
        modifiedAtProvenance: modified
          ? "explicit-source-modified"
          : "filesystem-mtime",
        archivePath,
        sha256: entry.sha256,
        processingState: /^inbox\//.test(entry.sourcePath) && ["note", "meeting"].includes(type) && hint?.confidence !== "high" ? "inbox" : "imported",
        provenance: { method: "source-file", sha256: entry.sha256 },
        ...(type === "artifact"
          ? { indexPath: `objects/artifact/${slug(name)}--${id.slice(7)}.md` }
          : {}),
        ...(type === "evidence" ? { archived: true } : {}),
        ...(disabled
          ? {
              enabled: false,
              migrationReview: "pending",
              originalConfiguration: {
                archivePath,
                keys: Object.keys(fields).slice(0, 100),
              },
            }
          : {}),
      },
    };
    record.tags = record.tags.slice(0, 100).map((tag) => tag.slice(0, 128));
    const archivedFields: string[] = [];
    for (const [key, value] of Object.entries(record.properties)) {
      if (Buffer.byteLength(JSON.stringify(value)) > 24 * 1024) {
        delete record.properties[key];
        archivedFields.push(key);
      }
    }
    if (!record.properties.sourceMetadata)
      record.properties.sourceMetadata = { metadataArchived: true };
    if (archivedFields.length)
      record.properties.archivedFields = archivedFields;
    if (entry.vault === "personal" && guidance.has(entry.sourcePath))
      record.properties.inventoryGuidance = guidance.get(entry.sourcePath);
    records.push(record);
    bodies.set(id, sourceBody(text));
    bySource.set(`${entry.vault}:${entry.sourcePath}`, record);
    for (const alias of new Set([
      entry.sourcePath,
      entry.sourcePath.replace(/\.md$/i, ""),
      path.posix.basename(entry.sourcePath, ".md"),
      ...(/\/(readme|index)\.md$/i.test(entry.sourcePath)
        ? [
            path.posix.dirname(entry.sourcePath),
            path.posix.dirname(entry.sourcePath).replace(/^projects\//, ""),
          ]
        : []),
    ])) {
      const key = `${entry.vault}:${alias.toLowerCase()}`;
      aliases.set(key, [...(aliases.get(key) ?? []), record]);
    }
  }
  for (const record of records) {
    const sourcePath = String(record.properties.sourcePath);
    const projectSlug = sourcePath.match(/^projects\/([^/]+)/)?.[1];
    const project = projectSlug
      ? bySource.get(
          `${record.properties.sourceVault}:projects/${projectSlug}/readme.md`,
        )
      : undefined;
    const hint = record.properties.inventoryGuidance as
      { project: string; collection: string } | undefined;
    const inheritedArea = project?.properties.area;
    const area =
      inheritedArea === "work" || inheritedArea === "personal"
        ? inheritedArea
        : hint &&
            ["travel", "home", "personal-content", "gym-and-health"].includes(
              hint.project,
            )
          ? "personal"
          : hint && ["tars-content", "work-planning"].includes(hint.project)
            ? "work"
            : record.tags[0];
    record.tags = [
      ...new Set([
        area,
        ...record.tags.slice(1),
        ...(hint && !/^(EXCLUDE|HOLD)$/.test(hint.project)
          ? [hint.project, hint.collection]
          : []),
      ]),
    ];
    record.properties.tagProvenance = {
      area: inheritedArea
        ? "source-project-area"
        : hint
          ? "source-inventory-context"
          : "source-vault-or-path",
      topic: projectSlug
        ? "source-project-path"
        : hint
          ? "inventory-v2"
          : "source-tags",
    };
  }
  for (const record of records) {
    const fields = record.properties.sourceMetadata as Record<string, unknown>;
    for (const field of ["artifacts", "output"]) {
      const values = Array.isArray(fields[field])
        ? (fields[field] as unknown[])
        : fields[field] == null
          ? []
          : [fields[field]];
      for (const value of values) {
        const relative =
          typeof value === "string"
            ? value
            : value && typeof value === "object"
              ? (value as Record<string, unknown>).path
              : null;
        if (typeof relative !== "string") continue;
        const sourcePath = path.posix.normalize(
          path.posix.join(
            path.posix.dirname(String(record.properties.sourcePath)),
            relative,
          ),
        );
        const artifact = bySource.get(
          `${record.properties.sourceVault}:${sourcePath}`,
        );
        if (
          !artifact ||
          /\/(readme|index)\.md$/i.test(sourcePath) ||
          artifact.type === "evidence"
        )
          continue;
        artifact.type = "artifact";
        artifact.properties.indexPath = `objects/artifact/${slug(artifact.name)}--${artifact.id.slice(7)}.md`;
        artifact.path = String(artifact.properties.archivePath);
      }
    }
  }
  const relationKeys = new Set<string>();
  const relations: {
    id: string;
    from: string;
    kind: string;
    to: string;
    properties: Record<string, unknown>;
  }[] = [];
  const add = (
    from: RecordData,
    kind: string,
    to: RecordData,
    method: string,
    evidence?: unknown,
  ) => {
    const id = digest(JSON.stringify([from.id, kind, to.id]));
    if (from.id === to.id || relationKeys.has(id)) return;
    relationKeys.add(id);
    relations.push({
      id,
      from: from.id,
      kind,
      to: to.id,
      properties: {
        provenance: method,
        ...(from.properties.sourcePath
          ? { sourcePath: from.properties.sourcePath }
          : {}),
        ...(evidence !== undefined
          ? {
              evidence:
                typeof evidence === "string"
                  ? evidence.slice(0, 2048)
                  : evidence,
            }
          : {}),
      },
    });
  };
  for (const record of records) {
    const sourcePath = String(record.properties.sourcePath);
    const vault = String(record.properties.sourceVault);
    let parent = path.posix.dirname(sourcePath);
    while (parent !== ".") {
      const container =
        bySource.get(`${vault}:${parent}/readme.md`) ??
        bySource.get(`${vault}:${parent}/index.md`);
      if (container && container.id !== record.id) {
        add(record, "part-of", container, "source-directory");
        break;
      }
      parent = path.posix.dirname(parent);
    }
    const resolveLink = (target: string) => {
      let decoded: string;
      try {
        decoded = decodeURIComponent(target.split("#")[0]);
      } catch {
        return null;
      }
      if (!decoded) return null;
      const originalAlias = decoded;
      let targetVault = vault;
      let absoluteSourceLink = false;
      for (const [name, sourceRoot] of Object.entries(sources)) {
        if (decoded.startsWith(sourceRoot + "/")) {
          targetVault = name;
          decoded = decoded.slice(sourceRoot.length + 1);
          absoluteSourceLink = true;
          break;
        }
      }
      if (!absoluteSourceLink && !/^[a-z]+:/i.test(decoded)) {
        const physical = path.resolve(
          sources[vault as SourceName],
          path.posix.dirname(sourcePath),
          decoded,
        );
        for (const [name, sourceRoot] of Object.entries(sources)) {
          if (inside(sourceRoot, physical)) {
            targetVault = name;
            decoded = path
              .relative(sourceRoot, physical)
              .split(path.sep)
              .join("/");
            absoluteSourceLink = true;
            break;
          }
        }
      }
      if (/^(?:[a-z]+:|\/)/i.test(decoded)) return null;
      const local = absoluteSourceLink
        ? decoded
        : path.posix.normalize(
            path.posix.join(path.posix.dirname(sourcePath), decoded),
          );
      const direct =
        bySource.get(`${targetVault}:${local}`) ??
        bySource.get(`${targetVault}:${local}.md`);
      const candidates =
        aliases.get(`${targetVault}:${decoded.toLowerCase()}`) ??
        aliases.get(`${vault}:${originalAlias.toLowerCase()}`) ??
        [];
      const crossCandidates = [
        ...new Map(
          (["legacy", "personal"] as const)
            .flatMap(
              (name) =>
                aliases.get(`${name}:${originalAlias.toLowerCase()}`) ?? [],
            )
            .map((record) => [record.id, record]),
        ).values(),
      ];
      const siblingLink = originalAlias.match(
        /^(?:\.\.\/)+(2b|legacy|personal)\/(.+)$/,
      );
      const siblingVault =
        siblingLink?.[1] === "personal" ? "personal" : "legacy";
      const sibling = siblingLink
        ? (bySource.get(`${siblingVault}:${siblingLink[2]}`) ??
          bySource.get(`${siblingVault}:${siblingLink[2]}.md`))
        : null;
      const found =
        direct ??
        sibling ??
        (candidates.length === 1
          ? candidates[0]
          : candidates.length === 0 && crossCandidates.length === 1
            ? crossCandidates[0]
            : null);
      if (found) add(record, "links-to", found, "explicit-source-link");
      else report.unresolvedLinks.push(`${vault}:${sourcePath} -> ${target}`);
      return found;
    };
    const fields = record.properties.sourceMetadata as Record<string, unknown>;
    for (const field of [
      "links",
      "prs",
      "resources",
      "artifacts",
      "output",
      "project",
      "collection",
    ]) {
      const value = fields[field];
      const values = Array.isArray(value)
        ? value
        : value == null
          ? []
          : [value];
      for (const reference of values) {
        const target =
          typeof reference === "string"
            ? reference
            : typeof reference === "object" && reference
              ? String(
                  (reference as Record<string, unknown>).path ??
                    (reference as Record<string, unknown>).url ??
                    "",
                )
              : "";
        if (!target) continue;
        const found = resolveLink(target);
        if (found)
          add(
            record,
            field === "project" || field === "collection"
              ? "part-of"
              : field === "artifacts" || field === "output"
                ? "has-artifact"
                : "references",
            found,
            `native-${field}-field`,
            reference,
          );
      }
    }
    const body = bodies.get(record.id) ?? "";
    const rewritten = body
      .replace(
        /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
        (original, target, label) => {
          const found = resolveLink(target);
          return found
            ? `[[${found.path!.replace(/\.md$/, "")}${String(target).includes("#") ? "#" + String(target).split("#").slice(1).join("#") : ""}|${label ?? found.name}]]`
            : original;
        },
      )
      .replace(/(!?\[[^\]]*\])\(([^\s)]+)\)/g, (original, label, target) => {
        const found = resolveLink(target);
        return found
          ? `${label}(${encodeURI(path.posix.relative(path.posix.dirname(record.path!), label.startsWith("!") && found.type === "artifact" ? String(found.properties.archivePath) : found.path!))}${String(target).includes("#") ? "#" + String(target).split("#").slice(1).join("#") : ""})`
          : original;
      });
    bodies.set(record.id, rewritten);
  }
  const generated = new Map<string, RecordData>();
  for (const record of records)
    if (["person", "book", "organization", "repository"].includes(record.type))
      generated.set(`${record.type}:${record.name.toLowerCase()}`, record);
  const ensure = (
    type: string,
    key: string,
    name: string,
    source: RecordData,
    method: string,
  ): RecordData => {
    const identityKey = `${type}:${key}`;
    const existing = generated.get(identityKey);
    if (existing) return existing;
    const record: RecordData = {
      id: identity("generated", identityKey),
      type,
      name,
      description: "",
      tags: [...source.tags],
      path:
        type === "tag"
          ? null
          : `objects/${type}/${slug(name)}--${digest(identityKey).slice(0, 16)}.md`,
      createdAt: source.createdAt,
      modifiedAt: source.modifiedAt,
      properties: {
        provenance: {
          method,
          sourcePath: source.properties.sourcePath ?? null,
        },
      },
    };
    generated.set(identityKey, record);
    records.push(record);
    return record;
  };
  const planningMembers = records.filter((record) => {
    const source = String(record.properties.sourcePath);
    return record.properties.sourceVault === "legacy"
      ? /^projects\/(?:goals|weekly-updates|product-updates)(?:\/|$)/.test(source)
      : /^work\/(?:monthly-goals|updates|weekly-updates|product-updates)(?:\/|$)/.test(source);
  });
  if (planningMembers.length) {
    const project = ensure(
      "project",
      "work-planning",
      "Work planning",
      planningMembers[0],
      "planning-path",
    );
    project.properties.kind = "ongoing";
    project.properties.area = "work";
    const collections = new Map(
      [
        "quarterly-goals",
        "daily-updates",
        "weekly-reports",
        "release-posts",
      ].map((key) => [
        key,
        ensure(
          "collection",
          `work-planning/${key}`,
          key.replace(/-/g, " "),
          planningMembers[0],
          "planning-path",
        ),
      ]),
    );
    for (const collection of collections.values())
      add(collection, "part-of", project, "planning-path");
    for (const record of planningMembers) {
      const sourcePath = String(record.properties.sourcePath);
      const key = /weekly/i.test(sourcePath)
        ? "weekly-reports"
        : /product|release/i.test(sourcePath)
          ? "release-posts"
          : /goals|quarter/i.test(sourcePath)
            ? "quarterly-goals"
            : "daily-updates";
      // Historical task evidence retains its native parent. Its task joins the new collection.
      if (record.type !== "artifact" && record.type !== "evidence")
        add(record, "part-of", collections.get(key)!, "planning-path");
      if (planningFront.test(sourcePath)) {
        record.properties.archived = true;
        record.properties.migrationReview = "historical-planning-front";
      }
    }
  }
  for (const source of [...records]) {
    const text = bodies.get(source.id) ?? "";
    const evidence = (
      type: string,
      name: string,
      method: string,
      quote: string,
      kind = "mentions",
    ) => {
      const target = ensure(type, name.toLowerCase(), name, source, method);
      add(source, kind, target, method, quote);
      return target;
    };
    for (const match of text.matchAll(/^#{1,3}\s+(Book|System):\s+([^\n]+)$/gm))
      evidence(
        match[1].toLowerCase(),
        match[2].trim(),
        "explicit-source-heading",
        match[0],
        "describes",
      );
    for (const title of ["$100M Offers", "$100M Leads", "$100M Money Models"]) {
      const position = text.indexOf(title);
      if (position >= 0)
        evidence(
          "book",
          title,
          "explicit-book-title",
          text.slice(Math.max(0, position - 60), position + title.length + 80),
        );
    }
    const manifest = text.match(/book (?:called |titled )?Manifest\b[^\n]*/i);
    if (manifest)
      evidence("book", "Manifest", "explicit-book-description", manifest[0]);
    const attendeePattern =
      /(?:Participants|Attendees(?: listed)?):\s*([^\n]+)/g;
    const attendeeLists = [...text.matchAll(attendeePattern)].map((match) => ({
      list: match[1],
      quote: match[0],
    }));
    for (const section of text.matchAll(
      /(?:^|\n)(?:#{1,4}\s+)?Attendees\s*\n([\s\S]*?)(?=\n(?:Purpose|Context|#{1,4}\s)|$)/g,
    )) {
      for (const line of section[1].split("\n")) {
        if (/^(?!Not attending)[A-Z][A-Za-z ]{0,30}:/.test(line.trim()))
          attendeeLists.push({
            list: line.trim(),
            quote: `Attendees\n${line.trim()}`,
          });
      }
    }
    const nativeFields = source.properties.sourceMetadata as
      Record<string, unknown> | undefined;
    for (const key of ["attendees", "participants"]) {
      if (Array.isArray(nativeFields?.[key]))
        attendeeLists.push({
          list: nativeFields[key].join(", "),
          quote: `${key}: ${JSON.stringify(nativeFields[key])}`,
        });
    }
    for (const attendee of attendeeLists) {
      const list = attendee.list
        .split(/\.\s/)[0]
        .replace(/\([^)]*\)/g, "")
        .replace(/(?:^|[|;])\s*[A-Z][A-Za-z ]{0,30}:/g, ",");
      for (const name of list
        .split(/,|;|\s+and\s+|\|/)
        .map((value) => value.trim().replace(/[.]$/, ""))) {
        if (/^[A-Z][a-z]+(?: [A-Z][a-z]+){0,2}$/.test(name))
          evidence(
            "person",
            name,
            "explicit-attendee-list",
            attendee.quote,
            "has-attendee",
          );
      }
    }
    const repoValues = [
      source.properties.repo,
      ...(Array.isArray(source.properties.repos)
        ? source.properties.repos
        : []),
    ].filter((value) => typeof value === "string") as string[];
    for (const repo of repoValues) {
      if (
        /tars-admin-dashboard|tars-monorepo|(?:^|[/:])tars(?:[/.]|$)/i.test(
          repo,
        )
      ) {
        const organization = evidence(
          "organization",
          "Tars",
          "source-repository-property",
          repo,
          "associated-with",
        );
        const repository = evidence(
          "repository",
          /tars-admin-dashboard-next|tars-monorepo/i.test(repo)
            ? "Tars monorepo"
            : path.basename(repo).replace(/\.git$/, ""),
          "source-repository-property",
          repo,
          "uses-repository",
        );
        repository.properties.repo = repo;
        add(
          repository,
          "associated-with",
          organization,
          "source-repository-property",
          repo,
        );
      }
    }
  }
  for (const record of [...records]) {
    const hint = record.properties.inventoryGuidance as
      | {
          project: string;
          collection: string;
          confidence: string;
          kind: string;
        }
      | undefined;
    if (
      !hint ||
      !hint.project ||
      /^(EXCLUDE|HOLD)$/.test(hint.project) ||
      !hint.collection ||
      /exclude|empty/i.test(hint.collection)
    )
      continue;
    const project =
      bySource.get(`legacy:projects/${hint.project}/readme.md`) ??
      ensure(
        "project",
        hint.project === "work-planning"
          ? "work-planning"
          : `inventory/${hint.project}`,
        hint.project === "work-planning"
          ? "Work planning"
          : hint.project.replace(/-/g, " "),
        record,
        "inventory-v2",
      );
    project.properties.migrationReview =
      hint.confidence === "high" ? "grouping-imported" : "grouping-pending";
    const collection = ensure(
      "collection",
      `${hint.project === "work-planning" ? "" : "inventory/"}${hint.project}/${hint.collection}`,
      hint.collection.replace(/-/g, " "),
      record,
      "inventory-v2",
    );
    add(collection, "part-of", project, "inventory-v2", hint);
    add(record, "part-of", collection, "inventory-v2", hint);
  }
  for (const record of [...records])
    for (const tag of record.tags) {
      const target = ensure(
        "tag",
        tag.toLowerCase(),
        tag,
        record,
        "source-tag-or-source-context",
      );
      target.tags = [];
    }
  const people = records.filter((record) => record.type === "person");
  const fullNames = new Map<string, RecordData[]>();
  for (const person of people)
    if (person.name.includes(" ")) {
      for (const alias of new Set([
        person.name.split(" ")[0].toLowerCase(),
        person.name.replace(/\s/g, "").toLowerCase(),
      ]))
        fullNames.set(alias, [...(fullNames.get(alias) ?? []), person]);
    }
  const replacements = new Map<string, RecordData>();
  for (const person of people) {
    const candidates = fullNames.get(person.name.toLowerCase()) ?? [];
    if (
      candidates.length !== 1 ||
      person.name.includes(" ") ||
      person.properties.sourcePath
    )
      continue;
    const target = candidates[0];
    replacements.set(person.id, target);
    target.properties.aliases = [
      ...new Set([
        ...(Array.isArray(target.properties.aliases)
          ? (target.properties.aliases as string[])
          : []),
        person.name,
      ]),
    ];
    target.properties.aliasProvenance = {
      method: "unique-full-name-and-short-name-in-source-attendee-evidence",
      sourceName: target.name,
    };
  }
  if (replacements.size) {
    for (let index = records.length - 1; index >= 0; index--)
      if (replacements.has(records[index].id)) records.splice(index, 1);
    relationKeys.clear();
    for (const relation of relations) {
      relation.from = replacements.get(relation.from)?.id ?? relation.from;
      relation.to = replacements.get(relation.to)?.id ?? relation.to;
      relation.id = digest(
        JSON.stringify([relation.from, relation.kind, relation.to]),
      );
    }
    for (let index = relations.length - 1; index >= 0; index--) {
      if (relationKeys.has(relations[index].id)) relations.splice(index, 1);
      else relationKeys.add(relations[index].id);
    }
  }
  report.objects = records.length;
  const manifestText = JSON.stringify(report.manifest, null, 2) + "\n";
  const runId = digest(manifestText).slice(0, 24);
  const runDirectory = path.join(root, "migration", runId);
  async function verifySources(): Promise<boolean> {
    try {
      const after: Entry[] = [];
      for (const vault of ["legacy", "personal"] as const)
        after.push(...(await scan(sources[vault], vault, [])));
      report.sourceUnchanged =
        JSON.stringify(after) === JSON.stringify(report.manifest);
      if (!options.dryRun)
        await writeOwned(
          path.join(
            runDirectory,
            `after-${digest(JSON.stringify(after)).slice(0, 16)}.json`,
          ),
          JSON.stringify(after, null, 2) + "\n",
        );
    } catch (error) {
      report.sourceUnchanged = false;
      report.errors.push(
        `Source verification failed: ${(error as Error).message}`,
      );
    }
    if (!report.sourceUnchanged) {
      report.retryable = true;
      if (
        !report.errors.includes(
          "Source changed during migration; retry when source writes stop",
        )
      )
        report.errors.push(
          "Source changed during migration; retry when source writes stop",
        );
    }
    return report.sourceUnchanged;
  }
  async function finish(): Promise<MigrationReport> {
    report.complete = report.sourceUnchanged && report.errors.length === 0;
    if (!options.dryRun)
      await fs.writeFile(
        path.join(runDirectory, "report.json"),
        JSON.stringify(report, null, 2) + "\n",
      );
    return report;
  }
  if (options.dryRun) {
    await verifySources();
    return finish();
  }
  async function checkDestination(directory: string): Promise<void> {
    let items;
    try {
      items = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const item of items) {
      if (item.isSymbolicLink())
        throw new Error(
          `Destination symlink: ${path.join(directory, item.name)}`,
        );
      if (item.isDirectory())
        await checkDestination(path.join(directory, item.name));
    }
  }
  await checkDestination(root);
  await writeOwned(path.join(runDirectory, "before.json"), manifestText);
  for (const entry of report.manifest) {
    const target = path.join(
      root,
      "archive",
      entry.vault,
      entry.sha256,
      archiveRelative(entry.sourcePath),
    );
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.access(target);
      if ((await checksum(target)) !== entry.sha256)
        throw new Error(`Archive checksum mismatch: ${target}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const temporary = target + `.copy-${process.pid}`;
      try {
        await fs.copyFile(
          path.join(sources[entry.vault], entry.sourcePath),
          temporary,
        );
        const actual = await checksum(temporary);
        if (actual !== entry.sha256) {
          // Keep the bytes that were read under their actual hash, never a false hash.
          const changedTarget = path.join(
            root,
            "archive",
            entry.vault,
            actual,
            archiveRelative(entry.sourcePath),
          );
          await fs.mkdir(path.dirname(changedTarget), { recursive: true });
          await fs.rename(temporary, changedTarget);
          report.errors.push(
            `Source changed while copying: ${entry.vault}:${entry.sourcePath}`,
          );
          report.retryable = true;
        } else await fs.rename(temporary, target);
      } catch (error) {
        await fs.rm(temporary, { force: true });
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        report.errors.push(
          `Source disappeared while copying: ${entry.vault}:${entry.sourcePath}`,
        );
        report.retryable = true;
      }
    }
  }
  if (!(await verifySources()) || report.errors.length) return finish();
  const { ObjectStore } = await import("./store.ts");
  const store = await ObjectStore.open(root);
  try {
    const definedTypes = new Set((await store.types()).map((type) => type.id));
    for (const type of ["evidence", "automation"])
      if (!definedTypes.has(type))
        await store.defineType({
          id: type,
          name: type,
          description:
            "Preserved migration evidence; schedules disabled pending review.",
          properties: [],
        });
    const recordsById = new Map(records.map((record) => [record.id, record]));
    const outgoing = new Map<string, typeof relations>();
    for (const relation of relations) {
      const group = outgoing.get(relation.from) ?? [];
      group.push(relation);
      outgoing.set(relation.from, group);
    }
    const existingById = new Map(
      (await store.list()).map((record) => [record.id, record]),
    );
    const pending: RecordData[] = [];
    for (const record of records) {
      const existing = existingById.get(record.id);
      const sourceBaseline = semanticSnapshot(record);
      if (existing) {
        const sameSource =
          existing.properties.sha256 === record.properties.sha256;
        if (sameSource) {
          const imported = record.properties;
          record.properties = { ...imported, ...existing.properties };
          for (const key of [
            "sourceVault",
            "sourcePath",
            "sourceCreatedAt",
            "sourceModifiedAt",
            "sourceMetadata",
            "sha256",
            "archivePath",
            "provenance",
            "createdAtProvenance",
            "modifiedAtProvenance",
          ]) {
            if (imported[key] !== undefined)
              record.properties[key] = imported[key];
          }
        }
        const prior = existing.properties.importedSemanticFields as
          Record<string, unknown> | undefined;
        const priorProperties = prior?.properties as
          Record<string, unknown> | undefined;
        const changedFields: string[] = [];
        for (const key of [
          "name",
          "type",
          "description",
          "tags",
          "path",
        ] as const) {
          if (
            sameSource ||
            !prior ||
            JSON.stringify(existing[key]) !== JSON.stringify(prior[key])
          ) {
            if (
              !sameSource &&
              JSON.stringify(existing[key]) !== JSON.stringify(record[key])
            )
              changedFields.push(key);
            Object.assign(record, { [key]: existing[key] });
          }
        }
        for (const key of semanticPropertyKeys) {
          if (
            sameSource ||
            !priorProperties ||
            JSON.stringify(existing.properties[key]) !==
              JSON.stringify(priorProperties[key])
          ) {
            if (
              !sameSource &&
              JSON.stringify(existing.properties[key]) !==
                JSON.stringify(record.properties[key])
            )
              changedFields.push(`properties.${key}`);
            if (existing.properties[key] === undefined)
              delete record.properties[key];
            else record.properties[key] = existing.properties[key];
          }
        }
        if (sameSource) record.modifiedAt = existing.modifiedAt;
        if (
          !sameSource &&
          ["agent-job", "reminder", "automation"].includes(record.type)
        ) {
          if (existing.properties.enabled === true)
            changedFields.push(
              "properties.enabled:disabled-pending-source-review",
            );
          record.properties.enabled = false;
          record.properties.migrationReview = "pending";
        }
        if (changedFields.length) {
          record.properties.metadataConflicts = changedFields;
          record.properties.migrationReview = "metadata-conflict";
          report.conflicts.push(
            `metadata:${record.id}:${changedFields.join(",")}`,
          );
        }
      }
      record.properties.importedSemanticFields = sourceBaseline;
      const viewPath =
        record.type === "artifact"
          ? String(record.properties.indexPath)
          : record.path;
      if (viewPath) {
        const links = (outgoing.get(record.id) ?? [])
          .map((relation) => {
            const target = recordsById.get(relation.to)!;
            return target.path
              ? `- ${relation.kind}: [[${target.path.replace(/\.md$/, "")}|${target.name}]]`
              : `- ${relation.kind}: ${target.name}`;
          })
          .join("\n");
        const body = (
          record.type === "artifact"
            ? record.description
            : (bodies.get(record.id) ?? record.description)
        )
          .replace(/^\s*#\s+[^\n]+(?:\n|$)/, "")
          .trim();
        const content = `---\nid: ${record.id}\ntype: ${record.type}\n---\n# ${record.name}\n\n${record.properties.archivePath ? `[Original file](${encodeURI(path.posix.relative(path.posix.dirname(viewPath), String(record.properties.archivePath)))})\n\n` : ""}${body}\n\n${links}\n`;
        const generatedHash = digest(content);
        const target = path.join(root, viewPath);
        let previous: string | null = null;
        try {
          previous = await fs.readFile(target, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (previous !== null && previous !== content) {
          if (digest(previous) === existing?.properties.generatedBodyHash) {
            await writeOwned(
              path.join(
                root,
                "migration/page-history",
                record.id,
                digest(previous) + ".md",
              ),
              previous,
            );
            await fs.writeFile(target, content);
          } else {
            const versionPath = `migration/conflicts/${record.id}/${generatedHash}.md`;
            const rebased = content.replace(
              /\]\(([^\s)]+)\)/g,
              (original, link: string) => {
                if (/^(?:[a-z]+:|#|\/)/i.test(link)) return original;
                const [relative, ...fragment] = link.split("#");
                let decoded: string;
                try {
                  decoded = decodeURI(relative);
                } catch {
                  return original;
                }
                const destination = path.posix.normalize(
                  path.posix.join(path.posix.dirname(viewPath), decoded),
                );
                return `](${encodeURI(path.posix.relative(path.posix.dirname(versionPath), destination))}${fragment.length ? "#" + fragment.join("#") : ""})`;
              },
            );
            await writeOwned(path.join(root, versionPath), rebased);
            record.properties.migrationConflict = "user-edited-generated-page";
            record.properties.userCopyPath = viewPath;
            record.properties.generatedVersionPath = versionPath;
            report.conflicts.push(viewPath);
          }
        } else await writeOwned(target, content);
        record.properties.generatedBodyHash = generatedHash;
        const oldViewPath =
          existing?.type === "artifact"
            ? existing.properties.indexPath
            : existing?.path;
        if (typeof oldViewPath === "string" && oldViewPath !== viewPath) {
          let oldBody: string | null = null;
          try {
            oldBody = await fs.readFile(path.join(root, oldViewPath), "utf8");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          if (
            oldBody !== null &&
            digest(oldBody) === existing?.properties.generatedBodyHash
          ) {
            await writeOwned(
              path.join(
                root,
                "migration/page-history",
                record.id,
                digest(oldBody) + ".md",
              ),
              oldBody,
            );
            await fs.unlink(path.join(root, oldViewPath));
          } else if (oldBody !== null) {
            record.properties.userCopyPath = oldViewPath;
            record.properties.migrationConflict = "user-edited-prior-page";
            report.conflicts.push(oldViewPath);
          }
        }
      }
      if (existing) {
        record.createdAt = existing.createdAt;
        record.properties = { ...existing.properties, ...record.properties };
        const versions = Array.isArray(existing.properties.archiveVersions)
          ? (existing.properties.archiveVersions as string[])
          : [];
        if (record.properties.archivePath || existing.properties.archivePath)
          record.properties.archiveVersions = [
            ...new Set([
              ...versions,
              ...(existing.properties.archivePath
                ? [String(existing.properties.archivePath)]
                : []),
              ...(record.properties.archivePath
                ? [String(record.properties.archivePath)]
                : []),
            ]),
          ];
      } else if (record.properties.archivePath)
        record.properties.archiveVersions = [record.properties.archivePath];
      const recordBytes = Buffer.byteLength(JSON.stringify(record));
      report.maxRecordBytes = Math.max(report.maxRecordBytes, recordBytes);
      if (recordBytes > 128 * 1024)
        throw new Error(
          `Bounded metadata exceeded for ${record.id}: ${recordBytes}`,
        );
      if (!existing || JSON.stringify(existing) !== JSON.stringify(record))
        pending.push(record);
    }
    for (const batch of byteBatches(pending)) {
      report.maxBatchBytes = Math.max(report.maxBatchBytes, batch.bytes);
      await store.upsertMany(batch.records);
    }
    for (const batch of byteBatches(relations)) {
      report.maxBatchBytes = Math.max(report.maxBatchBytes, batch.bytes);
      await store.upsertRelationships(batch.records);
    }
  } finally {
    await store.close();
  }
  const appPath = path.join(root, ".obsidian/app.json");
  let app: Record<string, unknown> = {};
  try {
    app = JSON.parse(await fs.readFile(appPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  app.userIgnoreFilters = [
    ...new Set([
      ...(Array.isArray(app.userIgnoreFilters)
        ? (app.userIgnoreFilters as string[])
        : []),
      "archive/",
      "migration/",
      ".2b",
    ]),
  ];
  await fs.mkdir(path.dirname(appPath), { recursive: true });
  await fs.writeFile(appPath, JSON.stringify(app, null, 2) + "\n");
  const pathMap = JSON.stringify(
    records.map((record) => ({
      id: record.id,
      sourceVault: record.properties.sourceVault,
      sourcePath: record.properties.sourcePath,
      path: record.path,
      archivePath: record.properties.archivePath,
    })), null, 2,
  ) + "\n";
  await writeOwned(path.join(runDirectory, `path-map-${digest(pathMap).slice(0, 16)}.json`), pathMap);
  const pathMapTemporary = path.join(runDirectory, `path-map-${process.pid}.tmp`);
  await fs.writeFile(pathMapTemporary, pathMap);
  await fs.rename(pathMapTemporary, path.join(runDirectory, "path-map.json"));
  await verifySources();
  return finish();
}
