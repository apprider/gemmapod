#!/usr/bin/env node
// wasm-pack writes a package.json into both pkg/ and pkg-node/ with the
// crate name as the npm `name` field. Cargo crate names can't contain
// `@` or `/`, so we rewrite those generated package.json files after each
// build so the published @gemmapod/core tarball is internally consistent.
//
// The pkg/ and pkg-node/ directories are NOT separate npm packages — they
// are subpath build artifacts of @gemmapod/core. Their package.json files
// only matter for resolvers that probe nested package boundaries; we set
// them to identify as nested subpaths of @gemmapod/core so nothing
// downstream sees a stale "gemmapod-core" name.
//
// We also delete the `.gitignore = *` files wasm-pack drops into pkg/ and
// pkg-node/. They are intended to keep wasm-pack outputs out of git; we
// want the outputs both committed to the repo AND included in `npm pack`
// (which honours .gitignore by default).

import { readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const corePackageDir = path.resolve(__dirname, "..");
const targets = [
  { dir: "pkg", subpath: "web" },
  { dir: "pkg-node", subpath: "node" },
];

for (const { dir, subpath } of targets) {
  const pkgJsonPath = path.join(corePackageDir, dir, "package.json");
  let raw;
  try {
    raw = await readFile(pkgJsonPath, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") {
      console.warn(`[postbuild] skipping ${dir}/package.json (not built yet)`);
      continue;
    }
    throw e;
  }
  const pkg = JSON.parse(raw);
  const next = {
    ...pkg,
    name: `@gemmapod/core-${subpath}`,
    private: true,
    description: `Internal build artifact of @gemmapod/core (${subpath} target). Do not depend on this name directly; use @gemmapod/core/${subpath} via the parent package's exports map.`,
  };
  await writeFile(pkgJsonPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log(`[postbuild] rewrote ${dir}/package.json → ${next.name}`);

  // Strip the wasm-pack-generated .gitignore (= "*") so npm pack and git
  // both see the artifacts. Also drop the stray pnpm-lock.yaml wasm-pack
  // sometimes emits — pkg/ is a build artifact, not its own workspace.
  for (const stray of [".gitignore", "pnpm-lock.yaml"]) {
    await rm(path.join(corePackageDir, dir, stray), { force: true });
  }
}
