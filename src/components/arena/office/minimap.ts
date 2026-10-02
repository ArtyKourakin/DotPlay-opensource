// Minimap drawn on a small 2D canvas: rooms, agent dots and the camera viewport. Clicking a
// room asks the scene to focus it.
import {
  FOCUS_ROOMS,
  OFFICE_BOUNDS,
  ROOMS,
  isoX,
  isoY,
  roomAt,
  tileAt,
  type RoomKey,
} from "./layout";

export type MinimapDot = {
  x: number;
  y: number;
  asleep: boolean;
  selected: boolean;
  hidden: boolean;
};

const hex = (n: number, a: number) => `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D | null;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private cssW = 0;
  private cssH = 0;
  hovered: RoomKey | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onFocus: (room: RoomKey) => void,
  ) {
    this.ctx = canvas.getContext("2d");
    canvas.addEventListener("click", this.onClick);
    canvas.addEventListener("pointermove", this.onHover);
    canvas.addEventListener("pointerleave", this.onLeave);
  }

  destroy() {
    this.canvas.removeEventListener("click", this.onClick);
    this.canvas.removeEventListener("pointermove", this.onHover);
    this.canvas.removeEventListener("pointerleave", this.onLeave);
  }

  private layout() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    if (rect.width !== this.cssW || rect.height !== this.cssH) {
      this.cssW = rect.width;
      this.cssH = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(rect.width * dpr);
      this.canvas.height = Math.round(rect.height * dpr);
      this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const pad = 6;
    const b = OFFICE_BOUNDS;
    const top = isoY(0, 0) - 40;
    const h = b.y + b.h - top;
    this.scale = Math.min((this.cssW - pad * 2) / b.w, (this.cssH - pad * 2) / h);
    this.ox = pad + (this.cssW - pad * 2 - b.w * this.scale) / 2 - b.x * this.scale;
    this.oy = pad + (this.cssH - pad * 2 - h * this.scale) / 2 - top * this.scale;
    return true;
  }

  private toWorld(mx: number, my: number) {
    return { x: (mx - this.ox) / this.scale, y: (my - this.oy) / this.scale };
  }

  private roomUnder(e: MouseEvent): RoomKey | null {
    const r = this.canvas.getBoundingClientRect();
    const w = this.toWorld(e.clientX - r.left, e.clientY - r.top);
    const t = tileAt(w.x, w.y);
    const room = roomAt(Math.floor(t.c), Math.floor(t.r));
    if (room && FOCUS_ROOMS.includes(room)) return room;
    // Corridor or wall: pick the nearest focusable room.
    let best: RoomKey | null = null;
    let bestD = Infinity;
    for (const key of FOCUS_ROOMS) {
      const rm = ROOMS[key];
      const dc = Math.max(rm.c0 - t.c, 0, t.c - (rm.c1 + 1));
      const dr = Math.max(rm.r0 - t.r, 0, t.r - (rm.r1 + 1));
      const d = dc * dc + dr * dr;
      if (d < bestD) {
        bestD = d;
        best = key;
      }
    }
    return bestD < 9 ? best : null;
  }

  private onClick = (e: MouseEvent) => {
    const room = this.roomUnder(e);
    if (room) this.onFocus(room);
  };
  private onHover = (e: PointerEvent) => {
    this.hovered = this.roomUnder(e);
    this.canvas.style.cursor = this.hovered ? "pointer" : "default";
  };
  private onLeave = () => {
    this.hovered = null;
  };

  draw(dots: readonly MinimapDot[], view: { x0: number; y0: number; x1: number; y1: number }) {
    const ctx = this.ctx;
    if (!ctx || !this.layout()) return;
    const s = this.scale;
    const X = (x: number) => this.ox + x * s;
    const Y = (y: number) => this.oy + y * s;
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    for (const key of Object.keys(ROOMS) as RoomKey[]) {
      const rm = ROOMS[key];
      const pts: [number, number][] = [
        [rm.c0, rm.r0],
        [rm.c1 + 1, rm.r0],
        [rm.c1 + 1, rm.r1 + 1],
        [rm.c0, rm.r1 + 1],
      ];
      ctx.beginPath();
      pts.forEach(([c, r], i) => {
        const x = X(isoX(c, r));
        const y = Y(isoY(c, r));
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
      const focusable = key !== "corridor";
      ctx.fillStyle = hex(rm.accent, this.hovered === key ? 0.35 : focusable ? 0.16 : 0.07);
      ctx.fill();
      ctx.strokeStyle = hex(rm.accent, focusable ? 0.6 : 0.2);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    for (const d of dots) {
      if (d.hidden) continue;
      ctx.fillStyle = d.selected ? "#00ff41" : d.asleep ? "rgba(154,164,214,0.5)" : "#e6e9ff";
      const r = d.selected ? 2.6 : 1.3;
      ctx.fillRect(X(d.x) - r, Y(d.y) - r, r * 2, r * 2);
    }
    ctx.strokeStyle = "rgba(0,255,65,0.85)";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(X(view.x0), Y(view.y0), (view.x1 - view.x0) * s, (view.y1 - view.y0) * s);
  }
}
