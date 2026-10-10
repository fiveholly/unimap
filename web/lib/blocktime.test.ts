import assert from "node:assert/strict";
import test from "node:test";

import { heightAt, heightOnDay } from "./blocktime.ts";

test("known blocks land where they were mined", () => {
  assert.equal(heightAt(1231006505), 0);
  assert.equal(heightAt(1713571767), 840000);
  assert.equal(heightAt(1231006504), null);
  // The first halving's day, from the anchors either side of it.
  const halving = heightOnDay("2012-11-28", 900000)!;
  assert.ok(Math.abs(halving - 210000) < 150, String(halving));
  // Heights only grow with the date.
  const days = ["2009-06-01", "2010-05-22", "2013-01-01", "2017-12-17", "2021-11-08", "2025-01-01"].map((d) => heightOnDay(d, 900000)!);
  assert.deepEqual([...days].sort((a, b) => a - b), days);
});

test("days before bitcoin or after the tip have no block", () => {
  assert.equal(heightOnDay("1990-06-01", 900000), null);
  assert.equal(heightOnDay("2099-01-01", 900000), null);
  assert.equal(heightOnDay("not a day", 900000), null);
  assert.ok(heightOnDay("2024-04-20", 900000)! >= 839900);
});
