import * as THREE from "three";
import { PICKUPS, PLAYER, PROPS } from "../config";
import { sfx } from "../engine/audio";
import { spawn } from "../engine/loader";
import { makeHeartMesh, type FxSystem } from "../art/fx";
import type { GameEvents, Pickup, PickupKind, PlayerData } from "../types";

// ---------------------------------------------------------------------------
// Pickups — hearts, coins, and the boss key. Once the player is inside the
// magnet range they suck in fast (satisfying Zelda-y collect). Coins/hearts
// despawn after a while; the boss key never does.
// ---------------------------------------------------------------------------

export class PickupSystem {
  pickups: Pickup[] = [];
  private scene: THREE.Scene;
  private fx: FxSystem;
  private events: GameEvents;

  constructor(scene: THREE.Scene, fx: FxSystem, events: GameEvents) {
    this.scene = scene;
    this.fx = fx;
    this.events = events;
  }

  spawn(kind: PickupKind, pos: THREE.Vector3, launchUp = 5): void {
    let mesh: THREE.Object3D;
    if (kind === "heart") {
      mesh = makeHeartMesh();
    } else if (kind === "coin") {
      mesh = spawn("coin", { castShadow: false });
      mesh.scale.setScalar(1.7);
    } else {
      mesh = spawn("key", { castShadow: false });
      mesh.scale.setScalar(1.4);
    }
    mesh.position.copy(pos);
    mesh.position.y = 0.5;
    this.scene.add(mesh);
    const a = Math.random() * Math.PI * 2;
    this.pickups.push({
      mesh,
      kind,
      pos: mesh.position.clone(),
      vel: new THREE.Vector3(Math.cos(a) * 3, launchUp, Math.sin(a) * 3),
      age: 0,
      dead: false,
    });
  }

  /** Called by the enemy system on death. */
  maybeDrop(pos: THREE.Vector3): void {
    if (Math.random() < PROPS.barrelDropHeart) this.spawn("heart", pos);
    else if (Math.random() < PROPS.barrelDropCoin) this.spawn("coin", pos);
  }

  update(dt: number, player: PlayerData): void {
    for (const p of this.pickups) {
      if (p.dead) continue;
      p.age += dt;

      // ballistic arc
      if (p.pos.y > 0.5 || p.vel.y > 0.01) {
        p.vel.y -= 22 * dt;
        p.pos.addScaledVector(p.vel, dt);
        if (p.pos.y < 0.5) {
          p.pos.y = 0.5;
          p.vel.set(0, 0, 0);
        }
      } else {
        // hover + magnet
        p.pos.y = 0.5 + Math.sin(p.age * PICKUPS.bobSpeed) * 0.15;
        if (p.kind !== "key" || player.hasBossKey === false) {
          const dx = player.pos.x - p.pos.x;
          const dz = player.pos.z - p.pos.z;
          const d = Math.hypot(dx, dz);
          if (d < PICKUPS.magnetRange && d > 0.01) {
            const s = PICKUPS.magnetSpeed * dt / d;
            p.pos.x += dx * s;
            p.pos.z += dz * s;
          }
        }
      }
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.y += dt * 3;

      // pick up
      const dx = player.pos.x - p.pos.x;
      const dz = player.pos.z - p.pos.z;
      if (dx * dx + dz * dz < (PLAYER.radius + 0.4) ** 2) {
        this.grab(p, player);
      } else if (p.age > PICKUPS.lifeTime && p.kind !== "key") {
        p.dead = true;
      }
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      if (this.pickups[i].dead) {
        this.scene.remove(this.pickups[i].mesh);
        this.pickups.splice(i, 1);
      }
    }
    void this.fx;
  }

  private grab(p: Pickup, player: PlayerData): void {
    p.dead = true;
    if (p.kind === "heart") {
      player.halfHearts = Math.min(PLAYER.maxHalfHearts, player.halfHearts + PICKUPS.heartHalfHearts);
      sfx.heart();
    } else if (p.kind === "coin") {
      player.coins += PICKUPS.coinValue;
      sfx.coin();
    } else {
      player.hasBossKey = true;
      sfx.key();
      this.events.onToast("Got the Boss Key!");
    }
    this.events.onHudDirty();
  }

  clearAll(): void {
    for (const p of this.pickups) this.scene.remove(p.mesh);
    this.pickups = [];
  }
}
