import * as THREE from "three";
import { BOSS, ENEMIES, PLAYER } from "../config";
import { sfx } from "../engine/audio";
import { makeBoltMesh, makeShockwaveMesh, type FxSystem } from "../art/fx";
import type { GameEvents, PlayerData, Projectile } from "../types";
import { damagePlayer } from "./player";
import type { RoomManager } from "./rooms";

// ---------------------------------------------------------------------------
// Projectiles: mage bolts + boss ground-slam shockwaves. Both travel in the
// XZ plane and are killed by walls, players, or expiry.
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

  spawnShockwave(origin: THREE.Vector3): void {
    // spawn 4 shockwave rings, one in each cardinal direction
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
      this.scene.add(mesh);
      this.projectiles.push({
        mesh,
        pos: origin.clone(),
        vel: d.clone().multiplyScalar(BOSS.shockwaveSpeed),
        radius: BOSS.shockwaveWidth,
        damage: BOSS.shockwaveDamage,
        life: 1.4,
        kind: "shockwave",
        dead: false,
      });
    }
  }

  update(dt: number, player: PlayerData, roomMgr: RoomManager): void {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.life -= dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      if (p.kind === "shockwave") {
        p.mesh.scale.setScalar(1 + (1.4 - p.life) * 0.9);
        (p.mesh as THREE.Mesh & { material: THREE.MeshBasicMaterial }).material.opacity = Math.max(0, p.life / 1.4);
      } else {
        p.mesh.rotation.y += dt * 12;
      }
      // player hit
      const dx = player.pos.x - p.pos.x;
      const dz = player.pos.z - p.pos.z;
      const min = p.radius + PLAYER.radius;
      if (dx * dx + dz * dz < min * min) {
        damagePlayer(player, p.damage, p.pos, this.fx, this.events);
        this.fx.burst(new THREE.Vector3(p.pos.x, 1, p.pos.z), 0xb45cff, 8, { speed: 3, up: 2 });
        if (p.kind === "bolt") p.dead = true;
      }
      // wall hit
      const room = roomMgr.current;
      const tx = Math.floor((p.pos.x - room.origin.x) / 4);
      const tz = Math.floor((p.pos.z - room.origin.z) / 4);
      if (tx < 0 || tz < 0 || tx >= 9 || tz >= 7 || room.solid[tz]?.[tx]) {
        if (p.kind === "bolt") p.dead = true;
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
