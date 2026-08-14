import { PLAYER } from "../config";
import { SPELLS } from "../systems/spells";
import type { NpcData, PlayerData } from "../types";

// ---------------------------------------------------------------------------
// HUD — hearts, coins, boss key indicator, boss bar, plus (v3):
//   • narrator/dialog panel at the bottom of the screen ("Elder Alden: ...")
//   • floating INTERACT prompt when an NPC or door is in range
//   • combo counter that follows the player's rolling streak
//
// All DOM; cheap on the GPU, easy to restyle. Text panels animate in with
// pure CSS transitions defined in index.html.
// ---------------------------------------------------------------------------

export class Hud {
  private hearts: HTMLElement;
  private coins: HTMLElement;
  private keyIcon: HTMLElement;
  private roomLabel: HTMLElement;
  private bossBar: HTMLElement;
  private bossFill: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer: number | null = null;

  private narrPanel: HTMLElement;
  private narrSpeaker: HTMLElement;
  private narrText: HTMLElement;
  private narrTimer: number | null = null;
  private narrQueue: { who: string | null; text: string }[] = [];

  private interactPrompt: HTMLElement;

  private comboBadge: HTMLElement;
  private chargeBar: HTMLElement;
  private chargeFill: HTMLElement;
  private spellBar: HTMLElement;

  constructor(mount: HTMLElement) {
    mount.innerHTML = `
      <div id="hud-top">
        <div id="hud-hearts"></div>
        <div id="hud-right">
          <div id="hud-key" class="hidden">🔑</div>
          <div id="hud-coins">💰 <span>0</span></div>
        </div>
      </div>
      <div id="hud-combo" class="hidden"><span class="cx"></span><span class="clabel">COMBO</span></div>
      <div id="hud-charge" class="hidden"><div id="hud-charge-fill"></div></div>
      <div id="hud-room-label"></div>
      <div id="hud-boss-bar" class="hidden">
        <div id="hud-boss-fill"></div>
        <div id="hud-boss-label">SKELETON WARRIOR</div>
      </div>
      <div id="hud-toast" class="hidden"></div>
      <div id="hud-interact" class="hidden"><span class="key">E</span> <span class="lbl">Talk</span></div>
      <div id="hud-narrator" class="hidden">
        <div id="hud-narr-speaker"></div>
        <div id="hud-narr-text"></div>
      </div>
      <div id="hud-spells" class="hidden"></div>
    `;
    this.hearts = mount.querySelector("#hud-hearts")!;
    this.coins = mount.querySelector("#hud-coins span")!;
    this.keyIcon = mount.querySelector("#hud-key")!;
    this.roomLabel = mount.querySelector("#hud-room-label")!;
    this.bossBar = mount.querySelector("#hud-boss-bar")!;
    this.bossFill = mount.querySelector("#hud-boss-fill")!;
    this.toastEl = mount.querySelector("#hud-toast")!;
    this.narrPanel = mount.querySelector("#hud-narrator")!;
    this.narrSpeaker = mount.querySelector("#hud-narr-speaker")!;
    this.narrText = mount.querySelector("#hud-narr-text")!;
    this.interactPrompt = mount.querySelector("#hud-interact")!;
    this.comboBadge = mount.querySelector("#hud-combo")!;
    this.chargeBar = mount.querySelector("#hud-charge")!;
    this.chargeFill = mount.querySelector("#hud-charge-fill")!;
    this.spellBar = mount.querySelector("#hud-spells")!;
  }

