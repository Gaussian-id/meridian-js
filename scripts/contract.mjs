import { spawnSync } from "node:child_process";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_URLS, refusal, runtimeDir } from "./contract-guard.mjs";

// Contract run against the real local engine. It must never spend money, so the guard (contract-guard.mjs) decides
// first and refuses on a paid provider key (process or any env file), a path outside the runtime folder, a
// non-loopback URL or a proxy (environment or Windows registry); it never prints a value. The real run is deferred
// by the owner: this script only refuses, or launches the suite when the guard allows it.
//   node scripts/contract.mjs

export const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");

// node and the installed vitest entry, not pnpm: nothing is installed or resolved (frozen), no registry, update
// check or other network access (offline), and no .env file is loaded (vite's envDir is off in vitest.config.ts;
// NODE_OPTIONS, which could add --env-file, is dropped from the child). In contract mode describeFake registers
// nothing, so a file of fake-only tests is empty: --passWithNoTests lets it be.
export const COMMAND = [
  process.execPath,
  join(ROOT, "node_modules", "vitest", "vitest.mjs"),
  "run",
  "--passWithNoTests",
];

export function readyEndpoint(publicUrl) {
  return publicUrl.replace(/\/+$/, "") + "/ready";
}

/** A plain 200 from /ready. A fresh agent (no proxy from the environment) and no redirect, so the answer is the engine's own. */
export function engineReady(publicUrl) {
  return new Promise((answer) => {
    try {
      const url = new URL(readyEndpoint(publicUrl));

      const [send, Agent] =
        url.protocol === "https:" ? [httpsRequest, HttpsAgent] : [httpRequest, HttpAgent];

      const request = send(url, { agent: new Agent(), timeout: 5000 }, (response) => {
        response.resume();
        answer(response.statusCode === 200);
      });

      request.on("timeout", () => request.destroy());
      request.on("error", () => answer(false));
      request.end();
    } catch {
      answer(false);
    }
  });
}

function defaultRunner(command, { env, cwd }) {
  return spawnSync(command[0], command.slice(1), { stdio: "inherit", env, cwd }).status ?? 1;
}

export async function main(
  environ = process.env,
  { ready = engineReady, runner = defaultRunner, registry } = {},
) {
  // [1] The guard decides first: nothing is contacted or launched on a refusal
  const reason = refusal(environ, registry ? { registry } : {});

  if (reason !== null) {
    console.error(`Contract run refused: ${reason}`);

    return 1;
  }

  // [2] The engine must be ready
  const publicUrl = environ.MERIDIAN_PUBLIC_URL ?? DEFAULT_URLS.MERIDIAN_PUBLIC_URL;

  if (!(await ready(publicUrl))) {
    console.error(
      "Contract run refused: the local engine is not ready (or did not answer in 5 s).",
    );

    return 1;
  }

  // [3] The same suite, in contract mode, against the engine. The guard found no proxy; NO_PROXY=* keeps it so
  const child = Object.fromEntries(
    Object.entries(environ).filter(([name]) => name.toUpperCase() !== "NODE_OPTIONS"),
  );

  Object.assign(child, {
    MERIDIAN_CONTRACT: "1",
    MERIDIAN_RUNTIME_DIR: environ.MERIDIAN_RUNTIME_DIR || runtimeDir(environ),
    NO_PROXY: "*",
    no_proxy: "*",
  });

  return Number(await runner(COMMAND, { env: child, cwd: ROOT }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
