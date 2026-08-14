import * as THREE from "three";
import { COLORS, ROOM_H, ROOM_W, TILE } from "../config";
import { findNode, spawn } from "../engine/loader";
import type { ChestState, DoorDir, DoorState, RoomRuntime, SpikeState } from "../types";
import {
  charAt,
  dirDelta,
  doorTile,
  ENEMY_CHARS,
  NPC_CHARS,
  neighborOf,
  opposite,
  ROOMS,
  type RoomDef,
} from "./dungeon";

// ---------------------------------------------------------------------------
// Builder — turns RoomDefs into meshes + runtime state, for both biomes:
//
//   dungeon biome  → KayKit walls, floors, torches, banners, portcullises
//   village biome  → POLYGON grass, houses, market stalls, trees, fences,
//                    an open door to the north into the dungeon
//
// Shared edge rule: the wall line between two rooms is built exactly once,
// by the room to the SOUTH (horizontal edges) or EAST (vertical edges).
// Gates on shared doors are single objects referenced by both DoorStates.
// ---------------------------------------------------------------------------

export function tileCenter(gx: number, gy: number, tx: number, tz: number): THREE.Vector3 {
  return new THREE.Vector3(
    (gx * ROOM_W + tx + 0.5) * TILE,
    0,
    (gy * ROOM_H + tz + 0.5) * TILE,
  );
}

