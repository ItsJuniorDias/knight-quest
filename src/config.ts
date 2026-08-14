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

// ---------------------------------------------------------------------------
// PERF PROFILE — auto-detect mobile / web-view and pick a preset.
//
// Detection order:
//   1. `?perf=low|med|high` query param — user/QA override, always wins.
//   2. Touch-only device OR small screen OR mobile UA string → "mobile" preset.
//   3. Otherwise → "desktop" preset.
//
// The preset picks:
//   • pixelRatio cap (mobile 1.0, desktop 2.0 — huge fill-rate savings)
//   • shadow strategy (mobile off by default, desktop soft shadows)
//   • antialias (mobile off — GPU AA is expensive on integrated mobile GPUs)
//   • fog distance (mobile pulls the far plane in — fewer visible rooms)
//   • adaptive downgrade (mobile turns itself down further if FPS drops)
//
// `RENDER` is intentionally **mutable** so the adaptive system in main.ts
// can flip `shadows`, `maxPixelRatio`, etc. mid-run without a page reload.
// ---------------------------------------------------------------------------

export type PerfProfile = "mobile" | "desktop";

function readPerfOverride(): "low" | "med" | "high" | null {
  if (typeof window === "undefined") return null;
  try {
    const p = new URLSearchParams(window.location.search).get("perf");
    if (p === "low" || p === "med" || p === "high") return p;
  } catch {
    /* ignore */
  }
  return null;
}

/** Best-effort mobile / web-view detection. Runs once at module load. */
function detectProfile(): PerfProfile {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "desktop";
  const override = readPerfOverride();
  if (override === "high") return "desktop";
  if (override === "low" || override === "med") return "mobile";

  const ua = navigator.userAgent || "";
  const mobileUa = /android|iphone|ipad|ipod|iemobile|blackberry|opera mini|mobile safari|webview|wv\)/i.test(ua);
  const coarsePointer =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const noHover =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none)").matches;
  const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 820;
  const touchOnly = "ontouchstart" in window && !window.matchMedia?.("(hover: hover)").matches;

  // Any two signals is enough — avoids false positives on hybrid laptops.
  const votes = [mobileUa, coarsePointer, noHover, smallScreen, touchOnly].filter(Boolean).length;
  return votes >= 2 ? "mobile" : "desktop";
}

export const PERF_PROFILE: PerfProfile = detectProfile();
export const IS_MOBILE = PERF_PROFILE === "mobile";

// Query overrides so QA can force one preset lower than the auto-detected one.
const perfOverride = readPerfOverride();
const forceLow = perfOverride === "low";

export const RENDER = {
  /**
   * Camera: BOTW/OoT-flavored third-person chase cam, fixed to world axes.
   */
  camFov: 48,
  camDistance: 22,
  camElevation: 0.74,
  camLerp: 5,
  camLookAhead: 3.2,
  roomSlideTime: 0.55,

  // Fog: pull the far plane in on mobile so distant rooms don't cost draws.
  fogNear: IS_MOBILE ? 26 : 34,
  fogFar: IS_MOBILE ? 52 : 70,

  /** Convert glTF PBR materials to cheap Lambert (huge mobile win). */
  useLambert: true,

  // Shadows: off on mobile / low-end by default. Adaptive system re-enables
  // on desktop if fps is comfortable, or downgrades to basic shadow map on
  // borderline devices.
  shadows: !IS_MOBILE && !forceLow,
  shadowMapSize: IS_MOBILE ? 512 : 1024,
  /** Use PCFSoft (nice, expensive) or Basic (cheap, blocky). */
  softShadows: !IS_MOBILE,

  // Fill-rate cap. Mobile GPUs choke rendering at native DPR; 1.0 is enough
  // for a stylized flat-shaded game. Desktop keeps the crisp 2x.
  maxPixelRatio: IS_MOBILE ? 1 : 2,

  /** MSAA. Expensive on tiled mobile GPUs — off. */
  antialias: !IS_MOBILE,

  /**
   * Hide non-neighbouring rooms entirely (visibility + shadow casting).
   * On desktop we can afford to render everything visited; on mobile we
   * cull anything the player isn't standing in or adjacent to.
   */
  aggressiveRoomCulling: IS_MOBILE,

  /** Skip animation mixer updates for actors that are outside the current room. */
  freezeDistantMixers: IS_MOBILE,

  /**
   * Adaptive perf: if the rolling FPS drops below this, the loop drops one
   * quality tier (soft→basic shadows → shadows off → pixelRatio to 0.85).
   * 0 disables the system.
   */
  adaptiveTargetFps: IS_MOBILE ? 55 : 0,
};

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
