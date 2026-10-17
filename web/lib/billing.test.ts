import assert from "node:assert/strict";
import test from "node:test";

import { btcAmount, demoTxid, parseTxid, payMethods, walletTxid } from "./billing.ts";

const TX = "a1".repeat(32);

test("parseTxid takes a bare txid or an explorer link", () => {
  assert.equal(parseTxid(TX), TX);
  assert.equal(parseTxid(`  ${TX.toUpperCase()}\n`), TX);
  assert.equal(parseTxid(`https://mempool.space/tx/${TX}`), TX);
  assert.equal(parseTxid(`https://mempool.space/tx/${TX}#vout=1`), TX);
  assert.equal(parseTxid(`${TX}:0`), TX); // an outpoint
  assert.equal(parseTxid(TX.slice(1)), null);
  assert.equal(parseTxid(TX + "0"), null);
  assert.equal(parseTxid("not a txid"), null);
  assert.equal(parseTxid(""), null);
});

test("walletTxid reads what each wallet's send returns", () => {
  assert.equal(walletTxid(TX), TX); // UniSat, OKX
  assert.equal(walletTxid({ txid: TX.toUpperCase() }), TX); // Xverse sendTransfer
  assert.throws(() => walletTxid({}));
  assert.throws(() => walletTxid(null));
  assert.throws(() => walletTxid("oops"));
});

test("btcAmount writes sats as BTC", () => {
  assert.equal(btcAmount(2000), "0.00002");
  assert.equal(btcAmount(123_456_789), "1.23456789");
  assert.equal(btcAmount(100_000_000), "1");
  assert.equal(btcAmount(0), "0");
});

test("payMethods keeps the server's order and drops unknown ones", () => {
  assert.deepEqual(payMethods(["onchain", "lightning"]), ["onchain", "lightning"]);
  assert.deepEqual(payMethods(["lightning", "card"]), ["lightning"]);
  assert.deepEqual(payMethods(undefined), []);
});

test("demoTxid looks like a txid", () => {
  const tx = demoTxid();
  assert.equal(parseTxid(tx), tx);
  assert.notEqual(demoTxid(), tx);
});
