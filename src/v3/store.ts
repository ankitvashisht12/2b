import { createHash } from "node:crypto";
import { posix } from "node:path";
import { Database, locked } from "./database.ts";
import { BUILTIN_TYPES } from "./models.ts";
import type {
  ObjectRecord,
  Relationship,
  TypeDefinition,
  PropertyDefinition,
} from "./models.ts";
export type {
  ObjectRecord,
  Relationship,
  TypeDefinition,
  PropertyDefinition,
} from "./models.ts";
const json = (value: unknown) => JSON.stringify(value);
const recordId = (table: string, id: string) =>
  `${table}:${createHash("sha256").update(id).digest("hex")}`;
function assertText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim())
    throw Error(label + " must be a nonempty string");
}
function assertJson(value: unknown) {
  const visit = (item: any): void => {
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (
      item &&
      typeof item === "object" &&
      Object.getPrototypeOf(item) === Object.prototype
    ) {
      Object.values(item).forEach(visit);
      return;
    }
    throw Error("Properties must contain JSON values");
  };
  visit(value);
}
function validateDefinition(definition: TypeDefinition) {
  assertText(definition.id, "Type id");
  assertText(definition.name, "Type name");
  if (!Array.isArray(definition.properties))
    throw Error("Type properties must be an array");
  const keys = new Set<string>();
  for (const property of definition.properties) {
    assertText(property.key, "Property key");
    if (keys.has(property.key))
      throw Error("Duplicate property " + property.key);
    keys.add(property.key);
    if (
      ![
        "text",
        "number",
        "boolean",
        "date",
        "datetime",
        "select",
        "relation",
        "json",
      ].includes(property.type)
    )
      throw Error("Invalid property type");
    if (
      property.type === "select" &&
      (!Array.isArray(property.options) ||
        !property.options.every((option) => typeof option === "string"))
    )
      throw Error("Select requires options");
  }
  assertJson(definition);
}
export interface ObjectFilters {
  type?: string;
  search?: string;
  status?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}
function whereClause(filters: ObjectFilters) {
  const predicates: string[] = [];
  if (filters.type) predicates.push(`value.type = ${json(filters.type)}`);
  if (filters.status)
    predicates.push(`value.properties.status = ${json(filters.status)}`);
  if (filters.tag) predicates.push(`value.tags CONTAINS ${json(filters.tag)}`);
  if (filters.search) {
    const search = json(filters.search.toLowerCase());
    predicates.push(
      `(string::lowercase(value.name) CONTAINS ${search} OR string::lowercase(value.description) CONTAINS ${search} OR string::lowercase(value.id) CONTAINS ${search})`,
    );
  }
  return predicates.length ? " WHERE " + predicates.join(" AND ") : "";
}
export interface PropertyPatch {
  id: string;
  expectedPath: string | null;
  expectedProperties?: Record<string, unknown>;
  properties: Record<string, unknown>;
  modifiedAt?: string;
}

