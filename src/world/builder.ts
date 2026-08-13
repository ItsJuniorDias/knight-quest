import * as THREE from "three";
import { COLORS, ROOM_H, ROOM_W, TILE } from "../config";
import { findNode, spawn } from "../engine/loader";
import type { ChestState, DoorDir, DoorState, RoomRuntime, SpikeState } from "../types";
import {
  charAt,
  dirDelta,
  doorTile,
  ENEMY_CHARS,
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

  // If either side of this edge is a village, skip the KayKit wall entirely —
  // the village fence handles its own perimeter.
  const iAmVillage = room.biome === "village";
  const nbrIsVillage = neighbor?.biome === "village";
  if (iAmVillage || nbrIsVillage) return;

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

const HOUSE_KEYS = [
  "poly_house_a", "poly_house_b", "poly_house_c",
  "poly_house_d", "poly_house_e",
] as const;
const TREE_KEYS = [
  "poly_tree_a", "poly_tree_b", "poly_tree_c",
  "poly_pine_a", "poly_pine_b", "poly_tree_birch",
] as const;
const BUSH_KEYS = ["poly_bush_a", "poly_bush_b", "poly_bush_c", "poly_bush_d"] as const;
const GRASS_DECOR = ["poly_grass_a", "poly_grass_b", "poly_flower_a", "poly_flower_b", "poly_mushroom"] as const;
const STALL_KEYS = ["poly_stall_a", "poly_stall_b"] as const;

function pickBy<T>(arr: readonly T[], seed: number): T {
  return arr[Math.floor(hash(seed) * arr.length) % arr.length];
}

/**
 * Recolor every mesh material under `root` with the given HSL. Materials in
 * the POLYGON pack are SHARED between clones (SkeletonUtils clones the scene
 * graph but keeps material refs); mutating them in place used to darken the
 * shared material once per tile until whole rows turned black. We clone the
 * material first, then setHSL — the clone gets its own Color, and the
 * original stays untouched for other consumers.
 */
function tintGround(root: THREE.Object3D, h: number, s: number, l: number): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const apply = (m: THREE.Material): THREE.Material => {
      const cloned = m.clone();
      const lam = cloned as THREE.MeshLambertMaterial;
      lam.color.setHSL(h, s, l);
      return cloned;
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

  // Per-tile HSL — narrow jitter around a bright grass-green so the ground
  // reads as a living carpet without any tile ever going dark. Dirt tiles
  // keep their original brown so paths still contrast against grass.
  if (!dirt) {
    const h = 0.27 + (hash(tx, tz, def.gx, 12) - 0.5) * 0.03; // ~yellow-green ↔ leaf-green
    const s = 0.55 + hash(tx, tz, def.gx, 13) * 0.10;         // bright saturation
    const l = 0.48 + hash(tx, tz, def.gx, 14) * 0.10;         // 0.48..0.58 (never too dark)
    tintGround(floor, h, s, l);
  }

  group.add(floor);

  // scatter decorative grass/flower on regular grass tiles — v2 doubles the
  // density so the ground reads busier and more organic.
  if (!dirt) {
    const n = 1 + Math.floor(hash(tx, tz, def.gx, 5) * 5); // was 0..2; now 1..5
    for (let i = 0; i < n; i++) {
      const decor = spawn(pickBy(GRASS_DECOR, tx * 31 + tz * 7 + i));
      decor.position.set(
        c.x + (hash(tx, tz, i, 20) - 0.5) * 3.0,
        0.01,
        c.z + (hash(tx, tz, i, 21) - 0.5) * 3.0,
      );
      decor.rotation.y = hash(tx, tz, i, 22) * Math.PI * 2;
      decor.scale.multiplyScalar(1.3 + hash(tx, tz, i, 23) * 0.7);
      group.add(decor);
    }
  }
}

function addTree(group: THREE.Group, x: number, z: number, seed: number, castShadow = true): void {
  const t = spawn(pickBy(TREE_KEYS, seed), { castShadow, receiveShadow: false });
  t.position.set(x + (hash(seed, 1) - 0.5) * 0.8, 0, z + (hash(seed, 2) - 0.5) * 0.8);
  t.rotation.y = hash(seed, 3) * Math.PI * 2;
  t.scale.multiplyScalar(0.9 + hash(seed, 4) * 0.4);
  group.add(t);
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
  h.rotation.y = Math.floor(hash(seed, 2) * 4) * (Math.PI / 2);
  group.add(h);
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
  stall.rotation.y = hash(seed, 3) < 0.5 ? Math.PI / 2 : -Math.PI / 2;
  group.add(stall);

  // scatter a couple of props on the stall table area
  const prop = spawn(hash(seed, 4) < 0.5 ? "poly_pumpkin" : "poly_basket_a");
  prop.position.set(c.x, 0.7, c.z);
  group.add(prop);
}

function addRoadsign(group: THREE.Group, c: THREE.Vector3): void {
  const r = spawn("poly_roadsign", { castShadow: true, receiveShadow: false });
  r.position.copy(c);
  r.rotation.y = Math.PI;
  r.scale.multiplyScalar(1.4);
  group.add(r);
}

function buildVillageFence(def: RoomDef, group: THREE.Group): void {
  // trees around the perimeter (skip door cell)
  for (let tx = 0; tx < ROOM_W; tx++) {
    for (const tz of [0, ROOM_H - 1]) {
      if (charAt(def, tx, tz) === "D") continue;
      const c = tileCenter(def.gx, def.gy, tx, tz);
      if (charAt(def, tx, tz) === "T") addTree(group, c.x, c.z, tx * 13 + tz);
    }
  }
  for (let tz = 0; tz < ROOM_H; tz++) {
    for (const tx of [0, ROOM_W - 1]) {
      if (charAt(def, tx, tz) === "D") continue;
      const c = tileCenter(def.gx, def.gy, tx, tz);
      if (charAt(def, tx, tz) === "T") addTree(group, c.x, c.z, tx * 17 + tz * 5);
    }
  }
}

/**
 * Build a "forest" biome tile: same grass ground as the village, plus much
 * denser foliage and rocks. Trees are treated as solid unless explicitly
 * placed as background — we mark trees at the edge as walls so the player
 * doesn't wander into the void.
 */
function buildForestContent(def: RoomDef, group: THREE.Group, runtime: RoomRuntime): void {
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
            gr.scale.multiplyScalar(1.1 + hash(tx, tz, def.gx, 8) * 0.3);
            group.add(gr);
          }
          break;
        case "R":
          {
            const rock = spawn(hash(tx, tz, def.gx, 44) < 0.5 ? "poly_rock_a" : "poly_rock_b", {
              castShadow: true, receiveShadow: true,
            });
            rock.position.copy(c);
            rock.scale.multiplyScalar(0.9 + hash(tx, tz, def.gx, 45) * 0.3);
            group.add(rock);
            runtime.solid[tz][tx] = true;
          }
          break;
      }
    }
  }
}

