import * as THREE from "three";
import { BOSS, PLAYER } from "../config";
import { buildAnimSet, clipDuration, play } from "../engine/anim";
import { sfx } from "../engine/audio";
import { getAnimations, spawn } from "../engine/loader";
import { flash, type FxSystem } from "../art/fx";
import { attachWeapon } from "./enemies";
import type { BossData, GameEvents, PlayerData } from "../types";
import { attackWindowOpen, damagePlayer, inSwordArc } from "./player";
import { moveCircle } from "./physics";
import type { RoomManager } from "./rooms";
import type { ProjectileSystem } from "./projectiles";
import type { PropsSystem } from "./props";

// ---------------------------------------------------------------------------
// The Skeleton Warrior — final boss of the Throne of Bones.
//
// State machine:
//   waiting        (player hasn't entered the room yet)
//   awaken         (rises from the floor with a roar)
//   chase          → picks spin (close) or jump-chop (far)
//   spinWindup     → spin (radial hitbox)
//   chopWindup     → chopLeap → chopLand (spawns 4 shockwaves)
//   taunt          (every N attacks — opening to punish)
//   recover        (cooldown between attacks)
//   hurt / dying
//
// Enrages under 45% HP: faster movement, shorter recovery.
// ---------------------------------------------------------------------------

export class BossSystem {
  boss: BossData | null = null;
  private scene: THREE.Scene;
  private fx: FxSystem;
  private events: GameEvents;

  constructor(scene: THREE.Scene, fx: FxSystem, events: GameEvents) {
    this.scene = scene;
    this.fx = fx;
    this.events = events;
  }

  spawn(pos: THREE.Vector3): void {
    const root = spawn("skeleton_warrior", { castShadow: true });
    root.position.copy(pos);
    root.scale.setScalar(BOSS.scale);
    this.scene.add(root);
    attachWeapon(root, "axe", BOSS.scale);
    const anim = buildAnimSet(root, getAnimations("skeleton_warrior"));
    play(anim, ["Skeletons_Inactive_Floor_Pose"], { loop: false, force: true });
    this.boss = {
      root, anim,
      state: "waiting", stateTime: 0,
      pos: pos.clone(), vel: new THREE.Vector3(),
      facing: { x: 0, z: 1 },
      hp: BOSS.hp,
      attacksSinceTaunt: 0,
      didHitPlayer: false,
      leapFrom: new THREE.Vector3(), leapTo: new THREE.Vector3(),
      active: false, dead: false,
    };
  }

  /** Called when the player first enters the throne room. */
  wake(): void {
    if (!this.boss || this.boss.active) return;
    this.boss.active = true;
    this.setState("awaken");
    sfx.bossRoar();
    play(this.boss.anim, ["Skeletons_Awaken_Floor", "Skeletons_Awaken_Standing"], {
      loop: false, force: true,
    });
    this.events.onBossBar(1);
    this.events.onToast("Skeleton Warrior awakens!");
  }