function hash(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) {
    h ^= Math.round(v * 1013);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

interface SharedGate {
  gate: THREE.Object3D | null; // village edges have no portcullis
  lockIcon: THREE.Object3D | null;
}

const torchLights: { light: THREE.PointLight; roomKey: string; seed: number }[] = [];
const campfireLights: { light: THREE.PointLight; roomKey: string; seed: number }[] = [];
const builtEdges = new Set<string>();
const builtPosts = new Set<string>();
const sharedGates = new Map<string, SharedGate>();

function canonicalEdge(room: RoomDef, dir: DoorDir): string {
  switch (dir) {
    case "n": return `${room.gx},${room.gy}:n`;
    case "s": return `${room.gx},${room.gy + 1}:n`;
    case "w": return `${room.gx},${room.gy}:w`;
    case "e": return `${room.gx + 1},${room.gy}:w`;
  }
}

function doorLineCenter(room: RoomDef, dir: DoorDir): THREE.Vector3 {
  const t = doorTile(dir);
  const c = tileCenter(room.gx, room.gy, t.tx, t.tz);
  switch (dir) {
    case "n": c.z -= TILE / 2; break;
    case "s": c.z += TILE / 2; break;
    case "w": c.x -= TILE / 2; break;
    case "e": c.x += TILE / 2; break;
  }
  return c;
}

function addDungeonWall(
  target: THREE.Object3D,
  center: THREE.Vector3,
  horizontal: boolean,
  kind: "wall" | "wall_doorway",
): void {
  const seg = spawn(kind, { castShadow: true, receiveShadow: true });
  seg.position.copy(center);
  if (!horizontal) seg.rotation.y = Math.PI / 2;
  target.add(seg);
}

function addPillarPost(target: THREE.Object3D, x: number, z: number): void {
  const key = `${Math.round(x)},${Math.round(z)}`;
  if (builtPosts.has(key)) return;
  builtPosts.add(key);
  const post = spawn("pillar", { castShadow: true, receiveShadow: true });
  post.position.set(x, 0, z);
  post.scale.set(0.62, 1.02, 0.62);
  target.add(post);
}

function addTorch(
  target: THREE.Object3D,
  roomKey: string,
  wallCenter: THREE.Vector3,
  facing: DoorDir,
): void {
  const t = spawn("torch_mounted", { castShadow: false, receiveShadow: false });
  t.position.copy(wallCenter);
  t.position.y = 2.4;
  const rot: Record<DoorDir, number> = { s: 0, n: Math.PI, e: -Math.PI / 2, w: Math.PI / 2 };
  t.rotation.y = rot[facing];
  t.position.x += (facing === "e" ? 1 : facing === "w" ? -1 : 0) * 0.55;
  t.position.z += (facing === "s" ? 1 : facing === "n" ? -1 : 0) * 0.55;
  target.add(t);

  const light = new THREE.PointLight(COLORS.torch, 0, 16, 1.6);
  light.position.copy(t.position);
  light.position.y = 3.0;
  light.position.x += (facing === "e" ? 1 : facing === "w" ? -1 : 0) * 0.6;
  light.position.z += (facing === "s" ? 1 : facing === "n" ? -1 : 0) * 0.6;
  target.add(light);
  torchLights.push({ light, roomKey, seed: Math.random() * 100 });
}

function buildDungeonEdge(
  room: RoomDef,
  dir: "n" | "w",
  target: THREE.Object3D,
): void {
  // Village rooms never build stone walls — they use their tree fence.
  // Dungeon rooms ALWAYS build their own perimeter, even when the neighbour
  // is a village (v1 skipped these, leaving the whole southern wall of the
  // dungeon-vs-village boundary open so the player could see straight into
  // the hidden dungeon from the village).
  const iAmVillage = room.biome === "village";
  if (iAmVillage) return;

  const edgeKey = canonicalEdge(room, dir);
  if (builtEdges.has(edgeKey)) return;
  builtEdges.add(edgeKey);

  const horizontal = dir === "n";
  const count = horizontal ? ROOM_W : ROOM_H;
  const doorT = doorTile(dir);
  const hasDoor = room.doors.some((d) => d.dir === dir);
  const neighbor = neighborOf(room, dir);
  const neighborDoor = neighbor?.doors.some((d) => d.dir === opposite(dir)) ?? false;
  const doorHere = hasDoor || neighborDoor;

  for (let i = 0; i < count; i++) {
    const tx = horizontal ? i : 0;
    const tz = horizontal ? 0 : i;
    const c = tileCenter(room.gx, room.gy, tx, tz);
    if (horizontal) c.z -= TILE / 2;
    else c.x -= TILE / 2;
    const isDoorCell = doorHere && tx === doorT.tx && tz === doorT.tz;
    addDungeonWall(target, c, horizontal, isDoorCell ? "wall_doorway" : "wall");
  }

  const start = tileCenter(room.gx, room.gy, 0, 0);
  if (horizontal) {
    const z = start.z - TILE / 2;
    addPillarPost(target, start.x - TILE / 2, z);
    addPillarPost(target, start.x - TILE / 2 + count * TILE, z);
  } else {
    const x = start.x - TILE / 2;
    addPillarPost(target, x, start.z - TILE / 2);
    addPillarPost(target, x, start.z - TILE / 2 + count * TILE);
  }
}

function ensureGate(
  room: RoomDef,
  dir: DoorDir,
  kind: "open" | "locked",
  scene: THREE.Scene,
): SharedGate {
  const key = canonicalEdge(room, dir);
  let sg = sharedGates.get(key);
  if (sg) return sg;

  const neighbor = neighborOf(room, dir);
  const crossesBiome =
    (room.biome === "village") !== ((neighbor?.biome ?? room.biome) === "village");

  // Village boundaries have no dungeon portcullis (it's the outdoor entrance).
  if (crossesBiome || room.biome === "village") {
    sg = { gate: null, lockIcon: null };
    sharedGates.set(key, sg);
    return sg;
  }

  const horizontal = dir === "n" || dir === "s";
  const c = doorLineCenter(room, dir);
  const gate = spawn("wall_gated", { castShadow: false, receiveShadow: false });
  gate.position.copy(c);
  if (!horizontal) gate.rotation.y = Math.PI / 2;
  gate.position.y = kind === "locked" ? 0 : -4.05;
  scene.add(gate);

  let lockIcon: THREE.Object3D | null = null;
  if (kind === "locked") {
    lockIcon = spawn("key");
    lockIcon.scale.setScalar(2.2);
    lockIcon.position.copy(c);
    lockIcon.position.y = 2.6;
    scene.add(lockIcon);
  }
  sg = { gate, lockIcon };
  sharedGates.set(key, sg);
  return sg;
}

// ---------------------------- village helpers -------------------------------

// ---------------------------------------------------------------------------
// v4: expanded asset pools using the FULL Synty POLYGON pack loaded from OBJ.
// The old poly_* GLB keys still exist and work; the new polyx_* keys are
// mixed in below so builder picks from a much wider variety.
// ---------------------------------------------------------------------------
const HOUSE_KEYS = [
  "poly_house_a", "poly_house_b", "poly_house_c", "poly_house_d", "poly_house_e",
  // v4 additions — SM_Bld_Village_01..05 are ~4×3×4m each (single houses).
  // 06 and 07 are excluded on purpose: 06 is a multi-house block and 07 is
  // a 9m-tall tower; both dwarf every other building and cover the camera.
  "polyx_bld_village_01", "polyx_bld_village_02", "polyx_bld_village_03",
  "polyx_bld_village_04", "polyx_bld_village_05",
] as const;
const TREE_KEYS = [
  "poly_tree_a", "poly_tree_b", "poly_tree_c",
  "poly_pine_a", "poly_pine_b", "poly_tree_birch",
  // v4 additions — 13 more tree variants + more birches + more pines
  "polyx_env_tree_01", "polyx_env_tree_02", "polyx_env_tree_03",
  "polyx_env_tree_04", "polyx_env_tree_05", "polyx_env_tree_06",
  "polyx_env_tree_07", "polyx_env_tree_08", "polyx_env_tree_09",
  "polyx_env_tree_010", "polyx_env_tree_011", "polyx_env_tree_012",
  "polyx_env_tree_013", "polyx_env_tree_014", "polyx_env_tree_015",
  "polyx_env_tree_016",
  "polyx_env_treebirch_01", "polyx_env_treebirch_02", "polyx_env_treebirch_03",
  "polyx_env_treepine_01", "polyx_env_treepine_02",
  "polyx_env_treepine_03", "polyx_env_treepine_04",
] as const;
const DEAD_TREE_KEYS = [
  "poly_tree_dead", "polyx_env_treedead_01", "polyx_env_treedead_02",
] as const;
const BUSH_KEYS = [
  "poly_bush_a", "poly_bush_b", "poly_bush_c", "poly_bush_d",
  "polyx_env_bush_01", "polyx_env_bush_02", "polyx_env_bush_03", "polyx_env_bush_04",
] as const;
const FLOWER_KEYS = [
  "poly_flower_a", "poly_flower_b",
  "polyx_env_flower_01", "polyx_env_flower_02", "polyx_env_flower_03",
  "polyx_env_flower_04", "polyx_env_flower_05", "polyx_env_flower_06",
  "polyx_env_flower_07", "polyx_env_flower_08",
] as const;
const GRASS_DECOR = [
  "poly_grass_a", "poly_grass_b",
  "polyx_env_grass_01", "polyx_env_grass_02",
  "polyx_env_flower_01", "polyx_env_flower_02", "polyx_env_flower_03",
  "polyx_env_flower_04", "polyx_env_flower_05", "polyx_env_flower_06",
  "polyx_env_flower_07", "polyx_env_flower_08",
  "poly_mushroom", "polyx_env_mushroom_01",
  "polyx_env_pebble_01", "polyx_env_pebble_02", "polyx_env_pebble_03",
  "polyx_env_pebble_04", "polyx_env_pebble_05",
] as const;
const ROCK_KEYS = [
  "poly_rock_a", "poly_rock_b", "poly_rock_flat",
  "polyx_env_rock_01", "polyx_env_rock_02", "polyx_env_rock_03",
  "polyx_env_rock_04", "polyx_env_rock_05", "polyx_env_rock_07",
  "polyx_env_rock_08", "polyx_env_rock_09",
  "polyx_env_rock_010", "polyx_env_rock_011", "polyx_env_rock_012",
  "polyx_env_rock_013", "polyx_env_rock_014", "polyx_env_rock_015",
  "polyx_env_rock_016",
] as const;
const PLANT_KEYS = [
  "polyx_env_plant_01", "polyx_env_plant_02", "polyx_env_plant_03",
  "polyx_env_plant_04", "polyx_env_plant_05",
] as const;
const REED_KEYS = [
  "polyx_env_reeds_01", "polyx_env_reeds_02", "polyx_env_reeds_03",
] as const;
const GROUND_MOUND_KEYS = [
  "polyx_env_groundmounds_01", "polyx_env_groundmounds_02", "polyx_env_groundmounds_03",
  "polyx_env_groundmounds_04", "polyx_env_groundmounds_05", "polyx_env_groundmounds_06",
  "polyx_env_groundmounds_07", "polyx_env_groundmounds_08", "polyx_env_groundmounds_09",
  "polyx_env_groundmounds_10",
] as const;
const HILL_KEYS = [
  "polyx_env_hill_01", "polyx_env_hill_02", "polyx_env_hill_03", "polyx_env_hill_04",
] as const;
const STALL_KEYS = [
  "poly_stall_a", "poly_stall_b",
  "polyx_bld_stall_01", "polyx_bld_stall_02", "polyx_bld_stall_03", "polyx_bld_stall_04",
] as const;
const STALL_COVER_KEYS = [
  "polyx_bld_stall_cover_01", "polyx_bld_stall_cover_02", "polyx_bld_stall_cover_03",
  "polyx_bld_stall_cover_04", "polyx_bld_stall_cover_05",
] as const;
const MARKET_ITEM_KEYS = [
  "poly_pumpkin", "polyx_prop_pumpkin_02",
  "polyx_prop_cheese_01", "polyx_prop_cheese_02", "polyx_prop_cheese_03",
  "polyx_prop_meat_01", "polyx_prop_meat_02", "polyx_prop_meat_03",
  "polyx_item_fruit_01", "polyx_item_fruit_02", "polyx_item_fruit_03",
  "polyx_item_gourd_01",
  "polyx_prop_basket_01", "polyx_prop_basket_02",
  "polyx_prop_basket_03", "polyx_prop_basket_04",
  "polyx_prop_pot_01", "polyx_prop_pot_02", "polyx_prop_pot_03",
  "polyx_prop_sack_01", "polyx_prop_sack_02",
  "polyx_prop_sack_03", "polyx_prop_sack_04",
] as const;
const BOOK_KEYS = [
  "polyx_prop_book_01", "polyx_prop_book_02", "polyx_prop_book_03",
] as const;
const POTION_KEYS = [
  "poly_potion_a",
  "polyx_item_potion_01", "polyx_item_potion_02", "polyx_item_potion_03",
  "polyx_item_potion_04", "polyx_item_potion_05", "polyx_item_potion_06",
  "polyx_item_wine_01", "polyx_item_wine_02",
  "polyx_item_canteen_01", "polyx_item_waterskin_01",
] as const;
const CART_KEYS = [
  "poly_cart", "polyx_prop_cart_01", "polyx_prop_cart_02", "polyx_prop_cart_03",
] as const;
const CLOUD_KEYS = [
  "poly_cloud_a", "poly_cloud_b",
  // v4 additions — clouds 01/02/05/07 excluded (too wide, cover the camera);
  // 03/04/06 are 5-5.5m wide, comparable to the original poly_cloud_a/b.
  "polyx_env_cloud_03", "polyx_env_cloud_04", "polyx_env_cloud_06",
] as const;
const STALAGMITE_KEYS = [
  "polyx_env_stalagmite_01", "polyx_env_stalagmite_02", "polyx_env_stalagmite_03",
] as const;
const ICE_KEYS = [
  "polyx_env_ice_01", "polyx_env_ice_02", "polyx_env_ice_03",
] as const;
const LILY_KEYS = [
  "poly_lillypad",
  "polyx_env_lillypads_01", "polyx_env_lillypads_02", "polyx_env_lillypads_03",
] as const;
const WASHINGLINE_KEYS = [
  "poly_washingline",
  "polyx_prop_washingline_01", "polyx_prop_washingline_02", "polyx_prop_washingline_03",
] as const;
const LANTERN_KEYS = [
  "poly_lantern", "polyx_item_lantern_01", "polyx_item_lantern_02",
] as const;
const WEAPON_KEYS = [
  "polyx_wep_sword_01", "polyx_wep_axe_01", "polyx_wep_greataxe_01",
  "polyx_wep_dagger_01", "polyx_wep_scythe_01", "polyx_wep_pitchfork_01",
  "polyx_wep_staff_01", "polyx_wep_staff_02",
  "polyx_wep_sheild_01", "polyx_wep_sheild_02", "polyx_wep_sheild_03",
] as const;

function pickBy<T>(arr: readonly T[], seed: number): T {
  return arr[Math.floor(hash(seed) * arr.length) % arr.length];
}

// v5 — dedicated pools per new biome. Each biome swaps its main flora set.
const PINE_KEYS = [
  "poly_pine_a", "poly_pine_b",
  "polyx_env_treepine_01", "polyx_env_treepine_02",
  "polyx_env_treepine_03", "polyx_env_treepine_04",
] as const;
const SNOW_PINE_KEYS = [
  "polyx_env_treepine_01_snow", "polyx_env_treepine_02_snow", "polyx_env_treepine_03_snow",
] as const;
const SNOW_TREE_KEYS = [
  "polyx_env_tree_01_snow", "polyx_env_tree_02_snow", "polyx_env_tree_03_snow",
  "polyx_env_tree_04_snow", "polyx_env_tree_06_snow", "polyx_env_tree_07_snow",
  "polyx_env_tree_08_snow", "polyx_env_tree_09_snow",
  "polyx_env_tree_010_snow", "polyx_env_tree_011_snow", "polyx_env_tree_012_snow",
  "polyx_env_tree_013_snow", "polyx_env_tree_014_snow", "polyx_env_tree_015_snow",
  "polyx_env_tree_016_snow", "polyx_env_tree_017_snow",
  "polyx_env_treebirch_01_snow",
] as const;
const SNOW_PILE_KEYS = [
  "polyx_env_snowpile_01", "polyx_env_snowpile_02", "polyx_env_snowpile_03",
] as const;
const SNOW_ROCK_KEYS = [
  "polyx_env_rock_03_snow", "polyx_env_rock_04_snow", "polyx_env_rock_05_snow",
] as const;
const SNOW_HUT_KEYS = ["polyx_bld_hut_01_snow"] as const;
const SNOW_HILL_KEYS = [
  "polyx_env_hillsnow_01", "polyx_env_hillsnow_02",
  "polyx_env_hillsnow_03", "polyx_env_hillsnow_04",
] as const;

// wetlands — dead trees + lily pads + reeds are the vibe
const DEAD_ANY_KEYS = [
  "poly_tree_dead",
  "polyx_env_treedead_01", "polyx_env_treedead_02",
  "polyx_env_treedead_02_snow",
] as const;

/**
 * Recolor every mesh material under `root` with the given HSL. Builds a
 * FRESH MeshLambertMaterial per mesh instead of cloning the source
 * material, because some POLYGON floor GLBs ship with `color = black` and
 * rely purely on their diffuse map — cloning + setHSL kept the black in
 * some code paths, producing the checkerboard black/green pattern the user
 * reported. The fresh material always starts from our HSL and only borrows
 * the source's texture map + side settings.
 */
function tintGround(root: THREE.Object3D, h: number, s: number, l: number): void {
  const color = new THREE.Color().setHSL(h, s, l);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const apply = (m: THREE.Material): THREE.Material => {
      const orig = m as THREE.MeshLambertMaterial;
      return new THREE.MeshLambertMaterial({
        map: orig.map ?? null,
        color: color.clone(),
        side: orig.side,
        transparent: orig.transparent,
        opacity: orig.opacity,
      });
    };
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(apply);
    else mesh.material = apply(mesh.material);
  });
}

