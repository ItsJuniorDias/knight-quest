// ---------------------------------------------------------------------------
// v5: SHOP UI
//
// Rendered as an HTML overlay when the player presses E on a shopkeeper NPC.
// Sells four items paid in coins:
//   • Heart Potion — instant heal 3 hearts (uses immediately)
//   • Extra Heart — permanent +1 max HP (up to a cap of 8)
//   • Shield Upgrade — reduce incoming damage by 1 (once per run)
//   • Sword Upgrade — +1 damage per swing (once per run)
//
// The shop pauses everything else — it's opened via `open(player)` and
// closed via `close()`. The RETURN button and Escape close it too.
// ---------------------------------------------------------------------------

import type { PlayerData } from "../types";
import { PLAYER } from "../config";
import { sfx } from "../engine/audio";

export interface ShopItem {
  id: string;
  name: string;
  price: number;
  desc: string;
  /** returns true if the item was applied (enough coins + not maxed). */
  apply(player: PlayerData): boolean;
  /** returns a human "unavailable" reason, or null if buyable. */
  reasonUnavailable(player: PlayerData): string | null;
}

export const SHOP_ITEMS: ShopItem[] = [
  {
    id: "heart_potion",
    name: "Heart Potion",
    price: 5,
    desc: "Restore 3 hearts. Drink now.",
    reasonUnavailable(p) {
      const maxHalves = (p.maxHp ?? 3) * 2;
      if (p.halfHearts >= maxHalves) return "You're already at full HP.";
      return null;
    },
    apply(p) {
      const maxHalves = (p.maxHp ?? 3) * 2;
      p.halfHearts = Math.min(maxHalves, p.halfHearts + 6); // 3 whole hearts = 6 halves
      p.hp = Math.ceil(p.halfHearts / 2);
      return true;
    },
  },
  {
    id: "extra_heart",
    name: "Extra Heart",
    price: 15,
    desc: "Permanently +1 max HP (up to 8).",
    reasonUnavailable(p) {
      if ((p.maxHp ?? 3) >= 8) return "Your heart is at its limit.";
      return null;
    },
    apply(p) {
      p.maxHp = Math.min(8, (p.maxHp ?? 3) + 1);
      // full-heal on purchase — feels rewarding
      p.halfHearts = p.maxHp * 2;
      p.hp = p.maxHp;
      return true;
    },
  },
  {
    id: "sword_upgrade",
    name: "Sharpen the Blade",
    price: 20,
    desc: "+1 damage per swing. One-time.",
    reasonUnavailable(p) {
      if (p.upgrades?.sharpBlade) return "Already sharpened this run.";
      return null;
    },
    apply(p) {
      if (!p.upgrades) p.upgrades = {};
      p.upgrades.sharpBlade = true;
      return true;
    },
  },
  {
    id: "shield_upgrade",
    name: "Reinforced Shield",
    price: 20,
    desc: "Reduce all damage taken by 1. One-time.",
    reasonUnavailable(p) {
      if (p.upgrades?.reinforcedShield) return "Already reinforced this run.";
      return null;
    },
    apply(p) {
      if (!p.upgrades) p.upgrades = {};
      p.upgrades.reinforcedShield = true;
      return true;
    },
  },
];

export class Shop {
  private root: HTMLElement;
  private overlay: HTMLDivElement;
  private open_ = false;
  private player: PlayerData | null = null;
  private onCloseCb?: () => void;
  private escHandler: (e: KeyboardEvent) => void;

  constructor(mount: HTMLElement) {
    this.root = mount;
    this.overlay = document.createElement("div");
    this.overlay.id = "shop-overlay";
    this.overlay.style.cssText = [
      "position:fixed", "inset:0", "background:rgba(0,0,0,0.72)",
      "display:none", "align-items:center", "justify-content:center",
      "z-index:400", "font-family:system-ui,-apple-system,sans-serif",
    ].join(";");
    this.overlay.innerHTML = this.buildInner();
    this.root.appendChild(this.overlay);
    this.escHandler = (e) => {
      if (this.open_ && e.key === "Escape") this.close();
    };
    window.addEventListener("keydown", this.escHandler);
  }

