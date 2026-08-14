import * as THREE from "three";
import { PLAYER } from "../config";
import { buildAnimSet, play } from "../engine/anim";
import { sfx } from "../engine/audio";
import { getAnimations, spawn } from "../engine/loader";
import type { GameEvents, InputState, NpcData, NpcKind, NpcLine, PlayerData } from "../types";
import { moveCircle } from "./physics";
import type { RoomManager } from "./rooms";

// ---------------------------------------------------------------------------
// NPCs — friendly (or restless-dead-but-friendly) characters scattered
// through every room.
//
// Design:
//   • idle → walk → idle cycle within a small radius of their home tile
//     (villagers pace, hermits and ghosts stand still)
//   • face the player and freeze when he steps in range (talk radius)
//   • advance through their line list on each interact press, calling
//     onStory so the dialog UI shows their line
//   • block the player from walking through them (soft push, same treatment
//     as a barrel)
//   • fire onStoryTrigger the first time an NPC is talked to, so the story
//     director can queue a bonus narrator beat
//
// Visuals:
//   • civilian NPCs = tinted "knight" GLB with weapons hidden
//   • guard NPCs    = tinted "knight" GLB WITH sword+shield visible
//   • ghost NPCs    = translucent, blue-emissive skeleton_minion
// ---------------------------------------------------------------------------

const TALK_RADIUS = 3.4;   // world units — press E within this range to talk
const WANDER_RADIUS = 2.2; // how far from home an NPC will drift
const BLOCK_RADIUS = 0.5;  // NPCs push the player at this circle-radius

// tint per kind (h, s, l) — knight body gets tinted, ghost gets special-cased
const TINT: Record<NpcKind, [number, number, number]> = {
  villager:   [0.09, 0.55, 0.52], // warm brown
  elder:      [0.13, 0.75, 0.55], // gold
  merchant:   [0.05, 0.7, 0.5],   // russet orange
  guard:      [0.58, 0.55, 0.5],  // steel blue
  hermit:     [0.68, 0.15, 0.42], // dusty purple-grey
  ghost:      [0.55, 0.6, 0.65],  // pale cyan (overridden with transparency)
  shopkeeper: [0.35, 0.55, 0.5],  // v5: emerald green apron
};

// ---------------------------------------------------------------------------
// Dialog roster — each NPC has an id and 2-4 lines. The id is used as the
// story trigger key ("meet:blacksmith", "meet:elder", ...).
//
// Order matters: LINES_BY_ID is looked up by `roomKey:tx,tz` when the
// builder spawns an NPC, so moving a char in dungeon.ts also moves the id.
// NPCs whose tile isn't in the roster fall back to a generic 1-liner so we
// never crash on unspecified crowds.
// ---------------------------------------------------------------------------

interface NpcSpec {
  id: string;
  name: string;
  kind: NpcKind;
  lines: string[];
}