function addGrassGround(group: THREE.Group, def: RoomDef, tx: number, tz: number, dirt: boolean): void {
  const c = tileCenter(def.gx, def.gy, tx, tz);
  const kind = dirt
    ? (hash(tx, tz, def.gx, 10) < 0.5 ? "poly_ground_dirt_a" : "poly_ground_dirt_b")
    : (hash(tx, tz, def.gx, 11) < 0.5 ? "poly_ground_grass_a" : "poly_ground_grass_b");
  const floor = spawn(kind, { receiveShadow: true });
  floor.position.copy(c);
  // POLYGON floor tiles are 300 units square = 3m after 0.01x. Scale up 4/3
  // so they fill the 4x4 tile without seams.
  floor.scale.multiplyScalar(TILE / 3);
  floor.rotation.y = Math.floor(hash(tx, tz, def.gx, 3) * 4) * (Math.PI / 2);

  // Per-tile HSL — both grass AND dirt get an explicit fresh material so no
  // asset can render as an unexpected black tile. v5: ground tint changes
  // with the biome so each new zone has a distinct floor color.
  const biome = def.biome;
  if (dirt) {
    const h = 0.08 + (hash(tx, tz, def.gx, 15) - 0.5) * 0.02; // rich brown
    const s = 0.42 + hash(tx, tz, def.gx, 16) * 0.10;
    const l = 0.34 + hash(tx, tz, def.gx, 17) * 0.06;
    tintGround(floor, h, s, l);
  } else if (biome === "snow") {
    // pale blue-white snow ground
    const h = 0.58 + (hash(tx, tz, def.gx, 12) - 0.5) * 0.03;
    const s = 0.05 + hash(tx, tz, def.gx, 13) * 0.05;
    const l = 0.85 + hash(tx, tz, def.gx, 14) * 0.06;
    tintGround(floor, h, s, l);
  } else if (biome === "wetland") {
    // murky green-brown swamp
    const h = 0.24 + (hash(tx, tz, def.gx, 12) - 0.5) * 0.03;
    const s = 0.38 + hash(tx, tz, def.gx, 13) * 0.10;
    const l = 0.28 + hash(tx, tz, def.gx, 14) * 0.06;
    tintGround(floor, h, s, l);
  } else if (biome === "meadow") {
    // sun-lit yellow-green with more golden warmth
    const h = 0.20 + (hash(tx, tz, def.gx, 12) - 0.5) * 0.02;
    const s = 0.65 + hash(tx, tz, def.gx, 13) * 0.10;
    const l = 0.58 + hash(tx, tz, def.gx, 14) * 0.10;
    tintGround(floor, h, s, l);
  } else if (biome === "pine") {
    // deep forest green with slight blue undertone
    const h = 0.31 + (hash(tx, tz, def.gx, 12) - 0.5) * 0.02;
    const s = 0.50 + hash(tx, tz, def.gx, 13) * 0.10;
    const l = 0.38 + hash(tx, tz, def.gx, 14) * 0.08;
    tintGround(floor, h, s, l);
  } else {
    // Default forest / village grass — yellow-green ↔ leaf
    const h = 0.27 + (hash(tx, tz, def.gx, 12) - 0.5) * 0.03;
    const s = 0.55 + hash(tx, tz, def.gx, 13) * 0.10;
    const l = 0.48 + hash(tx, tz, def.gx, 14) * 0.10;
    tintGround(floor, h, s, l);
  }

  group.add(floor);

  // v4: much richer ground decor — pull from GRASS_DECOR (24 keys now)
  // plus occasional larger accents (small plants, pebbles). Density is
  // higher on grass, sparse on dirt.
  if (!dirt) {
    const n = 2 + Math.floor(hash(tx, tz, def.gx, 5) * 5);
    for (let i = 0; i < n; i++) {
      const decor = spawn(pickBy(GRASS_DECOR, tx * 31 + tz * 7 + i));
      decor.position.set(
        c.x + (hash(tx, tz, i, 20) - 0.5) * 3.0,
        0.01,
        c.z + (hash(tx, tz, i, 21) - 0.5) * 3.0,
      );
      decor.rotation.y = hash(tx, tz, i, 22) * Math.PI * 2;
      decor.scale.multiplyScalar(1.1 + hash(tx, tz, i, 23) * 0.7);
      group.add(decor);
    }
    // v4: 15% chance of a small plant or reed clump for verticality
    if (hash(tx, tz, def.gx, 30) < 0.15) {
      const plant = spawn(pickBy([...PLANT_KEYS, ...REED_KEYS], tx * 7 + tz));
      plant.position.set(
        c.x + (hash(tx, tz, def.gx, 31) - 0.5) * 2.4,
        0,
        c.z + (hash(tx, tz, def.gx, 32) - 0.5) * 2.4,
      );
      plant.rotation.y = hash(tx, tz, def.gx, 33) * Math.PI * 2;
      plant.scale.multiplyScalar(1.2 + hash(tx, tz, def.gx, 34) * 0.4);
      group.add(plant);
    }
  } else {
    // dirt roads get pebbles occasionally, and rarely a pot / roadside prop
    if (hash(tx, tz, def.gx, 40) < 0.25) {
      const p = spawn(pickBy([
        "polyx_env_pebble_01", "polyx_env_pebble_02", "polyx_env_pebble_03",
        "polyx_env_pebble_04", "polyx_env_pebble_05", "polyx_env_pebble_06",
      ] as const, tx * 5 + tz * 3));
      p.position.set(
        c.x + (hash(tx, tz, def.gx, 41) - 0.5) * 2.6,
        0.02,
        c.z + (hash(tx, tz, def.gx, 42) - 0.5) * 2.6,
      );
      p.rotation.y = hash(tx, tz, def.gx, 43) * Math.PI * 2;
      p.scale.multiplyScalar(1.0 + hash(tx, tz, def.gx, 44) * 0.5);
      group.add(p);
    }
  }
}

