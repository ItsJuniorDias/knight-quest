import * as THREE from "three";
import { BOSS, BOSSES, PLAYER } from "../config";
import { buildAnimSet, clipDuration, play } from "../engine/anim";
import { sfx } from "../engine/audio";
import { getAnimations, spawn } from "../engine/loader";
import { flash, type FxSystem } from "../art/fx";
import {
  makeCrystalGolemMesh, makeFlameDjinnMesh, makeStormElementalMesh, makeVoidSerpentMesh,
  type BossMeshHandles,
} from "../art/boss-meshes";
import { attachWeapon, type EnemySystem } from "./enemies";
import type { BossData, BossKind, GameEvents, PlayerData } from "../types";
import { attackWindowOpen, damagePlayer, inSwordArc, isHeavyAttack } from "./player";
import { moveCircle } from "./physics";
import type { RoomManager } from "./rooms";
import type { ProjectileSystem } from "./projectiles";
import type { PropsSystem } from "./props";
import type { PickupSystem } from "./pickups";
import type { SpellSystem } from "./spells";

// ---------------------------------------------------------------------------
// v6: MULTI-BOSS SYSTEM
//
// The v5 system managed exactly one boss (Skeleton King Malric). v6 supports
// eight bosses across the world:
//   - skeleton_king    (KayKit skeleton_warrior, original AI)
//   - bone_necromancer (skeleton_mage, purple tint, summons + bolts)
//   - shadow_reaver    (skeleton_rogue, dark tint, dash + triple stab)
//   - iron_warden      (skeleton_minion, rust tint, block + smash)
//   - crystal_golem    (procedural, slam + laser)
//   - void_serpent     (procedural, bite + spit + coil)
//   - flame_djinn      (procedural, teleport + ring + fireball)
//   - storm_elemental  (procedural, chain lightning + tornado)
//
// A BossData carries its own `kind` and behaviors are dispatched via that.
// Each boss stays dormant (state=waiting) until the player enters its room.
// The classic BossSystem.boss field is kept as a "current room's active boss"
// for the HUD boss bar, but internally we keep the full list in `bosses`.
// ---------------------------------------------------------------------------

/** Handles for procedural bosses (crystal_golem etc.) — parts to animate. */
type ProcHandles = BossMeshHandles["parts"];

export class BossSystem {
  /** All bosses in the world, one per bossSpawn tile. */
  bosses: BossData[] = [];
  /** Backwards compat: the boss currently on-screen (updated per frame). */
  boss: BossData | null = null;
  private procHandles = new WeakMap<BossData, ProcHandles>();
  private scene: THREE.Scene;
  private fx: FxSystem;
  private events: GameEvents;
  /** Set by main.ts so summoners can spawn minions. */
  enemies: EnemySystem | null = null;
  /** v8: injected so bosses can drop spells + loot on death. */
  spells: SpellSystem | null = null;
  pickups: PickupSystem | null = null;
  player: PlayerData | null = null;

  constructor(scene: THREE.Scene, fx: FxSystem, events: GameEvents) {
    this.scene = scene;
    this.fx = fx;
    this.events = events;
  }

  /** Legacy single-spawn (used only by the old Malric spawn line). */
  spawn(pos: THREE.Vector3): void {
    this.spawnKind("skeleton_king", pos, "0,0");
  }

  /** v6: spawn a specific boss kind at world pos, dormant, tied to a room. */
  spawnKind(kind: BossKind, pos: THREE.Vector3, roomKey: string): BossData {
    const cfg = BOSSES[kind];
    let root: THREE.Group;
    let anim: BossData["anim"];
    let procHandle: ProcHandles | null = null;

    // ---- pack (KayKit) bosses use the existing skeleton meshes ------------
    if (kind === "skeleton_king") {
      root = spawn("skeleton_warrior", { castShadow: true });
      attachWeapon(root, "axe", BOSS.scale);
      anim = buildAnimSet(root, getAnimations("skeleton_warrior"));
      play(anim, ["Skeletons_Inactive_Floor_Pose"], { loop: false, force: true });
    } else if (kind === "bone_necromancer") {
      root = spawn("skeleton_mage", { castShadow: true });
      attachWeapon(root, "staff", cfg.scale);
      anim = buildAnimSet(root, getAnimations("skeleton_mage"));
      tintSkeleton(root, cfg.tint);
      play(anim, ["Skeletons_Inactive_Floor_Pose", "Idle"], { loop: false, force: true });
    } else if (kind === "shadow_reaver") {
      root = spawn("skeleton_rogue", { castShadow: true });
      attachWeapon(root, "blade", cfg.scale);
      anim = buildAnimSet(root, getAnimations("skeleton_rogue"));
      tintSkeleton(root, cfg.tint);
      play(anim, ["Skeletons_Inactive_Floor_Pose", "Idle"], { loop: false, force: true });
    } else if (kind === "iron_warden") {
      root = spawn("skeleton_minion", { castShadow: true });
      attachWeapon(root, "axe", cfg.scale);
      anim = buildAnimSet(root, getAnimations("skeleton_minion"));
      tintSkeleton(root, cfg.tint);
      play(anim, ["Skeletons_Inactive_Floor_Pose", "Idle"], { loop: false, force: true });
    } else {
      // ---- procedural bosses -------------------------------------------
      let handles: BossMeshHandles;
      if (kind === "crystal_golem") handles = makeCrystalGolemMesh(cfg.tint);
      else if (kind === "void_serpent") handles = makeVoidSerpentMesh(cfg.tint);
      else if (kind === "flame_djinn") handles = makeFlameDjinnMesh(cfg.tint);
      else handles = makeStormElementalMesh(cfg.tint);
      root = handles.root;
      procHandle = handles.parts;
      // procedurals ship no animations — buildAnimSet handles empty arrays
      anim = buildAnimSet(root, []);
    }

    root.position.copy(pos);
    root.scale.setScalar(cfg.scale);
    this.scene.add(root);

    const b: BossData = {
      kind, root, anim,
      state: "waiting", stateTime: 0,
      pos: pos.clone(), vel: new THREE.Vector3(),
      facing: { x: 0, z: 1 },
      hp: cfg.hp, maxHp: cfg.hp,
      attacksSinceTaunt: 0,
      didHitPlayer: false,
      leapFrom: new THREE.Vector3(), leapTo: new THREE.Vector3(),
      active: false, dead: false,
      enrageAnnounced: false,
      roomKey, cooldown: 0, summonsUsed: 0, procTime: 0,
    };
    if (procHandle) this.procHandles.set(b, procHandle);
    this.bosses.push(b);
    return b;
  }