const ROSTER: Record<string, NpcSpec> = {
  // ---- Willowvale Village -----------------------------------------------
  "0,4:2,2": {
    id: "meet:blacksmith",
    name: "Bram the Blacksmith",
    kind: "guard",
    lines: [
      "Ye look like a fighter. Good. Willowvale needs one.",
      "Something crawls out of the old dungeon each night. Bones. Cold, cold bones.",
      "Take the north road when yer ready. And mind the barracks — I heard my brother's voice in there last week. He's been dead six years.",
      "Your sword's edge holds true. But your ARM decides where it goes. Keep the arm cool.",
    ],
  },
  "0,4:11,2": {
    id: "meet:tavern-mira",
    name: "Mira the Tavern Keeper",
    kind: "villager",
    lines: [
      "Oh, a traveler! Sit, sit. There's stew on the fire.",
      "The elder's been waiting for someone like you. He's the old man in the middle of the square — you can't miss him.",
      "If you find my necklace down there... it was a gift from my mother. Please. Bring it back.",
      "You know what I miss? Music. Nobody sings anymore. When you save us, sing something on your way out.",
    ],
  },
  "0,4:10,4": {
    id: "meet:child",
    name: "Little Wren",
    kind: "villager",
    lines: [
      "Are you a REAL knight? Like in the stories?",
      "Papa says the Skeleton King used to be a good king. A LONG time ago. Before he got sad.",
      "If you fight him — please don't be scared. Being scared makes it worse. Mama says.",
      "I drew you a picture. I'll give it to you when you come back. So you HAVE to come back, okay?",
    ],
  },
  "0,4:2,5": {
    id: "meet:merchant-village",
    name: "Osric the Merchant",
    kind: "merchant",
    lines: [
      "Ah, a customer! Sadly, my caravan hasn't returned from the north road. All my wares are... gone.",
      "If you happen upon crates in the dungeon, break them open! Whatever's inside was mine anyway.",
      "Come back rich, my friend. I'll be here. Probably.",
      "Word of the wise: coins slow you down but heal purses. Hearts heal you. Choose your carry wisely.",
    ],
  },
  "0,4:12,5": {
    id: "meet:merchant-east",
    name: "Yara the Fruit-Seller",
    kind: "merchant",
    lines: [
      "Apples! Fresh apples! ... You have no coins? A pity.",
      "The forest orchards to the east are the last ones still bearing fruit. The rot spreads from the north.",
      "Whatever's under that castle is killing the land. Please. Kill it back.",
      "If you visit Grandfather Row in the orchard — tell him Yara sends her love. He planted every one of those trees.",
    ],
  },
  "0,4:8,6": {
    id: "meet:elder",
    name: "Elder Alden",
    kind: "elder",
    lines: [
      "So. Another one comes to try.",
      "The dungeon below us was the old royal keep. King Malric ruled from its Throne of Bones long before Willowvale was a village.",
      "He was a good man. Then his queen fell to plague, and grief took his mind. He made a bargain with something ancient. Something patient.",
      "Now he sits on that throne as a Skeleton Warrior. His mind is gone. His axe is not. Find the Boss Key in the treasury, unlock the Great Hall's northern door — and end him. For his sake as much as ours.",
      "Go, knight. And listen to the ghosts as you pass. They remember more than we do.",
    ],
  },
  "0,4:9,8": {
    id: "meet:priestess",
    name: "Sister Ivy",
    kind: "villager",
    lines: [
      "Bless you, traveler. Drink from the well — it's still clean, praise the light.",
      "I lay hearts in the barrels down below when I dare. Break every one you find. Some of them still hold a blessing.",
      "The dead down there are not your enemies. Not truly. They are trapped. Cut them down and you free them.",
      "If your shield feels heavy, that's your fear. Set it down for a breath. Then pick it back up.",
    ],
  },
  "0,4:12,11": {
    id: "meet:farmer",
    name: "Old Harl",
    kind: "villager",
    lines: [
      "Aye, another sword-arm come to save us all. That'll be the fifth this year.",
      "The other four didn't come back. Just so you know.",
      "...Bring my son's helm back, if you find one that looks like a badger. Reckon that's all that's left of him.",
      "Bah. I've said too much. Go. And come back, will ye?",
    ],
  },

  // ---- Willowvale Grove (west forest) -----------------------------------
  "-1,4:7,4": {
    id: "meet:grove-woman",
    name: "Weeping Elin",
    kind: "villager",
    lines: [
      "This grove was full of children once. Now it's only me and the birds.",
      "Something calls from the west. A voice like a bell in deep water. I try not to listen.",
      "You look like my brother did, before he went below. Same jaw. Same tired eyes.",
    ],
  },
  "-1,4:10,8": {
    id: "meet:woodcutter",
    name: "Tomas the Woodcutter",
    kind: "villager",
    lines: [
      "Axe-work is honest work. Not like whatever you're doing.",
      "The trees remember, you know. This grove has stood since before the king went mad.",
      "If ye hear singing in the deep — don't answer. Just keep walking.",
    ],
  },

  // ---- Old Orchard (east forest) ----------------------------------------
  "1,4:11,3": {
    id: "meet:orchard-picker",
    name: "Nell the Picker",
    kind: "villager",
    lines: [
      "The apples are smaller every year. And redder. Almost like...",
      "Never mind. Take one if you like. They still taste of home.",
      "The best ones are near the top. Same in life. Reach a little higher.",
    ],
  },
  "1,4:3,8": {
    id: "meet:orchard-old",
    name: "Grandfather Row",
    kind: "villager",
    lines: [
      "I planted every one of these trees. When I was a boy the king himself walked here.",
      "He wore no crown, only a farmer's hat. He said crowns were heavy. He knew, even then.",
      "If you meet him down there — remember he was a farmer too, once. Then swing.",
    ],
  },

  // ---- Southern Woods (hermit's home) -----------------------------------
  "0,5:7,5": {
    id: "meet:hermit",
    name: "Elric the Hermit",
    kind: "hermit",
    lines: [
      "Ha! You found my clearing. Few do.",
      "I was court sorcerer to King Malric, once. I saw what he became. I ran.",
      "The Boss Key is in the treasury on the western branch. Beyond the Great Hall's locked door lies his throne. His axe swings twice — dodge the second.",
      "One last thing: the shockwaves he casts move in cardinal lines. Stand on the diagonals. Live.",
      "You have my blessing. It weighs nothing. It costs nothing. It is all I have left to give.",
    ],
  },

  // ---- DUNGEON GHOSTS: the restless dead --------------------------------
  "-1,3:7,5": {
    id: "meet:ghost-watch",
    name: "Ghost of Sir Adric",
    kind: "ghost",
    lines: [
      "Turn back... turn back, brother. I could not stop what walks below.",
      "I hear his axe in my bones. He does not remember me. I served him for thirty years.",
      "Take my blade, if you can find one. Cut deeper than I did.",
    ],
  },
  "1,3:8,3": {
    id: "meet:ghost-barracks",
    name: "Ghost of Captain Roswin",
    kind: "ghost",
    lines: [
      "The barracks are quiet now. Once we drilled here every dawn.",
      "The king ordered us into the treasury to guard the key from his own hand. He knew what he was becoming.",
      "We failed him. He locked us in. He locked himself in too.",
    ],
  },
  "-2,2:7,6": {
    id: "meet:ghost-prisoner",
    name: "Ghost of the Prisoner",
    kind: "ghost",
    lines: [
      "Water... no. I don't need that anymore. Habit dies slowly.",
      "I was thrown here for speaking against the queen's burial rites. She rose again, you see. And no one wanted to hear it.",
      "Cut him down. Not for vengeance. For rest.",
    ],
  },
  "-1,2:7,6": {
    id: "meet:ghost-armorer",
    name: "Ghost of Fenn the Armorer",
    kind: "ghost",
    lines: [
      "I forged his axe. Fine steel. I regret every strike of the hammer.",
      "There is no shame in fleeing this room, if you must. There is shame in dying stupidly.",
    ],
  },
  "1,2:7,4": {
    id: "meet:ghost-mage",
    name: "Ghost of Archmage Cyn",
    kind: "ghost",
    lines: [
      "The magi guarded these halls. Now we haunt them.",
      "The bolts they fling are our old spells, twisted. Roll through them — the intent inside is hollow.",
    ],
  },
  "-1,1:7,1": {
    id: "meet:ghost-treasurer",
    name: "Ghost of Steward Bael",
    kind: "ghost",
    lines: [
      "The Boss Key is in the great chest at the north. I put it there myself.",
      "I locked it with the last strength I had. I hope you find it. I hope you use it well.",
    ],
  },
  "1,1:7,1": {
    id: "meet:ghost-sorcerer",
    name: "Ghost of the Court Sorcerer",
    kind: "ghost",
    lines: [
      "You are close now. The king sits just beyond the northern hall.",
      "When you strike him — do not hate him. He was kind, once. Hate makes for poor swordsmanship.",
    ],
  },
  "0,0:7,10": {
    id: "meet:ghost-king-echo",
    name: "Echo of King Malric",
    kind: "ghost",
    lines: [
      "...Is that you, my queen?",
      "No. A knight. A young one. You have come to kill me. Good.",
      "Try to remember, when you swing — I was a man, once. And I loved this valley.",
      "Do not fail. If you fall here, another must come, and another. Break the chain, knight. Please.",
    ],
  },

  // v6 — Willowvale Village shopkeeper (moved south from the Frozen Frontier
  // so the shop lives beside the produce cart, right in the market strip).
  // Note: shopkeepers open the shop on first E press — this `lines` array is
  // kept only for the story trigger id and as a safety net; the flavor text
  // that the player actually sees is inside the shop overlay header.
  "0,4:5,9": {
    id: "meet:shopkeeper-inga",
    name: "Inga the Trader",
    kind: "shopkeeper",
    lines: [
      "Welcome to my stall, knight.",
    ],
  },

  // v5 — Frozen Frontier (-2,4)
  "-2,4:3,4": {
    id: "meet:snow-villager",
    name: "Hilde of the Frontier",
    kind: "villager",
    lines: [
      "The road east is still frozen. Best travel by daylight.",
      "Inga packed up and moved to Willowvale last month. Bad for trade up here, good for her.",
      "I heard wolves in the pines last night. Watch yourself.",
    ],
  },
  "-2,4:5,8": {
    id: "meet:snow-child",
    name: "Little Otto",
    kind: "villager",
    lines: [
      "Are you a real knight? Mama says knights don't come here anymore.",
      "The snow used to melt in spring. Now it never does.",
    ],
  },

  // v5 — Sunflower Meadow (2,4)
  "2,4:11,3": {
    id: "meet:meadow-druid",
    name: "Alva the Beekeeper",
    kind: "hermit",
    lines: [
      "The bees keep the flowers, and the flowers keep the sun.",
      "Bandits been thicker this year. Two of the raiders came through yesterday — watch the tall grass.",
      "If you free the dungeon, I'll bring honey to the village. Been years.",
    ],
  },
  "2,4:2,7": {
    id: "meet:meadow-hermit",
    name: "Old Roric",
    kind: "hermit",
    lines: [
      "I used to be a soldier. Now I just watch the bees.",
      "Take the bandit's coin. They took plenty from folk who couldn't spare it.",
    ],
  },

  // v5 — Silverpine Woods (1,5)
  "1,5:7,6": {
    id: "meet:pine-hermit",
    name: "Bern the Woodsman",
    kind: "hermit",
    lines: [
      "Pines are old. Older than the dungeon. They remember the good king.",
      "Skeletons been walking the trails. If one gets in your face, DODGE first, then strike.",
      "Take the eastern path if you dare — the wetlands beyond are cursed.",
    ],
  },

  // v5 — Whispering Wetlands (2,5)
  "2,5:7,6": {
    id: "meet:wetland-hermit",
    name: "Vala the Marsh-Witch",
    kind: "hermit",
    lines: [
      "You reek of iron. The bog does not like iron.",
      "Mages come here to die. Their bones do not stay buried.",
      "The frozen north hides more than merchants. Look for a shrine.",
    ],
  },
};

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

