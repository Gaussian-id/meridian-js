import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isInside, isLoopbackUrl, paidKeysIn } from "./contract-guard.mjs";

// The contract run must never spend money. It therefore only runs when ALL hold:
//   - the public and admin URLs are loopback (127.0.0.1, localhost, ::1);
//   - the env file it checks lives inside the runtime folder the local runtime scripts use
//     (%LOCALAPPDATA%\Gaussian\MeridianEngine, or ${XDG_STATE_HOME:-~/.local/state}/gaussian/meridian-engine),
//     so an override cannot point the check at a clean file while the engine runs on another;
//   - that env file names no non-empty GAUSSMERIDIAN_GEMINI_API_KEY / GAUSSMERIDIAN_OPENROUTER_API_KEY;
//   - the engine answers /ready.
// Overrides that break a rule are refused by name; values are never printed.

const refuse = (message) => {
  console.error(message);
  process.exit(1);
};

// [1] Locate the runtime folder and env file; refuse overrides that leave the runtime folder.
const runtimeDir = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, "Gaussian", "MeridianEngine")
  : join(
      process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? "", ".local", "state"),
      "gaussian",
      "meridian-engine",
    );

const dir = process.env.MERIDIAN_RUNTIME_DIR ?? runtimeDir;
const envFile = process.env.GAUSSMERIDIAN_ENV_FILE ?? join(dir, "meridian-engine.env");

if (!isInside(runtimeDir, envFile)) {
  refuse(
    "Refusing the contract run: MERIDIAN_RUNTIME_DIR / GAUSSMERIDIAN_ENV_FILE point outside the local runtime folder, so the check could miss the real engine configuration.",
  );
}

// [2] Refuse non-loopback engines.
const publicUrl = process.env.MERIDIAN_PUBLIC_URL ?? "http://127.0.0.1:8180";
const adminUrl = process.env.MERIDIAN_ADMIN_URL ?? "http://127.0.0.1:8181";

const remote = [
  ["MERIDIAN_PUBLIC_URL", publicUrl],
  ["MERIDIAN_ADMIN_URL", adminUrl],
]
  .filter(([, url]) => !isLoopbackUrl(url))
  .map(([name]) => name);

if (remote.length > 0) {
  refuse(
    `Refusing the contract run: ${remote.join(", ")} is not a loopback address (127.0.0.1, localhost, ::1).`,
  );
}

if (!existsSync(envFile)) {
  refuse(`No engine runtime at ${dir}. Start it from "1. Engine": pwsh -File scripts/local-up.ps1`);
}

// [3] Refuse when a real provider key is set. Fail closed if the file cannot be read.
let text;

try {
  text = readFileSync(envFile, "utf8");
} catch {
  refuse(
    "Refusing the contract run: the engine env file cannot be read, so it cannot be checked for provider keys.",
  );
}

const paid = paidKeysIn(text);

if (paid.length > 0) {
  refuse(
    `Refusing the contract run: ${paid.join(", ")} is set, so the engine would call a paid provider.`,
  );
}

// [4] The engine must be ready.
const ready = await fetch(`${publicUrl}/ready`, { signal: AbortSignal.timeout(5000) }).then(
  (response) => response.status === 200,
  () => false,
);

if (!ready) {
  refuse(
    `The engine at ${publicUrl} is not ready (or did not answer in 5 s). Start it from "1. Engine": pwsh -File scripts/local-up.ps1`,
  );
}

// [5] The same suite, against the real engine.
const run = spawnSync("pnpm", ["vitest", "run"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, MERIDIAN_CONTRACT: "1", MERIDIAN_RUNTIME_DIR: dir },
});

process.exit(run.status ?? 1);
