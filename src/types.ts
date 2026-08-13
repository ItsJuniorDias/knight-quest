import type * as THREE from "three";

// ---------------------------------------------------------------------------
// Shared types — mirrors the shape of Spell Storm's types.ts
// ---------------------------------------------------------------------------

export interface InputState {
  moveX: number;
  moveY: number;
  attackPressed: boolean;
  attackBuffered: number; // seconds remaining in the buffer window
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
  | "taunt"
  | "recover"
  | "hurt"
  | "dying";

export interface BossData {
  root: THREE.Group;
  anim: AnimSet;
  state: BossState;
  stateTime: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  facing: Facing;
  hp: number;
  attacksSinceTaunt: number;
  didHitPlayer: boolean;
  leapFrom: THREE.Vector3;
  leapTo: THREE.Vector3;
  active: boolean;
  dead: boolean;
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
  hasBoss: boolean;
  cleared: boolean; // combat resolved (gates open forever)
  visited: boolean;
  group: THREE.Group;
}

export interface GameEvents {
  onHudDirty: () => void;
  onToast: (text: string) => void;
  onBossBar: (frac: number | null) => void;
  onGameOver: () => void;
  onVictory: () => void;
  onRoomChanged: (key: string) => void;
}
