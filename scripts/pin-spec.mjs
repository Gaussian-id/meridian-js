import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// [1] The engine repository comes from the first argument or the sibling folder.
const engine = process.argv[2] ?? join(process.cwd(), "..", "..", "1. Engine");
const files = ["meridian-public.json", "meridian-admin.json"];

const git = (...args) =>
  execFileSync("git", ["-C", engine, ...args], { maxBuffer: 64 * 1024 * 1024 });

// [2] Copy the committed OpenAPI documents byte for byte from engine HEAD (never the working tree).
for (const file of files) {
  writeFileSync(join("spec", file), git("show", `HEAD:deploy/openapi/${file}`));
}

// [3] Record which engine commit and API versions they came from.
const commit = git("rev-parse", "--short=12", "HEAD").toString("utf8").trim();
const version = (file) => JSON.parse(readFileSync(join("spec", file), "utf8")).info.version;

const source = {
  engineCommit: commit,
  pinnedAt: new Date().toISOString().slice(0, 10),
  publicVersion: version("meridian-public.json"),
  adminVersion: version("meridian-admin.json"),
};

writeFileSync(join("spec", "SOURCE.json"), `${JSON.stringify(source, null, 2)}\n`);
console.log(`Pinned engine spec at ${commit} (${source.publicVersion}).`);
