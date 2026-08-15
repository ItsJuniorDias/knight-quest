import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
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
// v4: added the FULL Synty POLYGON pack via OBJ files. The pack uses ONE
// shared texture atlas (PolyAdventureTexture_01.png, 256×256) — every OBJ
// is a plain mesh with UVs pointing into it. We load the atlas once, then
// apply a single MeshLambertMaterial to every OBJ. This is dramatically
// cheaper than shipping ~220 GLB files each with an embedded copy of the
// same 24KB texture.
//
// PORTING NOTE (expo-gl): swap the imports for the three-stdlib equivalents
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

// ---------------------------------------------------------------------------
// Synty POLYGON (existing GLBs kept as-is; new .obj additions below)
// ---------------------------------------------------------------------------
const MANIFEST_POLYGON_GLB = {
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

// ---------------------------------------------------------------------------
// v4: EVERY OBJ in Synty POLYGON Adventure Pack (220 files, minus Snow variants).
// All share one atlas texture that lives beside them at assets/polygon-obj/atlas.png.
// Keys prefixed `polyx_` so we can distinguish them from the older GLB copies at
// runtime without exploding builder.ts.
// ---------------------------------------------------------------------------
const MANIFEST_POLYGON_OBJ_LIST = [
  // buildings
  "bld_fence_01", "bld_fence_02", "bld_fencepost_01", "bld_hut_01", "bld_hutdoor_01",
  "bld_stall_01", "bld_stall_02", "bld_stall_03", "bld_stall_04",
  "bld_stall_cover_01", "bld_stall_cover_02", "bld_stall_cover_03",
  "bld_stall_cover_04", "bld_stall_cover_05",
  "bld_village_01", "bld_village_02", "bld_village_03", "bld_village_04",
  "bld_village_05", "bld_village_06", "bld_village_07",
  "bld_village_hangingcloth_01", "bld_village_top_01", "bld_village_windowdrapes_01",
  "bld_wall_01", "bld_wall_02", "bld_well_01",
  // env — big/nature
  "env_bridge_01",
  "env_bush_01", "env_bush_02", "env_bush_03", "env_bush_04",
  "env_campfire_01",
  "env_cloud_01", "env_cloud_02", "env_cloud_03", "env_cloud_04",
  "env_cloud_05", "env_cloud_06", "env_cloud_07",
  "env_dirtmound_01",
  "env_floortile_01", "env_floortile_02", "env_floortile_03", "env_floortile_04",
  "env_floortile_05", "env_floortile_06", "env_floortile_07",
  "env_flower_01", "env_flower_02", "env_flower_03", "env_flower_04",
  "env_flower_05", "env_flower_06", "env_flower_07", "env_flower_08",
  "env_grass_01", "env_grass_02",
  "env_groundmounds_01", "env_groundmounds_02", "env_groundmounds_03",
  "env_groundmounds_04", "env_groundmounds_05", "env_groundmounds_06",
  "env_groundmounds_07", "env_groundmounds_08", "env_groundmounds_09",
  "env_groundmounds_10",
  "env_hedge_01",
  "env_hill_01", "env_hill_02", "env_hill_03", "env_hill_04",
  "env_ice_01", "env_ice_02", "env_ice_03",
  "env_lillypads_01", "env_lillypads_02", "env_lillypads_03",
  "env_mushroom_01",
  "env_pebble_01", "env_pebble_02", "env_pebble_03", "env_pebble_04",
  "env_pebble_05", "env_pebble_06", "env_pebble_07",
  "env_plant_01", "env_plant_02", "env_plant_03", "env_plant_04", "env_plant_05",
  "env_reeds_01", "env_reeds_02", "env_reeds_03",
  "env_road_corner_01", "env_road_cross_01",
  "env_road_straight_01", "env_road_straight_02", "env_road_t_01",
  "env_rock_01", "env_rock_02", "env_rock_03", "env_rock_04", "env_rock_05",
  "env_rock_07", "env_rock_08", "env_rock_09",
  "env_rock_010", "env_rock_011", "env_rock_012", "env_rock_013",
  "env_rock_014", "env_rock_015", "env_rock_016",
  "env_stalagmite_01", "env_stalagmite_02", "env_stalagmite_03",
  "env_stream_corner_01", "env_stream_straight_01", "env_stream_straight_02",
  "env_tree_01", "env_tree_02", "env_tree_03", "env_tree_04", "env_tree_05",
  "env_tree_06", "env_tree_07", "env_tree_08", "env_tree_09",
  "env_tree_010", "env_tree_011", "env_tree_012", "env_tree_013",
  "env_tree_014", "env_tree_015", "env_tree_016",
  "env_treebirch_01", "env_treebirch_02", "env_treebirch_03",
  "env_treedead_01", "env_treedead_02",
  "env_treelog_01",
  "env_treepine_01", "env_treepine_02", "env_treepine_03", "env_treepine_04",
  "env_treestump_01",
  // items
  "item_canteen_01",
  "item_fruit_01", "item_fruit_02", "item_fruit_03",
  "item_gourd_01",
  "item_lantern_01", "item_lantern_02",
  "item_potion_01", "item_potion_02", "item_potion_03",
  "item_potion_04", "item_potion_05", "item_potion_06",
  "item_pouch_01",
  "item_waterskin_01",
  "item_wine_01", "item_wine_02",
  // props
  "prop_barrel_01", "prop_barrel_02",
  "prop_basket_01", "prop_basket_02", "prop_basket_03", "prop_basket_04",
  "prop_book_01", "prop_book_02", "prop_book_03",
  "prop_cart_01", "prop_cart_02", "prop_cart_03", "prop_cart_wheel_01",
  "prop_cheese_01", "prop_cheese_02", "prop_cheese_03",
  "prop_chest_01", "prop_chest_lid_01",
  "prop_crate_01", "prop_crate_02",
  "prop_loghalf_01", "prop_loghalf_02", "prop_logpile_01",
  "prop_meat_01", "prop_meat_02", "prop_meat_03",
  "prop_pot_01", "prop_pot_02", "prop_pot_03",
  "prop_pumpkin_01", "prop_pumpkin_02",
  "prop_roadsign_01",
  "prop_sack_01", "prop_sack_02", "prop_sack_03", "prop_sack_04",
  "prop_scroll_01", "prop_scroll_02",
  "prop_stall_table_01", "prop_stoneblock_01",
  "prop_washingline_01", "prop_washingline_02", "prop_washingline_03",
  // weapons
  "wep_axe_01", "wep_dagger_01", "wep_greataxe_01",
  "wep_musketpistol_01", "wep_pitchfork_01", "wep_scythe_01",
  "wep_sheild_01", "wep_sheild_02", "wep_sheild_03",
  "wep_staff_01", "wep_staff_02", "wep_sword_01",
  // v5: snow variants — a whole snow biome's worth of props. They still
  // sample the same green atlas by default; assets that reference the
  // snow-tinted atlas get it applied via applySnowMaterial at spawn time
  // (see isSnowKey below). Assets tagged _snow render with the snow atlas.
  "bld_fence_01_snow", "bld_fence_02_snow", "bld_hut_01_snow",
  "bld_market_snow_01", "bld_village_snowsheet_01",
  "env_dirtmound_01_snow", "env_hedge_01_snow",
  "env_hillsnow_01", "env_hillsnow_02", "env_hillsnow_03", "env_hillsnow_04",
  "env_road_corner_01_snow", "env_road_cross_01_snow",
  "env_road_straight_01_snow", "env_road_straight_02_snow", "env_road_t_01_snow",
  "env_rock_03_snow", "env_rock_04_snow", "env_rock_05_snow",
  "env_snowpile_01", "env_snowpile_02", "env_snowpile_03",
  "env_stream_corner_01_snow",
  "env_stream_straight_01_snow", "env_stream_straight_02_snow",
  "env_treebirch_01_snow", "env_treedead_02_snow",
  "env_treepine_01_snow", "env_treepine_02_snow", "env_treepine_03_snow",
  "env_tree_01_snow", "env_tree_02_snow", "env_tree_03_snow", "env_tree_04_snow",
  "env_tree_06_snow", "env_tree_07_snow", "env_tree_08_snow", "env_tree_09_snow",
  "env_tree_010_snow", "env_tree_011_snow", "env_tree_012_snow",
  "env_tree_013_snow", "env_tree_014_snow", "env_tree_015_snow",
  "env_tree_016_snow", "env_tree_017_snow",
] as const;

// Build the OBJ manifest with url + key
const MANIFEST_POLYGON_OBJ: Record<string, string> = {};
for (const name of MANIFEST_POLYGON_OBJ_LIST) {
  MANIFEST_POLYGON_OBJ[`polyx_${name}`] = `assets/polygon-obj/${name}.obj`;
}

const MANIFEST = {
  ...MANIFEST_KAYKIT,
  ...MANIFEST_POLYGON_GLB,
  ...MANIFEST_POLYGON_OBJ,
} as const;
export type AssetKey = keyof typeof MANIFEST | `polyx_${(typeof MANIFEST_POLYGON_OBJ_LIST)[number]}`;

/** Native scale: POLYGON is cm (0.01x), KayKit is meters (1x). */
function nativeScale(key: string): number {
  if (key.startsWith("poly_") || key.startsWith("polyx_")) return 0.01;
  return 1;
}

export interface LoadedAsset {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

const cache = new Map<string, LoadedAsset>();

/** The shared atlas textures — one green (default), one snow-tinted. */
let atlasTexture: THREE.Texture | null = null;
let atlasMaterial: THREE.MeshLambertMaterial | null = null;
let atlasSnowTexture: THREE.Texture | null = null;
let atlasSnowMaterial: THREE.MeshLambertMaterial | null = null;
/** v12: max anisotropy the current renderer supports. Set by setMaxAnisotropy(). */
let maxAnisotropy = 1;

/**
 * v12: called from main.ts once the renderer exists so we know how much
 * anisotropic filtering the GPU supports (typically 16 on desktop, 4-16
 * on mobile). Higher = crisper textures viewed at oblique angles, no
 * more shimmery/serrilhado atlas edges when the camera tilts.
 */
export function setMaxAnisotropy(value: number): void {
  maxAnisotropy = Math.max(1, Math.floor(value));
  // Retroactively lift any textures that were already loaded before this
  // call (i.e. everything the atlas loader created).
  const bump = (t: THREE.Texture | null): void => {
    if (!t) return;
    t.anisotropy = maxAnisotropy;
    t.needsUpdate = true;
  };
  bump(atlasTexture);
  bump(atlasSnowTexture);
}

function convertMaterials(root: THREE.Object3D): void {
  if (!RENDER.useLambert) return;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const convert = (m: THREE.Material): THREE.Material => {
      const std = m as THREE.MeshStandardMaterial;
      // v12: force linear filtering + anisotropy on every glTF-embedded
      // texture too, not just the shared OBJ atlas. Otherwise KayKit
      // character/dungeon textures still look serrilhado at grazing angles.
      if (std.map) {
        std.map.magFilter = THREE.LinearFilter;
        std.map.minFilter = THREE.LinearMipmapLinearFilter;
        std.map.anisotropy = maxAnisotropy;
        std.map.needsUpdate = true;
      }
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

/**
 * Apply the shared atlas material to every mesh under `root`. Called on
 * every OBJ load. The material is REUSED across meshes (not cloned) so
 * hundreds of props still ship a single GL material — huge draw-call win.
 * Snow-tagged assets sample the winter atlas instead of the green one.
 */
function applyAtlasMaterial(root: THREE.Object3D, useSnow: boolean): void {
  const mat = useSnow ? atlasSnowMaterial : atlasMaterial;
  if (!mat) return;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = mat;
  });
}

/** True if this asset key belongs to the snow-variant family. */
export function isSnowKey(key: string): boolean {
  return key.includes("_snow") || key.includes("snowpile") || key.includes("hillsnow");
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

/** Preload the shared atlas textures used by every polyx_ OBJ. */
async function loadAtlas(): Promise<void> {
  const loadTex = (url: string) =>
    new Promise<THREE.Texture>((resolve, reject) => {
      new THREE.TextureLoader().load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          // v12: Linear (trilinear) filtering instead of Nearest. The old
          // Nearest path shipped a "retro pixel art" look, but the user
          // reported it as `serrilhado` (jaggies). LinearMipmapLinear +
          // anisotropy = smooth atlas sampling at every distance/angle.
          tex.magFilter = THREE.LinearFilter;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.generateMipmaps = true;
          tex.anisotropy = maxAnisotropy;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          resolve(tex);
        },
        undefined,
        (err) => reject(err),
      );
    });
  const [green, snow] = await Promise.all([
    loadTex("assets/polygon-obj/atlas.png"),
    loadTex("assets/polygon-obj/atlas_snow.png"),
  ]);
  atlasTexture = green;
  atlasSnowTexture = snow;
  atlasMaterial = new THREE.MeshLambertMaterial({
    map: green,
    side: THREE.DoubleSide,
    color: 0xffffff,
  });
  atlasSnowMaterial = new THREE.MeshLambertMaterial({
    map: snow,
    side: THREE.DoubleSide,
    color: 0xffffff,
  });
}

export async function loadAll(
  onProgress: (done: number, total: number, label: string) => void,
): Promise<void> {
  const gltfLoader = new GLTFLoader();
  const objLoader = new OBJLoader();

  // atlas first — every OBJ needs it
  onProgress(0, 1, "loading atlas texture");
  await loadAtlas();

  const gltfEntries = Object.entries({ ...MANIFEST_KAYKIT, ...MANIFEST_POLYGON_GLB }) as [string, string][];
  const objEntries = Object.entries(MANIFEST_POLYGON_OBJ) as [string, string][];
  const total = gltfEntries.length + objEntries.length;
  let done = 0;

  for (const [key, url] of gltfEntries) {
    onProgress(done, total, url.split("/").pop() ?? url);
    const gltf: GLTF = await gltfLoader.loadAsync(url);
    convertMaterials(gltf.scene);
    cache.set(key, { scene: gltf.scene, animations: gltf.animations });
    done++;
  }
  for (const [key, url] of objEntries) {
    onProgress(done, total, url.split("/").pop() ?? url);
    try {
      const grp: THREE.Group = await objLoader.loadAsync(url);
      applyAtlasMaterial(grp, isSnowKey(key));
      cache.set(key, { scene: grp, animations: [] });
    } catch (e) {
      // Some OBJs may fail loading — skip and continue to avoid breaking the game
      console.warn(`Failed to load ${url}:`, e);
    }
    done++;
  }
  onProgress(total, total, "done");
}

export function getAnimations(key: AssetKey): THREE.AnimationClip[] {
  const a = cache.get(key as string);
  if (!a) throw new Error(`Asset not loaded: ${String(key)}`);
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
  const a = cache.get(key as string);
  if (!a) throw new Error(`Asset not loaded: ${String(key)}`);
  // OBJ assets (polyx_) are static meshes — a plain .clone(true) is right.
  // GLB assets can contain skinned meshes; skeletonClone re-binds their skeletons.
  const isObj = (key as string).startsWith("polyx_");
  const inst = isObj ? (a.scene.clone(true) as THREE.Group) : (skeletonClone(a.scene) as THREE.Group);
  enableShadows(inst, opts.castShadow ?? false, opts.receiveShadow ?? false);
  const s = nativeScale(key as string) * (opts.scale ?? 1);
  if (s !== 1) {
    const wrapper = new THREE.Group();
    wrapper.add(inst);
    wrapper.scale.setScalar(s);
    return wrapper;
  }
  return inst;
}

/**
 * True if this asset was loaded from an OBJ file (belongs to the polyx_
 * family). Kept as a helper for the builder so it can safely pick from
 * random pools that mix OBJ and GLB entries.
 */
export function isPolyxKey(key: string): boolean {
  return key.startsWith("polyx_");
}

/** Access the shared atlas material — useful for custom procedural meshes. */
export function getAtlasMaterial(): THREE.MeshLambertMaterial | null {
  return atlasMaterial;
}

export function findNode(root: THREE.Object3D, contains: string): THREE.Object3D | null {
  const needle = contains.toLowerCase();
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && o.name.toLowerCase().includes(needle)) found = o;
  });
  return found;
}

/** Expose the list of every polyx_ key so systems can build random pools. */
export const POLYX_KEYS: readonly `polyx_${string}`[] = MANIFEST_POLYGON_OBJ_LIST.map(
  (n) => `polyx_${n}` as `polyx_${typeof n}`,
);
