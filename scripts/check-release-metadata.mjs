import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const pkg = read("package.json");
const lock = read("package-lock.json");
const server = read("server.json");
const bundle = read("mcpb/manifest.json");
for (const version of [lock.version, lock.packages[""].version, server.version, ...server.packages.map(p => p.version), bundle.version]) {
  assert.equal(version, pkg.version, "Release metadata versions must match package.json");
}
const formula = readFileSync(new URL("../homebrew/proton-mail-bridge-client.rb", import.meta.url), "utf8");
assert.match(formula, /sha256 "[a-f0-9]{64}"/);
assert.ok(formula.includes(`-${pkg.version}.tgz`), "Update the pinned archive and verify its SHA-256 when changing versions");
console.log(`Release metadata is consistent at ${pkg.version}.`);
