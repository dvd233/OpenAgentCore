import assert from "node:assert/strict";
for (const port of process.argv.slice(2)) {
  assert.match(port, /^\d+$/);
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
    throw new Error(`Fixture/browser server still responds on ${port}`);
  } catch (error) {
    // A timeout, HTTP response or unknown transport failure does not establish shutdown.
    assert.equal(error.cause?.code, "ECONNREFUSED", `Could not establish server shutdown on ${port}: ${error.message}`);
  }
}
console.log("Native Playwright fixture/web server ports are closed.");