  /** Wake every boss in the room the player just entered. */
  wakeRoom(roomKey: string): void {
    for (const b of this.bosses) {
      if (b.roomKey === roomKey && b.state === "waiting" && !b.dead) {
        this.wake(b);
      }
    }
  }

  private wake(b: BossData): void {
    if (b.active) return;
    b.active = true;
    b.state = "awaken"; b.stateTime = 0;
    sfx.bossRoar();
    const cfg = BOSSES[b.kind];
    if (b.anim.actions.size) {
      play(b.anim, ["Skeletons_Awaken_Floor", "Skeletons_Awaken_Standing"], {
        loop: false, force: true,
      });
    }
    this.events.onBossBar(1);
    this.events.onToast(cfg.intro);
    this.events.onGameEvent(`boss:awake:${b.kind}`);
  }

  /**
   * v5 API preserved: still called by main when player enters the throne
   * room. Now just delegates to wakeRoom() so any boss (Malric or otherwise)
   * in the current room is roused.
   */
  update(
    dt: number,
    player: PlayerData,
    roomMgr: RoomManager,
    projectiles: ProjectileSystem,
    props: PropsSystem,
  ): void {
    // pick "the on-screen boss" for the HUD — first alive in current room
    const currentKey = roomMgr.current.key;
    const active = this.bosses.find((b) => b.roomKey === currentKey && !b.dead);
    this.boss = active ?? null;

    // wake any dormant bosses in the room
    if (roomMgr.current.hasBoss) this.wakeRoom(currentKey);

    for (const b of this.bosses) {
      if (b.dead) continue;
      // v11: don't even tick mixer/state for bosses in other rooms.
      // A dormant boss in a room the player hasn't entered still needs to
      // hold its "inactive floor pose" — which it does purely via the anim
      // action's clamp, no mixer ticks required.
      if (b.roomKey !== currentKey) continue;
      b.stateTime += dt;
      b.procTime += dt;
      if (b.anim.mixer) b.anim.mixer.update(dt);
      if (b.state === "waiting") continue;
      this.updateBoss(b, dt, player, roomMgr, projectiles, props);
    }
    // procedural cosmetics for the active boss (rotations, bobbing…)
    if (active) this.animateProc(active, dt);
  }

  // -------------------------------------------------------------------------
  // per-boss AI dispatch
  // -------------------------------------------------------------------------
  private updateBoss(
    b: BossData, dt: number, player: PlayerData, roomMgr: RoomManager,
    projectiles: ProjectileSystem, props: PropsSystem,
  ): void {
    const cfg = BOSSES[b.kind] as typeof BOSSES[BossKind];
    const enraged = b.hp / b.maxHp <= (BOSS.enrageAtHpFrac);
    const speedMul = enraged ? BOSS.enrageSpeedMul : 1;
    const recoverMul = enraged ? BOSS.enrageRecoverMul : 1;

    const toPlayer = new THREE.Vector3().subVectors(player.pos, b.pos);
    const dist = Math.hypot(toPlayer.x, toPlayer.z);
    const dirX = dist > 1e-4 ? toPlayer.x / dist : 0;
    const dirZ = dist > 1e-4 ? toPlayer.z / dist : 1;

    // Awaken common to every boss ------------------------------------------
    if (b.state === "awaken") {
      if (b.stateTime >= 1.6) { b.state = "chase"; b.stateTime = 0; }
      this.faceTargetSmooth(b, dt);
      return;
    }
    if (b.state === "hurt") {
      b.vel.multiplyScalar(Math.max(0, 1 - 6 * dt));
      moveCircle(b.pos, b.vel, dt, cfg.radius, roomMgr.current);
      if (b.stateTime >= 0.28) { b.state = "chase"; b.stateTime = 0; }
      this.faceTargetSmooth(b, dt);
      this.commitRoot(b);
      return;
    }
    if (b.state === "dying") {
      if (b.stateTime >= 1.6 && !b.dead) {
        b.dead = true;
        this.scene.remove(b.root);
        this.events.onBossBar(null);
        roomMgr.current.cleared = true;
        // v6: only Malric drops the "you won the game" victory crystal.
        // Coliseum bosses are bonus fights that just open their room's gates.
        if (b.kind === "skeleton_king") {
          props.spawnVictoryCrystal(this.scene, b.pos.clone());
        }
        this.events.onToast(cfg.outro);
        this.events.onGameEvent(`boss:dead:${b.kind}`);
        // v8: reward — unlock spell + drop a generous coin/heart pile so
        // the player actually FEELS rewarded for the fight.
        if (this.spells && this.player) {
          this.spells.grantSpellForBoss(this.player, b.kind);
        }
        if (this.pickups) {
          // 5 coins + 2 hearts around the corpse
          for (let i = 0; i < 5; i++) {
            const ang = (i / 5) * Math.PI * 2;
            const p = new THREE.Vector3(
              b.pos.x + Math.cos(ang) * 1.2, 0, b.pos.z + Math.sin(ang) * 1.2,
            );
            this.pickups.spawnCoin(p);
          }
          this.pickups.spawnHeart(b.pos.clone());
          this.pickups.spawnHeart(new THREE.Vector3(b.pos.x + 1, 0, b.pos.z + 1));
        }
      }
      return;
    }

    // Dispatch per-kind AI --------------------------------------------------
    switch (b.kind) {
      case "skeleton_king":
        this.aiSkeletonKing(b, dt, dist, dirX, dirZ, player, roomMgr, projectiles, speedMul, recoverMul);
        break;
      case "bone_necromancer":
        this.aiNecromancer(b, dt, dist, dirX, dirZ, player, roomMgr, projectiles, speedMul, recoverMul);
        break;
      case "shadow_reaver":
        this.aiReaver(b, dt, dist, dirX, dirZ, player, roomMgr, speedMul, recoverMul);
        break;
      case "iron_warden":
        this.aiWarden(b, dt, dist, dirX, dirZ, player, roomMgr, projectiles, speedMul, recoverMul);
        break;
      case "crystal_golem":
        this.aiGolem(b, dt, dist, dirX, dirZ, player, roomMgr, projectiles, speedMul, recoverMul);
        break;
      case "void_serpent":
        this.aiSerpent(b, dt, dist, dirX, dirZ, player, roomMgr, projectiles, speedMul, recoverMul);
        break;
      case "flame_djinn":
        this.aiDjinn(b, dt, dist, dirX, dirZ, player, roomMgr, projectiles, speedMul, recoverMul);
        break;
      case "storm_elemental":
        this.aiStorm(b, dt, dist, dirX, dirZ, player, roomMgr, projectiles, speedMul, recoverMul);
        break;
    }

    // face + move + touch damage + sword damage (common tail)
    this.faceTargetSmooth(b, dt);
    this.commitRoot(b);
    if (b.state === "chase" && dist < cfg.radius + PLAYER.radius) {
      damagePlayer(player, cfg.touchDamage, b.pos, this.fx, this.events);
    }
    if (attackWindowOpen(player) && !player.attackDidHit.has(-1000 - this.bosses.indexOf(b))) {
      if (inSwordArc(player, b.pos, cfg.radius)) {
        player.attackDidHit.add(-1000 - this.bosses.indexOf(b));
        const isHeavy = isHeavyAttack(player);
        let dmg = isHeavy ? PLAYER.heavyAttackDamage : PLAYER.attackDamage;
        if (player.upgrades?.sharpBlade) dmg += 1;
        this.hurt(b, dmg, player.pos);
        this.events.onSwordHit("boss", b.pos);
      }
    }

    // enrage narrative
    if (enraged && !b.enrageAnnounced) {
      b.enrageAnnounced = true;
      this.events.onStory(null, cfg.enrageLine);
      this.events.onGameEvent?.("boss:enraged");
    }
  }