/**
 * Solid-color safety plane under every village/forest room. Even if a
 * POLYGON floor tile fails to render for any reason (missing texture,
 * material quirk, LOD switch), the room still shows a grass-green ground
 * beneath the tiles instead of exposing the black scene background.
 */
function addGrassBasePlane(def: RoomDef, group: THREE.Group): void {
  const geom = new THREE.PlaneGeometry(ROOM_W * TILE + 2, ROOM_H * TILE + 2);
  // v5: base plane color matches biome so gaps between tiles never expose
  // the wrong palette (snow biome shouldn't show green underneath, etc).
  let baseColor: number = COLORS.grassDark;
  switch (def.biome) {
    case "snow":    baseColor = 0xd9e6ee; break; // pale blue-white
    case "wetland": baseColor = 0x3d5a3a; break; // murky green
    case "meadow":  baseColor = 0x9bb45c; break; // sun-lit yellow-green
    case "pine":    baseColor = 0x2f4a35; break; // deep forest green
  }
  const mat = new THREE.MeshLambertMaterial({ color: baseColor });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.position.y = -0.05; // just below the tile floors so it doesn't z-fight
  const c00 = tileCenter(def.gx, def.gy, 0, 0);
  mesh.position.x = c00.x + (ROOM_W * TILE) / 2 - TILE / 2;
  mesh.position.z = c00.z + (ROOM_H * TILE) / 2 - TILE / 2;
  group.add(mesh);
}

function addTree(group: THREE.Group, x: number, z: number, seed: number, castShadow = true): void {
  const t = spawn(pickBy(TREE_KEYS, seed), { castShadow, receiveShadow: false });
  t.position.set(x + (hash(seed, 1) - 0.5) * 0.8, 0, z + (hash(seed, 2) - 0.5) * 0.8);
  t.rotation.y = hash(seed, 3) * Math.PI * 2;
  t.scale.multiplyScalar(0.9 + hash(seed, 4) * 0.4);
  group.add(t);
  // v4: 30% chance of a bush or mushroom at the base for foliage layering
  if (hash(seed, 15) < 0.3) {
    const under = spawn(pickBy(BUSH_KEYS, seed + 20));
    under.position.set(t.position.x + (hash(seed, 16) - 0.5) * 1.6, 0, t.position.z + (hash(seed, 17) - 0.5) * 1.6);
    under.rotation.y = hash(seed, 18) * Math.PI * 2;
    under.scale.multiplyScalar(0.7 + hash(seed, 19) * 0.4);
    group.add(under);
  }
}

function addBush(group: THREE.Group, x: number, z: number, seed: number): void {
  const b = spawn(pickBy(BUSH_KEYS, seed));
  b.position.set(x, 0, z);
  b.rotation.y = hash(seed, 2) * Math.PI * 2;
  b.scale.multiplyScalar(0.8 + hash(seed, 3) * 0.4);
  group.add(b);
}

function addHouse(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  const key = pickBy(HOUSE_KEYS, seed);
  const h = spawn(key, { castShadow: true, receiveShadow: true });
  h.position.copy(c);
  const rot = Math.floor(hash(seed, 2) * 4) * (Math.PI / 2);
  h.rotation.y = rot;
  group.add(h);

  // v4: exterior clutter — sacks, baskets, lanterns hanging by the door.
  // Placed slightly OUT from the house center so they don't clip the walls.
  const dec = Math.floor(hash(seed, 8) * 3); // 0-2 extras per house
  for (let i = 0; i < dec; i++) {
    const ang = hash(seed, i, 21) * Math.PI * 2;
    const r = 1.6 + hash(seed, i, 22) * 0.4;
    const item = spawn(pickBy([
      "polyx_prop_sack_01", "polyx_prop_sack_02",
      "polyx_prop_basket_02", "polyx_prop_basket_04",
      "polyx_prop_pot_02", "polyx_prop_barrel_01",
    ] as const, seed * 3 + i));
    item.position.set(c.x + Math.cos(ang) * r, 0, c.z + Math.sin(ang) * r);
    item.rotation.y = hash(seed, i, 23) * Math.PI * 2;
    group.add(item);
  }
  // v4: chance of a laundry line beside the house
  if (hash(seed, 9) < 0.4) {
    const line = spawn(pickBy(WASHINGLINE_KEYS, seed + 10));
    const ang = Math.PI * 0.5 * (Math.floor(hash(seed, 11) * 4));
    line.position.set(c.x + Math.cos(ang) * 1.8, 0, c.z + Math.sin(ang) * 1.8);
    line.rotation.y = hash(seed, 12) * Math.PI * 2;
    group.add(line);
  }
}

function addCampfire(group: THREE.Group, roomKey: string, c: THREE.Vector3): void {
  const fire = spawn("poly_campfire", { castShadow: false, receiveShadow: false });
  fire.position.copy(c);
  fire.scale.multiplyScalar(1.4);
  group.add(fire);

  const light = new THREE.PointLight(0xff9a3d, 0, 12, 1.6);
  light.position.set(c.x, 1.6, c.z);
  group.add(light);
  campfireLights.push({ light, roomKey, seed: Math.random() * 100 });
}

function addWell(group: THREE.Group, c: THREE.Vector3): void {
  const w = spawn("poly_well", { castShadow: true, receiveShadow: true });
  w.position.copy(c);
  w.scale.multiplyScalar(1.2);
  group.add(w);
}

function addMarketStall(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  const stall = spawn(pickBy(STALL_KEYS, seed), { castShadow: true, receiveShadow: true });
  stall.position.copy(c);
  const rot = hash(seed, 3) < 0.5 ? Math.PI / 2 : -Math.PI / 2;
  stall.rotation.y = rot;
  group.add(stall);

  // v4: awning/cover on top for silhouette
  const cover = spawn(pickBy(STALL_COVER_KEYS, seed + 1), { castShadow: true, receiveShadow: false });
  cover.position.set(c.x, 0, c.z);
  cover.rotation.y = rot;
  group.add(cover);

  // v4: scatter 3–5 items ON the stall to make it read as a real market
  const nItems = 3 + Math.floor(hash(seed, 5) * 3);
  for (let i = 0; i < nItems; i++) {
    const item = spawn(pickBy(MARKET_ITEM_KEYS, seed * 13 + i * 7));
    item.position.set(
      c.x + (hash(seed, i, 10) - 0.5) * 1.6,
      0.7 + hash(seed, i, 11) * 0.15,
      c.z + (hash(seed, i, 12) - 0.5) * 1.6,
    );
    item.rotation.y = hash(seed, i, 13) * Math.PI * 2;
    item.scale.multiplyScalar(0.9 + hash(seed, i, 14) * 0.3);
    group.add(item);
  }

  // v4: a sack or basket at the base
  const base = spawn(pickBy(["polyx_prop_sack_01", "polyx_prop_sack_02", "polyx_prop_basket_03"] as const, seed + 2));
  base.position.set(c.x + Math.cos(rot) * 1.4, 0, c.z + Math.sin(rot) * 1.4);
  base.rotation.y = hash(seed, 6) * Math.PI * 2;
  group.add(base);
}

function addRoadsign(group: THREE.Group, c: THREE.Vector3): void {
  const r = spawn("poly_roadsign", { castShadow: true, receiveShadow: false });
  r.position.copy(c);
  r.rotation.y = Math.PI;
  r.scale.multiplyScalar(1.4);
  group.add(r);
}

// -------------------- v4: new composition helpers --------------------

function addLanternPost(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  // Lantern floating on a small stone base, warm yellow point light.
  // NOTE: polyx_ assets are returned as a wrapper Group with scale=0.01
  // baked in. Using `.scale.set(0.7,...)` would DESTROY that baked scale
  // and spawn a 48-meter stone in the middle of the village. Use
  // `.scale.multiplyScalar()` for wrappers, and only when needed.
  const stone = spawn("polyx_prop_stoneblock_01", { castShadow: false, receiveShadow: true });
  stone.position.copy(c);
  group.add(stone);
  const lantern = spawn(pickBy(LANTERN_KEYS, seed));
  lantern.position.set(c.x, 0.7, c.z);
  lantern.scale.multiplyScalar(1.4);
  group.add(lantern);
  const light = new THREE.PointLight(0xffc873, 6, 8, 1.7);
  light.position.set(c.x, 1.2, c.z);
  group.add(light);
}