export class ObjectStore {
  get metadataDirectory(): string {
    return this.database.directory;
  }
  private closed = false;
  private database: Database;
  private constructor(database: Database) {
    this.database = database;
  }
  static async open(root: string): Promise<ObjectStore> {
    const store = new ObjectStore(await Database.open(root));
    await store.run(async () => {
      await store.database.query(
        `DEFINE INDEX IF NOT EXISTS object_type_index ON object FIELDS value.type; DEFINE INDEX IF NOT EXISTS object_status_index ON object FIELDS value.properties.status; DEFINE INDEX IF NOT EXISTS object_tags_index ON object FIELDS value.tags; DEFINE INDEX IF NOT EXISTS object_name_index ON object FIELDS value.name; DEFINE INDEX IF NOT EXISTS object_path_index ON object FIELDS value.path; DEFINE INDEX IF NOT EXISTS relation_from_index ON object_relation FIELDS value.from; DEFINE INDEX IF NOT EXISTS relation_to_index ON object_relation FIELDS value.to; DEFINE INDEX IF NOT EXISTS relation_kind_index ON object_relation FIELDS value.kind;`,
      );
      const existing = await store.values<TypeDefinition>("object_type");
      for (const definition of BUILTIN_TYPES)
        if (!existing.some((type) => type.id === definition.id))
          await store.database.query(
            `CREATE ${recordId("object_type", definition.id)} CONTENT { value: ${json(definition)} };`,
          );
    });
    return store;
  }
  private async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.closed) throw Error("Store is closed");
    return locked(this.database.directory, action);
  }
  private async values<T>(table: string): Promise<T[]> {
    const [rows] = await this.database.query(
      `SELECT VALUE value FROM ${table};`,
    );
    return rows;
  }
  private async exact(id: string): Promise<ObjectRecord | null> {
    const [rows] = await this.database.query(
      `SELECT VALUE value FROM ${recordId("object", id)};`,
    );
    return rows[0] ?? null;
  }
  async list(filters: ObjectFilters = {}): Promise<ObjectRecord[]> {
    return this.run(async () => {
      const offset = filters.offset ?? 0;
      const limit = filters.limit;
      if (
        !Number.isInteger(offset) ||
        offset < 0 ||
        (limit !== undefined && (!Number.isInteger(limit) || limit < 0))
      )
        throw Error("Invalid pagination");
      if (limit === 0) return [];
      const [rows] = await this.database.query(
        `SELECT * FROM object${whereClause(filters)} ORDER BY value.id${limit === undefined ? "" : ` LIMIT ${limit}`} START ${offset};`,
      );
      return rows.map((row: { value: ObjectRecord }) => row.value);
    });
  }
  async summaries(essential = false): Promise<ObjectRecord[]> {
    return this.run(async () => {
      const definitions = await this.values<TypeDefinition>("object_type");
      const hidden = new Set(["sourceMetadata", "importedSemanticFields", "originalConfiguration", "provenance"]);
      const keys = [...new Set([
        ...definitions.flatMap(definition => definition.properties.map(property => property.key)),
        "sourcePath", "sourceVault", "sourceCreatedAt", "sourceModifiedAt", "contentDate", "dateConfidence",
        "processingState", "archived", "archivePath", "indexPath", "migrationReview", "projectKind",
        "capturedAt", "plannedFor", "completedAt", "nextRunAt", "lastRun", "priority", "statusReason", "activityAt",
      ])].filter(key => !hidden.has(key));
      const priorityKeys = new Set(['status', 'priority', 'due', 'kind', 'area', 'processingState', 'sourcePath', 'sourceVault', 'sourceCreatedAt', 'sourceModifiedAt', 'contentDate', 'capturedAt', 'plannedFor', 'completedAt', 'activityAt', 'archived', 'enabled', 'migrationReview', 'startsAt', 'endsAt', 'at', 'nextRunAt', 'readingState', 'noteType', 'aliases', ...definitions.flatMap(definition => definition.properties.filter(property => property.required).map(property => property.key))]);
      const selectedKeys = essential ? keys.filter(key => priorityKeys.has(key)) : keys;
      const properties = selectedKeys.map(key => `${json(key)}: value.properties[${json(key)}]`).join(",");
      const where = essential ? " WHERE (value.type NOT IN ['artifact', 'evidence', 'agent-run'] AND value.properties.archived != true) OR value.type IN ['project', 'task', 'meeting', 'reminder', 'agent-job'] OR value.properties.processingState = 'inbox'" : '';
      const [rows] = await this.database.query(`SELECT VALUE { id: value.id, type: value.type, name: value.name, description: value.description, tags: value.tags, path: value.path, createdAt: value.createdAt, modifiedAt: value.modifiedAt, properties: { ${properties} } } FROM object${where};`);
      return rows.map((record: ObjectRecord) => ({ ...record, properties: Object.fromEntries(Object.entries(record.properties).filter(([, value]) => value !== null)) }));
    });
  }
  async relationshipsAmong(ids: string[]): Promise<Relationship[]> {
    if (!ids.length) return [];
    return this.run(async () => {
      const [rows] = await this.database.query('SELECT VALUE { id: value.id, from: value.from, to: value.to, kind: value.kind } FROM object_relation;');
      const included = new Set(ids);
      return rows.filter((relation: Relationship) => included.has(relation.from) && included.has(relation.to));
    });
  }
  async statistics() {
    return this.run(async () => {
      const [objects, relationships, files] = await this.database.query("SELECT count() AS total FROM object GROUP ALL; SELECT count() AS total FROM object_relation GROUP ALL; SELECT count() AS total FROM object WHERE value.path != NONE AND value.path != NULL GROUP ALL;");
      return { objects: objects[0]?.total ?? 0, relationships: relationships[0]?.total ?? 0, files: files[0]?.total ?? 0 };
    });
  }
  async activitySources(): Promise<ObjectRecord[]> {
    return this.run(async () => {
      const source = "string::lowercase(value.properties.sourcePath ?? '')";
      const [rows] = await this.database.query(`SELECT VALUE { id: value.id, type: value.type, name: value.name, description: '', tags: value.tags, path: value.path, createdAt: value.createdAt, modifiedAt: value.modifiedAt, properties: { sourcePath: value.properties.sourcePath, sourceVault: value.properties.sourceVault } } FROM object WHERE ${source} CONTAINS 'readme.md' OR ${source} CONTAINS 'index.md' OR ${source} CONTAINS 'log.md';`);
      return rows;
    });
  }
  async count(filters: ObjectFilters = {}): Promise<number> {
    return this.run(async () => {
      const [rows] = await this.database.query(
        `SELECT count() AS total FROM object${whereClause(filters)} GROUP ALL;`,
      );
      return rows[0]?.total ?? 0;
    });
  }
  private async recordsByIds<T>(
    table: string,
    ids: string[],
  ): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    const unique = [...new Set(ids)];
    for (let offset = 0; offset < unique.length; offset += 500) {
      const [rows] = await this.database.query(
        `SELECT VALUE value FROM ${unique
          .slice(offset, offset + 500)
          .map((id) => recordId(table, id))
          .join(", ")};`,
      );
      for (const row of rows) result.set(row.id, row);
    }
    return result;
  }
  async get(ref: string): Promise<ObjectRecord | null> {
    return this.run(async () => {
      const exact = await this.exact(ref);
      if (exact) return exact;
      const [matches] = await this.database.query(
        `SELECT VALUE value FROM object WHERE value.name = ${json(ref)} OR value.path = ${json(ref)} LIMIT 2;`,
      );
      if (matches.length > 1) throw Error("Ambiguous object reference");
      return matches[0] ?? null;
    });
  }
  private async validate(
    record: ObjectRecord,
    pending: Map<string, ObjectRecord> = new Map(),
    proposedDefinition?: TypeDefinition,
    referenceCache?: Map<string, ObjectRecord>,
  ) {
    assertText(record.id, "Object id");
    assertText(record.type, "Object type");
    assertText(record.name, "Object name");
    if (
      typeof record.description !== "string" ||
      !record.properties ||
      Array.isArray(record.properties) ||
      typeof record.properties !== "object" ||
      !Array.isArray(record.tags) ||
      !record.tags.every((tag) => typeof tag === "string")
    )
      throw Error("Invalid object shape");
    assertJson(record);
    if (record.type === "tag" && record.path !== null)
      throw Error("Tags do not have content files");
    if (
      record.path !== null &&
      (typeof record.path !== "string" ||
        record.path.includes("\\") ||
        record.path.startsWith("/") ||
        record.path.split("/").includes("..") ||
        posix.normalize(record.path).startsWith(".2b"))
    )
      throw Error("Unsafe content path");
    for (const date of [record.createdAt, record.modifiedAt])
      if (typeof date !== "string" || !Number.isFinite(Date.parse(date)))
        throw Error("Invalid object timestamp");
    const definition =
      proposedDefinition ??
      (await this.values<TypeDefinition>("object_type")).find(
        (type) => type.id === record.type,
      );
    if (!definition) throw Error("Unknown object type " + record.type);
    for (const property of definition.properties) {
      const value = record.properties[property.key];
      if (value === undefined || value === null) {
        if (property.required) throw Error("Required property " + property.key);
        continue;
      }
      let valid = true;
      switch (property.type) {
        case "text":
          valid = typeof value === "string";
          break;
        case "number":
          valid = typeof value === "number" && Number.isFinite(value);
          break;
        case "boolean":
          valid = typeof value === "boolean";
          break;
        case "select":
          valid = property.options!.includes(value as string);
          break;
        case "date":
          valid =
            typeof value === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(value) &&
            new Date(value).toISOString().slice(0, 10) === value;
          break;
        case "datetime":
          valid =
            typeof value === "string" && Number.isFinite(Date.parse(value));
          break;
        case "relation": {
          const references = Array.isArray(value) ? value : [value];
          for (const ref of references) {
            const target =
              typeof ref === "string"
                ? (pending.get(ref) ??
                  (referenceCache
                    ? referenceCache.get(ref)
                    : await this.exact(ref)))
                : null;
            if (
              !target ||
              (property.targetType && target.type !== property.targetType)
            )
              valid = false;
          }
          break;
        }
      }
      if (!valid) throw Error("Invalid property " + property.key);
    }
  }
  private async save(records: ObjectRecord[]) {
    const pending = new Map(records.map((record) => [record.id, record]));
    const definitions = new Map(
      (await this.values<TypeDefinition>("object_type")).map((definition) => [
        definition.id,
        definition,
      ]),
    );
    const referenceIds = records.flatMap((record) =>
      (definitions.get(record.type)?.properties ?? [])
        .filter((property) => property.type === "relation")
        .flatMap((property) => {
          const value = record.properties[property.key];
          return (Array.isArray(value) ? value : [value]).filter(
            (value) => typeof value === "string",
          ) as string[];
        }),
    );
    const known = await this.recordsByIds<ObjectRecord>("object", [
      ...records.map((record) => record.id),
      ...referenceIds,
    ]);
    const statements: string[] = [];
    for (const record of records) {
      const definition = definitions.get(record.type);
      if (!definition) throw Error("Unknown object type " + record.type);
      await this.validate(record, pending, definition, known);
      const existing = known.get(record.id);
      if (existing && existing.createdAt !== record.createdAt)
        throw Error("createdAt is immutable");
      statements.push(
        `UPSERT ${recordId("object", record.id)} CONTENT { value: ${json(record)} };`,
      );
    }
    if (statements.length)
      await this.database.query(
        `BEGIN TRANSACTION; ${statements.join("\n")} COMMIT TRANSACTION;`,
      );
  }
  async upsert(record: ObjectRecord): Promise<ObjectRecord> {
    return this.run(async () => {
      await this.save([record]);
      return record;
    });
  }
  async upsertMany(records: ObjectRecord[]): Promise<void> {
    return this.run(() => this.save(records));
  }
  async patchPropertiesMany(patches: PropertyPatch[]): Promise<void> {
    if (!patches.length) return;
    return this.run(async () => {
      const current = await this.recordsByIds<ObjectRecord>('object', patches.map(patch => patch.id));
      let batch: ObjectRecord[] = [], bytes = 0;
      for (const patch of patches) {
        const record = current.get(patch.id);
        if (!record || record.path !== patch.expectedPath) continue;
        if (Object.entries(patch.expectedProperties || {}).some(([key, value]) => JSON.stringify(record.properties[key]) !== JSON.stringify(value))) continue;
        const merged = { ...record, properties: { ...record.properties, ...patch.properties }, modifiedAt: patch.modifiedAt && patch.modifiedAt > record.modifiedAt ? patch.modifiedAt : record.modifiedAt };
        const size = Buffer.byteLength(JSON.stringify(merged));
        if (bytes + size > 240_000 && batch.length) { await this.save(batch); batch = []; bytes = 0; }
        batch.push(merged); bytes += size;
        current.set(record.id, merged);
      }
      if (batch.length) await this.save(batch);
    });
  }
  async update(
    id: string,
    patch: Partial<ObjectRecord>,
  ): Promise<ObjectRecord> {
    return this.run(async () => {
      const existing = await this.exact(id);
      if (!existing) throw Error("Object not found");
      if (patch.id && patch.id !== id) throw Error("Object id is immutable");
      const updated = {
        ...existing,
        ...patch,
        id,
        properties: { ...existing.properties, ...patch.properties, activityAt: new Date().toISOString() },
        modifiedAt: new Date().toISOString(),
      };
      await this.save([updated]);
      return updated;
    });
  }
  async relationships(id?: string): Promise<Relationship[]> {
    return this.run(async () => {
      const [rows] = await this.database.query(
        `SELECT VALUE value FROM object_relation${id ? ` WHERE value.from = ${json(id)} OR value.to = ${json(id)}` : ""};`,
      );
      return rows;
    });
  }
  async removeRelationship(id: string): Promise<boolean> {
    return this.run(async () => {
      assertText(id, "Relationship id");
      const key = recordId("object_relation", id);
      const [existing] = await this.database.query(`SELECT VALUE value FROM ${key};`);
      if (!existing.length) return false;
      await this.database.query(`DELETE ${key};`);
      return true;
    });
  }
  /** Deletes objects and every relationship that touches them. Content files are the caller's job. */
  async removeObjects(ids: string[]): Promise<void> {
    return this.run(async () => {
      const unique = [...new Set(ids)];
      for (let offset = 0; offset < unique.length; offset += 500) {
        const batch = unique.slice(offset, offset + 500);
        batch.forEach((id) => assertText(id, "Object id"));
        await this.database.query(
          `BEGIN TRANSACTION; DELETE object_relation WHERE value.from IN ${json(batch)} OR value.to IN ${json(batch)}; DELETE ${batch.map((id) => recordId("object", id)).join(", ")}; COMMIT TRANSACTION;`,
        );
      }
    });
  }
  private async saveRelations(records: Relationship[]) {
    const endpoints = await this.recordsByIds<ObjectRecord>(
      "object",
      records.flatMap((record) => [record.from, record.to]),
    );
    const existingRelations = await this.recordsByIds<Relationship>(
      "object_relation",
      records.map((record) => record.id),
    );
    const statements: string[] = [];
    for (const relation of records) {
      assertText(relation.id, "Relation id");
      assertText(relation.kind, "Relation kind");
      assertJson(relation);
      if (!endpoints.has(relation.from) || !endpoints.has(relation.to))
        throw Error("Relationship endpoint not found");
      const key = recordId("object_relation", relation.id);
      const existing = existingRelations.get(relation.id);
      if (
        existing &&
        (existing.from !== relation.from ||
          existing.to !== relation.to ||
          existing.kind !== relation.kind)
      )
        throw Error("Relationship identity is immutable");
      statements.push(
        existing
          ? `UPDATE ${key} SET value = ${json(relation)};`
          : `RELATE ${recordId("object", relation.from)}->${key}->${recordId("object", relation.to)} CONTENT { value: ${json(relation)} };`,
      );
      existingRelations.set(relation.id, relation);
    }
    if (statements.length)
      await this.database.query(
        `BEGIN TRANSACTION; ${statements.join("\n")} COMMIT TRANSACTION;`,
      );
  }
  async relate(
    from: string,
    kind: string,
    to: string,
    properties: Record<string, unknown> = {},
  ): Promise<Relationship> {
    return this.run(async () => {
      const id = createHash("sha256")
        .update(json([from, kind, to]))
        .digest("hex");
      const relation = { id, from, kind, to, properties };
      await this.saveRelations([relation]);
      return relation;
    });
  }
  async upsertRelationships(records: Relationship[]): Promise<void> {
    return this.run(() => this.saveRelations(records));
  }
  async types(): Promise<TypeDefinition[]> {
    return this.run(() => this.values<TypeDefinition>("object_type"));
  }
  async defineType(definition: TypeDefinition): Promise<TypeDefinition> {
    return this.run(async () => {
      validateDefinition(definition);
      const builtin = BUILTIN_TYPES.find((type) => type.id === definition.id);
      if (builtin) {
        const protectedFields = builtin.properties.filter(
          (property) =>
            property.type === "select" || property.type === "boolean",
        );
        for (const field of protectedFields) {
          const supplied = definition.properties.find(
            (property) => property.key === field.key,
          );
          if (
            supplied &&
            (supplied.type !== field.type ||
              json(supplied.options) !== json(field.options))
          )
            throw Error("Protected built-in property " + field.key);
        }
        definition = {
          ...definition,
          properties: [
            ...definition.properties,
            ...protectedFields.filter(
              (field) =>
                !definition.properties.some(
                  (property) => property.key === field.key,
                ),
            ),
          ],
        };
      }
      for (const record of await this.values<ObjectRecord>("object")) {
        if (record.type === definition.id)
          await this.validate(record, new Map(), definition);
      }
      await this.database.query(
        `UPSERT ${recordId("object_type", definition.id)} CONTENT { value: ${json(definition)} };`,
      );
      return definition;
    });
  }
  async removeType(id: string): Promise<void> {
    return this.run(async () => {
      assertText(id, "Type id");
      const [used] = await this.database.query(`SELECT VALUE value.id FROM object WHERE value.type = ${json(id)} LIMIT 1;`);
      if (used.length) throw Error(`Type ${id} still has objects`);
      await this.database.query(`DELETE ${recordId("object_type", id)};`);
    });
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}
