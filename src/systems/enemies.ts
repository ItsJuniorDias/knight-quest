import * as THREE from "three";
import { ENEMIES, PLAYER } from "../config";
import { buildAnimSet, clipDuration, play } from "../engine/anim";
import { sfx } from "../engine/audio";
import { findNode, spawn } from "../engine/loader";
import { getAnimations } from "../engine/loader";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { flash, type FxSystem } from "../art/fx";
import type { EnemyData, EnemyKind, GameEvents, PlayerData, RoomRuntime } from "../types";
import { attackWindowOpen, damagePlayer, inSwordArc, isHeavyAttack } from "./player";
import { dist2, moveCircle, separate } from "./physics";
import type { RoomManager } from "./rooms";
import type { ProjectileSystem } from "./projectiles";
import type { PickupSystem } from "./pickups";

// ---------------------------------------------------------------------------
// Skeletons.
//
// Three flavors of undead, all rising from the dungeon floor when the doors
// slam shut (Skeletons_Awaken_Floor — the pack literally ships the Stalfos
// intro):
//   minion — walks at you, telegraphed sword swing
//   rogue  — darts in, stabs, darts away
//   mage   — keeps distance, lobs magic bolts
// ---------------------------------------------------------------------------

const ASSET_BY_KIND: Record<EnemyKind, "skeleton_minion" | "skeleton_rogue" | "skeleton_mage"> = {
  minion: "skeleton_minion",
  rogue: "skeleton_rogue",
  mage: "skeleton_mage",
};

let nextId = 1;

// weapon glTFs load once, then get cloned onto hand bones
const weaponCache = new Map<string, THREE.Group>();

export async function preloadWeapons(): Promise<void> {
  const loader = new GLTFLoader();
  const files: [string, string][] = [
    ["blade", "assets/characters/Skeleton_Blade.gltf"],
    ["staff", "assets/characters/Skeleton_Staff.gltf"],
    ["axe", "assets/characters/Skeleton_Axe.gltf"],
  ];
  for (const [key, url] of files) {
    const gltf: GLTF = await loader.loadAsync(url);
    weaponCache.set(key, gltf.scene);
  }
}

export function attachWeapon(root: THREE.Object3D, weapon: "blade" | "staff" | "axe", scale = 1): void {
  const cached = weaponCache.get(weapon);
  if (!cached) return;
  const slot = findNode(root, "handslot.r");
  if (!slot) return;
  const w = cached.clone(true);
  w.scale.setScalar(scale);
  slot.add(w);
}

export class EnemySystem {
  enemies: EnemyData[] = [];
  private scene: THREE.Scene;
  private fx: FxSystem;
  private events: GameEvents;

  constructor(scene: THREE.Scene, fx: FxSystem, events: GameEvents) {
    this.scene = scene;
    this.fx = fx;
    this.events = events;
  }

  spawnRoomEnemies(room: RoomRuntime, origin: { tileCenter: (tx: number, tz: number) => THREE.Vector3 }): void {
    for (const s of room.enemySpawns) {
      const pos = origin.tileCenter(s.tx, s.tz);
      this.spawnEnemy(s.kind, pos, room.key);
    }
    if (room.enemySpawns.length > 0) sfx.awaken();
  }

  spawnEnemy(kind: EnemyKind, pos: THREE.Vector3, roomKey: string): EnemyData {
    const root = spawn(ASSET_BY_KIND[kind], { castShadow: true });
    root.position.copy(pos);
    this.scene.add(root);
    attachWeapon(root, kind === "mage" ? "staff" : "blade");

    const anim = buildAnimSet(root, getAnimations(ASSET_BY_KIND[kind]));
    const e: EnemyData = {
      id: nextId++,
      kind,
      root,
      anim,
      state: "awaken",
      stateTime: 0,
      pos: pos.clone(),
      vel: new THREE.Vector3(),
      facing: { x: 0, z: 1 },
      hp: ENEMIES[kind].hp,
      roomKey,
      didHitPlayer: false,
      castCooldown: 1 + Math.random(),
      dead: false,
    };
    const awakenDur = clipDuration(anim, ["Skeletons_Awaken_Floor"], 1.4);
    play(anim, ["Skeletons_Awaken_Floor", "Skeletons_Awaken_Standing"], {
      loop: false,
      force: true,
      timeScale: awakenDur / ENEMIES.awakenTime,
    });
    this.enemies.push(e);
    return e;
  }

  countAliveInRoom(roomKey: string): number {
    return this.enemies.filter((e) => e.roomKey === roomKey && !e.dead).length;
  }

