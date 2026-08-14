import * as THREE from "three";
import { BOSS, ENEMIES, PLAYER } from "../config";
import { sfx } from "../engine/audio";
import { makeBoltMesh, makeShockwaveMesh, type FxSystem } from "../art/fx";
import type { GameEvents, PlayerData, Projectile } from "../types";
import { damagePlayer } from "./player";
import type { RoomManager } from "./rooms";
import type { EnemySystem } from "./enemies";
import type { BossSystem } from "./boss";
import type { PickupSystem } from "./pickups";

// ---------------------------------------------------------------------------
// Projectiles: mage bolts + boss ground-slam shockwaves + v8 player spells.
// All travel in the XZ plane and are killed by walls, players/enemies, or
// expiry. `friendly` flag flips the target: friendly hits ENEMIES/BOSSES,
// hostile hits the PLAYER.
// ---------------------------------------------------------------------------

export class ProjectileSystem {
  projectiles: Projectile[] = [];
  private scene: THREE.Scene;
  private fx: FxSystem;
  private events: GameEvents;

  constructor(scene: THREE.Scene, fx: FxSystem, events: GameEvents) {
    this.scene = scene;
    this.fx = fx;
    this.events = events;
  }

  spawnBolt(origin: THREE.Vector3, direction: THREE.Vector3): void {
    const mesh = makeBoltMesh();
    mesh.position.copy(origin);
    this.scene.add(mesh);
    sfx.bolt();
    const cfg = ENEMIES.mage;
    this.projectiles.push({
      mesh,
      pos: origin.clone(),
      vel: new THREE.Vector3(direction.x, 0, direction.z).normalize().multiplyScalar(cfg.boltSpeed),
      radius: cfg.boltRadius,
      damage: cfg.boltDamage,
      life: 3,
      kind: "bolt",
      dead: false,
    });
  }

