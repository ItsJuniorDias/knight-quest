import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { RENDER } from "../config";

// ---------------------------------------------------------------------------
// Asset loading — KayKit (characters + dungeon) + Synty POLYGON (overworld).
//
// The two packs live at different scales: KayKit ships in meters, POLYGON
// in centimetres. Every POLYGON asset key starts with `poly_`, and spawn()
// applies a 0.01x baked scale automatically so callers can place everything
// in the same meter-based grid regardless of origin pack.
//
// PORTING NOTE (expo-gl): swap the import above for
//   import { GLTFLoader } from "three-stdlib";
// and resolve each url via expo-asset before calling loader.loadAsync.
// ---------------------------------------------------------------------------

const MANIFEST_KAYKIT = {
  // characters (skinned + animated)
  knight: "assets/characters/Knight.glb",
  skeleton_minion: "assets/characters/Skeleton_Minion.glb",
  skeleton_rogue: "assets/characters/Skeleton_Rogue.glb",
  skeleton_mage: "assets/characters/Skeleton_Mage.glb",
  skeleton_warrior: "assets/characters/Skeleton_Warrior.glb",
  // dungeon modules
  floor_large: "assets/dungeon/floor_tile_large.glb",
  floor_small: "assets/dungeon/floor_tile_small.glb",
  floor_broken: "assets/dungeon/floor_tile_small_broken_A.glb",
  floor_weeds: "assets/dungeon/floor_tile_small_weeds_A.glb",
  floor_decorated: "assets/dungeon/floor_tile_small_decorated.glb",
  wall: "assets/dungeon/wall.glb",
  wall_corner: "assets/dungeon/wall_corner.glb",
  wall_doorway: "assets/dungeon/wall_doorway.glb",
  wall_gated: "assets/dungeon/wall_gated.glb",
  wall_pillar: "assets/dungeon/wall_pillar.glb",
  column: "assets/dungeon/column.glb",
  pillar: "assets/dungeon/pillar.glb",
  chest: "assets/dungeon/chest.glb",
  chest_gold: "assets/dungeon/chest_gold.glb",
  key: "assets/dungeon/key.glb",
  coin: "assets/dungeon/coin.glb",
  torch_mounted: "assets/dungeon/torch_mounted.glb",
  barrel_small: "assets/dungeon/barrel_small.glb",
  barrel_large: "assets/dungeon/barrel_large.glb",
  box_small: "assets/dungeon/box_small.glb",
  crates_stacked: "assets/dungeon/crates_stacked.glb",
  banner_red: "assets/dungeon/banner_patternA_red.glb",
  banner_blue: "assets/dungeon/banner_patternA_blue.glb",
  sword_shield: "assets/dungeon/sword_shield.glb",
  rubble_half: "assets/dungeon/rubble_half.glb",
  stairs: "assets/dungeon/stairs.glb",
  spikes: "assets/dungeon/floor_tile_big_spikes.glb",
} as const;

// Synty POLYGON — all in centimeters, auto-scaled 0.01x at spawn.
const MANIFEST_POLYGON = {
  // village buildings
  poly_house_a: "assets/polygon/house_a.glb",
  poly_house_b: "assets/polygon/house_b.glb",
  poly_house_c: "assets/polygon/house_c.glb",
  poly_house_d: "assets/polygon/house_d.glb",
  poly_house_e: "assets/polygon/house_e.glb",
  poly_house_big: "assets/polygon/house_big.glb",
  poly_hut: "assets/polygon/hut.glb",
  poly_well: "assets/polygon/well.glb",
  poly_stall_a: "assets/polygon/stall_a.glb",
  poly_stall_b: "assets/polygon/stall_b.glb",
  poly_stall_cover_a: "assets/polygon/stall_cover_a.glb",
  poly_stall_cover_b: "assets/polygon/stall_cover_b.glb",
  poly_stall_table: "assets/polygon/stall_table.glb",
  poly_fence_a: "assets/polygon/fence_a.glb",
  poly_fence_b: "assets/polygon/fence_b.glb",
  poly_fence_post: "assets/polygon/fence_post.glb",
  poly_wall_stone: "assets/polygon/wall_stone.glb",
  poly_roadsign: "assets/polygon/roadsign.glb",
  poly_campfire: "assets/polygon/campfire.glb",
  poly_cart: "assets/polygon/cart.glb",
  poly_washingline: "assets/polygon/washingline.glb",
  // trees + foliage
  poly_tree_a: "assets/polygon/tree_a.glb",
  poly_tree_b: "assets/polygon/tree_b.glb",
  poly_tree_c: "assets/polygon/tree_c.glb",
  poly_pine_a: "assets/polygon/pine_a.glb",
  poly_pine_b: "assets/polygon/pine_b.glb",
  poly_tree_birch: "assets/polygon/tree_birch.glb",
  poly_tree_dead: "assets/polygon/tree_dead.glb",
  poly_tree_stump: "assets/polygon/tree_stump.glb",
  poly_tree_log: "assets/polygon/tree_log.glb",
  poly_bush_a: "assets/polygon/bush_a.glb",
  poly_bush_b: "assets/polygon/bush_b.glb",
  poly_bush_c: "assets/polygon/bush_c.glb",
  poly_bush_d: "assets/polygon/bush_d.glb",
  poly_grass_a: "assets/polygon/grass_a.glb",
  poly_grass_b: "assets/polygon/grass_b.glb",
  poly_flower_a: "assets/polygon/flower_a.glb",
  poly_flower_b: "assets/polygon/flower_b.glb",
  poly_reeds: "assets/polygon/reeds.glb",
  poly_mushroom: "assets/polygon/mushroom.glb",
  // rocks
  poly_rock_a: "assets/polygon/rock_a.glb",
  poly_rock_b: "assets/polygon/rock_b.glb",
  poly_rock_flat: "assets/polygon/rock_flat.glb",
  poly_pebble_a: "assets/polygon/pebble_a.glb",
  // ground tiles
  poly_ground_grass_a: "assets/polygon/ground_grass_a.glb",
  poly_ground_grass_b: "assets/polygon/ground_grass_b.glb",
  poly_ground_dirt_a: "assets/polygon/ground_dirt_a.glb",
  poly_ground_dirt_b: "assets/polygon/ground_dirt_b.glb",
  poly_ground_stone: "assets/polygon/ground_stone.glb",
  poly_road_straight: "assets/polygon/road_straight.glb",
  poly_road_corner: "assets/polygon/road_corner.glb",
  // water
  poly_stream_straight: "assets/polygon/stream_straight.glb",
  poly_bridge: "assets/polygon/bridge.glb",
  poly_lillypad: "assets/polygon/lillypad.glb",
  // decorative
  poly_barrel_a: "assets/polygon/poly_barrel_a.glb",
  poly_crate_a: "assets/polygon/poly_crate_a.glb",
  poly_basket_a: "assets/polygon/basket_a.glb",
  poly_pot: "assets/polygon/pot.glb",
  poly_sack_a: "assets/polygon/sack_a.glb",
  poly_pumpkin: "assets/polygon/pumpkin.glb",
  poly_cheese: "assets/polygon/cheese.glb",
  poly_meat: "assets/polygon/meat.glb",
  poly_potion_a: "assets/polygon/potion_a.glb",
  poly_lantern: "assets/polygon/lantern.glb",
  poly_cloud_a: "assets/polygon/cloud_a.glb",
  poly_cloud_b: "assets/polygon/cloud_b.glb",
} as const;

