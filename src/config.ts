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
  fogNear: 42,
  fogFar: 82,
  /** Convert glTF PBR materials to cheap Lambert (huge mobile win, flat cute look). */
  useLambert: true,
  shadows: true,
  shadowMapSize: 1024,
  maxPixelRatio: 2,
} as const;

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
