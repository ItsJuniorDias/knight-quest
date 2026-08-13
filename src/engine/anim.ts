import * as THREE from "three";
import type { AnimSet } from "../types";

// ---------------------------------------------------------------------------
// Animation plumbing
//
// KayKit characters ship 76-95 clips with stable names ("Idle", "Running_A",
// "1H_Melee_Attack_Slice_Horizontal", ...). We build an action map once per
// character and switch with crossfades. `play` accepts a list of candidate
// names so callers can express fallbacks ("Running_A" then "Walking_A").
// ---------------------------------------------------------------------------

export function buildAnimSet(
  root: THREE.Object3D,
  clips: THREE.AnimationClip[],
): AnimSet {
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of clips) {
    actions.set(clip.name, mixer.clipAction(clip));
  }
  return { mixer, actions, current: null };
}

function resolve(anim: AnimSet, candidates: string[]): string | null {
  for (const name of candidates) {
    if (anim.actions.has(name)) return name;
  }
  // last resort: substring match, keeps us alive if a pack renames a clip
  const lowered = candidates.map((c) => c.toLowerCase());
  for (const key of anim.actions.keys()) {
    const lk = key.toLowerCase();
    if (lowered.some((c) => lk.includes(c))) return key;
  }
  return null;
}

export interface PlayOpts {
  fade?: number;
  loop?: boolean;
  timeScale?: number;
  /** restart even if this clip is already playing */
  force?: boolean;
}

export function play(anim: AnimSet, candidates: string[], opts: PlayOpts = {}): void {
  const name = resolve(anim, candidates);
  if (!name) return;
  if (anim.current === name && !opts.force) return;

  const fade = opts.fade ?? 0.15;
  const next = anim.actions.get(name)!;
  const prev = anim.current ? anim.actions.get(anim.current) : undefined;

  next.reset();
  next.setLoop(opts.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
  next.clampWhenFinished = opts.loop === false;
  next.timeScale = opts.timeScale ?? 1;
  next.enabled = true;

  if (prev && prev !== next) {
    next.crossFadeFrom(prev, fade, false);
  }
  next.play();
  anim.current = name;
}

/** Duration in seconds of the first matching clip, or a fallback. */
export function clipDuration(anim: AnimSet, candidates: string[], fallback: number): number {
  const name = resolve(anim, candidates);
  if (!name) return fallback;
  const action = anim.actions.get(name)!;
  return action.getClip().duration;
}
