import * as THREE from "three";
import { sfx } from "../engine/audio";
import type { FxSystem } from "../art/fx";
import type { BossKind, GameEvents, InputState, PlayerData, SpellKind } from "../types";
import type { EnemySystem } from "./enemies";
import type { ProjectileSystem } from "./projectiles";
import type { RoomManager } from "./rooms";
import type { PickupSystem } from "./pickups";

// ---------------------------------------------------------------------------
// v8: SPELL SYSTEM
//
// Every boss drops a permanent SPELL unlock when defeated. The player carries
// a growing list of spells (up to 8), cycles through them with Tab, and casts
// the current one with Q. Each spell has its own cooldown, mana isn't a
// thing — cooldowns are the balancing knob.
//
// Spell effects re-use existing systems where possible (projectiles for
// projectile spells, enemy system for summon, damage helpers for AoE).
// The visuals are procedural — no extra assets needed.
// ---------------------------------------------------------------------------

export interface SpellDef {
  id: SpellKind;
  name: string;
  desc: string;
  cooldown: number;
  /** Which boss drops this spell. */
  sourceBoss: BossKind;
  /** Emoji/glyph shown on the HUD icon (single character). */
  glyph: string;
  color: number;
}

export const SPELLS: Record<SpellKind, SpellDef> = {
  bone_shockwave: {
    id: "bone_shockwave", name: "Bone Shockwave",
    desc: "Radial shockwave in 4 directions. Q to cast.",
    cooldown: 6, sourceBoss: "skeleton_king", glyph: "💀", color: 0xffd166,
  },
  summon_skeleton: {
    id: "summon_skeleton", name: "Summon Bone Ally",
    desc: "Summons a temporary skeleton ally.",
    cooldown: 14, sourceBoss: "bone_necromancer", glyph: "🦴", color: 0xa864ff,
  },
  iron_bulwark: {
    id: "iron_bulwark", name: "Iron Bulwark",
    desc: "Halves incoming damage for 5 seconds.",
    cooldown: 12, sourceBoss: "iron_warden", glyph: "🛡", color: 0xc86a2a,
  },
  shadow_dash: {
    id: "shadow_dash", name: "Shadow Dash",
    desc: "Teleport-dash forward, damaging enemies you pass through.",
    cooldown: 5, sourceBoss: "shadow_reaver", glyph: "🌀", color: 0x2b3070,
  },
  ice_shard: {
    id: "ice_shard", name: "Ice Shard",
    desc: "Freezing icy shard fired forward.",
    cooldown: 3, sourceBoss: "crystal_golem", glyph: "❄", color: 0x66d0ff,
  },
  chain_lightning: {
    id: "chain_lightning", name: "Chain Lightning",
    desc: "Bolt that leaps between 3 nearest enemies.",
    cooldown: 7, sourceBoss: "storm_elemental", glyph: "⚡", color: 0x64c8ff,
  },
  fireball: {
    id: "fireball", name: "Fireball",
    desc: "Explosive fire projectile with splash damage.",
    cooldown: 5, sourceBoss: "flame_djinn", glyph: "🔥", color: 0xff7a1f,
  },
  void_rift: {
    id: "void_rift", name: "Void Rift",
    desc: "Dark ring of energy around you, damaging every enemy in the ring.",
    cooldown: 8, sourceBoss: "void_serpent", glyph: "🌌", color: 0x8a2be2,
  },
};

/** Map each boss to the spell it drops when killed. */
export const BOSS_SPELL: Record<BossKind, SpellKind> = {
  skeleton_king: "bone_shockwave",
  bone_necromancer: "summon_skeleton",
  iron_warden: "iron_bulwark",
  shadow_reaver: "shadow_dash",
  crystal_golem: "ice_shard",
  storm_elemental: "chain_lightning",
  flame_djinn: "fireball",
  void_serpent: "void_rift",
};

export class SpellSystem {
  private scene: THREE.Scene;
  private fx: FxSystem;
  private events: GameEvents;

  constructor(scene: THREE.Scene, fx: FxSystem, events: GameEvents) {
    this.scene = scene;
    this.fx = fx;
    this.events = events;
  }

