// Builds a standalone galpi .exe for one snapshot and keeps it next to that snapshot.
//
//   node tools/build-exe.mjs <NN> [debug|release]
//
//   debug   (default) → snapshots/NN/exe/galpi-NN-debug.exe   (frontend embedded, debug tab visible)
//   release           → snapshots/NN/exe/galpi-NN.exe         (optimized, no debug tab)
//
// Rust compiles into the shared cache (<repo>/target, see .cargo/config.toml), so dependencies are
// built once for all snapshots. Every build overwrites target/<profile>/galpi.exe, which is why the
// result is copied out per snapshot. Frozen snapshots are not modified: only exe/ (git-ignored) is written.
// The exe needs no dev server; it only needs WebView2 (present on Windows 10/11).

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [nnArg, profileArg = "debug"] = process.argv.slice(2);
if (!nnArg || !["debug", "release"].includes(profileArg)) {
  console.error("usage: node tools/build-exe.mjs <NN> [debug|release]");
  process.exit(2);
}
const nn = nnArg.padStart(2, "0");
const snap = join(repo, "snapshots", nn);
if (!existsSync(join(snap, "src-tauri", "Cargo.toml"))) {
  console.error(`no snapshot at ${snap}`);
  process.exit(2);
}

const run = (cmd, args, cwd) => {
  console.log(`\n> (${cwd}) ${cmd} ${args.join(" ")}`);
  // shell:true so Windows resolves npm/npx (.cmd). Arguments here are fixed literals.
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`failed: ${cmd} ${args.join(" ")} (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
};

// Snapshots with a debug tab (03+) must describe their own session before an exe is made,
// otherwise the debug build would ship last session's checklist (this happened once in 04).
const features = join(snap, "src", "debug", "features.ts");
if (existsSync(features) && !readFileSync(features, "utf8").includes(`session: "${nn}"`)) {
  console.error(
    `snapshot ${nn}: src/debug/features.ts has no entry for session "${nn}".\n` +
      `Add this session's implemented list, automated tests and manual checklist first (SNAPSHOTS.md rule 4).`,
  );
  process.exit(3);
}

if (!existsSync(join(snap, "node_modules"))) run("npm", ["ci"], snap);

const tauriArgs = ["tauri", "build", "--no-bundle"];
if (profileArg === "debug") tauriArgs.push("--debug");
run("npx", tauriArgs, snap);

const meta = spawnSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
  cwd: join(snap, "src-tauri"),
  encoding: "utf8",
  shell: true,
  maxBuffer: 64 * 1024 * 1024,
});
if (meta.status !== 0) {
  console.error(meta.stderr);
  process.exit(1);
}
const targetDir = JSON.parse(meta.stdout).target_directory;
const built = join(targetDir, profileArg, "galpi.exe");
if (!existsSync(built)) {
  console.error(`built exe not found: ${built}`);
  process.exit(1);
}
const outDir = join(snap, "exe");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, profileArg === "debug" ? `galpi-${nn}-debug.exe` : `galpi-${nn}.exe`);
copyFileSync(built, out);
console.log(`\nsnapshot ${nn} ${profileArg} exe → ${out} (${(statSync(out).size / 1048576).toFixed(1)} MB)`);
