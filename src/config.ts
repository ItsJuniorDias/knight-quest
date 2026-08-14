// ---------------------------------------------------------------------------
// KNIGHT QUEST — configuration
//
// Every tunable number in the game lives here, following the same pattern as
// Spell Storm's config.ts. Tweak freely: the systems read these at runtime.
// ---------------------------------------------------------------------------

/** KayKit dungeon tiles are exactly 4x4 world units. */
export const TILE = 4;

/**
 * Room size in tiles (odd numbers keep doors centered).
 * v2: Bumped from 9x7 to 15x13 for a much roomier, less claustrophobic feel.
 * Each room is now ~60x52 world units vs. the old 36x28 — nearly 3× the area.
 */
export const ROOM_W = 15;
export const ROOM_H = 13;

export const RENDER = {
  /**
   * Camera: BOTW/OoT-flavored third-person chase cam, fixed to world axes.
   * Higher FOV + shorter distance + shallower elevation = more of the world
   * fills the screen and the horizon reads as "ahead of the knight" rather
   * than "directly overhead".
   */
  camFov: 48,
  camDistance: 22,
  /** Elevation angle in radians (~42 degrees — clearly behind, not on top). */
  camElevation: 0.74,
  /** How fast the camera eases toward its target (per-second lerp factor). */
  camLerp: 5,
  /**
   * How far AHEAD of the player the camera looks (in the movement direction).
   * Zelda-like: the player sits in the lower third of the frame so you can
   * see what's coming.
   */
  camLookAhead: 3.2,
  /** Seconds for the room-to-room slide transition. */
  roomSlideTime: 0.55,
  /** Fog near/far — near matches the room bounds, far hides distant geometry. */
  fogNear: 34,
  fogFar: 70,
  /** Convert glTF PBR materials to cheap Lambert (huge mobile win, flat cute look). */
  useLambert: true,
  shadows: true,
  shadowMapSize: 1024,
  maxPixelRatio: 2,
  /**
   * v11: how far (in ROOMS, not tiles) from the current one we still render.
   * 1 = current + immediate 4 neighbors visible; farther rooms are hidden.
   * Every hidden room skips its draw calls, animation mixers, and lights —
   * the biggest single FPS win in the whole codebase.
   */
  roomRenderDistance: 1,
} as const;

/**
 * v11: MOBILE PROFILE — applied at boot when we detect a touch device with
 * a narrow viewport. Textures stay at full resolution (the user asked for
 * "alta qualidade" textures); only render-target cost is trimmed:
 *   • pixel ratio capped at 1 (hi-DPI already runs at ×2-3, way too heavy)
 *   • hard shadows instead of PCF soft (single sample per texel)
 *   • smaller shadow map (512 vs 1024) — barely visible, half the memory
 *   • no procedural door-marker point lights (emissive gems still glow)
 */
export const MOBILE_RENDER = {
  maxPixelRatio: 1,
  shadowMapSize: 512,
  shadowFilterHard: true,
  useDoorLights: false,
  fogFar: 55, // v11: pull fog in so distant rooms fade fully
} as const;

/**
 * v11: DESKTOP PROFILE — mild trim vs. defaults. Users on a 4K panel don't
 * need the game to render at ×3 pixel ratio; ×1.5 is enough to look crisp
 * and doubles the framerate over the raw ×3 path.
 */
export const DESKTOP_RENDER = {
  maxPixelRatio: 1.5,
  shadowMapSize: 1024,
  shadowFilterHard: false,
  useDoorLights: true,
  fogFar: 70,
} as const;

/** Runtime detection — checked once at boot and cached in main.ts. */
export function detectMobile(): boolean {
  if (typeof window === "undefined") return false;
  const hasTouch =
    "ontouchstart" in window ||
    (typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0);
  const narrow = window.innerWidth <= 900;
  return hasTouch && narrow;
}

export const PLAYER = {
  maxHalfHearts: 12, // 6 hearts, Zelda-style half-heart granularity
  moveSpeed: 7.2,
  accel: 46,
  friction: 30,
  radius: 0.62,
  turnLerp: 14,

  attackDuration: 0.42,
  attackHitStart: 0.10, // seconds into the swing when the hitbox goes live
  attackHitEnd: 0.30,
  attackRange: 2.5,
  attackArc: Math.PI * 0.85, // radians of the frontal arc
  attackDamage: 1,
  comboWindow: 0.26, // seconds after a swing where a 2nd press chains the combo

  // v5: heavy / charged attack — hold attack for `chargeTime` then release
  chargeTime: 0.55,          // seconds of hold before the strike is "ready"
  heavyAttackDuration: 0.72, // longer swing, sells the weight
  heavyAttackHitStart: 0.22,
  heavyAttackHitEnd: 0.52,
  heavyAttackDamage: 3,      // vs light=1 (or 2 with sharpBlade upgrade)
  heavyKnockbackMul: 2.0,    // multiplies enemy knockback

  rollDuration: 0.46,
  rollSpeed: 13.5,
  rollCooldown: 0.22,

  blockDamageScale: 0, // frontal hits while blocking are fully absorbed
  blockMoveScale: 0.35,

  hurtInvuln: 1.0,
  knockback: 9,
  respawnHalfHearts: 12,
} as const;

