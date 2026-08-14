import type * as THREE from "three";

// ---------------------------------------------------------------------------
// Shared types — mirrors the shape of Spell Storm's types.ts
// ---------------------------------------------------------------------------

export interface InputState {
  moveX: number;
  moveY: number;
  attackPressed: boolean;
  attackBuffered: number; // seconds remaining in the buffer window
  attackHeld: boolean;     // v5: true while the attack button is still pressed
  rollPressed: boolean;
  blockHeld: boolean;
  interactPressed: boolean;
}

export type Facing = { x: number; z: number };

export interface AnimSet {
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: string | null;
}

export type PlayerState =
  | "idle"
  | "run"
  | "attack"
  | "heavyAttack"  // v5: released charged strike, big damage
  | "chargeHold"   // v5: holding attack button to charge
  | "roll"
  | "block"
  | "hurt"
  | "dead"
  | "cheer";

export interface PlayerData {
  root: THREE.Group;
  anim: AnimSet;
  state: PlayerState;
  stateTime: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  facing: Facing;
  halfHearts: number;
  invuln: number;
  attackIndex: 0 | 1; // combo step
  attackDidHit: Set<number>; // enemy ids already hit by the current swing
  rollCooldown: number;
  coins: number;
  hasBossKey: boolean;
  /** rolling count of enemies hit within the last combo window */
  comboCount: number;
  /** seconds until the combo counter resets to 0 */
  comboTimer: number;
  // v5: shop-relative fields. maxHp is in whole hearts; hp is the same unit.
  // The legacy halfHearts field stays for backwards compatibility with any
  // system that still reads it; hp/maxHp are the new source of truth for
  // shop-driven max-HP upgrades.
  hp: number;
  maxHp: number;
  /** v5: purchased one-time upgrades from the shop. */
  upgrades?: {
    sharpBlade?: boolean;
    reinforcedShield?: boolean;
  };
  /** v5: seconds attack has been held (charge attack). 0 = not charging. */
  chargeTime: number;
  /** v5: true if the next release should fire a heavy strike, not a light. */
  chargeReady: boolean;
}

export type EnemyKind = "minion" | "rogue" | "mage";

export type EnemyState =
  | "awaken"
  | "idle"
  | "chase"
  | "windup"
  | "attack"
  | "retreat"
  | "cast"
  | "hurt"
  | "dying";

export interface EnemyData {
  id: number;
  kind: EnemyKind;
  root: THREE.Group;
  anim: AnimSet;
  state: EnemyState;
  stateTime: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  facing: Facing;
  hp: number;
  roomKey: string;
  didHitPlayer: boolean;
  castCooldown: number;
  dead: boolean;
}

export type BossState =
  | "waiting"
  | "awaken"
  | "chase"
  | "spinWindup"
  | "spin"
  | "chopWindup"
  | "chopLeap"
  | "chopLand"
  | "castWindup"
  | "cast"
  | "dashWindup"
  | "dash"
  | "slamWindup"
  | "slam"
  | "teleport"
  | "summon"
  | "taunt"
  | "recover"
  | "hurt"
  | "dying";

/**
 * v6: eight boss kinds. `skeleton_king` is the original Malric.
 * The next three are elite skeleton variants (bigger, tinted, expanded AI)
 * built on the existing KayKit skeleton models. The final four are fully
 * procedural bosses whose meshes are assembled from three.js primitives
 * at spawn time — no external assets needed.
 */
export type BossKind =
  | "skeleton_king"    // original — Throne of Bones (Malric)
  | "bone_necromancer" // skeleton_mage x1.6 purple — summons minions + bolts
  | "shadow_reaver"    // skeleton_rogue x1.5 obsidian — dash + triple-strike
  | "iron_warden"      // skeleton_minion x1.7 rust — block + counter-smash
  | "crystal_golem"    // procedural — obsidian cubes + gems, ground slam + laser
  | "void_serpent"     // procedural — segmented worm, coiling attacks
  | "flame_djinn"      // procedural — floating orb + flames, teleport + fire waves
  | "storm_elemental"; // procedural — swirling storm, chain lightning + tornadoes

export interface BossData {
  kind: BossKind;
  root: THREE.Group;
  anim: AnimSet;
  state: BossState;
  stateTime: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  facing: Facing;
  hp: number;
  maxHp: number;
  attacksSinceTaunt: number;
  didHitPlayer: boolean;
  leapFrom: THREE.Vector3;
  leapTo: THREE.Vector3;
  active: boolean;
  dead: boolean;
  /** true once we've fired the "enraged" narrative beat */
  enrageAnnounced: boolean;
  /** the runtime room key this boss belongs to */
  roomKey: string;
  /** custom timer for kind-specific behavior */
  cooldown: number;
  /** how many times this boss has telegraphed a summon (for necromancer) */
  summonsUsed: number;
  /** procedural boss animation clock (rotations, floating, etc.) */
  procTime: number;
}