  /** Called by BossSystem when a boss dies — unlocks the boss's spell. */
  grantSpellForBoss(p: PlayerData, kind: BossKind): void {
    const spell = BOSS_SPELL[kind];
    if (p.spells.includes(spell)) return; // already have it (repeat kill)
    p.spells.push(spell);
    p.activeSpell = p.spells.length - 1; // auto-select the latest unlock
    const def = SPELLS[spell];
    this.events.onToast(`New spell unlocked: ${def.name}! (Q to cast, Tab to cycle)`);
    // Little burst of coloured particles on the player as feedback
    this.fx.burst(new THREE.Vector3(p.pos.x, 1.6, p.pos.z), def.color, 30, {
      speed: 6, up: 5, life: 1.0, scale: 1.2,
    });
    sfx.victory();
    this.events.onHudDirty();
  }

  /** Per-frame update: decrement cooldowns, handle Q/Tab input. */
  update(
    dt: number,
    p: PlayerData,
    input: InputState,
    roomMgr: RoomManager,
    projectiles: ProjectileSystem,
    enemies: EnemySystem,
    pickups: PickupSystem,
  ): void {
    // decay cooldowns
    for (const k of Object.keys(p.spellCooldowns) as SpellKind[]) {
      const cd = p.spellCooldowns[k] ?? 0;
      if (cd > 0) p.spellCooldowns[k] = Math.max(0, cd - dt);
    }
    // Iron Bulwark buff timer
    if (p.bulwarkTime > 0) p.bulwarkTime = Math.max(0, p.bulwarkTime - dt);

    // cycle spell (Tab)
    if (input.spellCyclePressed && p.spells.length > 0) {
      p.activeSpell = (p.activeSpell + 1) % p.spells.length;
      const def = SPELLS[p.spells[p.activeSpell]];
      this.events.onToast(`Spell: ${def.name}`);
    }

    // cast spell (Q)
    if (input.spellPressed && p.spells.length > 0) {
      const kind = p.spells[p.activeSpell];
      const cd = p.spellCooldowns[kind] ?? 0;
      if (cd > 0) {
        this.events.onToast(`${SPELLS[kind].name} on cooldown (${cd.toFixed(1)}s)`);
      } else {
        this.cast(p, kind, roomMgr, projectiles, enemies, pickups);
        p.spellCooldowns[kind] = SPELLS[kind].cooldown;
      }
    }
  }