/** Build a stable key from room + tile so ROSTER lookups match dungeon.ts. */
function specKey(roomKey: string, tx: number, tz: number): string {
  return `${roomKey}:${tx},${tz}`;
}

function tintNpc(root: THREE.Object3D, kind: NpcKind): void {
  const [h, s, l] = TINT[kind];
  const color = new THREE.Color().setHSL(h, s, l);
  const isGhost = kind === "ghost";
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const apply = (m: THREE.Material): THREE.Material => {
      const src = m as THREE.MeshLambertMaterial;
      const mat = new THREE.MeshLambertMaterial({
        map: src.map ?? null,
        color: color.clone(),
        transparent: isGhost,
        opacity: isGhost ? 0.55 : 1,
        emissive: isGhost ? new THREE.Color(0x66aaff) : new THREE.Color(0x000000),
        emissiveIntensity: isGhost ? 0.6 : 0,
        side: src.side,
      });
      return mat;
    };
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(apply);
    else mesh.material = apply(mesh.material);
  });
}

export class NpcSystem {
  npcs: NpcData[] = [];
  private scene: THREE.Scene;
  private events: GameEvents;
  private triggeredIds = new Set<string>();

  /** the NPC currently in talk range (null if none) — read by hud for the prompt */
  activeNpc: NpcData | null = null;

