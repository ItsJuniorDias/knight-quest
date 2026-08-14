// Sanity tests for the dungeon layout. Uses esbuild to transpile dungeon.ts
// into a temp JS file, then imports it as an ES module.
//
// Run with: node test/dungeon.test.mjs

import esbuild from "esbuild";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const outFile = "/tmp/dungeon-runtime.mjs";
await esbuild.build({
  entryPoints: ["src/world/dungeon.ts"],
  bundle: true,
  format: "esm",
  target: "es2020",
  outfile: outFile,
  logLevel: "silent",
});

const mod = await import(pathToFileURL(outFile).href);
const { ROOMS, START_ROOM_KEY, BOSS_ROOM_KEY, doorTile, isSolidChar, neighborOf, opposite } = mod;

let ok = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { console.log("  ✓", msg); ok++; }
  else { console.log("  ✗", msg); fail++; }
}
function assertEq(a, b, msg) {
  const cond = JSON.stringify(a) === JSON.stringify(b);
  if (cond) { console.log("  ✓", msg); ok++; }
  else { console.log("  ✗", msg, "got:", a, "want:", b); fail++; }
}

console.log("\n[dungeon layout]");
assertEq(ROOMS.length, 19, "19 rooms total (7 biomes with new snow/meadow/pine/wetland)");
assertEq(START_ROOM_KEY, "0,4", "start room is village 0,4");
assertEq(BOSS_ROOM_KEY, "0,0", "boss room is 0,0");
// Every room must be 15 wide x 13 tall for the new ROOM_W/ROOM_H
for (const r of ROOMS) {
  assert(r.map.length === 13, `${r.key} has 13 rows`);
  assert(r.map.every((row) => row.length === 15), `${r.key} rows are 15 wide`);
}

console.log("\n[biome tags]");
const village = ROOMS.find((r) => r.key === "0,4");
assert(village && village.biome === "village", "0,4 is village biome");
const throne = ROOMS.find((r) => r.key === "0,0");
assert(throne && throne.biome === "dungeon", "0,0 is dungeon biome");
const forestCount = ROOMS.filter((r) => r.biome === "forest").length;
assert(forestCount >= 3, `at least 3 forest rooms (got ${forestCount})`);

console.log("\n[door consistency]");
// Every declared door must have a matching door on the neighbor (or no neighbor at all).
for (const r of ROOMS) {
  for (const d of r.doors) {
    const n = neighborOf(r, d.dir);
    if (!n) continue; // outer edge, OK
    const back = n.doors.find((x) => x.dir === opposite(d.dir));
    assert(!!back, `door ${r.key}:${d.dir} has matching door on ${n.key}:${opposite(d.dir)}`);
  }
}

console.log("\n[D cells match declared doors]");
for (const r of ROOMS) {
  const declared = new Set(r.doors.map((d) => d.dir));
  const dCells = [];
  for (let tz = 0; tz < r.map.length; tz++) {
    for (let tx = 0; tx < r.map[tz].length; tx++) {
      if (r.map[tz][tx] === "D") dCells.push({ tx, tz });
    }
  }
  for (const dir of declared) {
    const t = doorTile(dir);
    const found = dCells.some((c) => c.tx === t.tx && c.tz === t.tz);
    assert(found, `${r.key}: D char present at door ${dir}`);
  }
}

console.log("\n[solid-cell contract]");
assert(isSolidChar("W") === true, "W is solid");
assert(isSolidChar("T") === true, "T (tree) is solid");
assert(isSolidChar(".") === false, ". is walkable");
assert(isSolidChar(",") === false, ", (dirt road) is walkable");
assert(isSolidChar("D") === false, "D (door cell) is walkable");

console.log(`\n${ok} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
