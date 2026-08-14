import type { GameEvents } from "../types";

// ---------------------------------------------------------------------------
// STORY — narrative director.
//
// The game has three narrative sources:
//   1. Room-entry beats — one line per room, first time the player enters.
//   2. NPC trigger beats — some NPC IDs fire an EXTRA narrator line the
//      first time the player talks to them (e.g. hearing the elder unlocks
//      the "quest begins" line).
//   3. Item beats — picking up the boss key, unlocking the boss door,
//      killing the boss, etc.
//
// Every beat is stored as a one-shot: the director keeps a Set of ids it
// has already fired and refuses to repeat. Beats are just callbacks that
// hit events.onStory, so all rendering lives in Hud.narrate().
//
// The narrator ("who = null") speaks like a chronicler. Named beats speak
// as an in-world character. The Hud shows both, but styles them differently.
// ---------------------------------------------------------------------------

interface Beat {
  id: string;
  who: string | null; // null = narrator; otherwise a speaker name
  text: string;
  /** delay in ms after triggering before the line appears (for a pause) */
  delay?: number;
}

// ---- room-entry beats: fires the first time the player enters a room ----
const ROOM_BEATS: Record<string, Beat[]> = {
  "0,4": [
    { id: "room:0,4", who: null, text: "Willowvale rests uneasy in the pale sun. Even the crows are quiet." },
  ],
  "0,5": [
    { id: "room:0,5", who: null, text: "The southern woods swallow the village noise. Something old lives here." },
  ],
  "-1,4": [
    { id: "room:-1,4", who: null, text: "The grove is a cathedral of leaves. A child's laugh echoes and is gone." },
  ],
  "1,4": [
    { id: "room:1,4", who: null, text: "The orchard rows stand in neat, dying columns. The last harvest ripens." },
  ],
  "0,3": [
    { id: "room:0,3", who: null, text: "You cross the threshold of the old keep. The air turns cold. The stone remembers." },
  ],
  "-1,3": [
    { id: "room:-1,3", who: null, text: "This was the outer watchpost. The soldiers here died at their posts." },
  ],
  "1,3": [
    { id: "room:1,3", who: null, text: "The barracks. Beds still stand. The men in them do not." },
  ],
  "-2,2": [
    { id: "room:-2,2", who: null, text: "A forgotten cell. Someone marked the days on the wall. Then stopped counting." },
  ],
  "-1,2": [
    { id: "room:-1,2", who: null, text: "The armory. Every rack is bare — the weapons walk on their own now." },
  ],
  "0,2": [
    { id: "room:0,2", who: null, text: "A crossing of four halls. Every door leads deeper. Every door leads to him." },
  ],
  "1,2": [
    { id: "room:1,2", who: null, text: "The Hall of Mages. Purple fire crackles between the columns. Stay light on your feet." },
  ],
  "-1,1": [
    { id: "room:-1,1", who: null, text: "The Treasury. Coin means nothing to the dead. But the KEY... the key means everything to YOU." },
  ],
  "0,1": [
    { id: "room:0,1", who: null, text: "The Great Hall. Once, banquets. Once, laughter. The northern door is sealed against the throne itself." },
  ],
  "1,1": [
    { id: "room:1,1", who: null, text: "The Sorcerer's Den. He still casts, in his sleep. His sleep never ends." },
  ],
  "0,0": [
    { id: "room:0,0", who: null, text: "The Throne of Bones. And on it — a king who cannot die, wielding an axe that cannot be dropped." },
  ],
};