  update(dt: number, player: PlayerData, roomMgr: RoomManager, projectiles: ProjectileSystem, pickups: PickupSystem): void {
    const room = roomMgr.current;
    for (const e of this.enemies) {
      if (e.dead) continue;
      // v11: skip mixer/state update entirely when the enemy is in another
      // room. They're invisible via the room-visibility cull anyway, so
      // ticking their skeleton mixer just burns CPU for no gain.
      if (e.roomKey !== room.key) continue;
      e.stateTime += dt;
      e.anim.mixer.update(dt);

      const cfg = ENEMIES[e.kind];
      const toPlayer = new THREE.Vector3().subVectors(player.pos, e.pos);
      const dist = Math.hypot(toPlayer.x, toPlayer.z);
      const dirX = dist > 1e-4 ? toPlayer.x / dist : 0;
      const dirZ = dist > 1e-4 ? toPlayer.z / dist : 1;
      const barrels = room.barrels.filter((b) => !b.broken);

      switch (e.state) {
        case "awaken": {
          if (e.stateTime >= ENEMIES.awakenTime) {
            this.setState(e, "chase");
          }
          break;
        }
        case "idle":
        case "chase": {
          e.facing.x = dirX;
          e.facing.z = dirZ;
          if (e.kind === "mage") {
            this.updateMage(e, dt, dist, dirX, dirZ, player, room, barrels, projectiles);
            break;
          }
          const speed = cfg.speed;
          e.vel.x = dirX * speed;
          e.vel.z = dirZ * speed;
          moveCircle(e.pos, e.vel, dt, cfg.radius, room, barrels);
          play(e.anim, ["Walking_D_Skeletons", "Walking_A", "Running_A"], { fade: 0.2 });
          const range = (cfg as { attackRange?: number }).attackRange ?? 2;
          if (dist <= range) {
            this.setState(e, "windup");
            play(e.anim, ["Idle_Combat", "Idle"], { fade: 0.08 });
          }
          break;
        }
        case "windup": {
          e.facing.x = dirX;
          e.facing.z = dirZ;
          const windup = (cfg as { attackWindup?: number }).attackWindup ?? 0.3;
          if (e.stateTime >= windup) {
            this.setState(e, "attack");
            e.didHitPlayer = false;
            const clips = e.kind === "rogue"
              ? ["1H_Melee_Attack_Stab", "1H_Melee_Attack_Slice_Diagonal"]
              : ["1H_Melee_Attack_Slice_Horizontal", "1H_Melee_Attack_Chop"];
            const attackDur = (cfg as { attackDuration?: number }).attackDuration ?? 0.5;
            const cd = clipDuration(e.anim, clips, 0.8);
            play(e.anim, clips, { loop: false, force: true, timeScale: cd / attackDur });
          }
          break;
        }
        case "attack": {
          const acfg = cfg as { attackDuration: number; hitStart: number; hitEnd: number; attackDamage: number; attackRange: number };
          // lunge forward slightly
          e.vel.x = e.facing.x * 3;
          e.vel.z = e.facing.z * 3;
          moveCircle(e.pos, e.vel, dt, cfg.radius, room, barrels);
          const inWindow = e.stateTime >= acfg.hitStart && e.stateTime <= acfg.hitEnd;
          if (inWindow && !e.didHitPlayer && dist < acfg.attackRange + PLAYER.radius + 0.4) {
            const dot = dirX * e.facing.x + dirZ * e.facing.z;
            if (dot > 0.2) {
              e.didHitPlayer = true;
              damagePlayer(player, acfg.attackDamage, e.pos, this.fx, this.events);
            }
          }
          if (e.stateTime >= acfg.attackDuration) {
            if (e.kind === "rogue") this.setState(e, "retreat");
            else this.setState(e, "chase");
          }
          break;
        }
        case "retreat": {
          const rcfg = cfg as { retreatTime: number; speed: number };
          e.vel.x = -dirX * rcfg.speed * 1.15;
          e.vel.z = -dirZ * rcfg.speed * 1.15;
          e.facing.x = dirX;
          e.facing.z = dirZ;
          moveCircle(e.pos, e.vel, dt, cfg.radius, room, barrels);
          play(e.anim, ["Walking_Backwards", "Walking_A"], { fade: 0.15 });
          if (e.stateTime >= rcfg.retreatTime) this.setState(e, "chase");
          break;
        }
        case "cast": {
          const mcfg = ENEMIES.mage;
          e.facing.x = dirX;
          e.facing.z = dirZ;
          if (e.stateTime >= mcfg.castTime) {
            const origin = e.pos.clone();
            origin.y = 1.4;
            projectiles.spawnBolt(origin, new THREE.Vector3(dirX, 0, dirZ));
            e.castCooldown = mcfg.castCooldown;
            this.setState(e, "chase");
          }
          break;
        }
        case "hurt": {
          e.vel.multiplyScalar(Math.max(0, 1 - 7 * dt));
          moveCircle(e.pos, e.vel, dt, cfg.radius, room, barrels);
          if (e.stateTime >= 0.3) this.setState(e, "chase");
          break;
        }
        case "dying": {
          if (e.stateTime >= 1.1) {
            e.dead = true;
            this.scene.remove(e.root);
            const alive = this.countAliveInRoom(room.key);
            if (alive === 0 && !room.hasBoss) {
              roomMgr.clearRoom(room);
            }
          }
          break;
        }
      }

      // separation so skeletons don't stack
      for (const other of this.enemies) {
        if (other === e || other.dead || other.roomKey !== room.key) continue;
        separate(
          { pos: e.pos, radius: cfg.radius },
          { pos: other.pos, radius: ENEMIES[other.kind].radius },
        );
      }
      if (e.state !== "dying") {
        // touch damage
        if (dist < cfg.radius + PLAYER.radius + 0.05 && e.state !== "awaken") {
          damagePlayer(player, (cfg as { touchDamage: number }).touchDamage, e.pos, this.fx, this.events);
        }
        // player sword
        if (attackWindowOpen(player) && !player.attackDidHit.has(e.id) && e.state !== "awaken") {
          if (inSwordArc(player, e.pos, cfg.radius)) {
            player.attackDidHit.add(e.id);
            // v5: heavy strike scales damage + knockback; sharpBlade adds +1
            const isHeavy = isHeavyAttack(player);
            let dmg = isHeavy ? PLAYER.heavyAttackDamage : PLAYER.attackDamage;
            if (player.upgrades?.sharpBlade) dmg += 1;
            this.hurtEnemy(e, dmg, player.pos, pickups, isHeavy ? PLAYER.heavyKnockbackMul : 1);
            this.events.onSwordHit("enemy", e.pos);
          }
        }
      }

      // face movement dir
      const ang = Math.atan2(e.facing.x, e.facing.z);
      let diff = ang - e.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      e.root.rotation.y += diff * Math.min(1, 10 * dt);
      e.root.position.copy(e.pos);
    }

    // prune dead
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  private updateMage(
    e: EnemyData,
    dt: number,
    dist: number,
    dirX: number,
    dirZ: number,
    player: PlayerData,
    room: RoomRuntime,
    barrels: { pos: THREE.Vector3; radius: number }[],
    projectiles: ProjectileSystem,
  ): void {
    const cfg = ENEMIES.mage;
    e.castCooldown -= dt;
    const tooClose = dist < cfg.preferredRange * 0.7;
    const tooFar = dist > cfg.preferredRange * 1.25;
    if (tooClose) {
      e.vel.x = -dirX * cfg.speed;
      e.vel.z = -dirZ * cfg.speed;
      play(e.anim, ["Walking_Backwards", "Walking_A"], { fade: 0.2 });
    } else if (tooFar) {
      e.vel.x = dirX * cfg.speed;
      e.vel.z = dirZ * cfg.speed;
      play(e.anim, ["Walking_D_Skeletons", "Walking_A"], { fade: 0.2 });
    } else {
      e.vel.set(0, 0, 0);
      play(e.anim, ["Idle_Combat", "Idle"], { fade: 0.2 });
      if (e.castCooldown <= 0) {
        this.setState(e, "cast");
        const castDur = clipDuration(e.anim, ["Spellcast_Shoot"], 1);
        play(e.anim, ["Spellcast_Shoot", "Spellcast_Long", "1H_Ranged_Shoot"], {
          loop: false,
          force: true,
          timeScale: castDur / cfg.castTime,
        });
        return;
      }
    }
    moveCircle(e.pos, e.vel, dt, cfg.radius, room, barrels);
    void player;
  }

  private setState(e: EnemyData, s: EnemyData["state"]): void {
    e.state = s;
    e.stateTime = 0;
  }

  hurtEnemy(e: EnemyData, dmg: number, from: THREE.Vector3, pickups: PickupSystem, knockbackMul = 1): void {
    if (e.state === "dying") return;
    e.hp -= dmg;
    flash(e.root, performance.now() / 1000);
    sfx.hitEnemy();
    this.fx.burst(new THREE.Vector3(e.pos.x, 1.2, e.pos.z), 0xfff1c9, 8, { speed: 4.5, up: 2.5, life: 0.4 });

    const dx = e.pos.x - from.x;
    const dz = e.pos.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    const kb = 7.5 * knockbackMul;
    e.vel.set((dx / d) * kb, 0, (dz / d) * kb);

    if (e.hp <= 0) {
      this.setState(e, "dying");
      play(e.anim, ["Death_A", "Death_B"], { loop: false, force: true });
      sfx.enemyDie();
      this.fx.burst(new THREE.Vector3(e.pos.x, 0.8, e.pos.z), 0xcfd2e8, 14, { speed: 5, up: 4, life: 0.6 });
      pickups.maybeDrop(e.pos);
    } else {
      this.setState(e, "hurt");
      play(e.anim, ["Hit_A", "Hit_B"], { loop: false, force: true, fade: 0.04 });
    }
  }

  /** Remove every enemy (used on player respawn). */
  clearAll(): void {
    for (const e of this.enemies) this.scene.remove(e.root);
    this.enemies = [];
  }
}
