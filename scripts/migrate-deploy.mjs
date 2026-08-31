/**
 * Runs `prisma migrate deploy`, retrying a few times before giving up.
 *
 * Migrations take an advisory lock on the database. Pushing several commits in quick
 * succession puts two builds in flight at once, the second loses the race, and the
 * deployment fails after about twenty seconds with nothing wrong in the code — the
 * commit before and after it deploy fine.
 *
 * A serverless Postgres that has scaled to zero fails the same way: the first
 * connection times out while the database wakes, and the retry succeeds.
 *
 * Retries only. A migration that genuinely cannot apply still fails the build, since
 * shipping code against a schema that never arrived is worse than not shipping.
 */
import { spawnSync } from "node:child_process";

const ATTEMPTS = 4;
const BACKOFF_MS = [3000, 8000, 15000];

/** Distinguishes "someone else is mid-migration" from "this migration is broken". */
function looksTransient(output) {
  return [
    "advisory lock",
    "Timed out trying to acquire",
    "P1002", // database reachable but timed out
    "P1001", // cannot reach the database server
    "P1017", // server closed the connection
    "Connection terminated",
    "ECONNRESET",
    "ETIMEDOUT",
  ].some((needle) => output.toLowerCase().includes(needle.toLowerCase()));
}

for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    encoding: "utf8",
    env: process.env,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);

  if (result.status === 0) process.exit(0);

  const transient = looksTransient(output);
  if (!transient || attempt === ATTEMPTS) {
    console.error(
      transient
        ? `\nMigrations still blocked after ${ATTEMPTS} attempts. Another deployment may be running; retry this build.`
        : "\nMigration failed for a reason retrying will not fix.",
    );
    process.exit(result.status ?? 1);
  }

  const wait = BACKOFF_MS[attempt - 1];
  console.error(`\nMigration attempt ${attempt} hit a transient error; retrying in ${wait / 1000}s.`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
}