  private buildInner(): string {
    return `
      <div style="background:linear-gradient(180deg,#2b1f18,#1a1210);border:2px solid #7a5030;border-radius:12px;padding:26px 30px;max-width:520px;width:90%;color:#f2e6d5;box-shadow:0 20px 60px rgba(0,0,0,0.55);">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px;">
          <div>
            <div style="font-size:22px;font-weight:600;color:#f7e4a5;">Inga's Wares</div>
            <div style="font-size:13px;color:#c9b596;margin-top:2px;">"Bought fair. Sold fairer."</div>
          </div>
          <div id="shop-coin-badge" style="background:#5a3f22;padding:6px 12px;border-radius:8px;font-weight:600;color:#f7e4a5;">💰 0</div>
        </div>
        <div id="shop-items" style="display:flex;flex-direction:column;gap:10px;"></div>
        <button id="shop-close" style="margin-top:18px;width:100%;padding:12px;background:#5a3f22;color:#f2e6d5;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;">Leave (Esc)</button>
      </div>
    `;
  }

  open(player: PlayerData, onClose?: () => void): void {
    this.player = player;
    this.onCloseCb = onClose;
    this.open_ = true;
    this.overlay.style.display = "flex";
    this.render();
    const close = this.overlay.querySelector("#shop-close") as HTMLButtonElement;
    close.onclick = () => this.close();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.overlay.style.display = "none";
    this.player = null;
    if (this.onCloseCb) this.onCloseCb();
  }

  isOpen(): boolean {
    return this.open_;
  }

  private render(): void {
    if (!this.player) return;
    const p = this.player;
    const coin = this.overlay.querySelector("#shop-coin-badge")!;
    coin.textContent = `💰 ${p.coins}`;
    const list = this.overlay.querySelector("#shop-items")!;
    list.innerHTML = "";
    for (const item of SHOP_ITEMS) {
      const reason = item.reasonUnavailable(p);
      const canAfford = p.coins >= item.price;
      const disabled = reason !== null || !canAfford;
      const row = document.createElement("div");
      row.style.cssText = [
        "display:flex", "align-items:center", "gap:12px",
        "background:rgba(120,80,50,0.24)", "padding:12px 14px",
        "border-radius:8px", "border:1px solid rgba(140,100,70,0.35)",
        disabled ? "opacity:0.5" : "opacity:1",
      ].join(";");
      row.innerHTML = `
        <div style="flex:1;">
          <div style="font-weight:600;font-size:15px;color:#f7e4a5;">${item.name}</div>
          <div style="font-size:12px;color:#c9b596;margin-top:2px;">${reason ?? item.desc}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:600;color:${canAfford ? "#f7e4a5" : "#ff8080"};">${item.price} 💰</div>
        </div>
        <button data-item="${item.id}" style="background:${disabled ? "#3a2a1c" : "#7a5030"};color:#f2e6d5;border:none;border-radius:6px;padding:8px 14px;font-weight:600;cursor:${disabled ? "not-allowed" : "pointer"};min-width:70px;" ${disabled ? "disabled" : ""}>Buy</button>
      `;
      list.appendChild(row);
    }
    list.querySelectorAll<HTMLButtonElement>("button[data-item]").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.item!;
        this.buy(id);
      };
    });
    void PLAYER; // ensures the config import isn't shaken out
  }

  private buy(id: string): void {
    const p = this.player;
    if (!p) return;
    const item = SHOP_ITEMS.find((it) => it.id === id);
    if (!item) return;
    if (item.reasonUnavailable(p)) return;
    if (p.coins < item.price) return;
    p.coins -= item.price;
    if (item.apply(p)) {
      sfx.coin(); // ker-ching
    }
    this.render();
  }
}
