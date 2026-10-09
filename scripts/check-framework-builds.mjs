import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const run = (cwd) =>
  spawnSync("pnpm", ["run", "build"], {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  }).status;

const filesUnder = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

// A string literal from packages/meridian-nuxt/src/server.ts that survives minification.
const NUXT_SERVER_MARKER = "meridian-nuxt: set runtimeConfig.meridian.url";

/** Client files of a built Nuxt fixture that hold the server client; null when there was nothing to scan. */
const nuxtClientLeaks = (cwd) => {
  const files = [".nuxt/dist/client", ".output/public"]
    .map((dir) => join(cwd, dir))
    .filter(existsSync)
    .flatMap(filesUnder);

  return files.length
    ? files.filter((file) => readFileSync(file, "utf8").includes(NUXT_SERVER_MARKER))
    : null;
};

// [1] The supported shapes must build.
const builds = [
  "packages/meridian-next/test/fixtures/app",
  "packages/meridian-nuxt/test/fixtures/app",
];

// [2] A client component importing the server client must fail to build.
const mustFail = ["packages/meridian-next/test/fixtures/leak"];

const broken = builds.filter((cwd) => run(cwd) !== 0);
const leaked = mustFail.filter((cwd) => run(cwd) === 0);
const problems = [];

// [3] The Nuxt client bundle must not hold the server client (scanned only after its build succeeded).
const nuxtGood = "packages/meridian-nuxt/test/fixtures/app";

if (!broken.includes(nuxtGood)) {
  const found = nuxtClientLeaks(nuxtGood);

  if (found === null) problems.push(`${nuxtGood}: no client files to scan`);
  else if (found.length)
    problems.push(`${nuxtGood}: server client in client bundle (${found.join(", ")})`);
}

// [4] The negative Nuxt fixture must be caught: its build fails, or its client bundle holds the marker.
const nuxtLeak = "packages/meridian-nuxt/test/fixtures/leak";

if (run(nuxtLeak) === 0) {
  const found = nuxtClientLeaks(nuxtLeak);

  if (!found?.length) problems.push(`${nuxtLeak}: leak built and was not detected`);
  else console.log(`Nuxt leak fixture detected: marker found in ${found.length} client file(s).`);
} else {
  console.log("Nuxt leak fixture detected: build failed.");
}

if (broken.length || leaked.length || problems.length) {
  console.error(
    `Builds that failed: ${broken.join(", ") || "none"}. Leaks that built: ${leaked.join(", ") || "none"}. Nuxt: ${problems.join("; ") || "ok"}.`,
  );
  process.exit(1);
}

console.log("Framework builds behave as expected.");
