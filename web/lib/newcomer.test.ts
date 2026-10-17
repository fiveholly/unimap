import assert from "node:assert/strict";
import test from "node:test";

import { complete, doneCount, LOCAL_KEY, merge, needsReport, NONE, nextStep, readLocal, writeLocal } from "./newcomer.ts";
import { shiftInto } from "./terms.ts";

test("a term's popup is moved back inside the screen", () => {
  assert.equal(shiftInto(100, 340, 1280), 0);
  assert.equal(shiftInto(300, 540, 390), 390 - 12 - 540);
  assert.equal(shiftInto(-20, 220, 390), 32);
  assert.equal(shiftInto(50, 500, 390), 12 - 50); // wider than the screen: from the left margin
});

const store = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

test("merge: a step done in the browser or on the server is done", () => {
  assert.deepEqual(merge({ birthday: true }, { checkin: true, capsule: false }), { birthday: true, checkin: true, capsule: false });
  assert.deepEqual(merge(null, null), NONE);
  assert.deepEqual(merge({ birthday: false }, { birthday: true, checkin: true, capsule: true }), { birthday: true, checkin: true, capsule: true });
});

test("progress, next step and completion", () => {
  assert.equal(nextStep(NONE), "birthday");
  assert.equal(nextStep({ birthday: true, checkin: false, capsule: true }), "checkin");
  const all = { birthday: true, checkin: true, capsule: true };
  assert.equal(nextStep(all), null);
  assert.equal(doneCount({ birthday: true, checkin: true, capsule: false }), 2);
  assert.ok(complete(all));
  assert.ok(!complete({ ...all, capsule: false }));
});

test("only the birthday is reported on sign-in, and only when the server lacks it", () => {
  const local = { birthday: true, block: 416_500, collapsed: false, dismissed: false };
  assert.ok(needsReport(local, NONE));
  assert.ok(!needsReport(local, { ...NONE, birthday: true }));
  assert.ok(!needsReport({ ...local, birthday: false }, NONE));
  assert.ok(!needsReport(local, null)); // not loaded yet
});

test("local storage round-trips and survives junk or a throwing store", () => {
  const s = store();
  assert.deepEqual(readLocal(s), { birthday: false, block: null, collapsed: false, dismissed: false });
  writeLocal(s, { birthday: true, block: 840_000, collapsed: true, dismissed: false });
  assert.deepEqual(readLocal(s), { birthday: true, block: 840_000, collapsed: true, dismissed: false });
  assert.deepEqual(readLocal(store({ [LOCAL_KEY]: "{not json" })).birthday, false);
  assert.deepEqual(readLocal(store({ [LOCAL_KEY]: JSON.stringify({ birthday: "yes", block: -3 }) })), { birthday: false, block: null, collapsed: false, dismissed: false });
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readLocal(broken).birthday, false);
  writeLocal(broken, { birthday: true, block: null, collapsed: false, dismissed: false }); // doesn't throw
  assert.equal(readLocal(null).birthday, false);
});
