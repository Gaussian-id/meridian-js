import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// [1] Find the engine runtime folder and its env file (1. Engine/README.md, "Run it locally").
const dir =
  process.env.MERIDIAN_RUNTIME_DIR ??
  (process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Gaussian", "MeridianEngine")
    : join(
        process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? "", ".local", "state"),
        "gaussian",
        "meridian-engine",
      ));

const envFile = process.env.GAUSSMERIDIAN_ENV_FILE ?? join(dir, "meridian-engine.env");

if (!existsSync(envFile)) {
  console.error(
    `No engine runtime at ${dir}. Start it from "1. Engine": pwsh -File scripts/local-up.ps1`,
  );
  process.exit(1);
}

// [2] Refuse when a real provider key is set: the run must never spend money. Values are never printed.
const paid = readFileSync(envFile, "utf8")
  .split(/\r?\n/)
  .map((line) => line.match(/^\s*(GAUSSMERIDIAN_(?:GEMINI|OPENROUTER)_API_KEY)\s*=\s*(.*)$/))
  .filter(
    (match) =>
      match && match[2].trim() !== "" && match[2].trim() !== '""' && match[2].trim() !== "''",
  )
  .map((match) => match[1]);

if (paid.length > 0) {
  console.error(
    `Refusing the contract run: ${paid.join(", ")} is set, so the engine would call a paid provider.`,
  );
  process.exit(1);
}

// [3] The engine must be ready.
const publicUrl = process.env.MERIDIAN_PUBLIC_URL ?? "http://127.0.0.1:8180";

const ready = await fetch(`${publicUrl}/ready`).then(
  (response) => response.status === 200,
  () => false,
);

if (!ready) {
  console.error(
    `The engine at ${publicUrl} is not ready. Start it from "1. Engine": pwsh -File scripts/local-up.ps1`,
  );
  process.exit(1);
}

// [4] The same suite, against the real engine.
const run = spawnSync("pnpm", ["vitest", "run"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, MERIDIAN_CONTRACT: "1", MERIDIAN_RUNTIME_DIR: dir },
});

process.exit(run.status ?? 1);
