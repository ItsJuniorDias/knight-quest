import { PLAYER } from "../config";
import type { PlayerData } from "../types";

// ---------------------------------------------------------------------------
// HUD — hearts, coins, boss key indicator, boss bar. Pure DOM: cheap on the
// GPU and easy to restyle later.
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

  constructor(mount: HTMLElement) {
    mount.innerHTML = `
      <div id="hud-top">
        <div id="hud-hearts"></div>
        <div id="hud-right">
          <div id="hud-key" class="hidden">🔑</div>
          <div id="hud-coins">💰 <span>0</span></div>
        </div>
      </div>
      <div id="hud-room-label"></div>
      <div id="hud-boss-bar" class="hidden">
        <div id="hud-boss-fill"></div>
        <div id="hud-boss-label">SKELETON WARRIOR</div>
      </div>
      <div id="hud-toast" class="hidden"></div>
    `;
    this.hearts = mount.querySelector("#hud-hearts")!;
    this.coins = mount.querySelector("#hud-coins span")!;
    this.keyIcon = mount.querySelector("#hud-key")!;
    this.roomLabel = mount.querySelector("#hud-room-label")!;
    this.bossBar = mount.querySelector("#hud-boss-bar")!;
    this.bossFill = mount.querySelector("#hud-boss-fill")!;
    this.toastEl = mount.querySelector("#hud-toast")!;
  }

  render(player: PlayerData): void {
    const totalHearts = PLAYER.maxHalfHearts / 2;
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
