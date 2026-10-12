import assert from "node:assert/strict";
import test from "node:test";

import { npub, noteId } from "./nostr.ts";

// The examples in NIP-19.
test("npub and note encode like NIP-19", () => {
  assert.equal(npub("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"), "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6");
  assert.equal(npub("7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e"), "npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg");
});

test("note ids use the note prefix", () => {
  assert.match(noteId("00".repeat(32)), /^note1q{52}/);
});
