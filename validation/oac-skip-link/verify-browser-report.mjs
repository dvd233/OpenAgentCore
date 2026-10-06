import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

// This gate is bound to the reviewed regression, not arbitrary similarly named tests.
export const approvedSpecSha256 = "02230077007e8dcec35e98150416b85902bd94a940879da287686297f66f3c28";
export const expectedCases = [
  { title: "skips to the current page with Enter without changing its route or history", line: 26, failureLine: 41, path: "/#files" },
  { title: "preserves detail parameters and Back/Forward history after repeated skip-link activation", line: 51, failureLine: 68, path: "/#agents?project=proj_7f3a91c2&id=agent_11c4f2a8" },
  { title: "skips to the current main after the tour removes and remounts the console", line: 85, failureLine: 102, path: "/" },
];

export function verifyBrowserReport(report, phase, exitCode, specPath) {
  assert.ok(phase === "baseline" || phase === "candidate", "invalid phase");
  assert.equal(String(exitCode), phase === "baseline" ? "1" : "0", "unexpected Playwright exit code");
  const sourcePath = resolve(specPath);
  const source = readFileSync(sourcePath);
  assert.equal(createHash("sha256").update(source).digest("hex"), approvedSpecSha256, "regression source differs from the approved spec");
  assert.equal(report.config.rootDir, dirname(sourcePath), "report must name the supplied source checkout");
  assert.equal(report.config.workers, 1);
  assert.equal(report.config.projects.length, 1, "extra projects are extra executions");
  const project = report.config.projects[0];
  assert.equal(project.testDir, dirname(sourcePath));
  assert.equal(project.retries, 0);
  assert.equal(project.repeatEach, 1);
  assert.deepEqual(report.errors, [], "global errors are not regression evidence");

  const specs = [];
  function collect(suite) {
    specs.push(...(suite.specs ?? []));
    for (const child of suite.suites ?? []) collect(child);
  }
  for (const suite of report.suites) collect(suite);
  assert.deepEqual(specs.map((spec) => spec.title).sort(), expectedCases.map((entry) => entry.title).sort());
  for (const spec of specs) {
    const expected = expectedCases.find((entry) => entry.title === spec.title);
    assert.equal(spec.file, "skip-link.spec.ts");
    assert.equal(spec.line, expected.line);
    assert.equal(spec.ok, phase === "candidate");
    assert.equal(spec.tests.length, 1, "extra executions are not allowed");
    const test = spec.tests[0];
    assert.equal(test.projectId, project.id);
    assert.equal(test.expectedStatus, "passed", "expected-failure annotations are not allowed");
    assert.deepEqual(test.annotations, []);
    assert.equal(test.results.length, 1, "retries/flakes require investigation");
    const result = test.results[0];
    assert.equal(result.retry, 0);
    assert.deepEqual(result.annotations, []);
    assert.deepEqual(result.steps ?? [], [], "unexpected nested steps need review");
    if (phase === "candidate") {
      assert.equal(test.status, "expected", spec.title);
      assert.equal(result.status, "passed", spec.title);
      assert.deepEqual(result.errors, []);
      assert.equal(result.error, undefined);
      assert.equal(result.errorLocation, undefined);
      continue;
    }

    assert.equal(test.status, "unexpected", spec.title);
    assert.equal(result.status, "failed", "test timeouts/interruption are not the intended assertion failure");
    assert.equal(result.errors.length, 1, "any setup, teardown, boundary or additional assertion error invalidates red evidence");
    assert.equal(result.error?.cause, undefined, "nested errors need review");
    assert.equal(typeof result.error?.message, "string");
    const raw = stripVTControlCharacters(result.error.message);
    // Inspect the primary raw error, not the rendered code frame, whose nearby
    // source lines can contain toHaveURL even when another assertion failed.
    const mismatch = raw.match(/^Error: expect\(page\)\.toHaveURL\(expected\) failed\n\nExpected: ("[^"\n]+")\nReceived: ("[^"\n]+")\nTimeout: +7500ms\n(?:\nCall log:\n[\s\S]*)?$/);
    assert.ok(mismatch, "primary error must be the exact URL assertion mismatch");
    const wanted = new URL(JSON.parse(mismatch[1]));
    const received = new URL(JSON.parse(mismatch[2]));
    assert.equal(wanted.protocol, "http:");
    assert.equal(wanted.hostname, "127.0.0.1");
    assert.notEqual(wanted.port, "");
    assert.equal(wanted.username + wanted.password, "");
    assert.equal(wanted.pathname + wanted.search + wanted.hash, expected.path);
    assert.equal(received.href, `${wanted.origin}/#main-content`);

    const rendered = result.errors[0];
    for (const location of [result.error.location, result.errorLocation, rendered.location]) {
      assert.equal(location?.file, sourcePath, "error came from another file or hook");
      assert.equal(location.line, expected.failureLine, "error came from another assertion");
      assert.ok(Number.isSafeInteger(location.column) && location.column > 0);
    }
    assert.deepEqual(result.error.location, rendered.location);
    assert.deepEqual(result.errorLocation, rendered.location);
    assert.equal(typeof rendered.message, "string");
    assert.ok(stripVTControlCharacters(rendered.message).startsWith(raw), "primary and rendered errors disagree");
  }
  assert.equal(report.stats.skipped, 0);
  assert.equal(report.stats.flaky, 0);
  assert.equal(report.stats.expected, phase === "candidate" ? 3 : 0);
  assert.equal(report.stats.unexpected, phase === "baseline" ? 3 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [phase, path, exitCode, specPath] = process.argv.slice(2);
  assert.ok(specPath, "usage: verify-browser-report.mjs phase report.json exit-code absolute-spec-path");
  verifyBrowserReport(JSON.parse(readFileSync(path, "utf8")), phase, exitCode, specPath);
  console.log(`${phase}: source-bound browser regression outcome accepted`);
}