  update(
    dt: number,
    player: PlayerData,
    roomMgr: RoomManager,
    projectiles: ProjectileSystem,
    props: PropsSystem,
  ): void {
    const b = this.boss;
    if (!b || b.dead) return;
    b.stateTime += dt;
    b.anim.mixer.update(dt);

    // wake when player enters the throne room
    if (b.state === "waiting" && roomMgr.current.hasBoss) {
      // seal the room by dropping the (open) south gate is not needed —
      // rooms.ts already runs the combat lock on entry
      this.wake();
    }
    if (b.state === "waiting") return;

    const enraged = b.hp / BOSS.hp <= BOSS.enrageAtHpFrac;
    const speedMul = enraged ? BOSS.enrageSpeedMul : 1;
    const recoverMul = enraged ? BOSS.enrageRecoverMul : 1;

    const toPlayer = new THREE.Vector3().subVectors(player.pos, b.pos);
    const dist = Math.hypot(toPlayer.x, toPlayer.z);
    const dirX = dist > 1e-4 ? toPlayer.x / dist : 0;
    const dirZ = dist > 1e-4 ? toPlayer.z / dist : 1;

    switch (b.state) {
      case "awaken": {
        if (b.stateTime >= 1.6) this.setState("chase");
        break;
      }
      case "chase": {
        b.facing.x = dirX; b.facing.z = dirZ;
        b.vel.x = dirX * BOSS.speed * speedMul;
        b.vel.z = dirZ * BOSS.speed * speedMul;
        moveCircle(b.pos, b.vel, dt, BOSS.radius, roomMgr.current);
        play(b.anim, ["Walking_D_Skeletons", "Walking_A", "Running_A"], { fade: 0.2 });
        if (dist <= BOSS.spinRange) {
          this.setState("spinWindup");
          play(b.anim, ["Idle_Combat", "Idle"], { fade: 0.1 });
        } else if (dist <= BOSS.chopRange && b.stateTime > 0.7) {
          this.setState("chopWindup");
          play(b.anim, ["Idle_Combat", "Idle"], { fade: 0.1 });
        }
        break;
      }
      case "spinWindup": {
        b.facing.x = dirX; b.facing.z = dirZ;
        if (b.stateTime >= BOSS.spinWindup) {
          this.setState("spin");
          b.didHitPlayer = false;
          const dur = clipDuration(b.anim, ["2H_Melee_Attack_Spinning", "2H_Melee_Attack_Spin"], 1);
          play(b.anim, ["2H_Melee_Attack_Spinning", "2H_Melee_Attack_Spin"], {
            loop: false, force: true, timeScale: dur / BOSS.spinDuration,
          });
        }
        break;
      }
      case "spin": {
        b.root.rotation.y += dt * 14; // spin visual
        // radial hitbox live for the middle of the swing
        if (b.stateTime > 0.25 && b.stateTime < BOSS.spinDuration - 0.15 && !b.didHitPlayer) {
          if (dist < BOSS.spinRadius) {
            b.didHitPlayer = true;
            damagePlayer(player, BOSS.spinDamage, b.pos, this.fx, this.events);
          }
        }
        if (b.stateTime >= BOSS.spinDuration) {
          b.attacksSinceTaunt++;
          this.enterRecover(recoverMul);
        }
        break;
      }
      case "chopWindup": {
        b.facing.x = dirX; b.facing.z = dirZ;
        if (b.stateTime >= BOSS.chopWindup) {
          this.setState("chopLeap");
          b.leapFrom.copy(b.pos);
          b.leapTo.copy(player.pos);
          const dur = clipDuration(b.anim, ["1H_Melee_Attack_Jump_Chop", "Jump_Full_Long"], 0.8);
          play(b.anim, ["1H_Melee_Attack_Jump_Chop", "Jump_Full_Long"], {
            loop: false, force: true, timeScale: dur / BOSS.chopLeapTime,
          });
        }
        break;
      }
      case "chopLeap": {
        const t = Math.min(1, b.stateTime / BOSS.chopLeapTime);
        b.pos.lerpVectors(b.leapFrom, b.leapTo, t);
        b.root.position.y = Math.sin(t * Math.PI) * 3;
        if (t >= 1) {
          b.root.position.y = 0;
          this.setState("chopLand");
          sfx.bossRoar();
          projectiles.spawnShockwave(b.pos.clone());
          this.fx.burst(new THREE.Vector3(b.pos.x, 0.5, b.pos.z), 0xffd166, 22, {
            speed: 6, up: 3, life: 0.6,
          });
          // direct hit if still under him
          const d2 = (player.pos.x - b.pos.x) ** 2 + (player.pos.z - b.pos.z) ** 2;
          if (d2 < 6) damagePlayer(player, BOSS.chopDamage, b.pos, this.fx, this.events);
        }
        break;
      }
      case "chopLand": {
        if (b.stateTime >= 0.35) {
          b.attacksSinceTaunt++;
          this.enterRecover(recoverMul);
        }
        break;
      }
      case "taunt": {
        if (b.stateTime >= 1.3) this.setState("chase");
        break;
      }
      case "recover": {
        if (b.stateTime >= BOSS.recoverTime * recoverMul) {
          if (b.attacksSinceTaunt >= BOSS.tauntEvery) {
            b.attacksSinceTaunt = 0;
            this.setState("taunt");
            play(b.anim, ["Taunt_Longer", "Taunt"], { loop: false, force: true });
          } else {
            this.setState("chase");
          }
        }
        break;
      }
      case "hurt": {
        b.vel.multiplyScalar(Math.max(0, 1 - 6 * dt));
        moveCircle(b.pos, b.vel, dt, BOSS.radius, roomMgr.current);
        if (b.stateTime >= 0.28) this.setState("chase");
        break;
      }
      case "dying": {
        if (b.stateTime >= 1.6 && !b.dead) {
          b.dead = true;
          this.scene.remove(b.root);
          this.events.onBossBar(null);
          roomMgr.current.cleared = true;
          props.spawnVictoryCrystal(this.scene, b.pos.clone());
          this.events.onToast("The Skeleton Warrior falls!");
        }
        break;
      }
    }

    // face target smoothly
    const ang = Math.atan2(b.facing.x, b.facing.z);
    let diff = ang - b.root.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    b.root.rotation.y += diff * Math.min(1, 6 * dt);
    b.root.position.x = b.pos.x;
    b.root.position.z = b.pos.z;

    // touch damage — only while chasing (avoids double-hitting during attacks)
    if (b.state === "chase" && dist < BOSS.radius + PLAYER.radius) {
      damagePlayer(player, BOSS.touchDamage, b.pos, this.fx, this.events);
    }

    // player sword damage on boss
    if (attackWindowOpen(player) && !player.attackDidHit.has(-9999)) {
      if (inSwordArc(player, b.pos, BOSS.radius)) {
        player.attackDidHit.add(-9999);
        this.hurt(PLAYER.attackDamage, player.pos);
      }
    }
  }

  private hurt(dmg: number, from: THREE.Vector3): void {
    const b = this.boss!;
    if (b.state === "dying") return;
    b.hp -= dmg;
    flash(b.root, performance.now() / 1000, 0.18);
    sfx.hitEnemy();
    this.fx.burst(new THREE.Vector3(b.pos.x, 1.8, b.pos.z), 0xfff1c9, 10, { speed: 5, up: 3 });
    const dx = b.pos.x - from.x;
    const dz = b.pos.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    b.vel.set((dx / d) * 5, 0, (dz / d) * 5);
    this.events.onBossBar(Math.max(0, b.hp / BOSS.hp));
    if (b.hp <= 0) {
      this.setState("dying");
      play(b.anim, ["Death_A", "Death_B"], { loop: false, force: true });
      sfx.enemyDie();
      sfx.victory();
      this.fx.burst(new THREE.Vector3(b.pos.x, 1.2, b.pos.z), 0xffe89a, 40, {
        speed: 8, up: 6, life: 1.2, scale: 1.4,
      });
    } else {
      this.setState("hurt");
      play(b.anim, ["Hit_A", "Hit_B"], { loop: false, force: true, fade: 0.05 });
    }
  }

  private setState(s: BossData["state"]): void {
    if (!this.boss) return;
    this.boss.state = s;
    this.boss.stateTime = 0;
  }

  private enterRecover(mul: number): void {
    void mul;
    this.setState("recover");
    play(this.boss!.anim, ["Idle_Combat", "Idle"], { fade: 0.2 });
  }
}