  constructor(scene: THREE.Scene, events: GameEvents) {
    this.scene = scene;
    this.events = events;
  }

  spawn(kind: NpcKind, pos: THREE.Vector3, roomKey: string, tx: number, tz: number): NpcData {
    // Pick the character model. Ghosts use a skeleton_minion asset because
    // it's already boney; everything else reskins the knight.
    const assetKey = kind === "ghost" ? "skeleton_minion" : "knight";
    const root = spawn(assetKey, { castShadow: kind !== "ghost" });
    root.position.copy(pos);
    tintNpc(root, kind);
    this.scene.add(root);

    // Hide the knight's offhand items (sword/shield) for civilian NPCs so
    // they don't look like they're about to fight the player. Guards keep
    // their sword/shield.
    if (assetKey === "knight") {
      const HIDE = ["1H_Sword_Offhand", "Badge_Shield", "Rectangle_Shield", "Spike_Shield", "2H_Sword"];
      if (kind === "merchant" || kind === "elder" || kind === "villager" || kind === "hermit") {
        HIDE.push("1H_Sword");
      }
      root.traverse((o) => { if (HIDE.includes(o.name)) o.visible = false; });
    }

    const anim = buildAnimSet(root, getAnimations(assetKey));
    play(anim, ["Idle"], { force: true });

    // Resolve spec from ROSTER, or fall back to a generic 1-liner.
    const spec = ROSTER[specKey(roomKey, tx, tz)];
    const lines: NpcLine[] = spec
      ? spec.lines.map((t) => ({ who: spec.name, text: t }))
      : [{
          who: prettyKind(kind),
          text: fallbackLine(kind),
        }];
    const id = spec?.id ?? `unnamed:${roomKey}:${tx},${tz}`;

    const npc: NpcData = {
      id,
      kind,
      root,
      anim,
      state: "idle",
      stateTime: 0,
      pos: pos.clone(),
      home: pos.clone(),
      facing: { x: 0, z: 1 },
      lines,
      lineIdx: 0,
      roomKey,
      wanderTarget: pos.clone(),
      wanderCooldown: 1 + Math.random() * 2,
      lastTalkedAt: -999,
    };
    // start with a random facing so a crowd doesn't look like a firing squad
    const a = Math.random() * Math.PI * 2;
    npc.facing.x = Math.sin(a);
    npc.facing.z = Math.cos(a);
    root.rotation.y = a;

    this.npcs.push(npc);
    return npc;
  }

