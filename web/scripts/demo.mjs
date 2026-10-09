// `npm run demo`: the site with a made-up city built in (lib/demo.ts), no API needed.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_DEMO: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