export const ENEMIES = {
  minion: {
    hp: 3, speed: 3.4, radius: 0.6, aggroRange: 11, attackRange: 1.9,
    attackWindup: 0.38, attackDuration: 0.55, attackDamage: 2, // half-hearts
    hitStart: 0.12, hitEnd: 0.34, touchDamage: 1, score: 5,
  },
  rogue: {
    hp: 2, speed: 5.2, radius: 0.55, aggroRange: 12, attackRange: 1.7,
    attackWindup: 0.22, attackDuration: 0.42, attackDamage: 1,
    hitStart: 0.08, hitEnd: 0.26, touchDamage: 1, retreatTime: 0.9, score: 8,
  },
  mage: {
    hp: 2, speed: 2.6, radius: 0.55, aggroRange: 14, preferredRange: 8.5,
    castTime: 1.1, castCooldown: 2.2, boltSpeed: 9.5, boltDamage: 2,
    boltRadius: 0.35, touchDamage: 1, score: 10,
  },
  /** Awaken-from-the-floor intro (Stalfos style). Player is safe during it. */
  awakenTime: 1.35,
} as const;

export const BOSS = {
  hp: 22, speed: 3.0, radius: 1.0, scale: 1.55,
  touchDamage: 2,
  // Pattern: chase -> (near) spin attack | (far) jump chop with shockwave
  spinRange: 3.2, spinWindup: 0.55, spinDuration: 1.15, spinDamage: 3, spinRadius: 3.6,
  chopRange: 9, chopWindup: 0.5, chopLeapTime: 0.55, chopDamage: 2,
  shockwaveSpeed: 10, shockwaveWidth: 1.1, shockwaveDamage: 2,
  recoverTime: 0.9,
  tauntEvery: 3, // taunts after every N attacks (opening to punish)
  enrageAtHpFrac: 0.45, enrageSpeedMul: 1.35, enrageRecoverMul: 0.6,
  score: 100,
} as const;

