import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const nuxtApp = "packages/meridian-nuxt/test/fixtures/app";
const nuxtSentinel = "MERIDIAN_NUXT_LEAK_SENTINEL";

const run = (cwd) =>
  spawnSync("pnpm", ["run", "build"], {
    cwd,
    stdio: "inherit",
    env:
      cwd === nuxtApp
        ? {
            ...process.env,
            NUXT_MERIDIAN_URL: "http://engine.invalid",
            NUXT_MERIDIAN_KEY: nuxtSentinel,
          }
        : process.env,
    shell: process.platform === "win32",
  }).status;

// [1] The supported shapes must build.
const builds = ["packages/meridian-next/test/fixtures/app", nuxtApp];

// [2] A client component importing the server client must fail to build.
const mustFail = ["packages/meridian-next/test/fixtures/leak"];

// [3] The built Nuxt client assets must hold neither the server key nor the server client.
const filesUnder = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

const nuxtClientDirs = [".nuxt/dist/client", ".output/public"].map((dir) => join(nuxtApp, dir));
const nuxtClientFiles = nuxtClientDirs.filter(existsSync).flatMap(filesUnder);

const nuxtLeaks = nuxtClientFiles.length
  ? nuxtClientFiles.filter((file) => {
      const text = readFileSync(file, "utf8");

      return text.includes(nuxtSentinel) || text.includes("useMeridianServerClient");
    })
  : ["(no client files found to scan)"];

const broken = builds.filter((cwd) => run(cwd) !== 0);
const leaked = mustFail.filter((cwd) => run(cwd) === 0);

if (broken.length || leaked.length || nuxtLeaks.length) {
  console.error(
    `Builds that failed: ${broken.join(", ") || "none"}. Leaks that built: ${leaked.join(", ") || "none"}. Nuxt client files leaking the server client or key: ${nuxtLeaks.join(", ") || "none"}.`,
  );
  process.exit(1);
}

console.log("Framework builds behave as expected.");