  update(dt: number, player: PlayerData, roomMgr: RoomManager, input: InputState): void {
    const room = roomMgr.current;
    let bestActive: NpcData | null = null;
    let bestDist = Infinity;

    for (const npc of this.npcs) {
      // v11: skip mixer for NPCs in other rooms — they're invisible, ticking
      // their skinned-mesh mixer just eats CPU. When the player returns they
      // resume from the current pose (idle) which is fine.
      if (npc.roomKey !== room.key) continue;
      npc.stateTime += dt;
      npc.anim.mixer.update(dt);

      const d = Math.hypot(player.pos.x - npc.pos.x, player.pos.z - npc.pos.z);

      // face + freeze when the knight is in talk range
      if (d < TALK_RADIUS) {
        npc.state = "talking";
        npc.stateTime = 0;
        const dx = player.pos.x - npc.pos.x;
        const dz = player.pos.z - npc.pos.z;
        const norm = Math.hypot(dx, dz) || 1;
        npc.facing.x = dx / norm;
        npc.facing.z = dz / norm;
        play(npc.anim, ["Idle"], { fade: 0.2 });

        if (d < bestDist) {
          bestDist = d;
          bestActive = npc;
        }
      } else {
        // wander: only villagers, merchants, elders, and guards wander;
        // hermits and ghosts stand still (adds character).
        const canWander =
          npc.kind === "villager" ||
          npc.kind === "merchant" ||
          npc.kind === "elder" ||
          npc.kind === "guard";
        if (!canWander) {
          play(npc.anim, ["Idle"], { fade: 0.25 });
        } else {
          npc.wanderCooldown -= dt;
          if (npc.state === "idle") {
            if (npc.wanderCooldown <= 0) {
              const a = Math.random() * Math.PI * 2;
              const r = Math.random() * WANDER_RADIUS;
              npc.wanderTarget.set(
                npc.home.x + Math.cos(a) * r,
                0,
                npc.home.z + Math.sin(a) * r,
              );
              npc.state = "walk";
              npc.stateTime = 0;
              npc.wanderCooldown = 2 + Math.random() * 2;
              play(npc.anim, ["Walking_A", "Walking_D_Skeletons"], { fade: 0.25 });
            } else {
              play(npc.anim, ["Idle"], { fade: 0.25 });
            }
          } else if (npc.state === "walk") {
            const dx = npc.wanderTarget.x - npc.pos.x;
            const dz = npc.wanderTarget.z - npc.pos.z;
            const dd = Math.hypot(dx, dz);
            if (dd < 0.3 || npc.stateTime > 3.5) {
              npc.state = "idle";
              npc.stateTime = 0;
              npc.wanderCooldown = 1.4 + Math.random() * 1.8;
            } else {
              const speed = 2.0;
              const vx = (dx / dd) * speed;
              const vz = (dz / dd) * speed;
              npc.facing.x = dx / dd;
              npc.facing.z = dz / dd;
              const vel = new THREE.Vector3(vx, 0, vz);
              moveCircle(npc.pos, vel, dt, 0.45, room);
            }
          }
        }
      }

      // face
      const ang = Math.atan2(npc.facing.x, npc.facing.z);
      let diff = ang - npc.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      npc.root.rotation.y += diff * Math.min(1, 8 * dt);
      npc.root.position.copy(npc.pos);

      // ghosts bob and pulse slightly
      if (npc.kind === "ghost") {
        npc.root.position.y = Math.sin(npc.stateTime * 2 + npc.pos.x) * 0.15 + 0.15;
      }

      // block the player from walking through them
      if (d < PLAYER.radius + BLOCK_RADIUS + 0.05) {
        const dx = player.pos.x - npc.pos.x;
        const dz = player.pos.z - npc.pos.z;
        const dd = Math.hypot(dx, dz) || 1;
        const push = (PLAYER.radius + BLOCK_RADIUS) - dd;
        if (push > 0) {
          player.pos.x += (dx / dd) * push;
          player.pos.z += (dz / dd) * push;
        }
      }
    }

    this.activeNpc = bestActive;

    // interact: advance dialog on this NPC
    if (bestActive && input.interactPressed) {
      const npc = bestActive;

      // v6 fix: shopkeepers open the shop on the FIRST E press. Personality
      // (the flavor line) lives inside the shop overlay header now, so we
      // don't waste an interaction on an intro line that gets covered by
      // the overlay two frames later. The old "press E again" pattern felt
      // like a freeze because nobody reads the intro before pressing again.
      if (npc.kind === "shopkeeper") {
        sfx.npcTalk();
        // fire the trigger once so story director sees "met the shopkeeper"
        if (!this.triggeredIds.has(npc.id)) {
          this.triggeredIds.add(npc.id);
          this.events.onStoryTrigger(npc.id);
        }
        npc.lastTalkedAt = performance.now() / 1000;
        this.events.onOpenShop();
        return;
      }

      const line = npc.lines[npc.lineIdx];
      this.events.onStory(line.who, line.text);
      sfx.npcTalk(); // brief two-note blip that isn't the coin ping
      npc.lineIdx = (npc.lineIdx + 1) % npc.lines.length;
      npc.lastTalkedAt = performance.now() / 1000;
      // fire the story trigger once per id
      if (!this.triggeredIds.has(npc.id)) {
        this.triggeredIds.add(npc.id);
        this.events.onStoryTrigger(npc.id);
      }
    }
  }

  clearAll(): void {
    for (const n of this.npcs) this.scene.remove(n.root);
    this.npcs = [];
    this.triggeredIds.clear();
    this.activeNpc = null;
  }
}

function prettyKind(k: NpcKind): string {
  return k[0].toUpperCase() + k.slice(1);
}

function fallbackLine(k: NpcKind): string {
  switch (k) {
    case "villager":   return "Peace on you, traveler. Mind the north road.";
    case "elder":      return "The old stones remember. Walk softly here.";
    case "merchant":   return "Trade's slow. Bring coin next time.";
    case "guard":      return "Halt — nay, pass. You look honest enough.";
    case "hermit":     return "Few come this far. Fewer return.";
    case "ghost":      return "Cold... so cold. Please, cut me free.";
    case "shopkeeper": return "Come warm yourself. My wares'll keep you alive.";
  }
}
