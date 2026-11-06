import { metadataDirectory, sourceVaults } from "./config.ts";
import {
  mkdir,
  readFile,
  writeFile,
  realpath,
  stat,
  readdir,
  rm,
  rename,
  open,
} from "node:fs/promises";
import { resolve, dirname, join, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
    return join(await canonical(dirname(path)), path.split("/").pop()!);
  }
}
function contains(parent: string, child: string) {
  const suffix = relative(parent, child);
  return suffix === "" || (!suffix.startsWith("..") && !isAbsolute(suffix));
}
export async function guardRoot(root: string): Promise<string> {
  const target = await canonical(resolve(root));
  for (const source of Object.values(sourceVaults())) {
    const forbidden = await canonical(source);
    if (contains(forbidden, target) || contains(target, forbidden))
      throw Error("Protected source vault: " + target);
  }
  if (target === "/" || target === homedir()) throw Error("Unsafe vault root");
  for (
    let ancestor = dirname(target);
    ancestor !== dirname(ancestor);
    ancestor = dirname(ancestor)
  ) {
    try {
      await stat(join(ancestor, ".2b", "vault.json"));
      throw Error("Nested vault roots are forbidden");
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  // Detect an existing nested vault before establishing a new parent vault.
  async function nested(directory: string): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error: any) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (
        entry.isDirectory() &&
        entry.name !== ".2b" &&
        entry.name !== ".git" &&
        entry.name !== "node_modules"
      ) {
        const child = join(directory, entry.name);
        try {
          await stat(join(child, ".2b", "vault.json"));
          return true;
        } catch (error: any) {
          if (error.code !== "ENOENT") throw error;
        }
        if (await nested(child)) return true;
      }
    }
    return false;
  }
  let established = false;
  try {
    const marker = JSON.parse(await readFile(join(target, ".2b", "vault.json"), "utf8"));
    established = marker.version === 3 && typeof marker.id === "string";
  } catch (error: any) { if (error.code !== "ENOENT") throw error; }
  if (!established && await nested(target)) throw Error("Nested vault roots are forbidden");
  await mkdir(target, { recursive: true });
  const metadata = join(target, ".2b");
  try {
    if ((await realpath(metadata)) !== metadata)
      throw Error("Metadata directory must not be a symlink");
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(metadata, { recursive: true, mode: 0o700 });
  return target;
}
const lockWaitMs = 60_000;
// Reduce polling frequency for locks held longer than a minute.
const lockGraceMs = 60_000;
const ownerTokenPattern = /^[0-9a-f-]{36}$/;
let lockHoldLimitMs = 0;
interface LockHolder {
  identity: string;
  pid?: number;
  command?: string;
  acquiredAt: number;
}
export type LockState = "free" | "held" | "acquiring" | "abandoned";
export const lockPath = (directory: string) => join(directory, "operation.lock");
// A long-running process that never finishes a locked action blocks every other
// 2b process. Exiting turns it into a dead owner, which the next caller recovers.
export function exitIfLockHeldLongerThan(milliseconds: number) {
  lockHoldLimitMs = milliseconds;
}
function processRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error.code !== "ESRCH";
  }
}
async function readHolder(lock: string): Promise<LockHolder | null> {
  let details;
  try {
    details = await stat(lock);
  } catch (error: any) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let owner: any = {};
  try {
    owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"));
    if (!owner || typeof owner !== "object" || Array.isArray(owner))
      throw new SyntaxError("Invalid lock owner record");
  } catch (error: any) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    try {
      owner = { pid: Number(await readFile(join(lock, "pid"), "utf8")) };
    } catch (reason: any) {
      if (reason.code !== "ENOENT") throw reason;
    }
  }
  return {
    identity: ownerTokenPattern.test(owner.token)
      ? owner.token
      : `legacy-${details.ino}`,
    pid: Number.isInteger(owner.pid) && owner.pid > 0 ? owner.pid : undefined,
    command: typeof owner.command === "string" ? owner.command : undefined,
    acquiredAt: Date.parse(owner.acquiredAt) || details.mtimeMs,
  };
}
function holderState(holder: LockHolder): Exclude<LockState, "free"> {
  if (!holder.pid) return "acquiring";
  return processRunning(holder.pid) ? "held" : "abandoned";
}
// Only an abandoned lock is moved, and only to a name derived from its owner.
// If another caller recovered it first and a new owner took the lock, that
// name already exists, so the rename fails instead of moving the new lock.
async function retireAbandoned(lock: string, holder: LockHolder): Promise<boolean> {
  const current = await readHolder(lock);
  if (current?.identity !== holder.identity || current.pid !== holder.pid)
    return false;
  try {
    await rename(lock, `${lock}.abandoned-${holder.identity}`);
    return true;
  } catch (error: any) {
    if (["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) return false;
    throw error;
  }
}
async function tryAcquire(lock: string, token: string): Promise<boolean> {
  try {
    await mkdir(lock);
  } catch (error: any) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
  try {
    await writeFile(join(lock, "pid"), String(process.pid));
    await writeFile(
      join(lock, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        token,
        acquiredAt: new Date().toISOString(),
        command: process.argv
          .slice(1, 3)
          .map((part) => part.split("/").pop())
          .join(" "),
      }),
    );
    return true;
  } catch (error) {
    await rm(lock, { recursive: true, force: true });
    throw error;
  }
}
async function release(lock: string, token: string) {
  const holder = await readHolder(lock);
  if (holder?.identity !== token) {
    console.error(
      `2b v3: the database lock ${lock} was replaced while this process held it. The new lock was left in place.`,
    );
    return;
  }
  const released = `${lock}.released-${token}`;
  await rename(lock, released);
  await rm(released, { recursive: true, force: true });
}
function describeHolder(holder: LockHolder): string {
  const seconds = Math.round((Date.now() - holder.acquiredAt) / 1000);
  const age = seconds < 120 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
  const owner = holder.pid
    ? `PID ${holder.pid}${holder.command ? ` (${holder.command})` : ""}`
    : "A process that has not written its PID";
  return `${owner} has held it for ${age}.`;
}
function lockAdvice(state: LockState, holder: LockHolder | null): string {
  if (state === "free") return "No process holds the database lock.";
  if (state === "abandoned")
    return 'Its owner has exited. Run "2b lock recover", or any 2b command, to recover it.';
  if (state === "acquiring")
    return "The lock has no valid owner PID. A process may still be taking it. Check again; if the lock persists, stop all 2b processes before inspecting it. Recovery cannot verify that its owner has exited.";
  return `PID ${holder!.pid} is still running, so 2b will not remove its lock. Run "2b lock status" and confirm its identity. If it is stuck, stop that process or its supervising service, then run "2b lock recover".`;
}
export async function lockStatus(directory: string) {
  const lock = lockPath(directory);
  const holder = await readHolder(lock);
  const state: LockState = holder ? holderState(holder) : "free";
  const processCommand =
    holder?.pid && state === "held"
      ? spawnSync("ps", ["-o", "command=", "-p", String(holder.pid)], {
          encoding: "utf8",
        }).stdout?.trim() || null
      : null;
  return {
    path: lock,
    state,
    ...(holder && {
      pid: holder.pid ?? null,
      command: holder.command ?? null,
      process: processCommand,
      acquiredAt: new Date(holder.acquiredAt).toISOString(),
      heldForSeconds: Math.round((Date.now() - holder.acquiredAt) / 1000),
    }),
    advice: lockAdvice(state, holder),
  };
}
export async function locked<T>(
  directory: string,
  action: () => Promise<T>,
  waitMs = lockWaitMs,
): Promise<T> {
  const lock = lockPath(directory);
  const token = randomUUID();
  const deadline = performance.now() + waitMs;
  while (!(await tryAcquire(lock, token))) {
    const holder = await readHolder(lock);
    const state = holder ? holderState(holder) : "free";
    if (state === "abandoned" && (await retireAbandoned(lock, holder!))) continue;
    if (performance.now() > deadline)
      throw Error(
        `Timed out after ${waitMs / 1000} s waiting for the database lock ${lock}. ` +
          (holder ? describeHolder(holder) + " " : "") +
          lockAdvice(state, holder),
      );
    const longHeld = holder && Date.now() - holder.acquiredAt > lockGraceMs;
    await pause(longHeld ? 1000 : 30);
  }
  const holdLimit =
    lockHoldLimitMs &&
    setTimeout(() => {
      console.error(
        `2b v3: this process held the database lock ${lock} for over ${lockHoldLimitMs / 1000} s without finishing. Exiting so the next 2b command can recover the lock.`,
      );
      process.exit(75);
    }, lockHoldLimitMs).unref();
  try {
    return await action();
  } finally {
    clearTimeout(holdLimit);
    await release(lock, token);
  }
}
interface ServerState {
  pid: number;
  port: number;
  password: string;
}
export class Database {
  readonly directory: string;
  private state: ServerState;
  constructor(directory: string, state: ServerState) {
    this.directory = directory;
    this.state = state;
  }
  async query(sql: string): Promise<any[]> {
    const response = await fetch(`http://127.0.0.1:${this.state.port}/sql`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "surreal-ns": "secondbrain",
        "surreal-db": "metadata",
        Authorization:
          "Basic " +
          Buffer.from("root:" + this.state.password).toString("base64"),
      },
      body: sql,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw Error(
        "SurrealDB HTTP " + response.status + ": " + (await response.text()),
      );
    const results: any = await response.json();
    for (const result of results)
      if (result.status !== "OK") throw Error(String(result.result));
    return results.map((result: any) => result.result);
  }
  static async open(root: string): Promise<Database> {
    const directory = metadataDirectory(await guardRoot(root));
    return locked(directory, async () => {
      const statePath = join(directory, "server.json");
      let previous: ServerState | undefined;
      try {
        previous = JSON.parse(await readFile(statePath, "utf8"));
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
      }
      if (previous) {
        if (
          !Number.isInteger(previous.pid) ||
          previous.pid < 1 ||
          !Number.isInteger(previous.port) ||
          previous.port < 1 ||
          previous.port > 65535 ||
          typeof previous.password !== "string"
        )
          throw Error("Invalid server state");
        let running = true;
        try {
          process.kill(previous.pid, 0);
        } catch (error: any) {
          if (error.code === "ESRCH") running = false;
          else throw error;
        }
        if (running) {
          const database = new Database(directory, previous);
          await database.query("RETURN true;");
          return database;
        }
      }
      const port = await new Promise<number>((resolvePort, reject) => {
        const server = createServer();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const port = (server.address() as any).port;
          server.close(() => resolvePort(port));
        });
      });
      const credentialsPath = join(directory, "credentials.json");
      let password: string;
      try {
        password = JSON.parse(await readFile(credentialsPath, "utf8")).password;
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
        password = previous?.password ?? randomBytes(32).toString("hex");
        await writeFile(credentialsPath, JSON.stringify({ password }), {
          mode: 0o600,
          flag: "wx",
        });
      }
      if (typeof password !== "string" || !password)
        throw Error("Invalid private credentials");
      const binary = fileURLToPath(
        new URL("../../.tools/surrealdb-2.3.10/surreal", import.meta.url),
      );
      const log = await open(join(directory, "surreal.log"), "a", 0o600);
      const child = spawn(
        binary,
        [
          "start",
          "--bind",
          `127.0.0.1:${port}`,
          "--log",
          "warn",
          `surrealkv:${join(directory, "metadata.db")}`,
        ],
        {
          detached: true,
          stdio: ["ignore", log.fd, log.fd],
          env: { ...process.env, SURREAL_USER: "root", SURREAL_PASS: password },
        },
      );
      let spawnError: Error | undefined;
      child.on("error", (error) => {
        spawnError = error;
      });
      await log.close();
      child.unref();
      const state = { pid: child.pid!, port, password };
      const database = new Database(directory, state);
      for (let attempt = 0; attempt < 150; attempt++) {
        if (spawnError) throw spawnError;
        try {
          await database.query("RETURN true;");
          await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
          return database;
        } catch {
          await pause(100);
        }
      }
      if (child.pid) process.kill(child.pid, "SIGTERM");
      throw Error(
        "SurrealDB startup failed; inspect " + join(directory, "surreal.log"),
      );
    });
  }
}