  /**
   * v8: shockwave with optional `friendly` flag. Player spells (bone_shockwave)
   * pass friendly=true so it damages enemies/bosses instead of the player.
   */
  spawnShockwave(origin: THREE.Vector3, friendly = false): void {
    const dirs = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
    ];
    for (const d of dirs) {
      const mesh = makeShockwaveMesh();
      mesh.position.copy(origin);
      mesh.position.y = 0.25;
      if (friendly) {
        (mesh as THREE.Mesh & { material: THREE.MeshBasicMaterial }).material.color.setHex(0xffd166);
      }
      this.scene.add(mesh);
      this.projectiles.push({
        mesh,
        pos: origin.clone(),
        vel: d.clone().multiplyScalar(BOSS.shockwaveSpeed),
        radius: BOSS.shockwaveWidth,
        damage: friendly ? 3 : BOSS.shockwaveDamage,
        life: 1.4,
        kind: friendly ? "friendly_shockwave" : "shockwave",
        dead: false,
        friendly,
      });
    }
  }

  /**
   * v8: Player spell projectiles. Each spell picks its own visual + speed.
   * All are marked friendly so hostile collision is skipped.
   */
  spawnPlayerBolt(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    kind: "ice_shard" | "fireball" | "chain_lightning",
  ): void {
    const spec = {
      ice_shard: { color: 0x88e0ff, speed: 14, damage: 3, radius: 0.5, life: 2.0 },
      fireball: { color: 0xff9040, speed: 11, damage: 4, radius: 0.7, life: 2.2 },
      chain_lightning: { color: 0xa0c8ff, speed: 20, damage: 2, radius: 0.4, life: 1.0 },
    }[kind];
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(spec.radius, 10, 8),
      new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.9 }),
    );
    mesh.position.copy(origin);
    // outer glow ring
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(spec.radius * 1.5, 10, 8),
      new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.3 }),
    );
    mesh.add(glow);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      pos: origin.clone(),
      vel: new THREE.Vector3(direction.x, 0, direction.z).normalize().multiplyScalar(spec.speed),
      radius: spec.radius,
      damage: spec.damage,
      life: spec.life,
      kind,
      dead: false,
      friendly: true,
    });
  }

  /**
   * v8: Void Rift — a growing dark ring around the player. Purely cosmetic;
   * damage is applied instantly by the SpellSystem, this just draws the ring.
   */
  spawnVoidRing(origin: THREE.Vector3, color = 0x8a2be2): void {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.15, 8, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(origin.x, 0.4, origin.z);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      pos: origin.clone(),
      vel: new THREE.Vector3(),
      radius: 0.5,
      damage: 0, // damage already dealt by SpellSystem
      life: 0.6,
      kind: "void_ring",
      dead: false,
      friendly: true,
    });
  }

  update(
    dt: number,
    player: PlayerData,
    roomMgr: RoomManager,
    enemies?: EnemySystem,
    boss?: BossSystem,
    pickups?: PickupSystem,
  ): void {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.life -= dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      if (p.kind === "shockwave" || p.kind === "friendly_shockwave") {
        p.mesh.scale.setScalar(1 + (1.4 - p.life) * 0.9);
        (p.mesh as THREE.Mesh & { material: THREE.MeshBasicMaterial }).material.opacity = Math.max(0, p.life / 1.4);
      } else if (p.kind === "void_ring") {
        // grow from 0.5 to ~4.5 over its life
        const t = 1 - p.life / 0.6;
        p.mesh.scale.setScalar(1 + t * 8);
        (p.mesh as THREE.Mesh & { material: THREE.MeshBasicMaterial }).material.opacity = 0.85 * (1 - t);
      } else {
        p.mesh.rotation.y += dt * 12;
        p.mesh.rotation.x += dt * 8;
      }

      if (!p.friendly) {
        // hostile projectiles hit the player
        const dx = player.pos.x - p.pos.x;
        const dz = player.pos.z - p.pos.z;
        const min = p.radius + PLAYER.radius;
        if (dx * dx + dz * dz < min * min) {
          damagePlayer(player, p.damage, p.pos, this.fx, this.events);
          this.fx.burst(new THREE.Vector3(p.pos.x, 1, p.pos.z), 0xb45cff, 8, { speed: 3, up: 2 });
          if (p.kind === "bolt") p.dead = true;
        }
      } else if (enemies && pickups) {
        // v8: friendly projectiles hit enemies (except void_ring which is
        // cosmetic — its damage already applied)
        if (p.kind !== "void_ring") {
          for (const e of enemies.enemies) {
            if (e.dead || e.roomKey !== roomMgr.current.key) continue;
            const dx = e.pos.x - p.pos.x;
            const dz = e.pos.z - p.pos.z;
            const min = p.radius + 0.6;
            if (dx * dx + dz * dz < min * min) {
              enemies.hurtEnemy(e, p.damage, p.pos, pickups);
              this.fx.burst(new THREE.Vector3(p.pos.x, 1, p.pos.z),
                (p.mesh as THREE.Mesh & { material: THREE.MeshBasicMaterial }).material.color.getHex(),
                10, { speed: 4, up: 2 });
              if (p.kind === "ice_shard" || p.kind === "chain_lightning") p.dead = true;
              if (p.kind === "fireball") {
                // splash damage in 2m radius, then die
                for (const e2 of enemies.enemies) {
                  if (e2 === e || e2.dead || e2.roomKey !== roomMgr.current.key) continue;
                  const dd = Math.hypot(e2.pos.x - p.pos.x, e2.pos.z - p.pos.z);
                  if (dd < 2.0) enemies.hurtEnemy(e2, Math.ceil(p.damage / 2), p.pos, pickups);
                }
                this.fx.burst(p.pos.clone(), 0xff9040, 25, { speed: 6, up: 3, life: 0.7, scale: 1.2 });
                p.dead = true;
              }
              break;
            }
          }
          // friendly shockwave — also damages bosses
          if (boss && !p.dead) {
            for (const b of boss.bosses) {
              if (b.dead || b.roomKey !== roomMgr.current.key) continue;
              const dx = b.pos.x - p.pos.x;
              const dz = b.pos.z - p.pos.z;
              const min = p.radius + 1.2;
              if (dx * dx + dz * dz < min * min) {
                boss.spellHit(b, p.damage);
                this.fx.burst(p.pos.clone(), 0xffd166, 10, { speed: 4, up: 2 });
                if (p.kind === "ice_shard" || p.kind === "chain_lightning") p.dead = true;
                if (p.kind === "fireball") {
                  this.fx.burst(p.pos.clone(), 0xff9040, 25, { speed: 6, up: 3, life: 0.7, scale: 1.2 });
                  p.dead = true;
                }
                break;
              }
            }
          }
        }
      }

      // wall hit
      const room = roomMgr.current;
      const tx = Math.floor((p.pos.x - room.origin.x) / 4);
      const tz = Math.floor((p.pos.z - room.origin.z) / 4);
      if (tx < 0 || tz < 0 || tx >= 15 || tz >= 13 || room.solid[tz]?.[tx]) {
        if (p.kind === "bolt" || p.kind === "ice_shard" || p.kind === "chain_lightning") p.dead = true;
        if (p.kind === "fireball") {
          this.fx.burst(p.pos.clone(), 0xff9040, 20, { speed: 5, up: 3, life: 0.6 });
          p.dead = true;
        }
      }
      if (p.life <= 0) p.dead = true;
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i].dead) {
        this.scene.remove(this.projectiles[i].mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  clearAll(): void {
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles = [];
  }
}
