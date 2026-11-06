import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, realpath, rename, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir, uptime } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { locked, lockPath, lockStatus } from "../src/v3/database.ts";

const temporaryRoot = await realpath(tmpdir());
const workspace = await mkdtemp(join(temporaryRoot, "2bv3-lock-"));
const appHome = join(workspace, "app");
const databaseModule = new URL("../src/v3/database.ts", import.meta.url).href;
const cli = fileURLToPath(new URL("../bin/2b", import.meta.url));
const runningChildren: ChildProcess[] = [];
after(async () => {
  for (const child of runningChildren) child.kill("SIGKILL");
  await rm(workspace, { recursive: true, force: true });
});
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const metadata = () => mkdtemp(join(workspace, "metadata-"));
function exitedPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid!;
}
function runningPid(): number {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  runningChildren.push(child);
  return child.pid!;
}
function ownerFiles(pid: number, heldForMs = 0, token: string = randomUUID()) {
  const acquiredAt = new Date(Date.now() - heldForMs).toISOString();
  return { pid: String(pid), "owner.json": JSON.stringify({ pid, token, acquiredAt, command: "test owner" }) };
}
async function plantLock(directory: string, files: Record<string, string>, ageMs = 0) {
  const lock = lockPath(directory);
  await mkdir(lock);
  for (const [name, content] of Object.entries(files)) await writeFile(join(lock, name), content);
  if (ageMs) {
    const modified = new Date(Date.now() - ageMs);
    await utimes(lock, modified, modified);
  }
  return lock;
}
async function lockEntries(directory: string) {
  return (await readdir(directory)).filter((name) => name.startsWith("operation.lock")).sort();
}
function runNode(code: string, environment: Record<string, string> = {}) {
  return new Promise<{ status: number | null; errors: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", code], {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, ...environment },
    });
    let errors = "";
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.on("error", reject);
    child.on("exit", (status) => resolve({ status, errors }));
  });
}
function runCli(root: string, ...args: string[]) {
  return spawnSync(cli, [...args, "--root", root], {
    encoding: "utf8",
    env: { ...process.env, TWOB_APP_HOME: appHome },
  });
}

test("a lock whose owner exited is recovered and kept as evidence", async () => {
  const directory = await metadata();
  const token = randomUUID();
  await plantLock(directory, ownerFiles(exitedPid(), 0, token));
  assert.equal((await lockStatus(directory)).state, "abandoned");
  assert.equal(await locked(directory, async () => "ran"), "ran");
  assert.deepEqual(await lockEntries(directory), [`operation.lock.abandoned-${token}`]);
});

test("legacy dead owners recover while ownerless locks remain protected", async () => {
  const legacy = await metadata();
  await plantLock(legacy, { pid: String(exitedPid()) });
  assert.equal(await locked(legacy, async () => "ran"), "ran");
  assert.match((await lockEntries(legacy)).join(), /^operation\.lock\.abandoned-legacy-\d+$/);

  const leftover = await metadata();
  await plantLock(leftover, {}, 10 * 60_000);
  assert.equal((await lockStatus(leftover)).state, "acquiring");
  await assert.rejects(locked(leftover, async () => assert.fail("owner is unknown"), 100), /no valid owner PID/);
  assert.deepEqual(await lockEntries(leftover), ["operation.lock"]);

  const starting = await metadata();
  await plantLock(starting, {});
  assert.equal((await lockStatus(starting)).state, "acquiring");
});

test("a running owner keeps its lock until it exits, however long it waits", async () => {
  const directory = await metadata();
  const token = randomUUID();
  const ownerPid = runningPid();
  const lock = await plantLock(directory, ownerFiles(ownerPid, 0, token));
  let ran = false;
  const waiting = locked(directory, async () => (ran = true), 10_000);
  await pause(400);
  assert.equal(ran, false);
  assert.equal(JSON.parse(await readFile(join(lock, "owner.json"), "utf8")).token, token);
  const status = await lockStatus(directory);
  assert.equal(status.state, "held");
  assert.equal(status.pid, ownerPid);
  process.kill(ownerPid, "SIGKILL");
  await waiting;
  assert.equal(ran, true);
});

test("an old lock of a running owner is never removed for its age", async (context) => {
  if (uptime() < 300) return context.skip("needs a process older than the planted lock");
  const directory = await metadata();
  const lock = await plantLock(directory, ownerFiles(1, (uptime() * 1000) / 2));
  const status = await lockStatus(directory);
  assert.equal(status.state, "held");
  assert.match(status.advice, /confirm its identity/);
  await assert.rejects(
    locked(directory, async () => assert.fail("must not run"), 300),
    /Timed out after 0\.3 s waiting for the database lock .*PID 1 \(test owner\) has held it for \d+ min\. PID 1 is still running/,
  );
  assert.deepEqual(await lockEntries(directory), ["operation.lock"]);
  assert.ok((await readdir(lock)).includes("owner.json"));
});