// ---------------------------------------------------------------------------
// v6: EXTENDED BOSS ROSTER
//
// Eight bosses live in the world now. `skeleton_king` is Malric (original).
// The next three re-skin the existing skeleton models (bigger, tinted, with
// upgraded state machines). The last four are procedural — meshes assembled
// from three.js primitives at spawn time, so they need zero extra assets.
//
// Each boss defines its own HP pool, speed, hitbox radius, and per-move
// tuning. The BossSystem reads this table and drives the right AI.
// ---------------------------------------------------------------------------
export const BOSSES = {
  skeleton_king: {
    name: "Skeleton King Malric",
    hp: 22, speed: 3.0, radius: 1.0, scale: 1.55, touchDamage: 2,
    tint: 0xffffff, // default (no tint)
    // reuses the classic pattern (spin / chop)
    score: 100,
    intro: "Skeleton King Malric awakens!",
    outro: "The Skeleton King falls!",
    enrageLine: "The Skeleton King's axe begins to glow. He remembers who he was.",
  },
  bone_necromancer: {
    name: "The Bone Necromancer",
    hp: 18, speed: 2.6, radius: 0.9, scale: 1.55, touchDamage: 2,
    tint: 0xa864ff, // violet
    // ranged caster — bolts + summons
    castRange: 12, castWindup: 0.75, castRecover: 0.9,
    boltDamage: 2, boltCount: 3, boltSpread: 0.35,
    summonEvery: 3, summonCount: 2, // spawns minions after N attacks
    score: 90,
    intro: "The Bone Necromancer rises!",
    outro: "The Necromancer crumbles to dust!",
    enrageLine: "The Necromancer's runes flare crimson — his magic doubles.",
  },
  shadow_reaver: {
    name: "The Shadow Reaver",
    hp: 20, speed: 5.8, radius: 0.7, scale: 1.5, touchDamage: 2,
    tint: 0x2b3070, // obsidian navy
    // dash + triple stab
    dashRange: 10, dashWindup: 0.32, dashDuration: 0.34, dashSpeed: 22,
    stabWindup: 0.18, stabDuration: 0.28, stabDamage: 2, stabCount: 3,
    teleportEvery: 4, // vanishes and re-appears behind the player
    score: 110,
    intro: "The Shadow Reaver slips into view.",
    outro: "The Reaver dissolves into mist.",
    enrageLine: "The Reaver's silhouette blurs — she attacks twice as fast.",
  },
  iron_warden: {
    name: "The Iron Warden",
    hp: 30, speed: 2.2, radius: 1.15, scale: 1.7, touchDamage: 2,
    tint: 0xc86a2a, // rusted iron
    // slow tank — blocks + counter-smash + shockwave
    smashRange: 3.6, smashWindup: 0.6, smashDuration: 0.6, smashDamage: 3,
    blockDuration: 1.2, blockEvery: 2, // blocks between smashes
    slamShockwave: true, // slams cause 4-direction shockwaves
    score: 120,
    intro: "The Iron Warden guards the vault.",
    outro: "The Warden's armor shatters!",
    enrageLine: "The Warden's hammer glows white-hot — no more blocking.",
  },
  crystal_golem: {
    name: "The Crystal Golem",
    hp: 26, speed: 2.4, radius: 1.4, scale: 1.0, touchDamage: 2,
    tint: 0x66d0ff, // ice-blue crystal
    // procedural — ground slam + rotating laser + crystal shards
    slamRange: 4.0, slamWindup: 0.7, slamDamage: 3,
    laserRange: 14, laserWindup: 1.0, laserDuration: 1.8, laserDamage: 2,
    shardsCount: 6, shardsDamage: 2,
    score: 130,
    intro: "The Crystal Golem grinds to life.",
    outro: "The Golem shatters into a thousand shards!",
    enrageLine: "The Golem's core turns crimson — its lasers glow hotter.",
  },
  void_serpent: {
    name: "The Void Serpent",
    hp: 24, speed: 3.6, radius: 1.2, scale: 1.0, touchDamage: 2,
    tint: 0x8a2be2, // void purple
    // procedural — coiling body, bite lunge, void spit
    biteRange: 3.5, biteWindup: 0.5, biteDamage: 3,
    spitRange: 14, spitWindup: 0.55, spitDamage: 2,
    coilRadius: 4.5, coilDuration: 1.4, coilDamage: 2,
    score: 130,
    intro: "The Void Serpent uncoils from the shadows.",
    outro: "The Serpent's coils dissolve into the void.",
    enrageLine: "The Void Serpent's fangs weep purple flame.",
  },
  flame_djinn: {
    name: "The Flame Djinn",
    hp: 22, speed: 4.4, radius: 0.9, scale: 1.0, touchDamage: 2,
    tint: 0xff7a1f, // ember orange
    // procedural — floating orb, teleport + fire ring + fireball
    fireballRange: 12, fireballWindup: 0.55, fireballDamage: 2,
    ringRange: 5.5, ringWindup: 0.7, ringDamage: 3,
    teleportEvery: 3, teleportDist: 8,
    score: 130,
    intro: "The Flame Djinn erupts from the coals.",
    outro: "The Djinn implodes in a puff of ash.",
    enrageLine: "The Djinn's flames turn white — his ring engulfs the arena.",
  },
  storm_elemental: {
    name: "The Storm Elemental",
    hp: 24, speed: 3.4, radius: 1.0, scale: 1.0, touchDamage: 2,
    tint: 0x64c8ff, // sky-blue
    // procedural — swirling orb, chain lightning + tornado spawns
    boltRange: 14, boltWindup: 0.5, boltDamage: 2, chainCount: 3,
    tornadoWindup: 0.9, tornadoDamage: 2, tornadoLife: 3.2,
    hoverHeight: 2.5,
    score: 130,
    intro: "The Storm Elemental crackles into view.",
    outro: "The Elemental discharges its last spark.",
    enrageLine: "The Elemental's core hums — the storm accelerates.",
  },
} as const;
export type BossKindKey = keyof typeof BOSSES;

export const PROPS = {
  barrelHp: 1,
  barrelDropHeart: 0.35, // probability
  barrelDropCoin: 0.4,
  spikePeriod: 2.2, // seconds for a full up/down cycle
  spikeUpTime: 1.0,
  spikeDamage: 2,
  chestOpenTime: 0.6,
} as const;

export const PICKUPS = {
  heartHalfHearts: 2,
  coinValue: 1,
  magnetRange: 2.2,
  magnetSpeed: 10,
  bobSpeed: 2.4,
  lifeTime: 12,
} as const;

export const INPUT = {
  deadzone: 0.18,
  bufferTime: 0.18, // input buffering for attack, Zelda feel
} as const;

export const COLORS = {
  bg: 0x0d0820,
  fog: 0x1a1330,
  ambient: 0x8a7bc2,
  sun: 0xfff2dd,
  torch: 0xff9a3d,
  magicBolt: 0xb45cff,
  shockwave: 0xffd166,
  heart: 0xff3b5c,
  gold: 0xffd166,
  /** Grass tint for the village floor — brighter, more saturated. */
  grass: 0x6cb247,
  grassDark: 0x4a8a35,
  dungeonCeiling: 0x0a0510,
} as const;