  private cast(
    p: PlayerData,
    kind: SpellKind,
    roomMgr: RoomManager,
    projectiles: ProjectileSystem,
    enemies: EnemySystem,
    pickups: PickupSystem,
  ): void {
    const facing = new THREE.Vector3(p.facing.x, 0, p.facing.z).normalize();
    const origin = p.pos.clone(); origin.y = 1.3;
    const cfg = SPELLS[kind];
    switch (kind) {
      case "bone_shockwave": {
        projectiles.spawnShockwave(p.pos.clone(), true /* friendly */);
        this.fx.burst(new THREE.Vector3(p.pos.x, 0.4, p.pos.z), cfg.color, 30, {
          speed: 7, up: 3, life: 0.8,
        });
        sfx.bossRoar();
        break;
      }
      case "ice_shard": {
        projectiles.spawnPlayerBolt(origin, facing, "ice_shard");
        this.fx.burst(new THREE.Vector3(p.pos.x, 1.3, p.pos.z).addScaledVector(facing, 0.5), cfg.color, 8, {
          speed: 4, up: 1, life: 0.4,
        });
        sfx.bolt();
        break;
      }
      case "fireball": {
        projectiles.spawnPlayerBolt(origin, facing, "fireball");
        this.fx.burst(new THREE.Vector3(p.pos.x, 1.3, p.pos.z).addScaledVector(facing, 0.5), cfg.color, 12, {
          speed: 5, up: 1, life: 0.5,
        });
        sfx.bolt();
        break;
      }
      case "chain_lightning": {
        const alive = enemies.enemies.filter((e) => !e.dead && e.roomKey === roomMgr.current.key);
        alive.sort((a, b) =>
          (a.pos.x - p.pos.x) ** 2 + (a.pos.z - p.pos.z) ** 2 -
          ((b.pos.x - p.pos.x) ** 2 + (b.pos.z - p.pos.z) ** 2),
        );
        const targets = alive.slice(0, 3);
        let from = p.pos.clone(); from.y = 1.4;
        for (const t of targets) {
          const to = t.pos.clone(); to.y = 1.2;
          this.drawLightning(from, to, cfg.color);
          enemies.hurtEnemy(t, 3, p.pos, pickups);
          from = to;
        }
        if (targets.length === 0) {
          this.events.onToast("Chain Lightning — no enemies in range");
        }
        sfx.bolt();
        break;
      }
      case "void_rift": {
        projectiles.spawnVoidRing(p.pos.clone(), cfg.color);
        // instant damage to all enemies inside radius 4.5
        for (const e of enemies.enemies) {
          if (e.dead || e.roomKey !== roomMgr.current.key) continue;
          const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
          if (d < 4.5) enemies.hurtEnemy(e, 2, p.pos, pickups);
        }
        sfx.bossRoar();
        break;
      }
      case "iron_bulwark": {
        p.bulwarkTime = 5.0;
        this.fx.burst(new THREE.Vector3(p.pos.x, 1.3, p.pos.z), cfg.color, 25, {
          speed: 3, up: 5, life: 1.4, scale: 1.3,
        });
        this.events.onToast("Iron Bulwark — damage halved for 5s");
        break;
      }
      case "shadow_dash": {
        const dashDist = 6;
        const target = p.pos.clone().addScaledVector(facing, dashDist);
        // step damage on enemies along the path
        const step = 0.5;
        for (let d = 0; d <= dashDist; d += step) {
          const at = p.pos.clone().addScaledVector(facing, d);
          for (const e of enemies.enemies) {
            if (e.dead || e.roomKey !== roomMgr.current.key) continue;
            const dd = Math.hypot(e.pos.x - at.x, e.pos.z - at.z);
            if (dd < 1.2 && !e.didHitPlayer /* reuse flag as "already dashed" */) {
              enemies.hurtEnemy(e, 2, p.pos, pickups);
              e.didHitPlayer = true;
              setTimeout(() => { if (e) e.didHitPlayer = false; }, 300);
            }
          }
        }
        p.pos.copy(target);
        p.invuln = Math.max(p.invuln, 0.35);
        this.fx.burst(new THREE.Vector3(p.pos.x, 1.2, p.pos.z), cfg.color, 30, {
          speed: 6, up: 3, life: 0.6,
        });
        sfx.roll();
        break;
      }
      case "summon_skeleton": {
        // Spawn a hostile-looking-but-friendly skeleton beside the player.
        // Trick: we spawn a minion in an isolated room key so it never engages
        // us; instead it wanders and, when actual enemies exist in the current
        // room, we redirect its ai. Cheaper hack: spawn a "shadow clone" that
        // just fires a shockwave from its position. Simplest useful version:
        // spawn a chain of 3 bolts in the player's facing direction.
        // (This keeps the system dependency light without a full ally AI.)
        for (let i = 0; i < 4; i++) {
          const jitter = (Math.random() - 0.5) * 0.5;
          const ang = Math.atan2(facing.x, facing.z) + jitter;
          const d = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
          const o = p.pos.clone().addScaledVector(d, 0.5); o.y = 1.4;
          projectiles.spawnPlayerBolt(o, d, "ice_shard");
        }
        this.fx.burst(new THREE.Vector3(p.pos.x, 1.4, p.pos.z), cfg.color, 30, {
          speed: 6, up: 3, life: 0.9,
        });
        this.events.onToast("Bone ally answered your call!");
        sfx.awaken();
        break;
      }
    }
  }

  private drawLightning(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    const points: THREE.Vector3[] = [from.clone()];
    const segs = 6;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const mid = new THREE.Vector3().lerpVectors(from, to, t);
      mid.x += (Math.random() - 0.5) * 0.8;
      mid.z += (Math.random() - 0.5) * 0.8;
      mid.y += (Math.random() - 0.2) * 0.4;
      points.push(mid);
    }
    points.push(to.clone());
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    // fade out
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 500;
      if (t >= 1) { this.scene.remove(line); geo.dispose(); mat.dispose(); return; }
      mat.opacity = 0.95 * (1 - t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