// ---- NPC-trigger beats: extra narration fired the first time the player
// finishes talking to a particular NPC. `id` matches NpcSpec.id.
const NPC_BEATS: Record<string, Beat[]> = {
  "meet:elder": [
    { id: "elder-quest", who: null, text: "So the quest is spoken aloud. It becomes real, the way stories always do.", delay: 900 },
  ],
  "meet:hermit": [
    { id: "hermit-warning", who: null, text: "The hermit's warning coils in your chest. Two swings. Diagonals. Live.", delay: 900 },
  ],
  "meet:ghost-treasurer": [
    { id: "treasurer-hint", who: null, text: "The Boss Key is close. Watch the chest with the golden clasp.", delay: 900 },
  ],
  "meet:ghost-king-echo": [
    { id: "king-echo", who: null, text: "The king's own voice, thin as smoke. He is not gone. Not yet. Not quite.", delay: 900 },
  ],
};

// ---- item / event beats: fired imperatively from game code ----
export const EVENT_BEATS: Record<string, Beat[]> = {
  "got:bosskey": [
    { id: "got-bosskey", who: null, text: "The Boss Key is heavy in your hand. Warm, almost. It knows where it's going." },
  ],
  "unlocked:bossdoor": [
    { id: "unlocked-bossdoor", who: null, text: "The northern door of the Great Hall grinds open. Beyond it — the throne. Beyond it — the end." },
  ],
  "boss:awake": [
    { id: "boss-awake", who: null, text: "The Skeleton King stands. He remembers your face. He does not remember his own." },
  ],
  "boss:enraged": [
    { id: "boss-enrage", who: null, text: "His axe glows. His step quickens. He fights not for himself now — for what he was." },
  ],
  "boss:dead": [
    { id: "boss-dead", who: null, text: "The king falls. Bone becomes dust. Dust becomes wind. The valley exhales for the first time in a hundred years." },
  ],
  "boss:dead:skeleton_king": [
    { id: "boss-dead-king", who: null, text: "Malric falls. The northern arch groans open — the Coliseum wing awaits the truly foolish." },
  ],
  "boss:dead:bone_necromancer": [{ id: "boss-dead-necro", who: null, text: "The Necromancer's runes flicker and die. His summoned dead lie still at last." }],
  "boss:dead:shadow_reaver": [{ id: "boss-dead-reaver", who: null, text: "The Reaver dissolves. Even shadows can be cut." }],
  "boss:dead:iron_warden": [{ id: "boss-dead-warden", who: null, text: "The Warden's armor rings like a bell, then goes still." }],
  "boss:dead:crystal_golem": [{ id: "boss-dead-golem", who: null, text: "The Golem shatters. Its heart-gem rolls to your feet." }],
  "boss:dead:void_serpent": [{ id: "boss-dead-serpent", who: null, text: "The Serpent's coils unwind into the void from which they came." }],
  "boss:dead:flame_djinn": [{ id: "boss-dead-djinn", who: null, text: "The Djinn implodes. Where he stood, only warm ash remains." }],
  "boss:dead:storm_elemental": [{ id: "boss-dead-storm", who: null, text: "The Elemental discharges its final spark. The Coliseum falls silent." }],
  "start:game": [
    { id: "start-game", who: null, text: "You are the knight the village has been waiting for. Whether you know it or not." },
  ],
};

export class StoryDirector {
  private fired = new Set<string>();
  private events: GameEvents;

  constructor(events: GameEvents) {
    this.events = events;
  }

  reset(): void {
    this.fired.clear();
  }

  private fire(beat: Beat): void {
    if (this.fired.has(beat.id)) return;
    this.fired.add(beat.id);
    if (beat.delay && beat.delay > 0) {
      window.setTimeout(() => this.events.onStory(beat.who, beat.text), beat.delay);
    } else {
      this.events.onStory(beat.who, beat.text);
    }
  }

  onRoomChanged(key: string): void {
    const beats = ROOM_BEATS[key];
    if (!beats) return;
    for (const b of beats) this.fire(b);
  }

  onNpcTrigger(id: string): void {
    const beats = NPC_BEATS[id];
    if (!beats) return;
    for (const b of beats) this.fire(b);
  }

  onEvent(key: string): void {
    const beats = EVENT_BEATS[key];
    if (!beats) return;
    for (const b of beats) this.fire(b);
  }
}
