import { ROOMS } from "../world/dungeon";
import type { RoomRuntime } from "../types";

// ---------------------------------------------------------------------------
// Minimap — a canvas showing every visited room as a small square. The
// current room pulses white; the boss room, once visited, is red; the village
// is green. Cheap redraw on every frame.
// ---------------------------------------------------------------------------

const CELL = 22;
const GAP = 3;

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private minGx: number;
  private minGy: number;
  private cols: number;
  private rows: number;

  constructor(mount: HTMLElement) {
    let minGx = Infinity, minGy = Infinity, maxGx = -Infinity, maxGy = -Infinity;
    for (const r of ROOMS) {
      minGx = Math.min(minGx, r.gx); maxGx = Math.max(maxGx, r.gx);
      minGy = Math.min(minGy, r.gy); maxGy = Math.max(maxGy, r.gy);
    }
    this.minGx = minGx; this.minGy = minGy;
    this.cols = maxGx - minGx + 1;
    this.rows = maxGy - minGy + 1;

    this.canvas = document.createElement("canvas");
    this.canvas.width = this.cols * (CELL + GAP) + GAP;
    this.canvas.height = this.rows * (CELL + GAP) + GAP;
    this.canvas.id = "minimap";
    mount.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
  }

  render(rooms: Map<string, RoomRuntime>, currentKey: string, time: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "rgba(20, 12, 30, 0.75)";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (const r of ROOMS) {
      const rt = rooms.get(r.key);
      if (!rt) continue;
      const x = GAP + (r.gx - this.minGx) * (CELL + GAP);
      const y = GAP + (r.gy - this.minGy) * (CELL + GAP);

      if (!rt.visited) {
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(x, y, CELL, CELL);
        continue;
      }

      // base color per biome / role
      let color = "#5a4880";
      if (r.biome === "village") color = "#5a8a48";
      if (r.key === "0,0") color = "#8a3a4c";

      ctx.fillStyle = color;
      ctx.fillRect(x, y, CELL, CELL);

      // current room pulses
      if (r.key === currentKey) {
        const p = 0.5 + 0.5 * Math.sin(time * 5);
        ctx.strokeStyle = `rgba(255,255,255,${0.4 + 0.5 * p})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
      } else {
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      }

      // door ticks
      for (const d of rt.doors) {
        ctx.fillStyle = d.gateClosed ? "#dd4422" : "#eae0c9";
        if (d.dir === "n") ctx.fillRect(x + CELL / 2 - 2, y - 1, 4, 3);
        if (d.dir === "s") ctx.fillRect(x + CELL / 2 - 2, y + CELL - 2, 4, 3);
        if (d.dir === "w") ctx.fillRect(x - 1, y + CELL / 2 - 2, 3, 4);
        if (d.dir === "e") ctx.fillRect(x + CELL - 2, y + CELL / 2 - 2, 3, 4);
      }
    }
  }

  markVisited(_key: string): void {
    // rooms.ts already flips the .visited flag; nothing to do here.
    // Method kept as a clean call site in main.ts.
  }
}
