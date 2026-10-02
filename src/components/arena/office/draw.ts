// Procedural drawing helpers for the isometric office. Everything is flat vector Graphics; no
// external art. Positions are in tile units relative to an origin, projected isometrically.
import type { Graphics } from "pixi.js";
import { TILE_H, TILE_W } from "./layout";

const HW = TILE_W / 2;
const HH = TILE_H / 2;

/** Screen offset of a tile-space offset (dc, dr). */
export const px = (dc: number, dr: number) => (dc - dr) * HW;
export const py = (dc: number, dr: number) => (dc + dr) * HH;

/** Multiplies a 0xRRGGBB color's channels by f (f < 1 darkens, f > 1 lightens). */
export function shade(color: number, f: number) {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f));
  const b = Math.min(255, Math.round((color & 255) * f));
  return (r << 16) | (g << 8) | b;
}

export type BoxStyle = { top: number; left?: number; right?: number; alpha?: number };

/**
 * An isometric box centred at tile offset (cx, cr), half extents a (along c) and b (along r),
 * standing on height z0 and h pixels tall. Draws the two camera-facing sides and the top.
 */
export function box(
  g: Graphics,
  cx: number,
  cr: number,
  a: number,
  b: number,
  z0: number,
  h: number,
  style: BoxStyle,
) {
  const alpha = style.alpha ?? 1;
  const left = style.left ?? shade(style.top, 0.72);
  const right = style.right ?? shade(style.top, 0.55);
  const zt = z0 + h;
  const nx = px(cx - a, cr - b);
  const ny = py(cx - a, cr - b);
  const ex = px(cx + a, cr - b);
  const ey = py(cx + a, cr - b);
  const sx = px(cx + a, cr + b);
  const sy = py(cx + a, cr + b);
  const wx = px(cx - a, cr + b);
  const wy = py(cx - a, cr + b);
  if (h > 0) {
    g.poly([wx, wy - z0, sx, sy - z0, sx, sy - zt, wx, wy - zt]).fill({ color: left, alpha });
    g.poly([sx, sy - z0, ex, ey - z0, ex, ey - zt, sx, sy - zt]).fill({ color: right, alpha });
  }
  g.poly([nx, ny - zt, ex, ey - zt, sx, sy - zt, wx, wy - zt]).fill({ color: style.top, alpha });
}

/**
 * A quad on the south face (facing +r) of a box: t runs 0..1 from the west end to the east end
 * of the face, z is height above the floor.
 */
export function southQuad(
  g: Graphics,
  cx: number,
  cr: number,
  a: number,
  b: number,
  t0: number,
  t1: number,
  z0: number,
  z1: number,
) {
  const c0 = cx - a + 2 * a * t0;
  const c1 = cx - a + 2 * a * t1;
  const r = cr + b;
  return g.poly([
    px(c0, r),
    py(c0, r) - z0,
    px(c1, r),
    py(c1, r) - z0,
    px(c1, r),
    py(c1, r) - z1,
    px(c0, r),
    py(c0, r) - z1,
  ]);
}

/** A quad on the east face (facing +c) of a box: t runs 0..1 from the south end to the north. */
export function eastQuad(
  g: Graphics,
  cx: number,
  cr: number,
  a: number,
  b: number,
  t0: number,
  t1: number,
  z0: number,
  z1: number,
) {
  const c = cx + a;
  const r0 = cr + b - 2 * b * t0;
  const r1 = cr + b - 2 * b * t1;
  return g.poly([
    px(c, r0),
    py(c, r0) - z0,
    px(c, r1),
    py(c, r1) - z0,
    px(c, r1),
    py(c, r1) - z1,
    px(c, r0),
    py(c, r0) - z1,
  ]);
}

/** Soft radial light pool on the floor (stacked translucent ellipses). */
export function lightPool(
  g: Graphics,
  x: number,
  y: number,
  radius: number,
  color: number,
  strength = 1,
) {
  const steps = 7;
  for (let i = 0; i < steps; i++) {
    const k = 1 - i / steps;
    g.ellipse(x, y, radius * HW * k * 1.2, radius * HH * k * 1.2).fill({
      color,
      alpha: 0.03 * strength,
    });
  }
}

/** Deterministic pseudo-random numbers so baked art is identical on every load. */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}
