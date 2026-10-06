import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2]);
const candidate = join(root, "candidate"), baseline = join(root, "baseline");
const base = "9fa92df0afb170bd57da8314e2a4280aca1fd4ac";
const feature = process.env.FEATURE_SHA;
assert.match(feature ?? "", /^[0-9a-f]{40}$/);
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const hashes = {
  "apps/web/src/ConsoleApp.tsx": "40bee46da93014dba19ca68300c96c7820b69a508fe63237aa4f25786502efe0",
  "apps/web/e2e/skip-link.spec.ts": "02230077007e8dcec35e98150416b85902bd94a940879da287686297f66f3c28",
};
assert.equal(git(baseline, "rev-parse", "HEAD"), base);
assert.equal(git(candidate, "rev-parse", "HEAD"), feature);
git(candidate, "merge-base", "--is-ancestor", base, feature);
assert.deepEqual(git(candidate, "diff", "--name-only", base, feature).split("\n").sort(), Object.keys(hashes).sort());
assert.equal(git(candidate, "status", "--porcelain=v1", "--untracked-files=all"), "", "candidate source changed during validation");
assert.equal(git(baseline, "diff", "--name-only"), "", "baseline tracked source changed");
assert.equal(git(baseline, "status", "--porcelain=v1", "--untracked-files=all"), "?? apps/web/e2e/skip-link.spec.ts", "baseline must differ only by the identical new regression");
for (const [path, expected] of Object.entries(hashes)) {
  const actual = createHash("sha256").update(readFileSync(join(candidate, path))).digest("hex");
  assert.equal(actual, expected, path);
  console.log(`${actual}  candidate/${path}`);
}
const spec = "apps/web/e2e/skip-link.spec.ts";
assert.deepEqual(readFileSync(join(baseline, spec)), readFileSync(join(candidate, spec)));
for (const path of ["apps/web/pnpm-lock.yaml", "packages/agents-client/pnpm-lock.yaml"]) {
  const bytes = readFileSync(join(candidate, path));
  assert.deepEqual(bytes, readFileSync(join(baseline, path)));
  console.log(`${createHash("sha256").update(bytes).digest("hex")}  both/${path}`);
}
console.log("Exact candidate and unchanged baseline plus identical regression verified.");
