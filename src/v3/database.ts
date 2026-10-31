import { metadataDirectory, sourceVaults } from "./config.ts";
import {
  mkdir,
  readFile,
  writeFile,
  realpath,
  stat,
  readdir,
  rm,
  open,
} from "node:fs/promises";
import { resolve, dirname, join, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
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
export async function locked<T>(
  directory: string,
  action: () => Promise<T>,
): Promise<T> {
  const lock = join(directory, "operation.lock");
  const deadline = Date.now() + 60000;
  while (true) {
    try {
      await mkdir(lock);
      await writeFile(join(lock, "pid"), String(process.pid));
      break;
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
      try {
        const pid = Number(await readFile(join(lock, "pid"), "utf8"));
        try {
          process.kill(pid, 0);
        } catch (reason: any) {
          if (reason.code === "ESRCH") {
            throw Error(
              "Abandoned database lock. Ensure no writer is active, then remove " +
                lock,
            );
          }
        }
      } catch (reason: any) {
        if (reason.code !== "ENOENT") throw reason;
        // The owner can release the lock between these reads.
        try {
          if (Date.now() - (await stat(lock)).mtimeMs > 60000)
            throw Error("Abandoned database lock: " + lock);
        } catch (error: any) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      if (Date.now() > deadline)
        throw Error("Timed out waiting for database lock");
      await pause(30);
    }
  }
  try {
    return await action();
  } finally {
    await rm(lock, { recursive: true, force: true });
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