const MANIFEST = { ...MANIFEST_KAYKIT, ...MANIFEST_POLYGON };
export type AssetKey = keyof typeof MANIFEST;

/** Native scale: POLYGON is cm (0.01x), KayKit is meters (1x). */
function nativeScale(key: string): number {
  return key.startsWith("poly_") ? 0.01 : 1;
}

export interface LoadedAsset {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

const cache = new Map<AssetKey, LoadedAsset>();

function convertMaterials(root: THREE.Object3D): void {
  if (!RENDER.useLambert) return;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const convert = (m: THREE.Material): THREE.Material => {
      const std = m as THREE.MeshStandardMaterial;
      const lam = new THREE.MeshLambertMaterial({
        map: std.map ?? null,
        color: std.color ? std.color.clone() : new THREE.Color(0xffffff),
        transparent: std.transparent,
        opacity: std.opacity,
        side: std.side,
      });
      lam.name = m.name;
      return lam;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(convert)
      : convert(mesh.material);
  });
}

function enableShadows(root: THREE.Object3D, cast: boolean, receive: boolean): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    if ((mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) {
      mesh.frustumCulled = false;
    }
  });
}

export async function loadAll(
  onProgress: (done: number, total: number, label: string) => void,
): Promise<void> {
  const loader = new GLTFLoader();
  const entries = Object.entries(MANIFEST) as [AssetKey, string][];
  let done = 0;
  for (const [key, url] of entries) {
    onProgress(done, entries.length, url.split("/").pop() ?? url);
    const gltf: GLTF = await loader.loadAsync(url);
    convertMaterials(gltf.scene);
    cache.set(key, { scene: gltf.scene, animations: gltf.animations });
    done++;
  }
  onProgress(entries.length, entries.length, "done");
}

export function getAnimations(key: AssetKey): THREE.AnimationClip[] {
  const a = cache.get(key);
  if (!a) throw new Error(`Asset not loaded: ${key}`);
  return a.animations;
}

export interface SpawnOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Extra multiplier on top of the pack's native scale. */
  scale?: number;
}

/**
 * Fresh clone of the asset. POLYGON assets get scaled 0.01x automatically
 * so callers never have to think about the pack the mesh came from.
 */
export function spawn(key: AssetKey, opts: SpawnOptions = {}): THREE.Group {
  const a = cache.get(key);
  if (!a) throw new Error(`Asset not loaded: ${key}`);
  const inst = skeletonClone(a.scene) as THREE.Group;
  enableShadows(inst, opts.castShadow ?? false, opts.receiveShadow ?? false);
  const s = nativeScale(key) * (opts.scale ?? 1);
  if (s !== 1) {
    const wrapper = new THREE.Group();
    wrapper.add(inst);
    wrapper.scale.setScalar(s);
    return wrapper;
  }
  return inst;
}

export function findNode(root: THREE.Object3D, contains: string): THREE.Object3D | null {
  const needle = contains.toLowerCase();
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && o.name.toLowerCase().includes(needle)) found = o;
  });
  return found;
}