export interface Projectile {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  damage: number;
  life: number;
  kind: "bolt" | "shockwave";
  dead: boolean;
}

export type PickupKind = "heart" | "coin" | "key";

export interface Pickup {
  mesh: THREE.Object3D;
  kind: PickupKind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  dead: boolean;
}

export type DoorDir = "n" | "s" | "e" | "w";

export interface DoorState {
  dir: DoorDir;
  kind: "open" | "gated" | "locked";
  gate: THREE.Object3D | null; // the wall_gated mesh that slides down
  gateClosed: boolean;
  lockIcon: THREE.Object3D | null;
  unlocked: boolean; // for locked doors, once the key is used
}

export interface ChestState {
  root: THREE.Group;
  lid: THREE.Object3D | null;
  opened: boolean;
  openT: number;
  contents: "coins" | "bosskey" | "heart" | "crystal";
  tile: { tx: number; tz: number };
}

export interface BarrelState {
  root: THREE.Object3D;
  pos: THREE.Vector3;
  radius: number;
  broken: boolean;
}

export interface SpikeState {
  root: THREE.Object3D;
  spikes: THREE.Object3D | null;
  pos: THREE.Vector3;
  phase: number;
  up: boolean;
}

export interface RoomRuntime {
  key: string; // "gx,gy"
  gx: number;
  gy: number;
  origin: THREE.Vector3; // world position of tile (0,0) corner
  solid: boolean[][]; // [tz][tx] collision grid
  doors: DoorState[];
  chests: ChestState[];
  barrels: BarrelState[];
  spikes: SpikeState[];
  enemySpawns: { kind: EnemyKind; tx: number; tz: number }[];
  npcSpawns: { kind: NpcKind; tx: number; tz: number }[];
  /** v6: one or more bosses in this room (Throne of Bones has 1; boss rush rooms 1) */
  bossSpawns: { kind: BossKind; tx: number; tz: number }[];
  hasBoss: boolean;
  cleared: boolean; // combat resolved (gates open forever)
  visited: boolean;
  group: THREE.Group;
}

// ---------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------

export type NpcKind =
  | "villager"    // generic townsfolk
  | "elder"       // gold-robed sage (quest giver)
  | "merchant"    // orange-clad trader
  | "guard"       // steel-blue armored
  | "hermit"      // wandering wise man in the forest
  | "ghost"       // translucent restless dead haunting the dungeon
  | "shopkeeper"; // v5: opens the shop UI on interact

export interface NpcLine {
  who: string;
  text: string;
}

export interface NpcData {
  id: string;               // unique roster id ("meet:elder" ...)
  kind: NpcKind;
  root: THREE.Group;
  anim: AnimSet;
  state: "idle" | "walk" | "talking";
  stateTime: number;
  pos: THREE.Vector3;
  home: THREE.Vector3;      // wander anchor
  facing: Facing;
  lines: NpcLine[];
  lineIdx: number;
  roomKey: string;
  wanderTarget: THREE.Vector3;
  wanderCooldown: number;
  lastTalkedAt: number;     // performance.now()/1000 of last dialog advance
}

// ---------------------------------------------------------------------------
// Game-wide event bus
//
// All UI updates go through this so systems don't have to know about the DOM.
// v3: added onStory / onStoryTrigger so the narrator + dialog UI can be fed
// from many sources (NPCs, story director, boss events) without coupling.
// ---------------------------------------------------------------------------

export interface GameEvents {
  onHudDirty: () => void;
  onToast: (text: string) => void;
  onBossBar: (frac: number | null) => void;
  onGameOver: () => void;
  onVictory: () => void;
  onRoomChanged: (key: string) => void;
  /** Narrator or NPC line; `who=null` = the omniscient chronicler voice. */
  onStory: (who: string | null, text: string) => void;
  /** Fires the first time an NPC's dialog is advanced (id === NpcSpec.id). */
  onStoryTrigger: (id: string) => void;
  /** Every enemy/boss hit by the sword — powers combo counter + screenshake. */
  onSwordHit: (kind: "enemy" | "boss" | "barrel", pos: THREE.Vector3) => void;
  /** Every player sword swing (before any hit) — used for screen shake ramp. */
  onSwordSwing: (comboStep: 0 | 1) => void;
  /** Fire an event beat by key ('got:bosskey', 'unlocked:bossdoor', ...). */
  onGameEvent: (key: string) => void;
  /** v5: Open/close the item shop UI. */
  onOpenShop: () => void;
  onCloseShop: () => void;
}