function addWashingLine(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  const line = spawn(pickBy(WASHINGLINE_KEYS, seed), { castShadow: false, receiveShadow: false });
  line.position.copy(c);
  line.rotation.y = hash(seed, 2) * Math.PI * 2;
  line.scale.multiplyScalar(1.1);
  group.add(line);
}

function addCart(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  const cart = spawn(pickBy(CART_KEYS, seed), { castShadow: true, receiveShadow: true });
  cart.position.copy(c);
  cart.rotation.y = hash(seed, 2) * Math.PI * 2;
  group.add(cart);
  // v4: load the cart with some sacks or barrels
  const load = 1 + Math.floor(hash(seed, 3) * 2);
  for (let i = 0; i < load; i++) {
    const item = spawn(pickBy([
      "polyx_prop_sack_01", "polyx_prop_sack_02", "polyx_prop_barrel_01",
      "polyx_prop_basket_02", "polyx_prop_pumpkin_02",
    ] as const, seed * 3 + i));
    item.position.set(c.x + (hash(seed, i, 5) - 0.5) * 0.8, 0.6, c.z + (hash(seed, i, 6) - 0.5) * 0.8);
    item.rotation.y = hash(seed, i, 7) * Math.PI * 2;
    group.add(item);
  }
}

function addGroundMound(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  // Pack GroundMounds are 5–8m wide. On a 4m tile they'd cover 2+ tiles.
  // Scale them ~40% so they read as a small terrain bump next to a tree.
  const m = spawn(pickBy(GROUND_MOUND_KEYS, seed), { castShadow: false, receiveShadow: true });
  m.position.copy(c);
  m.rotation.y = hash(seed, 2) * Math.PI * 2;
  m.scale.multiplyScalar(0.4 + hash(seed, 3) * 0.15);
  group.add(m);
}

function addTreeStump(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  const s = spawn(hash(seed, 1) < 0.5 ? "poly_tree_stump" : "polyx_env_treestump_01", {
    castShadow: true, receiveShadow: true,
  });
  s.position.copy(c);
  s.rotation.y = hash(seed, 2) * Math.PI * 2;
  group.add(s);
  // v4: mushrooms on the stump
  if (hash(seed, 3) < 0.6) {
    const shroom = spawn(pickBy(["poly_mushroom", "polyx_env_mushroom_01"] as const, seed));
    shroom.position.set(c.x + (hash(seed, 4) - 0.5) * 0.6, 0.6, c.z + (hash(seed, 5) - 0.5) * 0.6);
    shroom.scale.multiplyScalar(1.4);
    group.add(shroom);
  }
}

// v5: pine tree — plain and snowy variants (biome picks which pool)
function addPineTree(group: THREE.Group, c: THREE.Vector3, seed: number, snowy: boolean): void {
  const key = pickBy(snowy ? SNOW_PINE_KEYS : PINE_KEYS, seed);
  const t = spawn(key, { castShadow: true, receiveShadow: false });
  t.position.set(c.x + (hash(seed, 1) - 0.5) * 0.6, 0, c.z + (hash(seed, 2) - 0.5) * 0.6);
  t.rotation.y = hash(seed, 3) * Math.PI * 2;
  t.scale.multiplyScalar(0.9 + hash(seed, 4) * 0.4);
  group.add(t);
}

// v5: dead / cypress tree (for wetlands, graveyard vibes)
function addDeadTree(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  const t = spawn(pickBy(DEAD_ANY_KEYS, seed), { castShadow: true, receiveShadow: false });
  t.position.set(c.x + (hash(seed, 1) - 0.5) * 0.6, 0, c.z + (hash(seed, 2) - 0.5) * 0.6);
  t.rotation.y = hash(seed, 3) * Math.PI * 2;
  t.scale.multiplyScalar(0.85 + hash(seed, 4) * 0.35);
  group.add(t);
}

// v5: snowpile (walkable snow drift decoration)
function addSnowPile(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  const p = spawn(pickBy(SNOW_PILE_KEYS, seed), { castShadow: false, receiveShadow: true });
  p.position.copy(c);
  p.rotation.y = hash(seed, 2) * Math.PI * 2;
  p.scale.multiplyScalar(0.7 + hash(seed, 3) * 0.4);
  group.add(p);
}

// v5: snow hut (single-piece, solid — used for Frozen Frontier huts)
function addSnowHut(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  const h = spawn(pickBy(SNOW_HUT_KEYS, seed), { castShadow: true, receiveShadow: true });
  h.position.copy(c);
  h.rotation.y = Math.floor(hash(seed, 2) * 4) * (Math.PI / 2);
  group.add(h);
  // A snow pile decor next to the door
  if (hash(seed, 5) < 0.7) {
    addSnowPile(group, new THREE.Vector3(c.x + 1.3, 0, c.z + 1.1), seed + 3);
  }
}

function addTreeLog(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  const l = spawn(hash(seed, 1) < 0.5 ? "poly_tree_log" : "polyx_env_treelog_01", {
    castShadow: true, receiveShadow: true,
  });
  l.position.copy(c);
  l.rotation.y = hash(seed, 2) * Math.PI * 2;
  group.add(l);
  // moss / mushroom on the log
  if (hash(seed, 3) < 0.5) {
    const decor = spawn(pickBy(BUSH_KEYS, seed + 3));
    decor.position.set(c.x + (hash(seed, 4) - 0.5) * 1.2, 0.4, c.z + (hash(seed, 5) - 0.5) * 1.2);
    decor.scale.multiplyScalar(0.6);
    group.add(decor);
  }
}

function addMushroomCluster(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  const n = 2 + Math.floor(hash(seed) * 4);
  for (let i = 0; i < n; i++) {
    const m = spawn(pickBy(["poly_mushroom", "polyx_env_mushroom_01"] as const, seed + i));
    m.position.set(
      c.x + (hash(seed, i, 1) - 0.5) * 2.2,
      0.02,
      c.z + (hash(seed, i, 2) - 0.5) * 2.2,
    );
    m.rotation.y = hash(seed, i, 3) * Math.PI * 2;
    m.scale.multiplyScalar(1.0 + hash(seed, i, 4) * 0.8);
    group.add(m);
  }
}

function addHillDecor(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  // The pack hills are 13-25 meters wide — WAY too large for a room tile.
  // We scale them down to ~30% so they read as small terrain bumps instead
  // of covering the whole scene.
  const h = spawn(pickBy(HILL_KEYS, seed), { castShadow: true, receiveShadow: true });
  h.position.copy(c);
  h.rotation.y = hash(seed, 2) * Math.PI * 2;
  h.scale.multiplyScalar(0.28 + hash(seed, 3) * 0.08);
  group.add(h);
}

/** Cluster of stalagmites for the dungeon rooms. */
function addStalagmiteCluster(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  const n = 1 + Math.floor(hash(seed) * 3);
  for (let i = 0; i < n; i++) {
    const s = spawn(pickBy(STALAGMITE_KEYS, seed + i), { castShadow: true, receiveShadow: false });
    s.position.set(
      c.x + (hash(seed, i, 1) - 0.5) * 1.6,
      0,
      c.z + (hash(seed, i, 2) - 0.5) * 1.6,
    );
    s.rotation.y = hash(seed, i, 3) * Math.PI * 2;
    s.scale.multiplyScalar(0.9 + hash(seed, i, 4) * 0.5);
    group.add(s);
  }
}

/** Books on the ground for the dungeon rooms with mages. */
function addBooksOnGround(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  const n = 1 + Math.floor(hash(seed) * 3);
  for (let i = 0; i < n; i++) {
    const b = spawn(pickBy(BOOK_KEYS, seed + i), { castShadow: false, receiveShadow: false });
    b.position.set(
      c.x + (hash(seed, i, 1) - 0.5) * 1.6,
      0,
      c.z + (hash(seed, i, 2) - 0.5) * 1.6,
    );
    b.rotation.y = hash(seed, i, 3) * Math.PI * 2;
    b.scale.multiplyScalar(0.9 + hash(seed, i, 4) * 0.5);
    group.add(b);
  }
}

/** Fallen weapon (sword/axe) laying on the dungeon floor as flavor. */
function addFallenWeapon(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  const w = spawn(pickBy(WEAPON_KEYS, seed), { castShadow: false, receiveShadow: false });
  w.position.set(c.x, 0.1, c.z);
  w.rotation.set(-Math.PI / 2 + (hash(seed, 1) - 0.5) * 0.3, hash(seed, 2) * Math.PI * 2, 0);
  w.scale.multiplyScalar(0.9 + hash(seed, 3) * 0.3);
  group.add(w);
}

