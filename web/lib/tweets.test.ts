import assert from "node:assert/strict";
import test from "node:test";

import { tweetsIn } from "./tweets.ts";

test("tweet links are found on x.com and twitter.com, once each, two at most", () => {
  assert.deepEqual(tweetsIn("看这条 https://x.com/halfin/status/1110302988 好"), [{ user: "halfin", id: "1110302988" }]);
  assert.deepEqual(
    tweetsIn("https://twitter.com/a/status/1 https://x.com/a/status/1?s=20 https://mobile.twitter.com/b/status/2 https://x.com/c/status/3"),
    [{ user: "a", id: "1" }, { user: "b", id: "2" }],
  );
  assert.deepEqual(tweetsIn("https://x.com/halfin 和 http://x.com/a/status/1"), []);
  assert.deepEqual(tweetsIn(null), []);
});
