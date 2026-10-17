import { test } from "node:test";
import assert from "node:assert/strict";

import { isStaleBuild } from "./stale.ts";

test("a missing script file after a redeploy counts as a stale build", () => {
  const e = new Error("Failed to load chunk /_next/static/chunks/abc.js from module 123");
  assert.equal(isStaleBuild(e), true);
  assert.equal(isStaleBuild(Object.assign(new Error("Loading chunk 7 failed."), { name: "ChunkLoadError" })), true);
  assert.equal(isStaleBuild(new TypeError("Failed to fetch dynamically imported module: /x.js")), true);
});

test("an ordinary bug does not", () => {
  assert.equal(isStaleBuild(new TypeError("Cannot read properties of undefined (reading 'map')")), false);
  assert.equal(isStaleBuild(undefined), false);
});