/** Ice crystal cluster (sorcerer's room, treasury). */
function addIceCluster(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  const n = 1 + Math.floor(hash(seed) * 3);
  for (let i = 0; i < n; i++) {
    const ice = spawn(pickBy(ICE_KEYS, seed + i), { castShadow: false, receiveShadow: false });
    ice.position.set(c.x + (hash(seed, i, 1) - 0.5) * 1.5, 0, c.z + (hash(seed, i, 2) - 0.5) * 1.5);
    ice.rotation.y = hash(seed, i, 3) * Math.PI * 2;
    ice.scale.multiplyScalar(1.0 + hash(seed, i, 4) * 0.4);
    group.add(ice);
  }
}

/** Random potion / bottle scatter for shelves in the sorcerer's den. */
function addPotionsScatter(group: THREE.Group, c: THREE.Vector3, seed: number): void {
  const n = 2 + Math.floor(hash(seed) * 3);
  for (let i = 0; i < n; i++) {
    const p = spawn(pickBy(POTION_KEYS, seed + i));
    p.position.set(c.x + (hash(seed, i, 1) - 0.5) * 1.4, 0.5, c.z + (hash(seed, i, 2) - 0.5) * 1.4);
    p.rotation.y = hash(seed, i, 3) * Math.PI * 2;
    group.add(p);
  }
}

function buildVillageFence(def: RoomDef, group: THREE.Group): void {
  // Every perimeter tile gets a grass floor first, then a tree if the map
  // char is T. Skipping the ground step (v1) left ugly black voids under the
  // tree rows because those tiles were never covered by buildVillageContent.
  for (let tx = 0; tx < ROOM_W; tx++) {
    for (const tz of [0, ROOM_H - 1]) {
      if (charAt(def, tx, tz) === "D") continue;
      addGrassGround(group, def, tx, tz, false);
      const c = tileCenter(def.gx, def.gy, tx, tz);
      if (charAt(def, tx, tz) === "T") addTree(group, c.x, c.z, tx * 13 + tz);
    }
  }
  for (let tz = 0; tz < ROOM_H; tz++) {
    for (const tx of [0, ROOM_W - 1]) {
      if (charAt(def, tx, tz) === "D") continue;
      addGrassGround(group, def, tx, tz, false);
      const c = tileCenter(def.gx, def.gy, tx, tz);
      if (charAt(def, tx, tz) === "T") addTree(group, c.x, c.z, tx * 17 + tz * 5);
    }
  }
}

/**
 * v5: outdoor content — same base logic as forest (grass ground + prop
 * scatter), but with biome-specific pools for pine/dead/snow tiles.
 * Called for `forest`, `snow`, `wetland`, `meadow`, `pine` biomes.
 */
function buildForestContent(def: RoomDef, group: THREE.Group, runtime: RoomRuntime): void {
  const biome = def.biome;
  const snowy = biome === "snow";
  for (let tz = 0; tz < ROOM_H; tz++) {
    for (let tx = 0; tx < ROOM_W; tx++) {
      const ch = charAt(def, tx, tz);
      const c = tileCenter(def.gx, def.gy, tx, tz);
      addGrassGround(group, def, tx, tz, false);
      switch (ch) {
        case "T":
          addTree(group, c.x, c.z, tx * 13 + tz * 3 + def.gx * 91);
          runtime.solid[tz][tx] = true;
          break;
        case "y":
          // v5: pine tree — snow-tinted if the biome is snowy
          addPineTree(group, c, tx * 13 + tz * 5 + def.gy, snowy);
          runtime.solid[tz][tx] = true;
          break;
        case "t":
          // v5: dead / cypress tree — wetlands & meadow edges
          addDeadTree(group, c, tx * 7 + tz * 11 + def.gx * 3);
          runtime.solid[tz][tx] = true;
          break;
        case "n":
          // v5: snow pile (walkable snow drift)
          addSnowPile(group, c, tx * 5 + tz * 13);
          break;
        case "H":
          // v5: house / snow hut depending on biome
          if (snowy) {
            addSnowHut(group, c, tx * 41 + tz * 7);
          } else {
            addHouse(group, c, tx * 41 + tz * 7);
          }
          runtime.solid[tz][tx] = true;
          break;
        case "f":
          {
            const flower = spawn(pickBy(FLOWER_KEYS, tx * 3 + tz * 5));
            flower.position.copy(c);
            flower.scale.multiplyScalar(1.5 + hash(tx, tz, 0, 6) * 0.5);
            group.add(flower);
          }
          break;
        case "g":
          {
            const gr = spawn(pickBy(BUSH_KEYS, tx * 3 + tz));
            gr.position.copy(c);
            gr.scale.multiplyScalar(1.1 + hash(tx, tz, def.gx, 8) * 0.3);
            group.add(gr);
          }
          break;
        case "R":
          {
            const rock = spawn(pickBy(snowy ? SNOW_ROCK_KEYS : ROCK_KEYS, tx * 3 + tz), {
              castShadow: true, receiveShadow: true,
            });
            rock.position.copy(c);
            rock.scale.multiplyScalar(0.9 + hash(tx, tz, def.gx, 45) * 0.3);
            group.add(rock);
            runtime.solid[tz][tx] = true;
          }
          break;
        case "~":
          {
            // v5: lily pads or shallow water — no solidity, decorative
            const w = spawn(pickBy(LILY_KEYS, tx * 3 + tz));
            w.position.copy(c);
            w.rotation.y = hash(tx, tz, def.gx, 51) * Math.PI * 2;
            w.scale.multiplyScalar(1.2 + hash(tx, tz, def.gx, 52) * 0.5);
            group.add(w);
          }
          break;
        case ",": /* dirt path — floor already rendered */ break;
        // ------- v4/v5 decorative chars -------
        case "l": addLanternPost(group, c, tx * 7 + tz * 11); break;
        case "m": addGroundMound(group, c, tx * 5 + tz * 23); break;
        case "+": addTreeStump(group, c, tx * 11 + tz * 7); break;
        case "-": addTreeLog(group, c, tx * 13 + tz * 17); break;
        case "*": addMushroomCluster(group, c, tx * 7 + tz * 3); break;
        case "M": addHillDecor(group, c, tx * 17 + tz * 19); runtime.solid[tz][tx] = true; break;
      }
      // NPCs in outdoor tiles (hermit, villagers, shopkeeper, wanderers)
      const npcKind = NPC_CHARS[ch];
      if (npcKind) runtime.npcSpawns.push({ kind: npcKind, tx, tz });
      // Enemies wandering the outdoor biomes (v5: not just dungeon anymore)
      const enemyKind = ENEMY_CHARS[ch];
      if (enemyKind) runtime.enemySpawns.push({ kind: enemyKind, tx, tz });
    }
  }
}

/**
 * v3 note: the dungeon ceiling was removed entirely. With the BOTW-style
 * chase cam sitting at ~y=15 looking down, ANY opaque ceiling positioned
 * near the top of the walls blocks the camera's view of the player as soon
 * as he steps inside the room. The visibility system (unvisited rooms hide
 * their interior contents) plus dense fog handles the "don't spoil the
 * next room" requirement without needing an actual ceiling mesh.
 */
function addDungeonCeiling(_def: RoomDef, _target: THREE.Object3D): void {
  // intentionally left blank — see comment above.
}