  // -------------------------------------------------------------------------
  // Malric (the original)
  // -------------------------------------------------------------------------
  private aiSkeletonKing(
    b: BossData, dt: number, dist: number, dirX: number, dirZ: number,
    player: PlayerData, roomMgr: RoomManager, projectiles: ProjectileSystem,
    speedMul: number, recoverMul: number,
  ): void {
    switch (b.state) {
      case "chase": {
        b.facing.x = dirX; b.facing.z = dirZ;
        b.vel.x = dirX * BOSS.speed * speedMul;
        b.vel.z = dirZ * BOSS.speed * speedMul;
        moveCircle(b.pos, b.vel, dt, BOSS.radius, roomMgr.current);
        play(b.anim, ["Walking_D_Skeletons", "Walking_A", "Running_A"], { fade: 0.2 });
        if (dist <= BOSS.spinRange) {
          b.state = "spinWindup"; b.stateTime = 0;
          play(b.anim, ["Idle_Combat", "Idle"], { fade: 0.1 });
        } else if (dist <= BOSS.chopRange && b.stateTime > 0.7) {
          b.state = "chopWindup"; b.stateTime = 0;
          play(b.anim, ["Idle_Combat", "Idle"], { fade: 0.1 });
        }
        break;
      }
      case "spinWindup": {
        b.facing.x = dirX; b.facing.z = dirZ;
        if (b.stateTime >= BOSS.spinWindup) {
          b.state = "spin"; b.stateTime = 0;
          b.didHitPlayer = false;
          const dur = clipDuration(b.anim, ["2H_Melee_Attack_Spinning", "2H_Melee_Attack_Spin"], 1);
          play(b.anim, ["2H_Melee_Attack_Spinning", "2H_Melee_Attack_Spin"], {
            loop: false, force: true, timeScale: dur / BOSS.spinDuration,
          });
        }
        break;
      }
      case "spin": {
        b.root.rotation.y += dt * 14;
        if (b.stateTime > 0.25 && b.stateTime < BOSS.spinDuration - 0.15 && !b.didHitPlayer) {
          if (dist < BOSS.spinRadius) {
            b.didHitPlayer = true;
            damagePlayer(player, BOSS.spinDamage, b.pos, this.fx, this.events);
          }
        }
        if (b.stateTime >= BOSS.spinDuration) {
          b.attacksSinceTaunt++;
          this.enterRecover(b, recoverMul);
        }
        break;
      }
      case "chopWindup": {
        b.facing.x = dirX; b.facing.z = dirZ;
        if (b.stateTime >= BOSS.chopWindup) {
          b.state = "chopLeap"; b.stateTime = 0;
          b.leapFrom.copy(b.pos); b.leapTo.copy(player.pos);
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
          b.state = "chopLand"; b.stateTime = 0;
          sfx.bossRoar();
          projectiles.spawnShockwave(b.pos.clone());
          this.fx.burst(new THREE.Vector3(b.pos.x, 0.5, b.pos.z), 0xffd166, 22, {
            speed: 6, up: 3, life: 0.6,
          });
          const d2 = (player.pos.x - b.pos.x) ** 2 + (player.pos.z - b.pos.z) ** 2;
          if (d2 < 6) damagePlayer(player, BOSS.chopDamage, b.pos, this.fx, this.events);
        }
        break;
      }
      case "chopLand": {
        if (b.stateTime >= 0.35) {
          b.attacksSinceTaunt++;
          this.enterRecover(b, recoverMul);
        }
        break;
      }
      case "taunt": {
        if (b.stateTime >= 1.3) { b.state = "chase"; b.stateTime = 0; }
        break;
      }
      case "recover": {
        if (b.stateTime >= BOSS.recoverTime * recoverMul) {
          if (b.attacksSinceTaunt >= BOSS.tauntEvery) {
            b.attacksSinceTaunt = 0;
            b.state = "taunt"; b.stateTime = 0;
            play(b.anim, ["Taunt_Longer", "Taunt"], { loop: false, force: true });
          } else {
            b.state = "chase"; b.stateTime = 0;
          }
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Bone Necromancer — ranged bolts + summons
  // -------------------------------------------------------------------------
  private aiNecromancer(
    b: BossData, dt: number, dist: number, dirX: number, dirZ: number,
    player: PlayerData, roomMgr: RoomManager, projectiles: ProjectileSystem,
    speedMul: number, recoverMul: number,
  ): void {
    const cfg = BOSSES.bone_necromancer;
    switch (b.state) {
      case "chase": {
        b.facing.x = dirX; b.facing.z = dirZ;
        // kite — keeps distance ~8m
        const preferred = 8;
        if (dist > preferred) {
          b.vel.x = dirX * cfg.speed * speedMul;
          b.vel.z = dirZ * cfg.speed * speedMul;
        } else {
          b.vel.x = -dirX * cfg.speed * 0.7;
          b.vel.z = -dirZ * cfg.speed * 0.7;
        }
        moveCircle(b.pos, b.vel, dt, cfg.radius, roomMgr.current);
        play(b.anim, ["Walking_D_Skeletons", "Walking_A"], { fade: 0.2 });
        if (b.stateTime > 1.1 && dist < cfg.castRange) {
          b.state = "castWindup"; b.stateTime = 0;
          play(b.anim, ["Spellcast_Long", "Spellcast_Shoot", "Idle_Combat"], { loop: false, force: true });
        }
        break;
      }
      case "castWindup": {
        b.facing.x = dirX; b.facing.z = dirZ;
        if (b.stateTime >= cfg.castWindup) {
          b.state = "cast"; b.stateTime = 0;
          // fan of bolts
          const origin = b.pos.clone(); origin.y = 1.6;
          const spread = cfg.boltSpread;
          for (let i = 0; i < cfg.boltCount; i++) {
            const t = (i / (cfg.boltCount - 1) - 0.5) * spread * 2;
            const ang = Math.atan2(dirX, dirZ) + t;
            const d = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
            projectiles.spawnBolt(origin.clone(), d);
          }
        }
        break;
      }
      case "cast": {
        if (b.stateTime >= 0.4) {
          b.attacksSinceTaunt++;
          if (b.attacksSinceTaunt >= cfg.summonEvery) {
            b.attacksSinceTaunt = 0;
            b.state = "summon"; b.stateTime = 0;
            play(b.anim, ["Taunt_Longer", "Taunt", "Idle"], { loop: false, force: true });
          } else {
            this.enterRecover(b, recoverMul);
          }
        }
        break;
      }
      case "summon": {
        // spawn N minions around the necromancer
        if (b.stateTime >= 0.6 && b.summonsUsed === Math.floor(b.stateTime / 0.6) - 1) {
          b.summonsUsed++;
          if (this.enemies && b.summonsUsed <= cfg.summonCount) {
            const ang = Math.random() * Math.PI * 2;
            const p = new THREE.Vector3(
              b.pos.x + Math.cos(ang) * 2.5, 0, b.pos.z + Math.sin(ang) * 2.5,
            );
            this.enemies.spawnEnemy("minion", p, b.roomKey);
            this.fx.burst(new THREE.Vector3(p.x, 0.4, p.z), 0xa864ff, 15, { speed: 4, up: 3, life: 0.5 });
          }
        }
        if (b.stateTime >= cfg.summonCount * 0.6 + 0.3) {
          b.summonsUsed = 0;
          this.enterRecover(b, recoverMul);
        }
        break;
      }
      case "recover": {
        if (b.stateTime >= cfg.castRecover * recoverMul) {
          b.state = "chase"; b.stateTime = 0;
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Shadow Reaver — dash + triple stab
  // -------------------------------------------------------------------------
  private aiReaver(
    b: BossData, dt: number, dist: number, dirX: number, dirZ: number,
    player: PlayerData, roomMgr: RoomManager,
    speedMul: number, recoverMul: number,
  ): void {
    const cfg = BOSSES.shadow_reaver;
    switch (b.state) {
      case "chase": {
        b.facing.x = dirX; b.facing.z = dirZ;
        b.vel.x = dirX * cfg.speed * speedMul;
        b.vel.z = dirZ * cfg.speed * speedMul;
        moveCircle(b.pos, b.vel, dt, cfg.radius, roomMgr.current);
        play(b.anim, ["Running_A", "Walking_A"], { fade: 0.2 });
        if (dist <= 2.2) {
          b.state = "stabWindup" as never; b.stateTime = 0;
          b.didHitPlayer = false;
          play(b.anim, ["1H_Melee_Attack_Stab", "1H_Melee_Attack_Slice_Diagonal"], {
            loop: false, force: true,
          });
        } else if (dist <= cfg.dashRange && b.stateTime > 0.6) {
          b.state = "dashWindup"; b.stateTime = 0;
          b.leapFrom.copy(b.pos);
          b.leapTo.copy(player.pos).addScaledVector(new THREE.Vector3(dirX, 0, dirZ), 1.5);
          play(b.anim, ["Idle_Combat", "Idle"], { fade: 0.05 });
        }
        break;
      }
      case "dashWindup": {
        if (b.stateTime >= cfg.dashWindup) {
          b.state = "dash"; b.stateTime = 0; b.didHitPlayer = false;
        }
        break;
      }
      case "dash": {
        const t = Math.min(1, b.stateTime / cfg.dashDuration);
        b.pos.lerpVectors(b.leapFrom, b.leapTo, t);
        // damage on contact
        if (!b.didHitPlayer && dist < 1.5) {
          b.didHitPlayer = true;
          damagePlayer(player, cfg.stabDamage, b.pos, this.fx, this.events);
        }
        this.fx.burst(new THREE.Vector3(b.pos.x, 0.6, b.pos.z), cfg.tint, 3, { speed: 3, up: 2, life: 0.28 });
        if (t >= 1) {
          b.attacksSinceTaunt++;
          if (b.attacksSinceTaunt >= (cfg.teleportEvery)) {
            b.attacksSinceTaunt = 0;
            b.state = "teleport"; b.stateTime = 0;
          } else {
            this.enterRecover(b, recoverMul);
          }
        }
        break;
      }
      case "stabWindup" as never: {
        b.facing.x = dirX; b.facing.z = dirZ;
        // 3 quick stabs
        const hitsDone = Math.floor(b.stateTime / (cfg.stabDuration / cfg.stabCount));
        if (hitsDone > b.summonsUsed && hitsDone <= cfg.stabCount) {
          b.summonsUsed = hitsDone;
          if (dist < 2.2) damagePlayer(player, cfg.stabDamage, b.pos, this.fx, this.events);
          play(b.anim, ["1H_Melee_Attack_Stab"], { loop: false, force: true });
        }
        if (b.stateTime >= cfg.stabDuration) {
          b.summonsUsed = 0;
          b.attacksSinceTaunt++;
          this.enterRecover(b, recoverMul);
        }
        break;
      }
      case "teleport": {
        b.root.visible = b.stateTime > 0.35;
        if (b.stateTime === 0 || (!b.root.visible && b.stateTime > 0.02)) {
          this.fx.burst(new THREE.Vector3(b.pos.x, 1.2, b.pos.z), cfg.tint, 20, { speed: 6, up: 4, life: 0.6 });
        }
        if (b.stateTime >= 0.35 && !b.didHitPlayer) {
          b.didHitPlayer = true;
          // reappear on opposite side of the player
          const back = new THREE.Vector3(-dirX, 0, -dirZ).multiplyScalar(1.6);
          b.pos.copy(player.pos).add(back);
          b.root.visible = true;
          this.fx.burst(new THREE.Vector3(b.pos.x, 1.2, b.pos.z), cfg.tint, 20, { speed: 6, up: 4, life: 0.6 });
        }
        if (b.stateTime >= 0.6) {
          b.didHitPlayer = false;
          b.state = "stabWindup" as never; b.stateTime = 0;
        }
        break;
      }
      case "recover": {
        if (b.stateTime >= 0.4 * recoverMul) {
          b.state = "chase"; b.stateTime = 0;
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Iron Warden — big slow tank, alternates smash / block / shockwave
  // -------------------------------------------------------------------------
  private aiWarden(
    b: BossData, dt: number, dist: number, dirX: number, dirZ: number,
    player: PlayerData, roomMgr: RoomManager, projectiles: ProjectileSystem,
    speedMul: number, recoverMul: number,
  ): void {
    const cfg = BOSSES.iron_warden;
    switch (b.state) {
      case "chase": {
        b.facing.x = dirX; b.facing.z = dirZ;
        b.vel.x = dirX * cfg.speed * speedMul;
        b.vel.z = dirZ * cfg.speed * speedMul;
        moveCircle(b.pos, b.vel, dt, cfg.radius, roomMgr.current);
        play(b.anim, ["Walking_D_Skeletons", "Walking_A"], { fade: 0.2 });
        if (dist <= cfg.smashRange) {
          b.state = "slamWindup"; b.stateTime = 0; b.didHitPlayer = false;
          play(b.anim, ["Idle_Combat"], { fade: 0.05 });
        }
        break;
      }
      case "slamWindup": {
        b.facing.x = dirX; b.facing.z = dirZ;
        if (b.stateTime >= cfg.smashWindup) {
          b.state = "slam"; b.stateTime = 0;
          play(b.anim, ["2H_Melee_Attack_Chop", "1H_Melee_Attack_Chop"], { loop: false, force: true });
          projectiles.spawnShockwave(b.pos.clone());
          this.fx.burst(new THREE.Vector3(b.pos.x, 0.5, b.pos.z), cfg.tint, 20, { speed: 5, up: 2, life: 0.6 });
          if (dist < cfg.smashRange + 0.5) {
            damagePlayer(player, cfg.smashDamage, b.pos, this.fx, this.events);
            b.didHitPlayer = true;
          }
        }
        break;
      }
      case "slam": {
        if (b.stateTime >= cfg.smashDuration) {
          b.attacksSinceTaunt++;
          if (b.attacksSinceTaunt >= cfg.blockEvery && !b.enrageAnnounced) {
            b.attacksSinceTaunt = 0;
            b.state = "taunt"; b.stateTime = 0;
            play(b.anim, ["Block", "Idle_Combat"], { loop: false, force: true });
          } else {
            this.enterRecover(b, recoverMul);
          }
        }
        break;
      }
      case "taunt": {
        // "block" pose — takes reduced damage, faces player
        b.facing.x = dirX; b.facing.z = dirZ;
        if (b.stateTime >= cfg.blockDuration) {
          b.state = "chase"; b.stateTime = 0;
        }
        break;
      }
      case "recover": {
        if (b.stateTime >= 0.6 * recoverMul) {
          b.state = "chase"; b.stateTime = 0;
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Crystal Golem — ground slam + rotating laser
  // -------------------------------------------------------------------------
  private aiGolem(
    b: BossData, dt: number, dist: number, dirX: number, dirZ: number,
    player: PlayerData, roomMgr: RoomManager, projectiles: ProjectileSystem,
    speedMul: number, recoverMul: number,
  ): void {
    const cfg = BOSSES.crystal_golem;
    switch (b.state) {
      case "chase": {
        b.facing.x = dirX; b.facing.z = dirZ;
        b.vel.x = dirX * cfg.speed * speedMul;
        b.vel.z = dirZ * cfg.speed * speedMul;
        moveCircle(b.pos, b.vel, dt, cfg.radius, roomMgr.current);
        if (dist <= cfg.slamRange) {
          b.state = "slamWindup"; b.stateTime = 0; b.didHitPlayer = false;
        } else if (b.stateTime > 1.3) {
          b.state = "castWindup"; b.stateTime = 0;
        }
        break;
      }
      case "slamWindup": {
        b.facing.x = dirX; b.facing.z = dirZ;
        // pulse core glow
        const parts = this.procHandles.get(b);
        if (parts?.core) (parts.core as THREE.Mesh).scale.setScalar(1 + b.stateTime * 0.5);
        if (b.stateTime >= cfg.slamWindup) {
          b.state = "slam"; b.stateTime = 0;
          sfx.bossRoar();
          projectiles.spawnShockwave(b.pos.clone());
          this.fx.burst(new THREE.Vector3(b.pos.x, 0.5, b.pos.z), cfg.tint, 30, { speed: 7, up: 3, life: 0.7 });
          if (dist < cfg.slamRange + 0.5) {
            damagePlayer(player, cfg.slamDamage, b.pos, this.fx, this.events);
          }
          // shard rain
          for (let i = 0; i < cfg.shardsCount; i++) {
            const ang = (i / cfg.shardsCount) * Math.PI * 2;
            const d = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
            const o = b.pos.clone(); o.y = 1.4;
            projectiles.spawnBolt(o, d);
          }
        }
        break;
      }
      case "slam": {
        const parts = this.procHandles.get(b);
        if (parts?.core) (parts.core as THREE.Mesh).scale.setScalar(1);
        if (b.stateTime >= 0.4) this.enterRecover(b, recoverMul);
        break;
      }
      case "castWindup": {
        b.facing.x = dirX; b.facing.z = dirZ;
        const parts = this.procHandles.get(b);
        if (parts?.ring) (parts.ring as THREE.Mesh).material = new THREE.MeshBasicMaterial({
          color: cfg.tint, transparent: true, opacity: Math.min(0.9, b.stateTime),
        });
        if (b.stateTime >= cfg.laserWindup) {
          b.state = "cast"; b.stateTime = 0;
          sfx.bolt();
        }
        break;
      }
      case "cast": {
        // rotating laser: continuous damage in a beam
        const parts = this.procHandles.get(b);
        if (parts?.ring) (parts.ring as THREE.Mesh).rotation.z += dt * 3;
        const beamAng = b.stateTime * 3;
        const bx = Math.cos(beamAng), bz = Math.sin(beamAng);
        // if player is within the beam's line, hit them
        const projX = (player.pos.x - b.pos.x) * bx + (player.pos.z - b.pos.z) * bz;
        const perp = Math.abs(-(player.pos.x - b.pos.x) * bz + (player.pos.z - b.pos.z) * bx);
        if (projX > 0 && projX < cfg.laserRange && perp < 0.9 && !b.didHitPlayer) {
          b.didHitPlayer = true;
          damagePlayer(player, cfg.laserDamage, b.pos, this.fx, this.events);
        }
        // visual dot at beam tip
        if (Math.random() < 0.5) {
          const p = new THREE.Vector3(b.pos.x + bx * 3, 1.2, b.pos.z + bz * 3);
          this.fx.burst(p, cfg.tint, 3, { speed: 3, up: 1, life: 0.25 });
        }
        if (b.stateTime >= cfg.laserDuration) {
          b.didHitPlayer = false;
          const parts2 = this.procHandles.get(b);
          if (parts2?.ring) {
            (parts2.ring as THREE.Mesh).material = new THREE.MeshBasicMaterial({
              color: cfg.tint, transparent: true, opacity: 0,
            });
          }
          this.enterRecover(b, recoverMul);
        }
        break;
      }
      case "recover": {
        if (b.stateTime >= 0.7 * recoverMul) { b.state = "chase"; b.stateTime = 0; }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Void Serpent — bite + spit + coil
  // -------------------------------------------------------------------------
  private aiSerpent(
    b: BossData, dt: number, dist: number, dirX: number, dirZ: number,
    player: PlayerData, roomMgr: RoomManager, projectiles: ProjectileSystem,
    speedMul: number, recoverMul: number,
  ): void {
    const cfg = BOSSES.void_serpent;
    switch (b.state) {
      case "chase": {
        b.facing.x = dirX; b.facing.z = dirZ;
        b.vel.x = dirX * cfg.speed * speedMul;
        b.vel.z = dirZ * cfg.speed * speedMul;
        moveCircle(b.pos, b.vel, dt, cfg.radius, roomMgr.current);
        if (dist <= cfg.biteRange) {
          b.state = "slamWindup"; b.stateTime = 0; b.didHitPlayer = false;
        } else if (dist <= cfg.spitRange && b.stateTime > 1.2) {
          b.state = "castWindup"; b.stateTime = 0;
        } else if (b.stateTime > 3) {
          b.state = "summon"; b.stateTime = 0; // coil
        }
        break;
      }
      case "slamWindup": {
        b.facing.x = dirX; b.facing.z = dirZ;
        if (b.stateTime >= cfg.biteWindup) {
          b.state = "slam"; b.stateTime = 0;
          if (dist < cfg.biteRange + 0.4) {
            damagePlayer(player, cfg.biteDamage, b.pos, this.fx, this.events);
          }
          this.fx.burst(new THREE.Vector3(b.pos.x, 1.5, b.pos.z), cfg.tint, 12, { speed: 5, up: 3, life: 0.5 });
        }
        break;
      }
      case "slam": {
        if (b.stateTime >= 0.35) this.enterRecover(b, recoverMul);
        break;
      }
      case "castWindup": {
        b.facing.x = dirX; b.facing.z = dirZ;
        if (b.stateTime >= cfg.spitWindup) {
          b.state = "cast"; b.stateTime = 0;
          const o = b.pos.clone(); o.y = 1.6;
          projectiles.spawnBolt(o, new THREE.Vector3(dirX, 0, dirZ));
        }
        break;
      }
      case "cast": {
        if (b.stateTime >= 0.35) this.enterRecover(b, recoverMul);
        break;
      }
      case "summon": {
        // coil: shrinking damage ring around the serpent
        const t = b.stateTime / cfg.coilDuration;
        const r = cfg.coilRadius * (1 - t * 0.7);
        if (Math.abs(dist - r) < 0.6 && !b.didHitPlayer) {
          b.didHitPlayer = true;
          damagePlayer(player, cfg.coilDamage, b.pos, this.fx, this.events);
        }
        if (Math.random() < 0.6) {
          const a = Math.random() * Math.PI * 2;
          const p = new THREE.Vector3(b.pos.x + Math.cos(a) * r, 0.2, b.pos.z + Math.sin(a) * r);
          this.fx.burst(p, cfg.tint, 2, { speed: 1.5, up: 1, life: 0.3 });
        }
        if (b.stateTime >= cfg.coilDuration) {
          b.didHitPlayer = false;
          this.enterRecover(b, recoverMul);
        }
        break;
      }
      case "recover": {
        if (b.stateTime >= 0.5 * recoverMul) { b.state = "chase"; b.stateTime = 0; }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Flame Djinn — teleport + fire ring + fireball
  // -------------------------------------------------------------------------
  private aiDjinn(
    b: BossData, dt: number, dist: number, dirX: number, dirZ: number,
    player: PlayerData, roomMgr: RoomManager, projectiles: ProjectileSystem,
    speedMul: number, recoverMul: number,
  ): void {
    const cfg = BOSSES.flame_djinn;
    switch (b.state) {
      case "chase": {
        b.facing.x = dirX; b.facing.z = dirZ;
        // slow hover approach
        const preferred = 6;
        const s = cfg.speed * speedMul * 0.7;
        if (dist > preferred) {
          b.vel.x = dirX * s; b.vel.z = dirZ * s;
        } else {
          b.vel.x = -dirZ * s * 0.6; b.vel.z = dirX * s * 0.6; // strafe
        }
        moveCircle(b.pos, b.vel, dt, cfg.radius, roomMgr.current);
        if (dist <= cfg.ringRange) {
          b.state = "castWindup"; b.stateTime = 0;
        } else if (b.stateTime > 1.4) {
          b.state = "slamWindup"; b.stateTime = 0; // fireball
        }
        break;
      }
      case "castWindup": {
        // ring warning
        const parts = this.procHandles.get(b);
        if (parts?.ring) (parts.ring as THREE.Mesh).scale.setScalar(1 + b.stateTime);
        if (b.stateTime >= cfg.ringWindup) {
          b.state = "cast"; b.stateTime = 0;
          sfx.bossRoar();
          this.fx.burst(new THREE.Vector3(b.pos.x, 0.5, b.pos.z), cfg.tint, 40, { speed: 9, up: 3, life: 0.9 });
          if (dist < cfg.ringRange + 0.3) {
            damagePlayer(player, cfg.ringDamage, b.pos, this.fx, this.events);
          }
        }
        break;
      }
      case "cast": {
        const parts = this.procHandles.get(b);
        if (parts?.ring) (parts.ring as THREE.Mesh).scale.setScalar(1);
        if (b.stateTime >= 0.4) {
          b.attacksSinceTaunt++;
          if (b.attacksSinceTaunt >= cfg.teleportEvery) {
            b.attacksSinceTaunt = 0;
            b.state = "teleport"; b.stateTime = 0;
            this.fx.burst(new THREE.Vector3(b.pos.x, 1.2, b.pos.z), cfg.tint, 20, { speed: 6, up: 3, life: 0.5 });
          } else {
            this.enterRecover(b, recoverMul);
          }
        }
        break;
      }
      case "slamWindup": {
        b.facing.x = dirX; b.facing.z = dirZ;
        if (b.stateTime >= cfg.fireballWindup) {
          b.state = "slam"; b.stateTime = 0;
          const o = b.pos.clone(); o.y = 2.2;
          projectiles.spawnBolt(o, new THREE.Vector3(dirX, 0, dirZ));
        }
        break;
      }
      case "slam": {
        if (b.stateTime >= 0.3) this.enterRecover(b, recoverMul);
        break;
      }
      case "teleport": {
        b.root.visible = b.stateTime > 0.3;
        if (b.stateTime >= 0.3 && !b.didHitPlayer) {
          b.didHitPlayer = true;
          const ang = Math.random() * Math.PI * 2;
          b.pos.set(
            player.pos.x + Math.cos(ang) * cfg.teleportDist,
            0, player.pos.z + Math.sin(ang) * cfg.teleportDist,
          );
          moveCircle(b.pos, new THREE.Vector3(), dt, cfg.radius, roomMgr.current);
          b.root.visible = true;
          this.fx.burst(new THREE.Vector3(b.pos.x, 1.2, b.pos.z), cfg.tint, 20, { speed: 6, up: 3, life: 0.5 });
        }
        if (b.stateTime >= 0.6) {
          b.didHitPlayer = false;
          this.enterRecover(b, recoverMul);
        }
        break;
      }
      case "recover": {
        if (b.stateTime >= 0.55 * recoverMul) { b.state = "chase"; b.stateTime = 0; }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Storm Elemental — chain lightning + tornado
  // -------------------------------------------------------------------------
  private aiStorm(
    b: BossData, dt: number, dist: number, dirX: number, dirZ: number,
    player: PlayerData, roomMgr: RoomManager, projectiles: ProjectileSystem,
    speedMul: number, recoverMul: number,
  ): void {
    const cfg = BOSSES.storm_elemental;
    switch (b.state) {
      case "chase": {
        b.facing.x = dirX; b.facing.z = dirZ;
        const preferred = 9;
        if (dist > preferred) {
          b.vel.x = dirX * cfg.speed * speedMul;
          b.vel.z = dirZ * cfg.speed * speedMul;
        } else {
          b.vel.x = -dirZ * cfg.speed * 0.6;
          b.vel.z = dirX * cfg.speed * 0.6;
        }
        moveCircle(b.pos, b.vel, dt, cfg.radius, roomMgr.current);
        if (dist <= cfg.boltRange && b.stateTime > 0.9) {
          b.state = "castWindup"; b.stateTime = 0;
        } else if (b.stateTime > 3) {
          b.state = "slamWindup"; b.stateTime = 0;
        }
        break;
      }
      case "castWindup": {
        b.facing.x = dirX; b.facing.z = dirZ;
        if (b.stateTime >= cfg.boltWindup) {
          b.state = "cast"; b.stateTime = 0;
          // chain lightning — cluster of bolts toward the player
          for (let i = 0; i < cfg.chainCount; i++) {
            const jitter = (Math.random() - 0.5) * 0.6;
            const ang = Math.atan2(dirX, dirZ) + jitter;
            const d = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
            const o = b.pos.clone(); o.y = 2.6;
            projectiles.spawnBolt(o, d);
          }
          sfx.bolt();
        }
        break;
      }
      case "cast": {
        if (b.stateTime >= 0.35) this.enterRecover(b, recoverMul);
        break;
      }
      case "slamWindup": {
        // tornado warning ring
        const parts = this.procHandles.get(b);
        if (parts?.ring) (parts.ring as THREE.Mesh).material = new THREE.MeshBasicMaterial({
          color: cfg.tint, transparent: true, opacity: Math.min(0.8, b.stateTime),
        });
        if (b.stateTime >= cfg.tornadoWindup) {
          b.state = "slam"; b.stateTime = 0;
          sfx.bossRoar();
          this.fx.burst(new THREE.Vector3(b.pos.x, 1.2, b.pos.z), cfg.tint, 30, { speed: 5, up: 6, life: 1.0 });
        }
        break;
      }
      case "slam": {
        // sustained ring damage for tornadoLife seconds
        const parts = this.procHandles.get(b);
        if (parts?.ring) (parts.ring as THREE.Mesh).rotation.z += dt * 6;
        if (Math.random() < 0.4) {
          const a = Math.random() * Math.PI * 2;
          const r = 2 + Math.random() * 2;
          const p = new THREE.Vector3(b.pos.x + Math.cos(a) * r, 0.1, b.pos.z + Math.sin(a) * r);
          this.fx.burst(p, cfg.tint, 2, { speed: 3, up: 2, life: 0.3 });
        }
        // small hit every 0.4s while player is close
        if (dist < 2.8 && Math.floor(b.stateTime / 0.4) > b.summonsUsed) {
          b.summonsUsed++;
          damagePlayer(player, cfg.tornadoDamage, b.pos, this.fx, this.events);
        }
        if (b.stateTime >= cfg.tornadoLife) {
          b.summonsUsed = 0;
          const parts2 = this.procHandles.get(b);
          if (parts2?.ring) (parts2.ring as THREE.Mesh).material = new THREE.MeshBasicMaterial({
            color: cfg.tint, transparent: true, opacity: 0,
          });
          this.enterRecover(b, recoverMul);
        }
        break;
      }
      case "recover": {
        if (b.stateTime >= 0.6 * recoverMul) { b.state = "chase"; b.stateTime = 0; }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // shared helpers
  // -------------------------------------------------------------------------
  /** v8: public entry point for player spell damage on any boss. */
  spellHit(b: BossData, dmg: number): void {
    this.hurt(b, dmg, b.pos.clone());
    this.events.onSwordHit("boss", b.pos);
  }

  private hurt(b: BossData, dmg: number, from: THREE.Vector3): void {
    if (b.state === "dying") return;
    const cfg = BOSSES[b.kind];
    // iron_warden while blocking (state "taunt") halves damage
    const damage = (b.kind === "iron_warden" && b.state === "taunt" && !b.enrageAnnounced)
      ? Math.max(1, Math.floor(dmg * 0.5))
      : dmg;
    b.hp -= damage;
    flash(b.root, performance.now() / 1000, 0.18);
    sfx.hitEnemy();
    this.fx.burst(new THREE.Vector3(b.pos.x, 1.8, b.pos.z), 0xfff1c9, 10, { speed: 5, up: 3 });
    const dx = b.pos.x - from.x;
    const dz = b.pos.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    b.vel.set((dx / d) * 5, 0, (dz / d) * 5);
    this.events.onBossBar(Math.max(0, b.hp / b.maxHp));
    if (b.hp <= 0) {
      b.state = "dying"; b.stateTime = 0;
      if (b.anim.actions.size) play(b.anim, ["Death_A", "Death_B"], { loop: false, force: true });
      sfx.enemyDie();
      sfx.victory();
      this.fx.burst(new THREE.Vector3(b.pos.x, 1.2, b.pos.z), cfg.tint === 0xffffff ? 0xffe89a : cfg.tint, 40, {
        speed: 8, up: 6, life: 1.2, scale: 1.4,
      });
    } else {
      b.state = "hurt"; b.stateTime = 0;
      if (b.anim.actions.size) play(b.anim, ["Hit_A", "Hit_B"], { loop: false, force: true, fade: 0.05 });
    }
  }

  private enterRecover(b: BossData, mul: number): void {
    void mul;
    b.state = "recover"; b.stateTime = 0;
    if (b.anim.actions.size) play(b.anim, ["Idle_Combat", "Idle"], { fade: 0.2 });
  }

  private faceTargetSmooth(b: BossData, dt: number): void {
    const ang = Math.atan2(b.facing.x, b.facing.z);
    let diff = ang - b.root.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    b.root.rotation.y += diff * Math.min(1, 6 * dt);
  }

  private commitRoot(b: BossData): void {
    b.root.position.x = b.pos.x;
    b.root.position.z = b.pos.z;
    // procedural bosses hover
    if (b.kind === "flame_djinn" || b.kind === "storm_elemental") {
      b.root.position.y = 0.8 + Math.sin(b.procTime * 2) * 0.15;
    } else if (b.kind === "void_serpent") {
      b.root.position.y = 0.2 + Math.sin(b.procTime * 3) * 0.1;
    }
  }

  /** Cosmetic per-frame animation for procedural bosses (rotations, bobs). */
  private animateProc(b: BossData, dt: number): void {
    const parts = this.procHandles.get(b);
    if (!parts) return;
    if (b.kind === "flame_djinn" && parts.orbs) {
      for (let i = 0; i < parts.orbs.length; i++) {
        const o = parts.orbs[i];
        const ang = b.procTime * 3 + (i / parts.orbs.length) * Math.PI * 2;
        o.position.set(Math.cos(ang) * 1.2, 2.4 + Math.sin(ang * 2) * 0.2, Math.sin(ang) * 1.2);
        o.rotation.x = ang; o.rotation.z = ang * 0.7;
      }
    } else if (b.kind === "storm_elemental" && parts.orbs) {
      for (let i = 0; i < parts.orbs.length; i++) {
        const o = parts.orbs[i];
        const ang = b.procTime * 5 + (i / parts.orbs.length) * Math.PI * 2;
        o.position.set(Math.cos(ang) * 1.5, 2.4, Math.sin(ang) * 1.5);
        o.rotation.z = ang;
      }
      if (parts.core) (parts.core as THREE.Mesh).scale.setScalar(1 + Math.sin(b.procTime * 6) * 0.1);
    } else if (b.kind === "void_serpent" && parts.segments) {
      for (let i = 0; i < parts.segments.length; i++) {
        const s = parts.segments[i];
        s.position.y = 1.4 + Math.sin(b.procTime * 3 - i * 0.5) * 0.5;
        s.rotation.z = Math.sin(b.procTime * 2 - i * 0.4) * 0.3;
      }
    } else if (b.kind === "crystal_golem") {
      if (parts.core) (parts.core as THREE.Mesh).rotation.y = b.procTime;
      if (parts.eyeL && parts.eyeR) {
        const scale = 1 + Math.sin(b.procTime * 4) * 0.2;
        (parts.eyeL as THREE.Mesh).scale.setScalar(scale);
        (parts.eyeR as THREE.Mesh).scale.setScalar(scale);
      }
    }
    void dt;
  }

  /** For main.ts to hook the enemy summoner (necromancer). */
  bindEnemies(enemies: EnemySystem): void {
    this.enemies = enemies;
  }

  /** v8: main.ts wires in spell reward + pickup drop dependencies. */
  bindRewards(spells: SpellSystem, pickups: PickupSystem, player: PlayerData): void {
    this.spells = spells;
    this.pickups = pickups;
    this.player = player;
  }
}

// ---------------------------------------------------------------------------
// tint helper — walks a skeleton root and multiplies each material color by
// the tint hex. Used to make elite skeleton variants visually distinct.
// ---------------------------------------------------------------------------
function tintSkeleton(root: THREE.Object3D, hex: number): void {
  const tint = new THREE.Color(hex);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const apply = (m: THREE.Material) => {
      const mat = m as THREE.MeshLambertMaterial;
      // clone so we don't tint the shared cached material for other skeletons
      const cloned = mat.clone();
      cloned.color = cloned.color.clone().multiply(tint);
      return cloned;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(apply) : apply(mesh.material);
  });
}
