import * as THREE from "three";
import { PLAYER } from "../config";
import { clipDuration, buildAnimSet, play } from "../engine/anim";
import { sfx } from "../engine/audio";
import { getAnimations, spawn } from "../engine/loader";
import type { FxSystem } from "../art/fx";
import type { GameEvents, InputState, PlayerData } from "../types";
import { moveCircle } from "./physics";
import type { RoomManager } from "./rooms";

// ---------------------------------------------------------------------------
// The Knight.
//
// Zelda-grammar state machine: move -> attack (2-hit combo with input
// buffering) -> dodge roll (i-frames) -> shield block (hold). Hurt knocks
// back with a blink of invulnerability; death hands control to screens.ts.
// ---------------------------------------------------------------------------

/** KayKit characters ship every weapon variant visible; keep sword + round shield. */
const HIDE_MESHES = [
  "1H_Sword_Offhand",
  "Badge_Shield",
  "Rectangle_Shield",
  "Spike_Shield",
  "2H_Sword",
];

export function createPlayer(scene: THREE.Scene, start: THREE.Vector3): PlayerData {
  const root = spawn("knight", { castShadow: true });
  root.position.copy(start);
  scene.add(root);

  root.traverse((o) => {
    if (HIDE_MESHES.includes(o.name)) o.visible = false;
  });

  const anim = buildAnimSet(root, getAnimations("knight"));
  play(anim, ["Idle"]);

  return {
    root,
    anim,
    state: "idle",
    stateTime: 0,
    pos: start.clone(),
    vel: new THREE.Vector3(),
    facing: { x: 0, z: -1 },
    halfHearts: PLAYER.maxHalfHearts,
    invuln: 0,
    attackIndex: 0,
    attackDidHit: new Set(),
    rollCooldown: 0,
    coins: 0,
    hasBossKey: false,
  };
}

const ATTACK_CLIPS: string[][] = [
  ["1H_Melee_Attack_Slice_Horizontal", "1H_Melee_Attack_Chop"],
  ["1H_Melee_Attack_Slice_Diagonal", "1H_Melee_Attack_Stab"],
];

