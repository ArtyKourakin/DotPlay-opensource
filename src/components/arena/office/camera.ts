// Camera for the office world: fit-to-view, wheel / drag / pinch, animated room focus and
// following an agent until the user pans.
import type * as PIXI from "pixi.js";

export type Rect = { x: number; y: number; w: number; h: number };

const MAX_SCALE = 2.6;

export class Camera {
  /** World units visible on screen, refreshed every frame. */
  readonly view = { x0: 0, y0: 0, x1: 0, y1: 0 };
  followId: string | null = null;
  /** True while the camera still shows the whole office (refits on resize). */
  fitted = true;
  private minScale = 0.2;
  private target: { x: number; y: number; scale: number } | null = null;

  constructor(
    private readonly world: PIXI.Container,
    private readonly screen: { width: number; height: number },
    private readonly bounds: Rect,
  ) {}

  get scale() {
    return this.world.scale.x;
  }

  fitScale() {
    const s = this.screen;
    return Math.min(s.width / this.bounds.w, s.height / this.bounds.h) * 0.98;
  }

  /** Shows the whole office. */
  fit(animate = false) {
    const scale = this.fitScale();
    this.minScale = scale * 0.6;
    const cx = this.bounds.x + this.bounds.w / 2;
    const cy = this.bounds.y + this.bounds.h / 2;
    this.fitted = true;
    this.followId = null;
    if (animate) this.target = { x: cx, y: cy, scale };
    else {
      this.target = null;
      this.apply(cx, cy, scale);
    }
  }

  /** Smoothly centres a world rectangle on screen. */
  focus(rect: Rect) {
    const s = this.screen;
    const scale = Math.min(
      MAX_SCALE,
      Math.max(this.minScale, Math.min(s.width / rect.w, s.height / rect.h) * 0.85),
    );
    this.target = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, scale };
    this.fitted = false;
    this.followId = null;
  }

  follow(id: string | null) {
    this.followId = id;
    if (id) {
      this.fitted = false;
      if (this.scale < 1.1) this.target = { x: this.centerX(), y: this.centerY(), scale: 1.25 };
    }
  }

  /** User drag: cancels following and any animation. */
  panBy(dx: number, dy: number) {
    this.world.x += dx;
    this.world.y += dy;
    this.followId = null;
    this.target = null;
    this.fitted = false;
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const old = this.world.scale.x;
    const next = Math.min(Math.max(old * factor, this.minScale), MAX_SCALE);
    const wx = (sx - this.world.x) / old;
    const wy = (sy - this.world.y) / old;
    this.world.scale.set(next);
    this.world.position.set(sx - wx * next, sy - wy * next);
    if (this.target) this.target.scale = next;
    this.fitted = false;
  }

  toWorld(sx: number, sy: number) {
    const s = this.world.scale.x;
    return { x: (sx - this.world.x) / s, y: (sy - this.world.y) / s };
  }

  /** Advances animation / follow; `followPos` is the followed agent's world position. */
  update(dt: number, followPos: { x: number; y: number } | null) {
    const k = 1 - Math.exp(-dt * 6);
    if (followPos) {
      const scale = this.target ? this.target.scale : this.scale;
      this.target = { x: followPos.x, y: followPos.y - 20, scale };
    }
    if (this.target) {
      const scale = this.scale + (this.target.scale - this.scale) * k;
      const cx = this.centerX() + (this.target.x - this.centerX()) * k;
      const cy = this.centerY() + (this.target.y - this.centerY()) * k;
      this.apply(cx, cy, scale);
      if (
        !followPos &&
        Math.abs(this.target.scale - scale) < 0.001 &&
        Math.abs(this.target.x - cx) < 0.5 &&
        Math.abs(this.target.y - cy) < 0.5
      )
        this.target = null;
    }
    const s = this.world.scale.x;
    this.view.x0 = -this.world.x / s;
    this.view.y0 = -this.world.y / s;
    this.view.x1 = this.view.x0 + this.screen.width / s;
    this.view.y1 = this.view.y0 + this.screen.height / s;
  }

  private centerX() {
    return (this.screen.width / 2 - this.world.x) / this.world.scale.x;
  }
  private centerY() {
    return (this.screen.height / 2 - this.world.y) / this.world.scale.y;
  }

  private apply(cx: number, cy: number, scale: number) {
    this.world.scale.set(scale);
    this.world.position.set(
      this.screen.width / 2 - cx * scale,
      this.screen.height / 2 - cy * scale,
    );
  }
}

/**
 * Pointer and wheel input on the canvas. A press that moves less than a few pixels is a tap and
 * is reported through `onTap` (used to pick avatars).
 */
export function attachCameraInput(
  el: HTMLCanvasElement,
  camera: Camera,
  onTap: (sx: number, sy: number) => void,
) {
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  let moved = 0;
  let downAt = { x: 0, y: 0 };

  const local = (e: PointerEvent | WheelEvent) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: PointerEvent) => {
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      moved = 0;
      downAt = p;
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      moved = 99;
    }
  };
  const onMove = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = local(e);
    pointers.set(e.pointerId, cur);
    if (pointers.size === 1) {
      moved = Math.max(moved, Math.hypot(cur.x - downAt.x, cur.y - downAt.y));
      if (moved > 4) camera.panBy(cur.x - prev.x, cur.y - prev.y);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinchDist > 0) camera.zoomAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, d / pinchDist);
      pinchDist = d;
    }
  };
  const onUp = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.delete(e.pointerId);
    pinchDist = 0;
    if (pointers.size === 0 && moved <= 4 && e.type === "pointerup") onTap(p.x, p.y);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = local(e);
    camera.zoomAt(p.x, p.y, Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.004));
  };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  el.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    el.removeEventListener("wheel", onWheel);
  };
}
