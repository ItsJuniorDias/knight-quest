# Music files — drop MP3s here and the game uses them automatically

The audio engine (`src/engine/audio.ts`) checks this folder on first play of
each track. If the MP3 exists, it streams the file with a smooth crossfade.
If not, it falls back to the procedural chip-tune synth for that track.

**You can migrate one track at a time.** Drop just `village.mp3` and only
Willowvale gets the new music; the rest stay procedural until you replace them.

## Expected filenames

| filename       | when it plays                                                                |
| -------------- | ---------------------------------------------------------------------------- |
| `title.mp3`    | title screen (before you press Start)                                        |
| `village.mp3`  | Willowvale hub + snow biome (Frozen Frontier) + meadow                       |
| `forest.mp3`   | forest / pine / wetland biomes (Willowvale Grove, Silverpine, Whispering)   |
| `dungeon.mp3`  | dungeon rooms (Treasury, Great Hall, Armory, Watchpost, etc.)                |
| `boss.mp3`     | Throne of Bone (boss room)                                                   |
| `victory.mp3`  | after killing the boss (**does NOT loop** — one-shot fanfare)                |
| `gameover.mp3` | after dying (**does NOT loop** — one-shot descending sting)                  |

## Format & size

- **Format:** MP3 (widest browser support). OGG works too if you rename the
  extension in `MUSIC_FILES` in `audio.ts`, and Safari added OGG support in
  iOS 17.5, so MP3 is only strictly needed for older iOS.
- **Bitrate:** 128kbps is plenty for looping ambient music. 192kbps if you
  want higher fidelity for the boss track. Above that is waste.
- **Length:** 60–120 seconds is ideal for loops. Suno usually gives you 60s
  in free tier and 120s in Pro — both work.
- **Loop points:** Suno doesn't do seamless loops by default. See the "Making
  it loop cleanly" section below.
- **Size budget:** aim for each file under 2MB. Total 7 tracks ≈ 10–14MB
  extra in the assets folder. Your bundle is already 60MB so this is fine.

## Suno prompts

Paste these into Suno (or Udio, similar workflow). The bracketed style tag
goes at the start. Iterate if the first result doesn't match — Suno's output
is stochastic, run 3–4 times per track and pick the best.

### `title.mp3` — hopeful, slow, sparse
```
[medieval fantasy adventure, orchestral, hopeful, slow tempo 70bpm]
A gentle rising theme, soft strings and a distant horn, sparse and open,
evoking the start of a heroic quest. Instrumental only, no vocals.
Ambient, cinematic, room to breathe.
```

### `village.mp3` — pastoral, warm, folk
```
[medieval village folk, gentle, warm, 78bpm, C major]
A pastoral loop with acoustic strings (lute, fiddle), light hand percussion,
soft flute counter-melody. Cozy, peaceful, small-town market feel.
Instrumental only. Should loop naturally with no dramatic build.
```

### `forest.mp3` — mysterious, minor, exploratory
```
[fantasy forest exploration, mysterious, minor mode, 70bpm]
Pentatonic flute or ocarina over a low sustained drone, distant harp notes,
soft wind ambience. A minor. Instrumental only. Slightly haunting but not
scary — the woods are quiet, not threatening.
```

### `dungeon.mp3` — brooding, tense, low
```
[dark dungeon crawler, brooding, tense, 90bpm, minor]
Low drone bass, sparse marimba or pizzicato strings, distant metallic taps,
soft heartbeat percussion. D minor. Ominous but not action-intense — this
is exploration music, not combat. Instrumental only.
```

### `boss.mp3` — driving, aggressive
```
[epic boss battle, driving, aggressive, 140bpm, minor]
Heavy percussion, low brass, urgent strings, choir stabs on the downbeat.
D minor. Intense and relentless. Instrumental only. Should loop hot —
no long calm section, keep the tension constant.
```

### `victory.mp3` — triumphant fanfare (short, no loop)
```
[medieval victory fanfare, triumphant, major key, 15 seconds]
Brass fanfare, timpani hits, choir "ah", resolving to a major chord.
C major or D major. Instrumental only. Short one-shot — no loop.
```

### `gameover.mp3` — sad descent (short, no loop)
```
[fantasy death theme, sad, descending, minor, 12 seconds]
Low strings descending, distant tolling bell, soft piano. Melancholy but
not dramatic. Instrumental only. Short one-shot — no loop.
```

## Making Suno loops cleanly

Suno tracks have intros and outros that break loop-ability. Two options:

**Quick (30 sec fix):** open the file in Audacity, cut off the first 2–5
seconds (intro fade-in) and the last 2–5 seconds (outro fade-out), export.
The middle portion loops much better because Suno's mid-section is usually
consistent tempo/mood.

**Better (2 min):** use Audacity's "Effect → Fade In" on the first 100ms and
"Fade Out" on the last 100ms of the cut file, so the loop crossfade has a
gentle blend point instead of a hard cut.

**Best (5 min):** in Audacity, find a bar boundary near the start and end,
crossfade the last 500ms of the track with the first 500ms so the seam is
invisible. There are YouTube tutorials for "seamless loop audacity" that
walk through this.

The engine's `HTMLAudioElement.loop = true` will restart the file instantly
at the end — any silence or click at the boundary will be audible.

## Testing

After dropping a file, hard-reload (Cmd+Shift+R on desktop, Safari > Clear
History on iOS) to bypass the browser cache. Then:

- Walk into Willowvale → should hear `village.mp3` if present
- Walk into a dungeon room → `dungeon.mp3`
- Enter Throne of Bone → `boss.mp3`
- Die → `gameover.mp3` (one-shot)
- Kill the boss → `victory.mp3` (one-shot)

If a file isn't picked up, open DevTools Network tab and check that the
`assets/music/<track>.mp3` request returned 200. If it's 404, the filename
is wrong. If it's 200 but you hear procedural, check the console for a
decode error.

## Volume balance

Each track has a per-track `gain` in `MUSIC_FILES` in `audio.ts`
(0.9 by default, 1.0 for boss and victory since those tend to be quieter
in Suno exports). Bump individual tracks up or down there if one feels loud
or quiet relative to the SFX. Master music gain lives in `musicGain.gain`
(currently 0.34) so both procedural and file music sit at the same level
relative to the sword swings and NPC blips.