export function updatePlayer(
  p: PlayerData,
  input: InputState,
  dt: number,
  roomMgr: RoomManager,
  fx: FxSystem,
  events: GameEvents,
): void {
  p.stateTime += dt;
  p.invuln = Math.max(0, p.invuln - dt);
  p.rollCooldown = Math.max(0, p.rollCooldown - dt);
  p.anim.mixer.update(dt);

  if (p.state === "dead" || p.state === "cheer") {
    p.root.position.copy(p.pos);
    return;
  }

  const room = roomMgr.current;
  const barrels = room.barrels.filter((b) => !b.broken);
  const frozen = roomMgr.transitionLock > 0;

  const wantX = frozen ? 0 : input.moveX;
  const wantZ = frozen ? 0 : input.moveY;
  const wantLen = Math.hypot(wantX, wantZ);

  switch (p.state) {
    case "idle":
    case "run": {
      // movement
      const speedCap = input.blockHeld ? PLAYER.moveSpeed * PLAYER.blockMoveScale : PLAYER.moveSpeed;
      if (wantLen > 0.01) {
        p.vel.x += wantX * PLAYER.accel * dt;
        p.vel.z += wantZ * PLAYER.accel * dt;
        const v = Math.hypot(p.vel.x, p.vel.z);
        if (v > speedCap) {
          p.vel.x = (p.vel.x / v) * speedCap;
          p.vel.z = (p.vel.z / v) * speedCap;
        }
        p.facing.x = wantX / wantLen;
        p.facing.z = wantZ / wantLen;
      } else {
        const drop = PLAYER.friction * dt;
        const v = Math.hypot(p.vel.x, p.vel.z);
        const nv = Math.max(0, v - drop);
        if (v > 0.001) {
          p.vel.x = (p.vel.x / v) * nv;
          p.vel.z = (p.vel.z / v) * nv;
        }
      }
      moveCircle(p.pos, p.vel, dt, PLAYER.radius, room, barrels);
      roomMgr.clampAtClosedDoors(p.pos, PLAYER.radius);

      const moving = Math.hypot(p.vel.x, p.vel.z) > 0.6;
      if (input.blockHeld && !frozen) {
        p.state = "block";
        p.stateTime = 0;
        play(p.anim, ["Blocking", "Block"], { fade: 0.1 });
        break;
      }
      p.state = moving ? "run" : "idle";
      play(p.anim, moving ? ["Running_A", "Walking_A"] : ["Idle"], { fade: 0.18 });

      if (!frozen && (input.attackPressed || input.attackBuffered > 0)) {
        startAttack(p, 0);
        input.attackBuffered = 0;
      } else if (!frozen && input.rollPressed && p.rollCooldown <= 0) {
        startRoll(p, wantLen > 0.01 ? { x: wantX / wantLen, z: wantZ / wantLen } : p.facing);
      }
      break;
    }

    case "block": {
      // slow strafe while holding shield up
      p.vel.set(wantX * PLAYER.moveSpeed * PLAYER.blockMoveScale, 0, wantZ * PLAYER.moveSpeed * PLAYER.blockMoveScale);
      if (wantLen > 0.01) {
        p.facing.x = wantX / wantLen;
        p.facing.z = wantZ / wantLen;
      }
      moveCircle(p.pos, p.vel, dt, PLAYER.radius, room, barrels);
      roomMgr.clampAtClosedDoors(p.pos, PLAYER.radius);
      if (!input.blockHeld) {
        p.state = "idle";
        p.stateTime = 0;
        play(p.anim, ["Idle"], { fade: 0.12 });
      } else if (input.attackPressed) {
        startAttack(p, 0);
      }
      break;
    }

    case "attack": {
      // root motion-ish: slight forward drift sells the lunge
      p.vel.x = p.facing.x * 2.2;
      p.vel.z = p.facing.z * 2.2;
      moveCircle(p.pos, p.vel, dt, PLAYER.radius, room, barrels);
      roomMgr.clampAtClosedDoors(p.pos, PLAYER.radius);

      if (p.stateTime >= PLAYER.attackDuration) {
        if (input.attackBuffered > 0 && p.attackIndex === 0) {
          startAttack(p, 1);
          input.attackBuffered = 0;
        } else {
          p.state = "idle";
          p.stateTime = 0;
          play(p.anim, ["Idle"], { fade: 0.14 });
        }
      }
      break;
    }

    case "roll": {
      p.vel.x = p.facing.x * PLAYER.rollSpeed;
      p.vel.z = p.facing.z * PLAYER.rollSpeed;
      moveCircle(p.pos, p.vel, dt, PLAYER.radius, room, barrels);
      roomMgr.clampAtClosedDoors(p.pos, PLAYER.radius);
      if (p.stateTime >= PLAYER.rollDuration) {
        p.state = "idle";
        p.stateTime = 0;
        p.rollCooldown = PLAYER.rollCooldown;
        play(p.anim, ["Idle"], { fade: 0.1 });
      }
      break;
    }

    case "hurt": {
      // knockback decays
      p.vel.multiplyScalar(Math.max(0, 1 - 8 * dt));
      moveCircle(p.pos, p.vel, dt, PLAYER.radius, room, barrels);
      roomMgr.clampAtClosedDoors(p.pos, PLAYER.radius);
      if (p.stateTime >= 0.38) {
        p.state = "idle";
        p.stateTime = 0;
        play(p.anim, ["Idle"], { fade: 0.12 });
      }
      break;
    }
  }

  // face movement direction
  const targetAngle = Math.atan2(p.facing.x, p.facing.z);
  const cur = p.root.rotation.y;
  let diff = targetAngle - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  p.root.rotation.y = cur + diff * Math.min(1, PLAYER.turnLerp * dt);

  // invulnerability blink
  p.root.visible = p.invuln <= 0 || Math.floor(p.stateTime * 18) % 2 === 0;

  p.root.position.copy(p.pos);
  void fx;
  void events;
}