test("a live PID is protected even when its timestamp predates the process", async () => {
  const directory = await metadata();
  const ownerPid = runningPid();
  await plantLock(directory, ownerFiles(ownerPid, 10 * 60_000));
  assert.equal((await lockStatus(directory)).state, "held");
  await assert.rejects(
    locked(directory, async () => assert.fail("must not replace a live owner"), 100),
    new RegExp(`PID ${ownerPid} is still running`),
  );
  assert.deepEqual(await lockEntries(directory), ["operation.lock"]);
});

test("a malformed owner record falls back to its live legacy PID", async () => {
  const directory = await metadata();
  const ownerPid = runningPid();
  await plantLock(directory, { pid: String(ownerPid), "owner.json": "null" });
  const status = await lockStatus(directory);
  assert.equal(status.state, "held");
  assert.equal(status.pid, ownerPid);
});

test("concurrent callers never overlap, including while recovering the same abandoned lock", async () => {
  const directory = await metadata();
  let active = 0;
  let overlaps = 0;
  await Promise.all(
    Array.from({ length: 8 }, () =>
      locked(directory, async () => {
        if (++active > 1) overlaps++;
        await pause(5);
        active--;
      }),
    ),
  );
  assert.equal(overlaps, 0);

  const token = randomUUID();
  await plantLock(directory, ownerFiles(exitedPid(), 0, token));
  const marker = join(directory, "inside");
  const code = `import { locked } from ${JSON.stringify(databaseModule)};
import { mkdir, rmdir, appendFile } from "node:fs/promises";
for (let round = 0; round < 5; round++) await locked(${JSON.stringify(directory)}, async () => {
  try { await mkdir(${JSON.stringify(marker)}); } catch { await appendFile(${JSON.stringify(join(directory, "overlaps"))}, "x"); }
  await new Promise((resolve) => setTimeout(resolve, 10));
  await rmdir(${JSON.stringify(marker)});
});`;
  const results = await Promise.all(Array.from({ length: 4 }, () => runNode(code)));
  for (const result of results) assert.equal(result.status, 0, result.errors);
  assert.deepEqual(await lockEntries(directory), [`operation.lock.abandoned-${token}`]);
  await assert.rejects(readFile(join(directory, "overlaps")), { code: "ENOENT" });
});

test("a failed action releases the lock", async () => {
  const directory = await metadata();
  await assert.rejects(locked(directory, async () => { throw Error("action failed"); }), /action failed/);
  assert.deepEqual(await lockEntries(directory), []);
  assert.equal((await lockStatus(directory)).state, "free");
});

test("an owner that finishes late does not remove a replacement owner's lock", async () => {
  const directory = await metadata();
  const lock = lockPath(directory);
  const replacementToken = randomUUID();
  const replacementPid = runningPid();
  const originalError = console.error;
  const warnings: string[] = [];
  console.error = (message: string) => warnings.push(message);
  try {
    await locked(directory, async () => {
      await rename(lock, join(directory, "archived-by-hand"));
      await plantLock(directory, ownerFiles(replacementPid, 0, replacementToken));
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(JSON.parse(await readFile(join(lock, "owner.json"), "utf8")).token, replacementToken);
  assert.match(warnings.join(), /was replaced while this process held it/);
});

test("a worker stuck inside the lock exits so the next caller recovers it", async () => {
  const directory = await metadata();
  const code = `import { locked, exitIfLockHeldLongerThan } from ${JSON.stringify(databaseModule)};
exitIfLockHeldLongerThan(300);
setInterval(() => {}, 1000);
await locked(${JSON.stringify(directory)}, () => new Promise(() => {}));`;
  const result = await runNode(code);
  assert.equal(result.status, 75);
  assert.match(result.errors, /held the database lock .* without finishing/);
  assert.equal((await lockStatus(directory)).state, "abandoned");
  assert.equal(await locked(directory, async () => "ran"), "ran");
});

test("lock status and recover commands report and recover without touching a running owner", async () => {
  const root = join(workspace, "vault");
  assert.equal(runCli(root, "lock", "status").status, 0);
  const directory = JSON.parse(runCli(root, "lock", "status").stdout).path.replace(/\/operation\.lock$/, "");

  await plantLock(directory, ownerFiles(exitedPid()));
  assert.equal(JSON.parse(runCli(root, "lock", "status").stdout).state, "abandoned");
  const recovered = runCli(root, "lock", "recover");
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).recovered, true);
  assert.equal(JSON.parse(recovered.stdout).state, "free");

  const ownerPid = runningPid();
  await plantLock(directory, ownerFiles(ownerPid));
  const refused = runCli(root, "lock", "recover");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, new RegExp(`PID ${ownerPid} is still running`));
  assert.equal(JSON.parse(runCli(root, "lock", "status").stdout).state, "held");
});
