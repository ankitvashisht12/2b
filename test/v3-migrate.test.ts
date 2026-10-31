import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { migrateVaults } from "../src/v3/migrate.ts";
import { ObjectStore } from "../src/v3/store.ts";

const isolatedAppHome = await fs.mkdtemp(
  path.join(os.tmpdir(), "v3-migrate-app-"),
);
const previousAppHome = process.env.TWOB_APP_HOME;
process.env.TWOB_APP_HOME = isolatedAppHome;
after(async () => {
  if (previousAppHome === undefined) delete process.env.TWOB_APP_HOME;
  else process.env.TWOB_APP_HOME = previousAppHome;
  await fs.rm(isolatedAppHome, { recursive: true, force: true });
});
async function cleanup(setup: { temporary: string; root: string }) {
  try {
    const marker = JSON.parse(
      await fs.readFile(path.join(setup.root, ".2b/vault.json"), "utf8"),
    );
    const statePath = path.join(
      isolatedAppHome,
      "vaults",
      marker.id,
      "server.json",
    );
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    process.kill(state.pid, "SIGTERM");
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        process.kill(state.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") break;
        throw error;
      }
      if (attempt === 99) {
        process.kill(state.pid, "SIGKILL");
        throw new Error("Fixture database did not stop after SIGTERM");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await fs.rm(path.dirname(statePath), { recursive: true, force: true });
  } catch (error) {
    if (
      !["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")
    )
      throw error;
  }
  await fs.rm(setup.temporary, { recursive: true, force: true });
}
async function fixture() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "v3-migrate-"));
  const sources = {
    legacy: path.join(temporary, "legacy"),
    personal: path.join(temporary, "personal"),
  };
  for (const source of Object.values(sources)) await fs.mkdir(source);
  return { temporary, sources, root: path.join(temporary, "destination") };
}
test("dry run leaves all paths unchanged and skips links and junk", async () => {
  const setup = await fixture();
  try {
    await fs.writeFile(path.join(setup.sources.legacy, "note.md"), "# Hello");
    await fs.mkdir(path.join(setup.sources.legacy, ".git"));
    await fs.writeFile(
      path.join(setup.sources.legacy, ".git", "config"),
      "private",
    );
    await fs.symlink("/etc/passwd", path.join(setup.sources.legacy, "escape"));
    const report = await migrateVaults({ ...setup, dryRun: true });
    assert.equal(report.files, 1);
    assert.equal(report.sourceUnchanged, true);
    assert.equal(report.skipped.length, 2);
    await assert.rejects(fs.stat(setup.root), { code: "ENOENT" });
    await assert.rejects(
      migrateVaults({ ...setup, root: setup.sources.personal }),
      /overlap/,
    );
  } finally {
    await cleanup(setup);
  }
});
test("archive is exact, links resolve, imports retry, and schedules stay disabled", async () => {
  const setup = await fixture();
  try {
    const original =
      "---\ntitle: Daily appraisal\ndate: 2020-01-02\n---\n# Appraisal\n[[other]] [other](other.md)";
    await fs.writeFile(path.join(setup.sources.legacy, "daily.md"), original);
    await fs.writeFile(path.join(setup.sources.legacy, "other.md"), "# Other");
    await fs.writeFile(
      path.join(setup.sources.personal, "reminders.json"),
      '{"enabled":true,"schedule":"daily"}',
    );
    await fs.mkdir(path.join(setup.sources.legacy, ".2b"));
    await fs.writeFile(
      path.join(setup.sources.legacy, ".2b", "history.json"),
      "[]",
    );
    const first = await migrateVaults(setup);
    assert.equal(first.sourceUnchanged, true);
    assert.equal(
      await fs.readFile(
        path.join(
          setup.root,
          "archive/legacy",
          first.manifest.find((entry) => entry.sourcePath === "daily.md")!
            .sha256,
          "daily.md",
        ),
        "utf8",
      ),
      original,
    );
    const store = await ObjectStore.open(setup.root);
    const records = await store.list();
    const daily = records.find((record) => record.name === "Daily appraisal")!;
    const reminder = records.find((record) => record.type === "automation")!;
    assert.equal(daily.properties.contentDate, "2020-01-02");
    assert.notEqual(daily.createdAt.slice(0, 10), "2020-01-02");
    assert.equal(reminder.properties.enabled, false);
    assert.equal(reminder.properties.migrationReview, "pending");
    assert.equal(
      (await store.relationships()).filter(
        (relation) => relation.kind === "links-to",
      ).length,
      1,
    );
    const view = await fs.readFile(path.join(setup.root, daily.path!), "utf8");
    assert.match(view, /\[\[objects\/note\/Other--/);
    await store.close();
    const retry = await migrateVaults(setup);
    assert.deepEqual(retry.manifest, first.manifest);
    await fs.writeFile(
      path.join(
        setup.root,
        "archive/legacy",
        first.manifest.find((entry) => entry.sourcePath === "daily.md")!.sha256,
        "daily.md",
      ),
      "collision",
    );
    await assert.rejects(migrateVaults(setup), /checksum mismatch/);
    assert.equal(
      await fs.readFile(path.join(setup.sources.legacy, "daily.md"), "utf8"),
      original,
    );
  } finally {
    await cleanup(setup);
  }
});
test("destination symlinks cannot redirect archive writes", async () => {
  const setup = await fixture();
  try {
    await fs.writeFile(path.join(setup.sources.legacy, "note.md"), "# Note");
    await fs.mkdir(setup.root);
    await fs.symlink(setup.sources.personal, path.join(setup.root, "archive"));
    await assert.rejects(migrateVaults(setup), /Destination symlink/);
    assert.deepEqual(await fs.readdir(setup.sources.personal), []);
  } finally {
    await cleanup(setup);
  }
});

test("native records, dates, artifacts, planning, and evidence-backed entities import as structured data", async () => {
  const setup = await fixture();
  async function put(
    vault: "legacy" | "personal",
    relative: string,
    content: string,
  ) {
    const filename = path.join(setup.sources[vault], relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, content);
  }
  try {
    await fs.writeFile(
      path.join(isolatedAppHome, "config.json"),
      JSON.stringify({
        version: 3,
        vaultPath: setup.root,
        agents: { primary: { provider: "codex", model: "fixture-model" } },
      }),
    );
    await put(
      "legacy",
      "projects/business/collections/accounts/readme.md",
      "---\ntitle: Accounts\ncreated: 2026-10-01 09:30\n---\n# Accounts",
    );
    await put(
      "legacy",
      "projects/business/collections/accounts/notes/call/readme.md",
      "---\ntitle: Account call\nnote-type: meeting\ncreated: 2026-10-02 10:00\ncollection: business/collections/accounts\nlinks: []\n---\n# Account call\nParticipants: Ankit Vashisht and Asha Rao.\n\nAttendees\n\nAcme Bank: Sam Carter\n\nNot attending: Absent Person\n\nTars: Asha\n\nContext\nCurrent reading includes a book called Manifest (author unknown).\nThe three books are $100M Offers, $100M Leads and $100M Money Models.",
    );
    await put(
      "legacy",
      "projects/weekly-updates/readme.md",
      "---\ntitle: Weekly updates\narea: work\n---\n# Weekly updates",
    );
    await put(
      "legacy",
      "projects/weekly-updates/tasks/report/readme.md",
      '---\ntitle: Weekly report\nkind: recurring\nEVERY: fri 17:00\nRUN: agent\nprs: ["https://example.com/pr/1"]\nresources: ["https://example.com/resource"]\nartifacts: [{"path":"report.md","why":"weekly evidence"}]\noutput: report.md\n---\n# Weekly report',
    );
    await put(
      "legacy",
      "projects/weekly-updates/tasks/report/report.md",
      "# Actual report bytes",
    );
    await put(
      "legacy",
      "projects/weekly-updates/tasks/report/log.md",
      "Historical run evidence",
    );
    await put("legacy", "projects/goals/readme.md", "# Goals");
    await put(
      "legacy",
      "projects/product-updates/readme.md",
      "# Product updates",
    );
    await put(
      "legacy",
      "projects/code/tasks/change/readme.md",
      "---\ntitle: Change\nrepo: /work/tars-monorepo\n---\n# Change",
    );
    await put(
      "personal",
      "work/appraisal/daily/2020-01/03.md",
      "---\ncreated: 2026-10-10 12:00\nmodified: 2026-10-11 12:00\n---\n# 03\nRetrospective daily evidence",
    );
    await put("personal", "travel/plan.md", "# Trip");
    await put("personal", "home/plan.md", "# House");
    await put("personal", "content/plan.md", "# Video");
    const inventoryPath = path.join(setup.temporary, "inventory.csv");
    await fs.writeFile(
      inventoryPath,
      "source_path,proposed_project,proposed_collection,confidence\ntravel/plan.md,travel,planning,high\nhome/plan.md,home,planning,high\ncontent/plan.md,personal-content,ideas,review\n",
    );
    const report = await migrateVaults({ ...setup, inventoryPath });
    assert.equal(report.sourceUnchanged, true);
    const store = await ObjectStore.open(setup.root);
    try {
      const objects = await store.list();
      const relations = await store.relationships();
      const source = (relative: string) =>
        objects.find((object) => object.properties.sourcePath === relative)!;
      const accounts = source(
        "projects/business/collections/accounts/readme.md",
      );
      assert.equal(accounts.type, "collection");
      assert.equal(accounts.createdAt, "2026-10-01T04:00:00.000Z");
      const call = source(
        "projects/business/collections/accounts/notes/call/readme.md",
      );
      assert.equal(call.properties.noteType, "meeting");
      assert.ok(
        relations.some(
          (relation) =>
            relation.from === call.id &&
            relation.kind === "part-of" &&
            relation.to === accounts.id,
        ),
      );
      const job = source("projects/weekly-updates/tasks/report/readme.md");
      assert.equal(job.type, "agent-job");
      assert.equal(job.properties.enabled, false);
      assert.equal(job.properties.migrationReview, "pending");
      assert.equal(job.properties.every, "fri 17:00");
      assert.equal(job.properties.run, "agent");
      assert.equal(job.properties.agent, "codex");
      assert.equal(job.properties.model, "fixture-model");
      assert.deepEqual(job.properties.prs, ["https://example.com/pr/1"]);
      assert.deepEqual(job.properties.resources, [
        "https://example.com/resource",
      ]);
      const artifact = source("projects/weekly-updates/tasks/report/report.md");
      assert.equal(artifact.type, "artifact");
      assert.equal(artifact.path, artifact.properties.archivePath);
      assert.equal(
        await fs.readFile(path.join(setup.root, artifact.path!), "utf8"),
        "# Actual report bytes",
      );
      assert.ok(
        relations.some(
          (relation) =>
            relation.from === job.id &&
            relation.kind === "has-artifact" &&
            relation.to === artifact.id,
        ),
      );
      const daily = source("work/appraisal/daily/2020-01/03.md");
      assert.equal(daily.properties.contentDate, "2020-01-03");
      assert.equal(daily.createdAt, "2026-10-10T06:30:00.000Z");
      assert.equal(daily.modifiedAt, "2026-10-11T06:30:00.000Z");
      assert.match(daily.name, /2020-01-03.*appraisal/);
      const planningProject = objects.find(
        (object) =>
          object.type === "project" && object.name === "Work planning",
      )!;
      assert.ok(planningProject);
      for (const name of [
        "quarterly goals",
        "daily updates",
        "weekly reports",
        "release posts",
      ]) {
        const collection = objects.find(
          (object) => object.type === "collection" && object.name === name,
        )!;
        assert.ok(
          relations.some(
            (relation) =>
              relation.from === collection.id &&
              relation.to === planningProject.id,
          ),
        );
      }
      const planningCollections = objects.filter(
        (object) => object.type === "collection" && object.name === "planning",
      );
      assert.equal(planningCollections.length, 2);
      assert.notEqual(planningCollections[0].id, planningCollections[1].id);
      assert.ok(
        objects.some(
          (object) =>
            object.type === "project" && object.name === "personal content",
        ),
      );
      for (const name of [
        "Asha Rao",
        "Ankit Vashisht",
        "Sam Carter",
      ]) {
        const person = objects.find(
          (object) => object.type === "person" && object.name === name,
        )!;
        assert.ok(person, name);
        assert.equal(person.properties.role, undefined);
      }
      assert.ok(
        objects.find(
          (object) =>
            object.type === "person" && object.name === "Asha Rao",
        )?.properties.aliases instanceof Array,
      );
      assert.ok(
        !objects.some(
          (object) =>
            object.type === "person" && object.name === "Absent Person",
        ),
      );
      for (const name of [
        "$100M Offers",
        "$100M Leads",
        "$100M Money Models",
        "Manifest",
      ])
        assert.ok(
          objects.some(
            (object) => object.type === "book" && object.name === name,
          ),
          name,
        );
      assert.ok(
        objects.some(
          (object) => object.type === "organization" && object.name === "Tars",
        ),
      );
      assert.ok(
        objects.some(
          (object) =>
            object.type === "repository" && object.name === "Tars monorepo",
        ),
      );
      assert.ok(
        objects
          .filter((object) => object.type === "tag")
          .every((object) => object.path === null),
      );
      assert.ok(daily.tags.includes("work"));
      const count = objects.length;
      await migrateVaults({ ...setup, inventoryPath });
      assert.equal((await store.list()).length, count);
      assert.deepEqual(await store.relationships(), relations);
    } finally {
      await store.close();
    }
  } finally {
    await cleanup(setup);
  }
});

test("large JSON stays archived, batches are bounded, inventory reuses native projects, and code jobs stay inert", async () => {
  const setup = await fixture();
  const put = async (
    vault: "legacy" | "personal",
    relative: string,
    text: string,
  ) => {
    const target = path.join(setup.sources[vault], relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text);
  };
  try {
    await put("legacy", "projects/argus/readme.md", "# ARGUS");
    await put(
      "personal",
      "projects/argus-vision-and-roadmap.md",
      "# ARGUS vision",
    );
    await put(
      "legacy",
      "projects/code/tasks/2026-09-04-task/fixtures/jobs/runner.ts",
      "export const runner = true;",
    );
    await put(
      "legacy",
      "projects/code/tasks/2026-09-04-task/2026-10-07-transcript.md",
      "---\ntitle: Transcript\n---\n# Transcript\nActual date in filename.",
    );
    await put(
      "legacy",
      "projects/code/tasks/2026-09-04-task/sample.json",
      JSON.stringify({ run: true, payload: "x".repeat(2 * 1024 * 1024) }),
    );
    const inventoryPath = path.join(setup.temporary, "inventory.csv");
    await fs.writeFile(
      inventoryPath,
      "source_path,proposed_project,proposed_collection,confidence,kind\nprojects/argus-vision-and-roadmap.md,argus,vision,high,note\n",
    );
    const report = await migrateVaults({ ...setup, inventoryPath });
    assert.equal(report.complete, true);
    assert.ok(report.maxBatchBytes <= 512 * 1024);
    assert.ok(report.maxRecordBytes < 128 * 1024);
    const store = await ObjectStore.open(setup.root);
    try {
      const records = await store.list();
      const json = records.find((record) =>
        String(record.properties.sourcePath).endsWith("sample.json"),
      )!;
      assert.deepEqual(json.properties.sourceMetadata, {});
      assert.equal(json.properties.originalConfiguration, undefined);
      assert.equal(json.properties.enabled, undefined);
      assert.equal(
        (await fs.stat(path.join(setup.root, json.path!))).size >
          2 * 1024 * 1024,
        true,
      );
      const runner = records.find((record) =>
        String(record.properties.sourcePath).endsWith("runner.ts"),
      )!;
      assert.equal(runner.type, "artifact");
      assert.equal(runner.properties.migrationReview, undefined);
      assert.equal(runner.properties.contentDate, null);
      assert.equal(runner.properties.containerDate, "2026-09-04");
      const transcript = records.find(
        (record) => record.name === "Transcript",
      )!;
      assert.equal(transcript.properties.contentDate, "2026-10-07");
      assert.equal(transcript.properties.containerDate, "2026-09-04");
      const view = await fs.readFile(
        path.join(setup.root, transcript.path!),
        "utf8",
      );
      assert.equal((view.match(/^---$/gm) ?? []).length, 2);
      assert.equal((view.match(/^# Transcript$/gm) ?? []).length, 1);
      const vision = records.find(
        (record) => record.properties.sourceVault === "personal",
      )!;
      assert.equal(vision.type, "note");
      assert.equal(
        records.filter(
          (record) => record.type === "project" && /argus/i.test(record.name),
        ).length,
        1,
      );
      assert.ok(
        !(await store.relationships()).some(
          (relation) => relation.kind === "tagged-with",
        ),
      );
      const ignored = JSON.parse(
        await fs.readFile(path.join(setup.root, ".obsidian/app.json"), "utf8"),
      ).userIgnoreFilters;
      assert.deepEqual(ignored, ["archive/", "migration/", ".2b"]);
    } finally {
      await store.close();
    }
  } finally {
    await cleanup(setup);
  }
});

test("changed sources keep old versions and user edits survive retries", async () => {
  const setup = await fixture();
  try {
    const filename = path.join(setup.sources.legacy, "note.md");
    await fs.writeFile(filename, "# Note\nVersion one");
    await migrateVaults(setup);
    const store = await ObjectStore.open(setup.root);
    try {
      const first = (await store.list()).find(
        (record) => record.properties.sourcePath === "note.md",
      )!;
      const oldArchive = String(first.properties.archivePath);
      await fs.writeFile(filename, "# Note\nVersion two");
      const secondReport = await migrateVaults(setup);
      assert.equal(secondReport.complete, true);
      const second = (await store.get(first.id))!;
      assert.equal(second.id, first.id);
      assert.equal(second.createdAt, first.createdAt);
      assert.notEqual(second.properties.archivePath, oldArchive);
      assert.equal(
        await fs.readFile(path.join(setup.root, oldArchive), "utf8"),
        "# Note\nVersion one",
      );
      assert.match(
        await fs.readFile(path.join(setup.root, second.path!), "utf8"),
        /Version two/,
      );
      await fs.writeFile(
        path.join(setup.root, second.path!),
        "# My user edit\nKeep this",
      );
      await fs.writeFile(filename, "# Note\nVersion three");
      const thirdReport = await migrateVaults(setup);
      const third = (await store.get(first.id))!;
      assert.equal(thirdReport.complete, true);
      assert.deepEqual(thirdReport.conflicts, [second.path]);
      assert.equal(
        await fs.readFile(path.join(setup.root, third.path!), "utf8"),
        "# My user edit\nKeep this",
      );
      assert.equal(
        third.properties.migrationConflict,
        "user-edited-generated-page",
      );
      assert.match(
        await fs.readFile(
          path.join(setup.root, String(third.properties.generatedVersionPath)),
          "utf8",
        ),
        /Version three/,
      );
      assert.equal((third.properties.archiveVersions as string[]).length, 3);
      const retry = await migrateVaults(setup);
      assert.equal(retry.complete, true);
      assert.equal(
        await fs.readFile(path.join(setup.root, third.path!), "utf8"),
        "# My user edit\nKeep this",
      );
    } finally {
      await store.close();
    }
  } finally {
    await cleanup(setup);
  }
});

test("source changes during copy return an incomplete report and the next run recovers", async () => {
  const setup = await fixture();
  const originalCopyFile = fs.copyFile.bind(fs);
  let changed = false;
  const filename = path.join(setup.sources.legacy, "note.md");
  const patch = mock.method(
    fs,
    "copyFile",
    async (...args: Parameters<typeof fs.copyFile>) => {
      if (String(args[0]).endsWith("/legacy/note.md") && !changed) {
        changed = true;
        await fs.writeFile(filename, "# Note\nChanged while copying");
      }
      return originalCopyFile(...args);
    },
  );
  try {
    await fs.writeFile(filename, "# Note\nOriginal");
    const incomplete = await migrateVaults(setup);
    assert.equal(incomplete.complete, false);
    assert.equal(incomplete.retryable, true);
    assert.ok(
      incomplete.errors.some((error) => error.includes("Source changed")),
    );
    patch.mock.restore();
    const retry = await migrateVaults(setup);
    assert.equal(retry.complete, true);
    assert.equal(retry.sourceUnchanged, true);
  } finally {
    patch.mock.restore();
    await cleanup(setup);
  }
});

test("relative cross-vault links and unique wiki aliases resolve and missing links are reported", async () => {
  const setup = await fixture();
  try {
    await fs.writeFile(
      path.join(setup.sources.legacy, "note.md"),
      "# Note\n[Personal](../personal/unique.md#Section) [[unique]] [[missing]]",
    );
    await fs.writeFile(
      path.join(setup.sources.personal, "unique.md"),
      "# Unique\n[Legacy](../legacy/note.md)",
    );
    await fs.mkdir(path.join(setup.sources.legacy, "inbox"));
    await fs.writeFile(
      path.join(setup.sources.legacy, "inbox/nested.md"),
      "# Nested\n[Personal](../personal/unique.md)",
    );
    const report = await migrateVaults(setup);
    assert.ok(
      !report.unresolvedLinks.some((link) => link.includes("unique.md")),
    );
    assert.ok(report.unresolvedLinks.some((link) => link.includes("missing")));
    const store = await ObjectStore.open(setup.root);
    try {
      const records = await store.list();
      const note = records.find((record) => record.name === "Note")!;
      const unique = records.find((record) => record.name === "Unique")!;
      const relations = await store.relationships();
      assert.ok(
        relations.some(
          (relation) => relation.from === note.id && relation.to === unique.id,
        ),
      );
      assert.ok(
        relations.some(
          (relation) => relation.from === unique.id && relation.to === note.id,
        ),
      );
      const view = await fs.readFile(path.join(setup.root, note.path!), "utf8");
      assert.match(view, /#Section/);
      assert.match(view, /\[\[objects\/note\/Unique/);
    } finally {
      await store.close();
    }
  } finally {
    await cleanup(setup);
  }
});

test(
  "full-scale read-only source proof",
  { skip: process.env.TWOB_FULL_MIGRATION_PROOF !== "1" },
  async () => {
    const setup = await fixture();
    const proofPath =
      process.env.TWOB_MIGRATION_PROOF_PATH ??
      path.join(os.tmpdir(), `2b-v3-migration-proof-${Date.now()}.json`);
    const runs: Record<string, unknown>[] = [];
    try {
      for (const label of ["initial", "retry"]) {
        const started = Date.now();
        const report = await migrateVaults({ root: setup.root });
        const { manifest, ...summary } = report;
        runs.push({
          label,
          durationMs: Date.now() - started,
          ...summary,
          sourceManifestFiles: manifest.length,
          sourceManifest: manifest,
        });
        await fs.writeFile(
          proofPath,
          JSON.stringify(
            {
              proofPath,
              sources: "Default real source vaults, read-only",
              migrationCodeSha256: createHash("sha256")
                .update(
                  await fs.readFile(
                    new URL("../src/v3/migrate.ts", import.meta.url),
                  ),
                )
                .digest("hex"),
              destination: "Temporary test root",
              runs,
            },
            null,
            2,
          ) + "\n",
        );
        assert.equal(report.complete, true, JSON.stringify(report.errors));
        assert.equal(report.sourceUnchanged, true);
        assert.equal(report.conflicts.length, 0);
        assert.ok(report.files > 9000);
        assert.ok(report.bytes > 1024 * 1024 * 1024);
        assert.ok(report.maxRecordBytes <= 128 * 1024);
        assert.ok(report.maxBatchBytes <= 512 * 1024);
        console.log(
          `FULL_MIGRATION_PROOF ${JSON.stringify({ label, durationMs: Date.now() - started, files: report.files, bytes: report.bytes, objects: report.objects, unresolvedLinks: report.unresolvedLinks.length, maxRecordBytes: report.maxRecordBytes, maxBatchBytes: report.maxBatchBytes, sourceUnchanged: report.sourceUnchanged, proofPath })}`,
        );
      }
      assert.equal(runs[0].objects, runs[1].objects);
      assert.equal(runs[0].files, runs[1].files);
    } finally {
      await cleanup(setup);
    }
  },
);

test("reimports preserve V3 semantic edits and flag conflicts when sources change", async () => {
  const setup = await fixture();
  try {
    const filename = path.join(
      setup.sources.legacy,
      "projects/work/tasks/task/readme.md",
    );
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(
      filename,
      "---\ntitle: Source task\nstatus: todo\n---\n# Source task\nOriginal body",
    );
    await migrateVaults(setup);
    const store = await ObjectStore.open(setup.root);
    try {
      const original = (await store.list()).find(
        (record) => record.type === "task",
      )!;
      await store.update(original.id, {
        name: "My V3 task",
        tags: ["custom"],
        properties: {
          status: "done",
          customField: "Keep this too",
          contentDate: "2020-01-02",
          migrationReview: "reviewed",
        },
      });
      const unchanged = await migrateVaults(setup);
      assert.equal(unchanged.complete, true);
      const edited = (await store.get(original.id))!;
      assert.equal(edited.name, "My V3 task");
      assert.deepEqual(edited.tags, ["custom"]);
      assert.equal(edited.properties.status, "done");
      assert.equal(edited.properties.contentDate, "2020-01-02");
      assert.equal(edited.properties.migrationReview, "reviewed");
      assert.equal(edited.properties.customField, "Keep this too");
      await fs.writeFile(
        filename,
        "---\ntitle: Source task revised\nstatus: doing\n---\n# Source task revised\nChanged body",
      );
      const changed = await migrateVaults(setup);
      assert.equal(changed.complete, true);
      assert.ok(
        changed.conflicts.some((conflict) => conflict.startsWith("metadata:")),
      );
      const after = (await store.get(original.id))!;
      assert.equal(after.name, "My V3 task");
      assert.deepEqual(after.tags, ["custom"]);
      assert.equal(after.properties.status, "done");
      assert.equal(after.properties.customField, "Keep this too");
      assert.ok(
        (after.properties.metadataConflicts as string[]).includes(
          "properties.status",
        ),
      );
      assert.notEqual(after.properties.sha256, original.properties.sha256);
      assert.equal(after.createdAt, original.createdAt);
    } finally {
      await store.close();
    }
  } finally {
    await cleanup(setup);
  }
});

test('rerun preserves moved V3 paths and versions its path map', async () => {
  const setup = await fixture();
  try {
    await fs.writeFile(path.join(setup.sources.personal, 'note.md'), '# A movable note');
    await migrateVaults(setup);
    const store = await ObjectStore.open(setup.root);
    const object = (await store.list()).find(record => record.name === 'A movable note')!;
    const nextPath = 'objects/note/moved-by-user.md';
    await fs.rename(path.join(setup.root, object.path!), path.join(setup.root, nextPath));
    await store.update(object.id, { path: nextPath });
    await store.close();
    const report = await migrateVaults(setup);
    assert.equal(report.complete, true);
    const reopened = await ObjectStore.open(setup.root);
    assert.equal((await reopened.get(object.id))!.path, nextPath);
    await reopened.close();
    const migrationRoot = path.join(setup.root, 'migration');
    const runs = (await fs.readdir(migrationRoot)).filter(name => /^[a-f0-9]{24}$/.test(name));
    const run = path.join(migrationRoot, runs[0]);
    assert.equal((await fs.readdir(run)).filter(name => /^path-map-[a-f0-9]+\.json$/.test(name)).length, 2);
    const map = JSON.parse(await fs.readFile(path.join(run, 'path-map.json'), 'utf8'));
    assert.equal(map.find((entry: any) => entry.id === object.id).path, nextPath);
  } finally { await cleanup(setup); }
});

test('personal reflection and health goals stay outside work reporting', async () => {
  const setup = await fixture();
  try {
    for (const relative of ['projects/weekly-updates', 'projects/journaling-and-reflection/collections/weekly-reflections']) await fs.mkdir(path.join(setup.sources.legacy, relative), { recursive: true });
    await fs.writeFile(path.join(setup.sources.legacy, 'projects/weekly-updates/readme.md'), '# Work reports');
    await fs.writeFile(path.join(setup.sources.legacy, 'projects/journaling-and-reflection/collections/weekly-reflections/readme.md'), '# Personal reflections');
    await fs.mkdir(path.join(setup.sources.personal, 'gym-and-diet'));
    await fs.writeFile(path.join(setup.sources.personal, 'gym-and-diet/goals.md'), '# Fitness goals');
    await fs.mkdir(path.join(setup.sources.personal, 'inbox'));
    await fs.writeFile(path.join(setup.sources.personal, 'inbox/unknown.md'), '# Undecided thought');
    await migrateVaults(setup);
    const store = await ObjectStore.open(setup.root);
    const records = await store.list();
    const reflections = records.find(record => record.name === 'Personal reflections')!;
    const fitness = records.find(record => record.name === 'Fitness goals')!;
    const reportCollections = new Set(records.filter(record => ['weekly reports', 'quarterly goals'].includes(record.name)).map(record => record.id));
    const relations = await store.relationships();
    assert.equal(relations.some(edge => [reflections.id, fitness.id].includes(edge.from) && reportCollections.has(edge.to)), false);
    assert.equal(records.find(record => record.name === 'Undecided thought')!.properties.processingState, 'inbox');
    await store.close();
  } finally { await cleanup(setup); }
});
