import { mkdir, mkdtemp, readFile, rm, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const execute = promisify(execFile);
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw Error(
    "Pinned installer supports macOS arm64 only. Add a verified platform archive before use.",
  );
const destination = fileURLToPath(
  new URL("../../.tools/surrealdb-2.3.10/", import.meta.url),
);
const temporary = await mkdtemp(join(tmpdir(), "2b-surreal-install-"));
try {
  const archive = join(temporary, "surreal.tgz");
  await execute("curl", [
    "--fail",
    "--location",
    "--proto",
    "=https",
    "https://github.com/surrealdb/surrealdb/releases/download/v2.3.10/surreal-v2.3.10.darwin-arm64.tgz",
    "--output",
    archive,
  ]);
  const checksum = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  if (
    checksum !==
    "291daeebc15a98a9957182fc2e373aaabc700261d07cddf1bfe9de533342f9d4"
  )
    throw Error("SurrealDB archive checksum mismatch");
  await execute("tar", ["-xzf", archive, "-C", temporary, "surreal"]);
  await mkdir(destination, { recursive: true });
  await rename(join(temporary, "surreal"), join(destination, "surreal"));
  console.log(
    (await execute(join(destination, "surreal"), ["version"])).stdout.trim(),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