function startAttack(p: PlayerData, index: 0 | 1): void {
  p.state = "attack";
  p.stateTime = 0;
  p.attackIndex = index;
  p.attackDidHit.clear();
  const clip = ATTACK_CLIPS[index];
  const dur = clipDuration(p.anim, clip, 0.8);
  play(p.anim, clip, { loop: false, force: true, timeScale: dur / PLAYER.attackDuration, fade: 0.06 });
  sfx.swing();
}

function startRoll(p: PlayerData, dir: { x: number; z: number }): void {
  p.state = "roll";
  p.stateTime = 0;
  p.facing = { ...dir };
  const dur = clipDuration(p.anim, ["Dodge_Forward"], 0.6);
  play(p.anim, ["Dodge_Forward"], { loop: false, force: true, timeScale: dur / PLAYER.rollDuration, fade: 0.05 });
  sfx.roll();
}

/** True while the current sword swing's hit window is open. */
export function attackWindowOpen(p: PlayerData): boolean {
  return (
    p.state === "attack" &&
    p.stateTime >= PLAYER.attackHitStart &&
    p.stateTime <= PLAYER.attackHitEnd
  );
}

/** Is `target` inside the frontal sword arc? */
export function inSwordArc(p: PlayerData, target: THREE.Vector3, targetRadius: number): boolean {
  const dx = target.x - p.pos.x;
  const dz = target.z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > PLAYER.attackRange + targetRadius) return false;
  if (d < 1e-4) return true;
  const dot = (dx / d) * p.facing.x + (dz / d) * p.facing.z;
  return dot >= Math.cos(PLAYER.attackArc / 2);
}

export interface DamageResult {
  died: boolean;
  blocked: boolean;
}

/** Apply damage to the player from a world-space source position. */
export function damagePlayer(
  p: PlayerData,
  halfHearts: number,
  from: THREE.Vector3,
  fx: FxSystem,
  events: GameEvents,
): DamageResult {
  if (p.invuln > 0 || p.state === "roll" || p.state === "dead") {
    return { died: false, blocked: false };
  }

  // shield: absorb hits from the front while blocking
  if (p.state === "block") {
    const dx = from.x - p.pos.x;
    const dz = from.z - p.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const dot = (dx / d) * p.facing.x + (dz / d) * p.facing.z;
    if (dot > 0.25) {
      sfx.hitBlocked();
      fx.burst(new THREE.Vector3(p.pos.x + p.facing.x, 1.2, p.pos.z + p.facing.z), 0xcfd8ff, 6, { speed: 3, up: 2, life: 0.3 });
      p.invuln = 0.25;
      return { died: false, blocked: true };
    }
  }

  p.halfHearts = Math.max(0, p.halfHearts - halfHearts);
  p.invuln = PLAYER.hurtInvuln;
  events.onHudDirty();
  fx.burst(new THREE.Vector3(p.pos.x, 1.3, p.pos.z), 0xff5964, 10, { speed: 4, up: 3 });

  const dx = p.pos.x - from.x;
  const dz = p.pos.z - from.z;
  const d = Math.hypot(dx, dz) || 1;
  p.vel.set((dx / d) * PLAYER.knockback, 0, (dz / d) * PLAYER.knockback);

  if (p.halfHearts <= 0) {
    p.state = "dead";
    p.stateTime = 0;
    play(p.anim, ["Death_A", "Death_B"], { loop: false, force: true });
    sfx.gameOver();
    events.onGameOver();
    return { died: true, blocked: false };
  }

  p.state = "hurt";
  p.stateTime = 0;
  play(p.anim, ["Hit_A", "Hit_B"], { loop: false, force: true, fade: 0.05 });
  sfx.playerHurt();
  return { died: false, blocked: false };
}

export function reviveAtStart(p: PlayerData, start: THREE.Vector3): void {
  p.pos.copy(start);
  p.vel.set(0, 0, 0);
  p.halfHearts = PLAYER.respawnHalfHearts;
  p.state = "idle";
  p.stateTime = 0;
  p.invuln = 1.2;
  play(p.anim, ["Idle"], { force: true });
}

export function playerCheer(p: PlayerData): void {
  p.state = "cheer";
  p.stateTime = 0;
  p.vel.set(0, 0, 0);
  play(p.anim, ["Cheer"], { loop: true, force: true });
}
