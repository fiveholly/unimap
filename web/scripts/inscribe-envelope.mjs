#!/usr/bin/env node
// Inscribe the shared capsule envelope (web/public/capsule-envelope.svg) once on a gift network, for
// the operator. Every inscribed letter then shows it by ord's delegate tag instead of carrying its
// own fallback SVG (lib/gift.ts letterScript): set the id this prints as CAPSULE_ENVELOPE_INSCRIPTION
// in deploy/unimap.env (and NEXT_PUBLIC_CAPSULE_ENVELOPE_INSCRIPTION for the demo site, signet only).
//
// Two steps, with a one-time key kept in a state file (it can spend the commit until the reveal is out):
//   node --experimental-strip-types scripts/inscribe-envelope.mjs --network signet [--fee-rate 2]
//       makes the key and the commit address, writes envelope-<network>.json, and says how many sats
//       to send there (from any wallet on that network)
//   node --experimental-strip-types scripts/inscribe-envelope.mjs --resume envelope-signet.json --to tb1p... [--dry-run]
//       once the payment is seen: signs the reveal (the inscription goes to --to, an address you keep
//       on that network), broadcasts it, and prints the inscription id <reveal txid>i0
// Options: --esplora <api url> (default mempool.space for the network), --file <svg> (default the asset).
// Run from web/. Test networks only, as the gifts are. With an ord wallet on the network, the same can
// be done with `ord wallet inscribe --fee-rate <n> --file public/capsule-envelope.svg`.
//
// Before relying on the delegate, check on Signet that the wallets you care about (UniSat, Xverse)
// show a letter's envelope; until then leave CAPSULE_ENVELOPE_INSCRIPTION empty: the fallback SVG
// is shown everywhere ord content is.

import { readFileSync, writeFileSync } from "node:fs";

import { hex } from "@scure/base";

import { buildReveal, commitTaproot, inscriptionScript, isGiftNetwork, newSecret, revealFee, SVG_TYPE, xonlyOf } from "../lib/gift.ts";

const ESPLORA = { signet: "https://mempool.space/signet/api", testnet: "https://mempool.space/testnet/api", testnet4: "https://mempool.space/testnet4/api" };
const POSTAGE = 546;
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const die = (msg) => (console.error(msg), process.exit(1));

const resume = opt("--resume");
const state = resume ? JSON.parse(readFileSync(resume, "utf8")) : null;
const network = state?.network ?? opt("--network") ?? die("--network signet|testnet|testnet4, or --resume <state file>");
if (!isGiftNetwork(network)) die("test networks only: signet, testnet or testnet4");
const esplora = (opt("--esplora") ?? state?.esplora ?? ESPLORA[network]).replace(/\/+$/, "");
const get = async (path) => {
  const r = await fetch(esplora + path);
  if (!r.ok) die(`${esplora}${path}: ${r.status} ${await r.text()}`);
  return r;
};

if (!state) {
  const svg = readFileSync(opt("--file") ?? new URL("../public/capsule-envelope.svg", import.meta.url));
  const secret = newSecret();
  const envelope = inscriptionScript(xonlyOf(secret), SVG_TYPE, svg);
  const feeRate = Number(opt("--fee-rate") ?? 2);
  // The reveal pays POSTAGE to a P2TR address; its size doesn't depend on which one.
  const dummy = "tb1pqxuqm6tl9ahdr6pu00w67cj3ynt7c65rkct9un6q2y9tueenhzwqqx4cd7";
  const amount = POSTAGE + revealFee(secret, envelope, dummy, POSTAGE, feeRate);
  const commit = commitTaproot(secret, envelope).address;
  const file = `envelope-${network}.json`;
  writeFileSync(file, JSON.stringify({ network, esplora, secret: hex.encode(secret), svg: hex.encode(svg), commit, amount }, null, 2), { mode: 0o600 });
  console.log(`send exactly ${amount} sats on ${network} to\n  ${commit}\nthen: node --experimental-strip-types scripts/inscribe-envelope.mjs --resume ${file} --to <your ${network} address>`);
  console.log(`(the envelope is ${svg.length} bytes; ${file} holds the one-time key: keep it until the reveal is out)`);
} else {
  const to = opt("--to") ?? die("--to <an address of yours on the network>: the inscription goes there");
  const secret = hex.decode(state.secret), svg = hex.decode(state.svg);
  const envelope = inscriptionScript(xonlyOf(secret), SVG_TYPE, svg);
  if (commitTaproot(secret, envelope).address !== state.commit) die("the state file doesn't match its commit address");
  const utxos = await (await get(`/address/${state.commit}/utxo`)).json();
  const coin = utxos.find((u) => u.value >= state.amount) ?? die(`nothing of ${state.amount} sats at ${state.commit} yet`);
  const reveal = buildReveal({ secret, envelope, commit: { txid: coin.txid, vout: coin.vout, value: coin.value }, giftAddress: to, giftSats: POSTAGE });
  console.error(`reveal ${reveal.txid}: ${reveal.vsize} vB, fee ${coin.value - POSTAGE} sats`);
  if (args.includes("--dry-run")) {
    console.log(reveal.hex);
  } else {
    const r = await fetch(`${esplora}/tx`, { method: "POST", body: reveal.hex });
    const text = (await r.text()).trim();
    if (!r.ok) die(`broadcast refused: ${text}`);
    console.log(`inscribed: ${reveal.txid}i0\nput this in deploy/unimap.env:\n  CAPSULE_ENVELOPE_INSCRIPTION=${reveal.txid}i0`);
  }
}