  /**
   * v9: render the row of spell icons the player has unlocked.
   * Tap/click a spell to select it as the active one (mobile-friendly
   * replacement for the removed cycle button). Cast is now bound to
   * releasing a fully charged attack.
   */
  renderSpells(player: PlayerData): void {
    if (player.spells.length === 0) {
      this.spellBar.classList.add("hidden");
      this.spellBar.innerHTML = "";
      return;
    }
    this.spellBar.classList.remove("hidden");
    const parts: string[] = ['<div class="spells-hint">Hold ⚔ to charge, release to cast · tap icon to switch</div>'];
    for (let i = 0; i < player.spells.length; i++) {
      const s = player.spells[i];
      const def = SPELLS[s];
      const cd = player.spellCooldowns[s] ?? 0;
      const cdFrac = Math.min(1, cd / def.cooldown);
      const active = i === player.activeSpell ? "active" : "";
      const cdOverlay = cd > 0
        ? `<div class="cd" style="height:${(cdFrac * 100).toFixed(0)}%"></div><div class="cdtext">${cd.toFixed(1)}s</div>`
        : "";
      const color = "#" + def.color.toString(16).padStart(6, "0");
      parts.push(`
        <button class="spell ${active}" data-idx="${i}" title="${def.name} — ${def.desc}" style="border-color:${color};">
          <div class="glyph">${def.glyph}</div>
          <div class="name">${def.name}</div>
          ${cdOverlay}
        </button>
      `);
    }
    this.spellBar.innerHTML = parts.join("");
    // Wire tap-to-select on every icon (bar gets re-rendered every frame, so
    // we re-attach — cheap since there are at most 8 icons).
    this.spellBar.querySelectorAll<HTMLButtonElement>(".spell").forEach((btn) => {
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx ?? "0", 10);
        if (!isNaN(idx) && idx >= 0 && idx < player.spells.length) {
          player.activeSpell = idx;
        }
      });
    });
  }

  render(player: PlayerData): void {
    // v5: max hearts follows the shop upgrade (if maxHp is set), else config default
    const totalHearts = (player.maxHp ?? PLAYER.maxHalfHearts / 2);
    let html = "";
    for (let i = 0; i < totalHearts; i++) {
      const remaining = player.halfHearts - i * 2;
      const cls = remaining >= 2 ? "full" : remaining === 1 ? "half" : "empty";
      html += `<span class="heart ${cls}">${heartSvg(cls)}</span>`;
    }
    this.hearts.innerHTML = html;
    this.coins.textContent = String(player.coins);
    this.keyIcon.classList.toggle("hidden", !player.hasBossKey);
  }

  /** v5: display charge attack fill (0 hidden, 0..1 fill, 1 ready glow). */
  setChargeBar(frac: number, ready: boolean): void {
    if (frac <= 0.001) {
      this.chargeBar.classList.add("hidden");
      return;
    }
    this.chargeBar.classList.remove("hidden");
    this.chargeFill.style.width = `${Math.min(1, frac) * 100}%`;
    this.chargeFill.classList.toggle("ready", ready);
  }

  setRoomLabel(text: string): void {
    this.roomLabel.textContent = text;
    this.roomLabel.classList.remove("fade");
    void this.roomLabel.offsetWidth; // restart transition
    this.roomLabel.classList.add("fade");
  }

  setBossBar(frac: number | null): void {
    if (frac === null) {
      this.bossBar.classList.add("hidden");
      return;
    }
    this.bossBar.classList.remove("hidden");
    this.bossFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove("hidden");
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.add("hidden");
      this.toastTimer = null;
    }, 2200);
  }

  /**
   * Narrator / dialog line. `who` = null shows italic narrator styling,
   * otherwise shows "Speaker Name" in gold on top of the text.
   *
   * If a line is already displayed, the new one queues behind it and rolls
   * in when the current one auto-hides.
   */
  narrate(who: string | null, text: string): void {
    if (this.narrTimer !== null) {
      // queue instead of stomping — reading interrupted is bad UX
      this.narrQueue.push({ who, text });
      return;
    }
    this.showNarrLine(who, text);
  }

  private showNarrLine(who: string | null, text: string): void {
    if (who === null) {
      this.narrSpeaker.classList.add("hidden");
      this.narrText.classList.add("narrator");
    } else {
      this.narrSpeaker.classList.remove("hidden");
      this.narrSpeaker.textContent = who;
      this.narrText.classList.remove("narrator");
    }
    this.narrText.textContent = text;
    this.narrPanel.classList.remove("hidden");
    this.narrPanel.classList.remove("in");
    void this.narrPanel.offsetWidth;
    this.narrPanel.classList.add("in");

    // reading-speed-derived timeout: ~14 chars/sec, min 2.4s, max 6s
    const dur = Math.min(6000, Math.max(2400, text.length * 70));
    this.narrTimer = window.setTimeout(() => {
      this.narrPanel.classList.add("hidden");
      this.narrTimer = null;
      const next = this.narrQueue.shift();
      if (next) window.setTimeout(() => this.showNarrLine(next.who, next.text), 200);
    }, dur);
  }

  /** Show/hide the "Press E" prompt based on the current interact target. */
  updateInteractPrompt(npc: NpcData | null): void {
    if (!npc) {
      this.interactPrompt.classList.add("hidden");
      return;
    }
    this.interactPrompt.classList.remove("hidden");
    const label = this.interactPrompt.querySelector<HTMLElement>(".lbl");
    if (label) {
      label.textContent =
        npc.kind === "ghost" ? "Listen" :
        npc.kind === "shopkeeper" ? "Shop" :
        "Talk";
    }
  }

  /** Set the prompt text directly (chests, doors, etc). Pass null to hide.
   *  v6: NPC prompt takes priority — call this AFTER updateInteractPrompt
   *  each frame, and only when npc is null. */
  setInteractPromptText(text: string | null): void {
    if (text === null) {
      this.interactPrompt.classList.add("hidden");
      return;
    }
    this.interactPrompt.classList.remove("hidden");
    const label = this.interactPrompt.querySelector<HTMLElement>(".lbl");
    if (label) label.textContent = text;
  }

  /** Set the combo counter. 0 hides the badge. */
  setCombo(count: number): void {
    if (count < 2) {
      this.comboBadge.classList.add("hidden");
      return;
    }
    this.comboBadge.classList.remove("hidden");
    const cx = this.comboBadge.querySelector<HTMLElement>(".cx");
    if (cx) cx.textContent = `${count}×`;
    // hot color once you're deep in a streak
    const hot = Math.min(1, (count - 2) / 8);
    (this.comboBadge as HTMLElement).style.setProperty(
      "--combo-color",
      `rgb(255, ${Math.max(0, 210 - hot * 150)}, ${Math.max(0, 120 - hot * 100)})`,
    );
    // little bump animation on every increment
    this.comboBadge.classList.remove("bump");
    void this.comboBadge.offsetWidth;
    this.comboBadge.classList.add("bump");
  }
}

function heartSvg(cls: string): string {
  const fillColor = cls === "empty" ? "#3a2540" : "#ff3b5c";
  const halfClip = cls === "half"
    ? `<defs><clipPath id="halfClip"><rect x="0" y="0" width="12" height="24"/></clipPath></defs>`
    : "";
  const clipAttr = cls === "half" ? ` clip-path="url(#halfClip)"` : "";
  return `<svg viewBox="0 0 24 24" width="24" height="24">
    ${halfClip}
    <path d="M12 21 C 4 15 2 9 6 5 C 9 2 12 5 12 7 C 12 5 15 2 18 5 C 22 9 20 15 12 21 Z"
          fill="#3a2540" stroke="#1a0e1e" stroke-width="1.4"/>
    ${cls !== "empty" ? `<path d="M12 21 C 4 15 2 9 6 5 C 9 2 12 5 12 7 C 12 5 15 2 18 5 C 22 9 20 15 12 21 Z" fill="${fillColor}"${clipAttr}/>` : ""}
  </svg>`;
}
