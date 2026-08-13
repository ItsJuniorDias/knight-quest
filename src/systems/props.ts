import * as THREE from "three";
import { PLAYER, PROPS } from "../config";
import { sfx } from "../engine/audio";
import type { FxSystem } from "../art/fx";
import { makeCrystalMesh } from "../art/fx";
import type { GameEvents, InputState, PlayerData } from "../types";
import { attackWindowOpen, inSwordArc, damagePlayer } from "./player";
import type { RoomManager } from "./rooms";
import type { PickupSystem } from "./pickups";

// ---------------------------------------------------------------------------
// Interactive props: barrels break to sword hits, chests open on interact,
// spike traps cycle up/down with a warning shudder before extending.
// ---------------------------------------------------------------------------

export class PropsSystem {
  private fx: FxSystem;
  private events: GameEvents;
  /** Set once the boss dies, spawns the victory crystal in the throne room. */
  victoryCrystal: THREE.Mesh | null = null;
  private crystalPickup = false;

  constructor(fx: FxSystem, events: GameEvents) {
    this.fx = fx;
    this.events = events;
  }

  update(dt: number, player: PlayerData, input: InputState, roomMgr: RoomManager, pickups: PickupSystem): void {
    const room = roomMgr.current;

    // ---- barrels ----------------------------------------------------------
    for (const b of room.barrels) {
      if (b.broken) continue;
      // touch damage none; broken via sword only
      if (attackWindowOpen(player) && !player.attackDidHit.has(-b.pos.x - b.pos.z * 999)) {
        const distSq = (b.pos.x - player.pos.x) ** 2 + (b.pos.z - player.pos.z) ** 2;
        if (distSq < (PLAYER.attackRange + b.radius) ** 2 && inSwordArc(player, b.pos, b.radius)) {
          player.attackDidHit.add(-b.pos.x - b.pos.z * 999);
          b.broken = true;
          b.root.visible = false;
          sfx.barrelBreak();
          this.fx.burst(new THREE.Vector3(b.pos.x, 0.8, b.pos.z), 0xa06b3a, 14, {
            speed: 5, up: 4, life: 0.7,
          });
          if (Math.random() < PROPS.barrelDropHeart) pickups.spawn("heart", b.pos);
          else if (Math.random() < PROPS.barrelDropCoin) pickups.spawn("coin", b.pos);
        }
      }
    }

    // ---- chests -----------------------------------------------------------
    for (const c of room.chests) {
      if (c.opened) {
        c.openT = Math.min(1, c.openT + dt / PROPS.chestOpenTime);
        if (c.lid) c.lid.rotation.x = -Math.PI * 0.42 * c.openT;
        continue;
      }
      const worldPos = new THREE.Vector3();
      c.root.getWorldPosition(worldPos);
      const d2 = (worldPos.x - player.pos.x) ** 2 + (worldPos.z - player.pos.z) ** 2;
      if (d2 < 3.6 && input.interactPressed) {
        c.opened = true;
        sfx.chest();
        const spawnAt = worldPos.clone(); spawnAt.y = 0.5;
        if (c.contents === "coins") {
          for (let i = 0; i < 5; i++) pickups.spawn("coin", spawnAt);
          this.events.onToast("+5 coins");
        } else if (c.contents === "heart") {
          pickups.spawn("heart", spawnAt);
        } else if (c.contents === "bosskey") {
          pickups.spawn("key", spawnAt, 6.5);
          this.events.onToast("The Boss Key!");
        }
        this.fx.burst(new THREE.Vector3(worldPos.x, 1.2, worldPos.z), 0xffd166, 18, { speed: 4, up: 3, life: 0.8 });
      }
    }

    // ---- spike traps ------------------------------------------------------
    for (const s of room.spikes) {
      s.phase += dt / PROPS.spikePeriod;
      const t = (s.phase % 1);
      const rising = t < 0.5;
      const localT = rising ? t / 0.5 : (1 - (t - 0.5) / 0.5);
      const y = -1.9 + localT * 1.9;
      if (s.spikes) s.spikes.position.y = y;
      const nowUp = y > 0.4;
      if (nowUp && !s.up) sfx.spikes();
      s.up = nowUp;
      if (nowUp) {
        const d2 = (s.pos.x - player.pos.x) ** 2 + (s.pos.z - player.pos.z) ** 2;
        if (d2 < 3.6) damagePlayer(player, PROPS.spikeDamage, s.pos, this.fx, this.events);
      }
    }

    // ---- victory crystal (post-boss) --------------------------------------
    if (this.victoryCrystal && !this.crystalPickup) {
      this.victoryCrystal.rotation.y += dt * 1.4;
      this.victoryCrystal.position.y = 1.4 + Math.sin(performance.now() * 0.003) * 0.15;
      const d2 = (this.victoryCrystal.position.x - player.pos.x) ** 2 + (this.victoryCrystal.position.z - player.pos.z) ** 2;
      if (d2 < 4) {
        this.crystalPickup = true;
        this.events.onVictory();
      }
    }
  }

  spawnVictoryCrystal(scene: THREE.Scene, pos: THREE.Vector3): void {
    const c = makeCrystalMesh();
    c.position.copy(pos);
    c.position.y = 1.4;
    scene.add(c);
    this.victoryCrystal = c;
  }
}
