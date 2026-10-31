import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  mkdir,
  stat,
  rename,
  realpath,
  readdir,
} from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { metadataDirectory, loadConfig, configPath } from "../src/v3/config.ts";
import { ObjectStore } from "../src/v3/store.ts";
import { guardRoot } from "../src/v3/database.ts";
import type { ObjectRecord } from "../src/v3/models.ts";
const temporaryRoot = await realpath(tmpdir());
const isolatedAppHome = await mkdtemp(join(temporaryRoot, "2bv3-app-"));
const originalAppHome = process.env.TWOB_APP_HOME;
process.env.TWOB_APP_HOME = isolatedAppHome;
after(async () => {
  if (originalAppHome === undefined) delete process.env.TWOB_APP_HOME;
  else process.env.TWOB_APP_HOME = originalAppHome;
  await rm(isolatedAppHome, { recursive: true, force: true });
});
const object = (id: string, type = "note"): ObjectRecord => ({
  id,
  type,
  name: id,
  description: "",
  properties: {},
  tags: [],
  path: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  modifiedAt: "2024-01-01T00:00:00.000Z",
});
async function stop(root: string) {
  try {
    const state = JSON.parse(
      await readFile(join(metadataDirectory(root), "server.json"), "utf8"),
    );
    process.kill(state.pid, "SIGTERM");
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        process.kill(state.pid, 0);
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  } catch {}
}
test('file metadata patches preserve a later user edit and skip moved or changed files', async () => {
  const root = await mkdtemp(join(temporaryRoot, '2bv3-file-patch-'));
  const store = await ObjectStore.open(root);
  try {
    await store.upsert({ ...object('edited'), path: 'note.md', properties: { fileModifiedAt: 'old-stamp' } });
    const snapshot = (await store.get('edited'))!;
    const edited = await store.update('edited', { name: 'New name', description: 'Keep this edit', properties: { customField: 'Keep this too' } });
    await store.patchPropertiesMany([{ id: snapshot.id, expectedPath: snapshot.path, expectedProperties: { fileModifiedAt: 'old-stamp' }, properties: { fileModifiedAt: 'new-stamp' } }]);
    const current = (await store.get('edited'))!;
    assert.equal(current.name, 'New name');
    assert.equal(current.description, 'Keep this edit');
    assert.equal(current.properties.customField, 'Keep this too');
    assert.equal(current.properties.fileModifiedAt, 'new-stamp');
    assert.equal(current.modifiedAt, edited.modifiedAt);
    await store.patchPropertiesMany([{ id: snapshot.id, expectedPath: snapshot.path, expectedProperties: { fileModifiedAt: 'old-stamp' }, properties: { fileModifiedAt: 'stale-stamp' } }]);
    assert.equal((await store.get('edited'))!.properties.fileModifiedAt, 'new-stamp');
    await store.update('edited', { path: 'moved.md' });
    await store.patchPropertiesMany([{ id: snapshot.id, expectedPath: snapshot.path, properties: { fileModifiedAt: 'wrong-file-stamp' } }]);
    assert.equal((await store.get('edited'))!.path, 'moved.md');
    assert.equal((await store.get('edited'))!.properties.fileModifiedAt, 'new-stamp');
  } finally { await store.close(); await stop(root); await rm(root, { recursive: true, force: true }); }
});
test("real database persists objects, types and graph edges across server restart", async () => {
  const root = await mkdtemp(join(temporaryRoot, "2bv3-store-"));
  try {
    let store = await ObjectStore.open(root);
    await store.upsertMany([object("a"), object("b")]);
    const relation = await store.relate("a", "references", "b", {
      reason: "test",
    });
    await store.upsertRelationships([relation]);
    await store.update("a", { name: "Renamed" });
    await store.close();
    await stop(root);
    store = await ObjectStore.open(root);
    assert.equal((await store.get("a"))?.name, "Renamed");
    assert.equal((await store.get("a"))?.id, "a");
    assert.deepEqual(await store.relationships("b"), [relation]);
    assert.equal((await store.types()).length, 15);
    assert.ok(
      (await stat(join(metadataDirectory(root), "metadata.db"))).isDirectory(),
    );
    await store.close();
  } finally {
    await stop(root);
    await rm(root, { recursive: true, force: true });
  }
});
test("schema and relation validation reject bad writes atomically", async () => {
  const root = await mkdtemp(join(temporaryRoot, "2bv3-schema-"));
  try {
    const store = await ObjectStore.open(root);
    await store.defineType({
      id: "custom",
      name: "Custom",
      description: "",
      properties: [
        { key: "score", type: "number", required: true },
        { key: "owner", type: "relation", targetType: "person" },
      ],
    });
    await store.upsert(object("person", "person"));
    await assert.rejects(
      store.upsert({ ...object("bad", "custom"), properties: { score: "no" } }),
      /score/,
    );
    await assert.rejects(
      store.upsertMany([
        object("valid"),
        {
          ...object("bad", "custom"),
          properties: { score: 1, owner: "missing" },
        },
      ]),
      /owner/,
    );
    assert.equal(await store.get("valid"), null);
    await store.upsert({
      ...object("good", "custom"),
      properties: { score: 1, owner: "person", extra: { preserved: true } },
    });
    await store.defineType({
      id: "custom",
      name: "Custom",
      description: "Updated",
      properties: [{ key: "score", type: "number", required: true }],
    });
    await assert.rejects(
      store.defineType({
        id: "custom",
        name: "Custom",
        description: "",
        properties: [{ key: "score", type: "text" }],
      }),
      /score/,
    );
    await assert.rejects(
      store.upsert({ ...object("tag", "tag"), path: "tag.md" }),
      /Tags/,
    );
    await assert.rejects(
      store.relate("good", "references", "missing"),
      /endpoint/,
    );
    await assert.rejects(
      store.upsert({ ...object("unsafe"), path: "../outside" }),
      /Unsafe/,
    );
    await assert.rejects(
      store.upsert({
        ...object("project", "project"),
        properties: { kind: "unknown" },
      }),
      /kind/,
    );
    await assert.rejects(
      store.upsert({
        ...object("job", "agent-job"),
        properties: { enabled: "yes" },
      }),
      /enabled/,
    );
    await assert.rejects(
      store.upsert({
        ...object("task", "task"),
        properties: { status: "invalid" },
      }),
      /status/,
    );
    await assert.rejects(
      store.defineType({
        id: "task",
        name: "Task",
        description: "",
        properties: [{ key: "status", type: "text" }],
      }),
      /Protected/,
    );
    await store.close();
  } finally {
    await stop(root);
    await rm(root, { recursive: true, force: true });
  }
});
function child(root: string, index: number, updateShared = true) {
  const code = `import {ObjectStore} from './src/v3/store.ts'; const store=await ObjectStore.open(${JSON.stringify(root)}); ${updateShared ? `await store.update('shared',{properties:{['worker'+${index}]:true}});` : ""} await store.upsert(${JSON.stringify(object("child-" + index))}); await store.close();`;
  return new Promise<void>((resolve, reject) => {
    const processHandle = spawn(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", code],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    );
    let errors = "";
    processHandle.stderr.on("data", (chunk) => (errors += chunk));
    processHandle.on("error", reject);
    processHandle.on("exit", (status) =>
      status === 0 ? resolve() : reject(Error(errors)),
    );
  });
}
test("separate CLI processes share a server and preserve concurrent updates", async () => {
  const root = await mkdtemp(join(temporaryRoot, "2bv3-concurrent-"));
  try {
    const store = await ObjectStore.open(root);
    await store.upsert(object("shared"));
    const before = JSON.parse(
      await readFile(join(metadataDirectory(root), "server.json"), "utf8"),
    );
    await Promise.all(
      Array.from({ length: 6 }, (_, index) => child(root, index)),
    );
    assert.equal((await store.list()).length, 7);
    assert.equal(
      Object.keys((await store.get("shared"))!.properties).filter(key => key.startsWith("worker")).length,
      6,
    );
    const after = JSON.parse(
      await readFile(join(metadataDirectory(root), "server.json"), "utf8"),
    );
    assert.equal(before.pid, after.pid);
    assert.equal(
      (await stat(join(metadataDirectory(root), "server.json"))).mode & 0o777,
      0o600,
    );
    await store.close();
  } finally {
    await stop(root);
    await rm(root, { recursive: true, force: true });
  }
});
test("guard blocks protected paths, aliases and nested vaults", async () => {
  await assert.rejects(
    guardRoot(join(homedir(), "obsidian/2bv2/child")),
    /Protected/,
  );
  await assert.rejects(
    guardRoot(join(homedir(), "obsidian/personal")),
    /Protected/,
  );
  const parent = await mkdtemp(join(temporaryRoot, "2bv3-guard-"));
  try {
    const vault = join(parent, "vault");
    metadataDirectory(await guardRoot(vault));
    await assert.rejects(guardRoot(join(vault, "child")), /Nested/);
    await assert.rejects(guardRoot(parent), /Nested/);
    await symlink(join(homedir(), "obsidian/2bv2"), join(parent, "alias"));
    await assert.rejects(
      guardRoot(join(parent, "alias", "child")),
      /Protected/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("concurrent first opens start one shared persistent server", async () => {
  const root = await mkdtemp(join(temporaryRoot, "2bv3-cold-"));
  try {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) => child(root, index, false)),
    );
    for (const outcome of outcomes)
      if (outcome.status === "rejected") throw outcome.reason;
    const store = await ObjectStore.open(root);
    assert.equal((await store.list()).length, 6);
    await store.close();
  } finally {
    await stop(root);
    await rm(root, { recursive: true, force: true });
  }
});

test("relocating a vault retains its identity and database", async () => {
  const parent = await mkdtemp(join(temporaryRoot, "2bv3-relocate-"));
  const original = join(parent, "original");
  const moved = join(parent, "moved");
  try {
    let store = await ObjectStore.open(original);
    await store.upsert(object("stable"));
    await store.close();
    const directory = metadataDirectory(original);
    await rename(original, moved);
    assert.equal(metadataDirectory(moved), directory);
    store = await ObjectStore.open(moved);
    assert.equal((await store.get("stable"))?.id, "stable");
    await store.close();
    await stop(moved);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("global config is private and source opens create no runtime state", async () => {
  assert.equal(loadConfig().version, 3);
  assert.equal((await stat(configPath())).mode & 0o777, 0o600);
  const before = await readdir(join(isolatedAppHome, "vaults"));
  for (const source of ["2bv2", "personal"])
    await assert.rejects(
      ObjectStore.open(join(homedir(), "obsidian", source)),
      /Protected/,
    );
  assert.deepEqual(await readdir(join(isolatedAppHome, "vaults")), before);
});

test("native filters, counts, safe literals and batched relation imports", async () => {
  const root = await mkdtemp(join(temporaryRoot, "2bv3-query-"));
  try {
    const store = await ObjectStore.open(root);
    const records = Array.from({ length: 510 }, (_, index) => ({
      ...object(`item-${String(index).padStart(3, "0")}`, "task"),
      name: index === 0 ? 'quote " ; SELECT * FROM object;' : "Task " + index,
      tags: index % 2 ? ["odd"] : ["even"],
      properties: { status: index % 2 ? "todo" : "done" },
    }));
    await store.upsertMany(records);
    assert.equal(
      await store.count({ type: "task", tag: "odd", status: "todo" }),
      255,
    );
    const page = await store.list({
      type: "task",
      tag: "odd",
      status: "todo",
      offset: 2,
      limit: 3,
    });
    assert.deepEqual(
      page.map((record) => record.id),
      ["item-005", "item-007", "item-009"],
    );
    assert.equal((await store.list({ search: 'quote " ; SELECT' })).length, 1);
    assert.equal(await store.count({ search: "nothing" }), 0);
    assert.equal((await store.list({ limit: 0 })).length, 0);
    assert.equal((await store.get(records[0].name))?.id, records[0].id);
    const edges = records
      .slice(1)
      .map((record) => ({
        id: "edge-" + record.id,
        from: records[0].id,
        to: record.id,
        kind: "depends-on",
        properties: { imported: true },
      }));
    await store.upsertRelationships(edges);
    await store.upsertRelationships(
      edges.map((edge) => ({ ...edge, properties: { imported: false } })),
    );
    assert.equal((await store.relationships(records[0].id)).length, 509);
    assert.equal(
      (await store.relationships(records[1].id))[0].properties?.imported,
      false,
    );
    assert.ok(store.metadataDirectory.startsWith(isolatedAppHome));
    await store.close();
  } finally {
    await stop(root);
    await rm(root, { recursive: true, force: true });
  }
});

test('removeRelationship removes only the selected edge', async () => {
  const root = await mkdtemp(join(temporaryRoot, '2bv3-unlink-'));
  try {
    const store = await ObjectStore.open(root);
    await store.upsertMany([object('from'), object('to')]);
    const edge = await store.relate('from', 'related', 'to');
    assert.equal(await store.removeRelationship(edge.id), true);
    assert.equal(await store.removeRelationship(edge.id), false);
    assert.equal((await store.relationships()).length, 0);
    assert.ok(await store.get('from'));
    await store.close();
  } finally { await stop(root); await rm(root, { recursive: true, force: true }); }
});
