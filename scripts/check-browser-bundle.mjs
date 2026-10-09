import { readFileSync } from "node:fs";

const DIST = "packages/meridian/dist";

// [1] Modules that must never reach the browser entry (the admin client joins once it exists)
const forbiddenModules = ["src/server-client.ts", "src/admin-client.ts"];

// [2] Key-shaped literals that must never appear in browser output
const forbiddenText = [/gmr_/, /gmi_/, /sk-or-v1-/];

function fail(message) {
  console.error(message);
  process.exit(1);
}

// [3] Check the browser entry of both formats: the metafile names its inputs, the file holds its text
for (const [format, ext] of [
  ["esm", "js"],
  ["cjs", "cjs"],
]) {
  const meta = JSON.parse(readFileSync(`${DIST}/metafile-${format}.json`, "utf8"));
  const browser = Object.entries(meta.outputs).find(([file]) => file.endsWith(`browser.${ext}`));

  if (!browser) fail(`No browser.${ext} in the meridian ${format} build.`);

  const leaked = Object.keys(browser[1].inputs).filter((input) =>
    forbiddenModules.some((path) => input.endsWith(path)),
  );

  if (leaked.length > 0)
    fail(`The browser bundle contains server-only modules: ${leaked.join(", ")}`);

  const code = readFileSync(`${DIST}/browser.${ext}`, "utf8");
  const found = forbiddenText.filter((pattern) => pattern.test(code));

  if (found.length > 0)
    fail(`The browser ${format} bundle holds key-shaped text: ${found.join(", ")}`);
}

console.log("Browser bundle holds no server or admin client.");

// [4] meridian-next's browser entry must import only meridian/browser, never the core root
for (const [file, pattern] of [
  ["browser.js", /from\s*["']meridian["']/],
  ["browser.cjs", /require\(["']meridian["']\)/],
]) {
  const code = readFileSync(`packages/meridian-next/dist/${file}`, "utf8");

  if (pattern.test(code)) fail(`meridian-next/${file} imports the server-side core.`);
}

console.log("meridian-next browser entry imports only meridian/browser.");
