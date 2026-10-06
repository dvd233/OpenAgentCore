import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const [reportPath, discoveryPath, expectedPath] = process.argv.slice(2);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const discovery = JSON.parse(readFileSync(discoveryPath, "utf8"));
const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
function entries(document) {
  const rows = [];
  function collect(suite) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests) {
      rows.push({ identity: [spec.file, spec.line, spec.column, spec.title, test.projectId], test });
    }
    for (const child of suite.suites ?? []) collect(child);
  }
  for (const suite of document.suites) collect(suite);
  return rows;
}
const order = (rows) => rows.map((row) => JSON.stringify(row)).sort();
assert.equal(expected.length, 83, "reviewed suite size changed");
assert.equal(new Set(order(expected)).size, 83);
assert.deepEqual(report.errors, []);
assert.deepEqual(discovery.errors, []);
assert.equal(report.config.rootDir, discovery.config.rootDir);
for (const document of [report, discovery]) {
  assert.equal(document.config.projects.length, 1);
  assert.equal(document.config.workers, 1);
  assert.equal(document.config.projects[0].retries, 0);
  assert.equal(document.config.projects[0].repeatEach, 1);
  assert.deepEqual(order(entries(document).map((entry) => entry.identity)), order(expected), "missing, extra or altered full-suite tests");
}
for (const { test } of entries(discovery)) {
  assert.deepEqual(test.results, [], "discovery must not contain executions");
  assert.equal(test.expectedStatus, "passed");
}
for (const { test } of entries(report)) {
  assert.equal(test.expectedStatus, "passed");
  assert.equal(test.status, "expected");
  assert.equal(test.results.length, 1);
  const result = test.results[0];
  assert.equal(result.status, "passed");
  assert.equal(result.retry, 0);
  assert.deepEqual(result.errors, []);
  assert.equal(result.error, undefined);
  assert.equal(result.errorLocation, undefined);
}
assert.equal(report.stats.expected, 83);
assert.equal(report.stats.unexpected, 0);
assert.equal(report.stats.flaky, 0);
assert.equal(report.stats.skipped, 0, "skips require separate review");
console.log("Complete reviewed browser suite passed: 83 tests, no omissions/skips/retries/failures.");
