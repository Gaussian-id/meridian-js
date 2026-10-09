import { spawnSync } from "node:child_process";

const run = (cwd) =>
  spawnSync("pnpm", ["run", "build"], {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  }).status;

// [1] The supported shapes must build.
const builds = ["packages/meridian-next/test/fixtures/app"];

// [2] A client component importing the server client must fail to build.
const mustFail = ["packages/meridian-next/test/fixtures/leak"];

const broken = builds.filter((cwd) => run(cwd) !== 0);
const leaked = mustFail.filter((cwd) => run(cwd) === 0);

if (broken.length || leaked.length) {
  console.error(
    `Builds that failed: ${broken.join(", ") || "none"}. Leaks that built: ${leaked.join(", ") || "none"}.`,
  );
  process.exit(1);
}

console.log("Framework builds behave as expected.");