function buildVillageContent(def: RoomDef, group: THREE.Group, runtime: RoomRuntime): THREE.Vector3 | null {
  let start: THREE.Vector3 | null = null;
  for (let tz = 0; tz < ROOM_H; tz++) {
    for (let tx = 0; tx < ROOM_W; tx++) {
      const ch = charAt(def, tx, tz);
      const c = tileCenter(def.gx, def.gy, tx, tz);
      const dirt = ch === ",";
      addGrassGround(group, def, tx, tz, dirt);
      switch (ch) {
        case "P": start = c.clone(); break;
        case "H": addHouse(group, c, tx * 41 + tz * 7); runtime.solid[tz][tx] = true; break;
        case "U":
          {
            const hut = spawn("poly_hut", { castShadow: true, receiveShadow: true });
            hut.position.copy(c);
            hut.rotation.y = Math.PI;
            group.add(hut);
            runtime.solid[tz][tx] = true;
          }
          break;
        case "L": addWell(group, c); runtime.solid[tz][tx] = true; break;
        case "M": addMarketStall(group, c, tx * 23 + tz * 11); runtime.solid[tz][tx] = true; break;
        case "C": addCampfire(group, def.key, c); break;
        case "T": addTree(group, c.x, c.z, tx * 13 + tz * 3); runtime.solid[tz][tx] = true; break;
        case "R":
          {
            const rock = spawn(pickBy(ROCK_KEYS, tx * 5 + tz * 3), {
              castShadow: true,
              receiveShadow: true,
            });
            rock.position.copy(c);
            rock.scale.multiplyScalar(0.9 + hash(tx, tz, def.gx, 45) * 0.3);
            group.add(rock);
            runtime.solid[tz][tx] = true;
          }
          break;
        case "F":
          {
            const fence = spawn("poly_fence_a");
            fence.position.copy(c);
            group.add(fence);
            runtime.solid[tz][tx] = true;
          }
          break;
        case "f":
          {
            const flower = spawn(hash(tx, tz, 0, 5) < 0.5 ? "poly_flower_a" : "poly_flower_b");
            flower.position.copy(c);
            flower.scale.multiplyScalar(2);
            group.add(flower);
          }
          break;
        case "g":
          {
            const gr = spawn(pickBy(BUSH_KEYS, tx * 3 + tz));
            gr.position.copy(c);
            group.add(gr);
          }
          break;
        case "r": addRoadsign(group, c); runtime.solid[tz][tx] = true; break;

        // ------- v4: decorative chars using the full pack -------
        case "l": addLanternPost(group, c, tx * 7 + tz * 11); break;
        case "w": addWashingLine(group, c, tx * 3 + tz * 5); break;
        case "$": addCart(group, c, tx * 17 + tz * 19); runtime.solid[tz][tx] = true; break;
        case "m": addGroundMound(group, c, tx * 5 + tz * 23); break;
        case "+": addTreeStump(group, c, tx * 11 + tz * 7); break;
        case "-": addTreeLog(group, c, tx * 13 + tz * 17); break;
        case "*": addMushroomCluster(group, c, tx * 7 + tz * 3); break;
      }
      // NPCs — plain ground tile also gets rendered underneath (already done
      // above), so the villager stands on grass/dirt cleanly.
      const npcKind = NPC_CHARS[ch];
      if (npcKind) runtime.npcSpawns.push({ kind: npcKind, tx, tz });
    }
  }
  return start;
}

// ---------------------------- top-level build --------------------------------

export interface BuiltWorld {
  rooms: Map<string, RoomRuntime>;
  playerStart: THREE.Vector3;
  bossSpawn: THREE.Vector3;
  lockIcons: THREE.Object3D[];
}

