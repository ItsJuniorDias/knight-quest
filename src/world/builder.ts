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
  group: THREE.Group,
  center: THREE.Vector3,
  horizontal: boolean,
  kind: "wall" | "wall_doorway",
): void {
  const seg = spawn(kind, { castShadow: true, receiveShadow: true });
  seg.position.copy(center);
  if (!horizontal) seg.rotation.y = Math.PI / 2;
  group.add(seg);
}

function addPillarPost(group: THREE.Group, x: number, z: number): void {
  const key = `${Math.round(x)},${Math.round(z)}`;
  if (builtPosts.has(key)) return;
  builtPosts.add(key);
  const post = spawn("pillar", { castShadow: true, receiveShadow: true });
  post.position.set(x, 0, z);
  post.scale.set(0.62, 1.02, 0.62);
  group.add(post);
}

function addTorch(
  group: THREE.Group,
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
  group.add(t);

  const light = new THREE.PointLight(COLORS.torch, 0, 16, 1.6);
  light.position.copy(t.position);
  light.position.y = 3.0;
  light.position.x += (facing === "e" ? 1 : facing === "w" ? -1 : 0) * 0.6;
  light.position.z += (facing === "s" ? 1 : facing === "n" ? -1 : 0) * 0.6;
  group.add(light);
  torchLights.push({ light, roomKey, seed: Math.random() * 100 });
}

function buildDungeonEdge(
  room: RoomDef,
  dir: "n" | "w",
  group: THREE.Group,
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
    addDungeonWall(group, c, horizontal, isDoorCell ? "wall_doorway" : "wall");
  }

  const start = tileCenter(room.gx, room.gy, 0, 0);
  if (horizontal) {
    const z = start.z - TILE / 2;
    addPillarPost(group, start.x - TILE / 2, z);
    addPillarPost(group, start.x - TILE / 2 + count * TILE, z);
  } else {
    const x = start.x - TILE / 2;
    addPillarPost(group, x, start.z - TILE / 2);
    addPillarPost(group, x, start.z - TILE / 2 + count * TILE);
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
  group.add(floor);

  // scatter decorative grass/flower on regular grass tiles
  if (!dirt) {
    const n = Math.floor(hash(tx, tz, def.gx, 5) * 3);
    for (let i = 0; i < n; i++) {
      const decor = spawn(pickBy(GRASS_DECOR, tx * 31 + tz * 7 + i));
      decor.position.set(
        c.x + (hash(tx, tz, i, 20) - 0.5) * 2.6,
        0.01,
        c.z + (hash(tx, tz, i, 21) - 0.5) * 2.6,
      );
      decor.rotation.y = hash(tx, tz, i, 22) * Math.PI * 2;
      decor.scale.multiplyScalar(1.5);
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
      visited: false,
      group,
    };

    if (def.biome === "village") {
      buildVillageFence(def, group);
      const start = buildVillageContent(def, group, runtime);
      if (start) playerStart = start;
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

      // -------- perimeter walls (shared) ----------
      buildDungeonEdge(def, "n", group);
      buildDungeonEdge(def, "w", group);
      if (!neighborOf(def, "s")) buildDungeonEdge({ ...def, gy: def.gy + 1 }, "n", group);
      if (!neighborOf(def, "e")) buildDungeonEdge({ ...def, gx: def.gx + 1 }, "w", group);

      // -------- torches + banners on north walls ----------
      for (const tx of [1, ROOM_W - 2]) {
        const c = tileCenter(def.gx, def.gy, tx, 0);
        c.z -= TILE / 2;
        addTorch(group, def.key, c, "s");
      }
      const bannerKey = def.banner === "blue" ? "banner_blue" : "banner_red";
      for (const tx of [3, ROOM_W - 4]) {
        const c = tileCenter(def.gx, def.gy, tx, 0);
        c.z -= TILE / 2;
        const b = spawn(bannerKey);
        b.position.set(c.x, 0.2, c.z);
        group.add(b);
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
    }

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