/**
 * Cap a dungeon room with a low, dark ceiling plane. Because the new camera
 * sits behind and above the knight (not overhead), the top of the frame
 * would otherwise show blank sky through the walls; the ceiling reads as
 * "we're indoors" and, more practically, blocks any leaking geometry from
 * neighbouring dungeon rooms.
 */
function addDungeonCeiling(def: RoomDef, target: THREE.Object3D): void {
  const geom = new THREE.PlaneGeometry(ROOM_W * TILE, ROOM_H * TILE);
  const mat = new THREE.MeshBasicMaterial({
    color: COLORS.dungeonCeiling,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(
    tileCenter(def.gx, def.gy, 0, 0).x + (ROOM_W * TILE) / 2 - TILE / 2,
    5.2,
    tileCenter(def.gx, def.gy, 0, 0).z + (ROOM_H * TILE) / 2 - TILE / 2,
  );
  target.add(mesh);
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
            const rock = spawn(hash(tx, tz, def.gx, 44) < 0.5 ? "poly_rock_a" : "poly_rock_b", {
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
      }
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
      hasBoss: false,
      cleared: def.biome === "village", // villages never lock the player in
      visited: def.startVisible === true,
      group,
    };

    if (def.biome === "village") {
      buildVillageFence(def, group);
      const start = buildVillageContent(def, group, runtime);
      if (start) playerStart = start;
    } else if (def.biome === "forest") {
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
      buildDungeonEdge(def, "n", sharedStatics);
      buildDungeonEdge(def, "w", sharedStatics);
      if (!neighborOf(def, "s")) buildDungeonEdge({ ...def, gy: def.gy + 1 }, "n", sharedStatics);
      if (!neighborOf(def, "e")) buildDungeonEdge({ ...def, gx: def.gx + 1 }, "w", sharedStatics);

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
          }
          const enemyKind = ENEMY_CHARS[ch];
          if (enemyKind) runtime.enemySpawns.push({ kind: enemyKind, tx, tz });
        }
      }

      // Dungeon ceiling — opaque cap that blocks the new low-angle camera
      // from peeking at neighbouring dungeon rooms through the tops of walls.
      // Ceiling stays in sharedStatics so an unvisited room still reads as a
      // dark chamber (walls + ceiling) rather than a hole in the world.
      addDungeonCeiling(def, sharedStatics);
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
    // clouds high above the village
    for (let i = 0; i < 6; i++) {
      const cloud = spawn(i % 2 === 0 ? "poly_cloud_a" : "poly_cloud_b");
      cloud.position.set(
        village.origin.x + Math.random() * ROOM_W * TILE,
        22 + Math.random() * 6,
        village.origin.z + Math.random() * ROOM_H * TILE,
      );
      cloud.scale.multiplyScalar(1.4);
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