export function buildWorld(scene: THREE.Scene): BuiltWorld {
  const rooms = new Map<string, RoomRuntime>();
  let playerStart = new THREE.Vector3();
  let bossSpawn = new THREE.Vector3();
  const lockIcons: THREE.Object3D[] = [];

  // sharedStatics holds everything that must stay visible even when its
  // owning room is hidden (perimeter walls, ceilings, banners, wall-mounted
  // torches, pillars at wall joints). Without this, hiding a room to prevent
  // the third-person camera from peeking into it would also erase the walls
  // that the player currently NEEDS to see from the adjacent room.
  const sharedStatics = new THREE.Group();
  sharedStatics.name = "sharedStatics";
  scene.add(sharedStatics);

  for (const def of ROOMS) {
    const group = new THREE.Group();
    group.name = `room:${def.key}`;
    scene.add(group);

    const solid: boolean[][] = [];
    for (let tz = 0; tz < ROOM_H; tz++) solid.push(new Array<boolean>(ROOM_W).fill(false));

    const runtime: RoomRuntime = {
      key: def.key,
      gx: def.gx,
      gy: def.gy,
      origin: tileCenter(def.gx, def.gy, 0, 0).sub(new THREE.Vector3(TILE / 2, 0, TILE / 2)),
      solid,
      doors: [],
      chests: [],
      barrels: [],
      spikes: [],
      enemySpawns: [],
      npcSpawns: [],
      hasBoss: false,
      cleared: def.biome === "village", // villages never lock the player in
      visited: def.startVisible === true,
      group,
    };

    if (def.biome === "village") {
      addGrassBasePlane(def, group);
      buildVillageFence(def, group);
      const start = buildVillageContent(def, group, runtime);
      if (start) playerStart = start;
    } else if (
      def.biome === "forest" ||
      def.biome === "snow" ||
      def.biome === "wetland" ||
      def.biome === "meadow" ||
      def.biome === "pine"
    ) {
      // v5: all outdoor biomes share the base builder — biome-specific look
      // comes from ground tint (addGrassGround reads biome) + prop pools
      // that swap when the biome is snowy/wetland/etc.
      addGrassBasePlane(def, group);
      buildForestContent(def, group, runtime);
    } else {
      // -------- dungeon floors + spike traps ----------
      for (let tz = 0; tz < ROOM_H; tz++) {
        for (let tx = 0; tx < ROOM_W; tx++) {
          const ch = charAt(def, tx, tz);
          const c = tileCenter(def.gx, def.gy, tx, tz);
          if (ch === "s") {
            const trap = spawn("spikes", { receiveShadow: true });
            trap.position.copy(c);
            group.add(trap);
            const spikesNode = findNode(trap, "spikes");
            if (spikesNode) spikesNode.position.y = -1.9;
            const st: SpikeState = {
              root: trap,
              spikes: spikesNode,
              pos: c.clone(),
              phase: hash(tx, tz, def.gx, def.gy) * Math.PI * 2,
              up: false,
            };
            runtime.spikes.push(st);
            continue;
          }
          const floor = spawn("floor_large", { receiveShadow: true });
          floor.position.copy(c);
          floor.rotation.y = (Math.floor(hash(tx, tz, def.gx, def.gy) * 4) * Math.PI) / 2;
          group.add(floor);
          const r = hash(tx + 31, tz + 7, def.gx, def.gy);
          if (ch === "." && r < 0.16) {
            const detail = spawn(r < 0.08 ? "floor_weeds" : "floor_broken", { receiveShadow: true });
            detail.position.copy(c);
            detail.position.y = 0.015;
            detail.position.x += (hash(tx, tz + 99, def.gx, def.gy) - 0.5) * 1.6;
            detail.position.z += (hash(tx + 55, tz, def.gx, def.gy) - 0.5) * 1.6;
            group.add(detail);
          }
        }
      }

      // -------- perimeter walls (shared, always visible) ----------
      // A dungeon room needs its own perimeter walls on any edge whose
      // neighbour ISN'T another dungeon room. v1 only checked "no neighbour",
      // which meant a dungeon room bordering a village left its facing edge
      // OPEN — the player standing in the village could see straight into
      // the (hidden) dungeon interior, including the tops of internal walls.
      const needSouthWall = (() => {
        const n = neighborOf(def, "s");
        return !n || n.biome !== "dungeon";
      })();
      const needEastWall = (() => {
        const n = neighborOf(def, "e");
        return !n || n.biome !== "dungeon";
      })();
      const needNorthWall = (() => {
        const n = neighborOf(def, "n");
        return !n || n.biome !== "dungeon";
      })();
      const needWestWall = (() => {
        const n = neighborOf(def, "w");
        return !n || n.biome !== "dungeon";
      })();
      if (needNorthWall) buildDungeonEdge(def, "n", sharedStatics);
      if (needWestWall) buildDungeonEdge(def, "w", sharedStatics);
      if (needSouthWall) buildDungeonEdge({ ...def, gy: def.gy + 1 }, "n", sharedStatics);
      if (needEastWall) buildDungeonEdge({ ...def, gx: def.gx + 1 }, "w", sharedStatics);

      // -------- torches + banners on north walls (shared) ----------
      for (const tx of [1, ROOM_W - 2]) {
        const c = tileCenter(def.gx, def.gy, tx, 0);
        c.z -= TILE / 2;
        addTorch(sharedStatics, def.key, c, "s");
      }
      const bannerKey = def.banner === "blue" ? "banner_blue" : "banner_red";
      for (const tx of [3, ROOM_W - 4]) {
        const c = tileCenter(def.gx, def.gy, tx, 0);
        c.z -= TILE / 2;
        const b = spawn(bannerKey);
        b.position.set(c.x, 0.2, c.z);
        sharedStatics.add(b);
      }
    }

    // -------- solid grid from map (both biomes) ----------
    for (let tz = 0; tz < ROOM_H; tz++) {
      for (let tx = 0; tx < ROOM_W; tx++) {
        const ch = charAt(def, tx, tz);
        if (ch === "W") solid[tz][tx] = true;
      }
    }
    for (const d of def.doors) {
      const t = doorTile(d.dir);
      solid[t.tz][t.tx] = false;
    }

    // -------- doors + shared gates (both biomes) ----------
    for (const d of def.doors) {
      const sg = ensureGate(def, d.dir, d.kind, scene);
      if (sg.lockIcon) lockIcons.push(sg.lockIcon);
      const door: DoorState = {
        dir: d.dir,
        kind: d.kind === "locked" ? "locked" : "open",
        gate: sg.gate,
        gateClosed: d.kind === "locked",
        lockIcon: sg.lockIcon,
        unlocked: false,
      };
      runtime.doors.push(door);
    }

    // -------- dungeon-only interior props ----------
    if (def.biome === "dungeon") {
      for (let tz = 0; tz < ROOM_H; tz++) {
        for (let tx = 0; tx < ROOM_W; tx++) {
          const ch = charAt(def, tx, tz);
          const c = tileCenter(def.gx, def.gy, tx, tz);
          switch (ch) {
            case "P":
              // dungeon P is only used if there's no village; village overrides.
              if (!playerStart.lengthSq()) playerStart = c.clone();
              break;
            case "Z":
              bossSpawn = c.clone();
              runtime.hasBoss = true;
              break;
            case "b":
            case "B": {
              const barrel = spawn(ch === "b" ? "barrel_small" : "barrel_large", {
                castShadow: true, receiveShadow: true,
              });
              barrel.position.copy(c);
              barrel.position.x += (hash(tx, tz, 1, def.gy) - 0.5) * 1.2;
              barrel.position.z += (hash(tx, tz, 2, def.gy) - 0.5) * 1.2;
              barrel.rotation.y = hash(tx, tz, 3, def.gy) * Math.PI * 2;
              group.add(barrel);
              runtime.barrels.push({
                root: barrel,
                pos: barrel.position.clone(),
                radius: ch === "b" ? 0.62 : 1.0,
                broken: false,
              });
              break;
            }
            case "x": {
              const crates = spawn("crates_stacked", { castShadow: true, receiveShadow: true });
              crates.position.copy(c);
              crates.rotation.y = Math.floor(hash(tx, tz, 4, def.gy) * 4) * (Math.PI / 2);
              group.add(crates);
              solid[tz][tx] = true;
              break;
            }
            case "o": {
              const box = spawn("box_small", { castShadow: true, receiveShadow: true });
              box.position.copy(c);
              box.position.x += (hash(tx, tz, 5, def.gy) - 0.5) * 1.4;
              box.rotation.y = hash(tx, tz, 6, def.gy) * Math.PI;
              group.add(box);
              break;
            }
            case "p": {
              const pillar = spawn("pillar", { castShadow: true, receiveShadow: true });
              pillar.position.copy(c);
              group.add(pillar);
              solid[tz][tx] = true;
              break;
            }
            case "S": {
              const stairs = spawn("stairs", { castShadow: true, receiveShadow: true });
              stairs.position.copy(c);
              stairs.position.z += TILE / 2 - 0.2;
              stairs.rotation.y = Math.PI;
              stairs.scale.set(0.78, 0.5, 0.9);
              group.add(stairs);
              solid[tz][tx] = true;
              break;
            }
            case "c": case "h": case "K": {
              const isGold = ch === "K";
              const chest = spawn(isGold ? "chest_gold" : "chest", {
                castShadow: true, receiveShadow: true,
              });
              chest.position.copy(c);
              chest.rotation.y = Math.PI;
              group.add(chest);

              // v6 fix: the chest_gold model reads as "plain wooden chest"
              // under Lambert lighting — no specular, so its gold trim looks
              // like plain metal. Punch it up visually so players actually
              // find the boss key: warm emissive tint on every mesh + a small
              // amber point light above it. Only for the K chest, so regular
              // chests remain visually distinct.
              if (isGold) {
                chest.traverse((o) => {
                  const mesh = o as THREE.Mesh;
                  if (!mesh.isMesh) return;
                  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                  for (const mat of mats) {
                    const lam = mat as THREE.MeshLambertMaterial;
                    if (lam.emissive) {
                      lam.emissive = new THREE.Color(0xffb84a);
                      lam.emissiveIntensity = 0.55;
                    }
                  }
                });
                const glow = new THREE.PointLight(0xffc760, 1.6, 6.5, 1.8);
                glow.position.copy(c);
                glow.position.y = 1.4;
                group.add(glow);
              }

              const lid = findNode(chest, "lid");
              runtime.chests.push({
                root: chest,
                lid,
                opened: false,
                openT: 0,
                contents: ch === "c" ? "coins" : ch === "h" ? "heart" : "bosskey",
                tile: { tx, tz },
              });
              solid[tz][tx] = true;
              break;
            }
            // ---------- v4 dungeon flavor chars ----------
            case "A": addStalagmiteCluster(group, c, tx * 7 + tz * 3 + def.gy); break;
            case "%": addBooksOnGround(group, c, tx * 11 + tz * 5); break;
            case "X": addFallenWeapon(group, c, tx * 13 + tz * 17); break;
            case "i": addIceCluster(group, c, tx * 19 + tz * 23); break;
            case "*": addMushroomCluster(group, c, tx * 7 + tz * 3); break;
            case "?": addPotionsScatter(group, c, tx * 5 + tz * 11); break;
            case "&": addBooksOnGround(group, c, tx * 3 + tz * 7); addPotionsScatter(group, c, tx * 5 + tz * 3); break;
          }
          const enemyKind = ENEMY_CHARS[ch];
          if (enemyKind) runtime.enemySpawns.push({ kind: enemyKind, tx, tz });
          const npcKind = NPC_CHARS[ch];
          if (npcKind) runtime.npcSpawns.push({ kind: npcKind, tx, tz });
        }
      }

      // v3: no ceiling mesh — see addDungeonCeiling docstring. The
      // visibility system (unvisited rooms hide interior) plus fog is
      // enough, and any opaque ceiling would block the third-person cam.
    }

    // Start hidden unless the room explicitly opts in (village always
    // reveals itself; everything else is discovered on entry).
    group.visible = def.startVisible === true;

    rooms.set(def.key, runtime);
  }

  // Scatter a decorative forest of extra trees + bushes around the village
  // exterior for a nicer skyline horizon.
  const village = rooms.get("0,4");
  if (village) {
    const forest = new THREE.Group();
    scene.add(forest);
    for (let i = 0; i < 55; i++) {
      const ring = 1.7 + Math.random() * 2.4;
      const ang = Math.random() * Math.PI * 2;
      const cx = village.origin.x + (ROOM_W * TILE) / 2 + Math.cos(ang) * ROOM_W * TILE * ring * 0.5;
      const cz = village.origin.z + (ROOM_H * TILE) / 2 + Math.sin(ang) * ROOM_H * TILE * ring * 0.5;
      addTree(forest, cx, cz, i * 97, false);
      if (i % 3 === 0) addBush(forest, cx + 3, cz - 2, i * 11);
    }
    // clouds high above the village (v4: 12 clouds pulling from full pool).
    // The pack clouds are already 5-9m wide, so we SHRINK them a bit and
    // push them much higher so they don't intersect the third-person camera.
    for (let i = 0; i < 12; i++) {
      const cloud = spawn(pickBy(CLOUD_KEYS, i * 13));
      cloud.position.set(
        village.origin.x + Math.random() * ROOM_W * TILE,
        38 + Math.random() * 12,
        village.origin.z + Math.random() * ROOM_H * TILE,
      );
      cloud.scale.multiplyScalar(0.6 + Math.random() * 0.4);
      forest.add(cloud);
    }
  }

  return { rooms, playerStart, bossSpawn, lockIcons };
}

// ---------------------------- ambient updates -------------------------------

export function updateTorches(activeRoomKey: string, time: number): void {
  for (const t of torchLights) {
    if (t.roomKey !== activeRoomKey) {
      t.light.intensity = 0;
      continue;
    }
    t.light.intensity =
      26 + Math.sin(time * 9 + t.seed) * 5 + Math.sin(time * 23 + t.seed * 2) * 3;
  }
  for (const c of campfireLights) {
    if (c.roomKey !== activeRoomKey) {
      c.light.intensity = 0;
      continue;
    }
    c.light.intensity =
      18 + Math.sin(time * 7 + c.seed) * 5 + Math.sin(time * 19 + c.seed * 2) * 3;
  }
}
