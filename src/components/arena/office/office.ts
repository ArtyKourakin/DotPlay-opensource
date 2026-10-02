// Builds the office scene graph once: a baked RenderTexture for everything that never moves or
// overlaps avatars (skyline, outer walls, floor, light pools) and depth-sorted sprites for
// furniture and interior walls, which avatars can pass in front of or behind.
import type * as PIXI from "pixi.js";
import { box, eastQuad, lightPool, px, py, seeded, shade, southQuad } from "./draw";
import {
  DOORS,
  ENTRANCE,
  FURNITURE,
  LAMPS,
  PIT_DIVIDER_C,
  ROOMS,
  ROOM_KEYS,
  SIGNS,
  TRADING_DESKS,
  WALL_BLOCKS,
  depthOf,
  isoX,
  isoY,
  type FurnitureKind,
  type WallKind,
} from "./layout";

type Pixi = typeof PIXI;

export const OUTER_H = 118;
const WALL_H = 22;
const RIM_H = 7;
const GLASS_H = 30;

const WALL_TOP = 0x2c3768;
const WALL_SOUTH = 0x1b2350;
const WALL_EAST = 0x141b3e;
const BOOK_COLORS = [0xff6b6b, 0xffd166, 0x6fb7ff, 0x9cf5ff, 0xc59bff, 0x7ef9c3, 0xff9d4d];

/** Where an object's texture origin (the tile centre on the floor) sits inside the texture. */
type Baked = { texture: PIXI.Texture; ax: number; ay: number };

export type BuiltOffice = {
  base: PIXI.Sprite;
  sorted: PIXI.Container[];
  /** Monitor glow overlays, indexed like TRADING_DESKS. */
  deskGlows: PIXI.Sprite[];
  leds: PIXI.Sprite[];
  signs: PIXI.Container;
  destroy: () => void;
};

// ---------------------------------------------------------------------------------------------
// Furniture and wall art (origin = tile centre on the floor)
// ---------------------------------------------------------------------------------------------

function screenLine(g: PIXI.Graphics, cx: number, cr: number, a: number, b: number, color: number) {
  const pts = [0.12, 21, 0.3, 25, 0.48, 23, 0.66, 28, 0.86, 26];
  const r = cr + b;
  for (let i = 0; i < pts.length; i += 2) {
    const c = cx - a + 2 * a * pts[i]!;
    const x = px(c, r);
    const y = py(c, r) - pts[i + 1]!;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke({ width: 1, color, alpha: 0.9 });
}

const MONITORS = [-0.28, 0, 0.28];

function drawFurniture(g: PIXI.Graphics, kind: FurnitureKind | "deskGlow" | "podLid" | WallArt) {
  switch (kind) {
    case "desk":
      box(g, 0, -0.08, 0.44, 0.28, 0, 15, { top: 0x3a4570, left: 0x252d4c, right: 0x1c2340 });
      box(g, 0, 0.1, 0.17, 0.05, 15, 1.5, { top: 0x6a7499 });
      box(g, 0.33, 0.08, 0.04, 0.04, 15, 5, { top: 0xffd166 });
      for (const k of MONITORS) {
        box(g, k, -0.24, 0.02, 0.02, 15, 3, { top: 0x0e1222 });
        box(g, k, -0.26, 0.125, 0.025, 17, 15, { top: 0x0e1222, left: 0x0b2238, right: 0x0a0e1a });
        screenLine(g, k, -0.26, 0.125, 0.025, k === 0 ? 0xff4d6d : 0x00ff41);
      }
      break;
    case "deskGlow":
      for (const k of MONITORS)
        southQuad(g, k, -0.26, 0.125, 0.025, 0.02, 0.98, 17.5, 31.5).fill(0xffffff);
      break;
    case "rdesk":
      box(g, 0, -0.08, 0.44, 0.28, 0, 15, { top: 0x6b5040, left: 0x4a3729, right: 0x3a2b20 });
      box(g, 0, -0.24, 0.02, 0.02, 15, 3, { top: 0x0e1222 });
      box(g, 0, -0.26, 0.15, 0.025, 17, 15, { top: 0x101422, left: 0x10304a, right: 0x0a0e1a });
      screenLine(g, 0, -0.26, 0.15, 0.025, 0x9cf5ff);
      box(g, -0.3, 0.02, 0.07, 0.1, 15, 4, { top: 0xff6b6b });
      box(g, -0.3, 0.02, 0.06, 0.09, 19, 3, { top: 0x6fb7ff });
      box(g, 0.3, -0.2, 0.015, 0.015, 15, 20, { top: 0x8a90a8 });
      box(g, 0.3, -0.2, 0.08, 0.08, 33, 5, { top: 0xffd98a, left: 0xffb347, right: 0xe09a30 });
      g.circle(px(0.3, -0.2), py(0.3, -0.2) - 30, 10).fill({ color: 0xffd98a, alpha: 0.16 });
      break;
    case "chair":
      box(g, 0, 0, 0.03, 0.03, 0, 6, { top: 0x1b2036 });
      box(g, 0, 0, 0.17, 0.15, 6, 3, { top: 0x39426b });
      box(g, 0, 0.15, 0.16, 0.03, 9, 13, { top: 0x2e3660 });
      break;
    case "stool":
      box(g, 0, 0, 0.03, 0.03, 0, 7, { top: 0x2a2340 });
      box(g, 0, 0, 0.14, 0.14, 7, 3, { top: 0x8a6bc0 });
      break;
    case "shelf": {
      const a = 0.3;
      const b = 0.46;
      box(g, -0.1, 0, a, b, 0, 66, { top: 0x4a3a30, left: 0x3a2d25, right: 0x2f241e });
      const rnd = seeded(7);
      for (const z of [4, 20, 36, 52]) {
        eastQuad(g, -0.1, 0, a, b, 0.05, 0.95, z, z + 13).fill(0x1d1612);
        let t = 0.07;
        while (t < 0.9) {
          const w = 0.035 + rnd() * 0.05;
          const h = 8 + rnd() * 4;
          const color = BOOK_COLORS[Math.floor(rnd() * BOOK_COLORS.length)]!;
          eastQuad(g, -0.1, 0, a, b, t, Math.min(0.93, t + w), z, z + h).fill(shade(color, 0.85));
          t += w + 0.012;
        }
      }
      break;
    }
    case "plant":
      box(g, 0, 0, 0.13, 0.13, 0, 11, { top: 0x3a2a1e, left: 0x8a5636, right: 0x6f442b });
      g.ellipse(-7, -19, 8, 9).fill(0x38b866);
      g.ellipse(7, -20, 8, 10).fill(0x2a7a49);
      g.ellipse(0, -26, 10, 13).fill(0x2f8f55);
      g.ellipse(1, -33, 6, 8).fill(0x45d07a);
      break;
    case "rack": {
      const a = 0.4;
      const b = 0.36;
      box(g, 0, 0, a, b, 0, 80, { top: 0x2b3354, left: 0x161c30, right: 0x10141f });
      for (let z = 8; z < 76; z += 9)
        southQuad(g, 0, 0, a, b, 0.32, 0.92, z, z + 1.5).fill(0x0c0f19);
      break;
    }
    case "cooler":
      box(g, 0, 0, 0.15, 0.15, 0, 26, { top: 0xdfe4ff, left: 0xb9c0e6, right: 0x98a0cc });
      g.ellipse(0, -36, 7, 10).fill({ color: 0x6fb7ff, alpha: 0.75 });
      g.ellipse(-2, -39, 2, 4).fill({ color: 0xffffff, alpha: 0.5 });
      break;
    case "sofa":
      box(g, 0, 0, 0.34, 0.45, 2, 8, { top: 0x9a5068, left: 0x7a3c52, right: 0x632f42 });
      box(g, 0.28, 0, 0.07, 0.45, 10, 12, { top: 0xa85a74, left: 0x86465c, right: 0x6c3849 });
      box(g, 0, -0.41, 0.34, 0.05, 10, 6, { top: 0xa85a74 });
      box(g, 0, 0.41, 0.34, 0.05, 10, 6, { top: 0xa85a74 });
      break;
    case "counter":
      box(g, 0, 0, 0.48, 0.36, 0, 24, { top: 0x7a6a8a, left: 0x4a3d58, right: 0x3a3046 });
      box(g, -0.2, 0.05, 0.05, 0.05, 24, 6, { top: 0xffffff });
      box(g, 0.1, 0.1, 0.05, 0.05, 24, 6, { top: 0xffb347 });
      break;
    case "coffee":
      box(g, 0, 0, 0.48, 0.36, 0, 24, { top: 0x7a6a8a, left: 0x4a3d58, right: 0x3a3046 });
      box(g, 0.02, -0.1, 0.22, 0.17, 24, 24, { top: 0x2b2f3d, left: 0x1c1f2a, right: 0x15171f });
      southQuad(g, 0.02, -0.1, 0.22, 0.17, 0.35, 0.65, 30, 34).fill(0x0b0d12);
      g.circle(px(0.1, 0.07), py(0.1, 0.07) - 42, 1.8).fill(0xff4d6d);
      box(g, 0.02, 0.0, 0.04, 0.04, 26, 4, { top: 0xffffff });
      break;
    case "table":
      box(g, 0, 0, 0.04, 0.04, 0, 15, { top: 0x2a2340 });
      g.ellipse(0, -14, 22, 11).fill(0x4a3729);
      g.ellipse(0, -16, 22, 11).fill(0x6b5040);
      box(g, 0.1, 0, 0.04, 0.04, 16, 5, { top: 0xffd166 });
      break;
    case "longtable":
      box(g, 0, 0, 0.5, 0.4, 0, 14, { top: 0x463b73, left: 0x2f2752, right: 0x261f44 });
      box(g, -0.2, -0.1, 0.09, 0.07, 14, 0.5, { top: 0xffd166 });
      box(g, 0.18, 0.12, 0.09, 0.07, 14, 0.5, { top: 0xff9dc4 });
      box(g, 0.1, -0.15, 0.08, 0.06, 14, 0.5, { top: 0x9cf5ff });
      break;
    case "pod":
      box(g, 0, -0.4, 0.44, 0.04, 0, 34, { top: 0x2f3a73, left: 0x262f63, right: 0x1a2147 });
      g.circle(px(0, -0.36), py(0, -0.36) - 26, 2).fill(0x9cf5ff);
      box(g, 0, 0, 0.44, 0.38, 0, 12, { top: 0x2f3a73, left: 0x222b58, right: 0x1a2147 });
      box(g, 0, 0.02, 0.38, 0.32, 12, 3, { top: 0x6a78c8 });
      box(g, -0.26, 0, 0.08, 0.24, 15, 3, { top: 0xcfd6ff });
      break;
    case "podLid":
      g.ellipse(0, -20, 30, 17).fill({ color: 0x9cf5ff, alpha: 0.07 });
      g.ellipse(0, -20, 30, 17).stroke({ width: 1.5, color: 0x9cf5ff, alpha: 0.35 });
      box(g, 0, 0.39, 0.44, 0.03, 0, 15, { top: 0x2f3a73, left: 0x28316a, right: 0x1a2147 });
      break;
    case "board":
      for (const k of [-1.2, 1.2]) {
        box(g, k, 0, 0.03, 0.22, 0, 2, { top: 0x6c7bb8 });
        box(g, k, 0, 0.025, 0.025, 0, 70, { top: 0x9aa4d6 });
      }
      break;
    case "reception":
      box(g, 0, 0, 0.5, 0.34, 0, 22, { top: 0x2b3f6b, left: 0x1d2c4f, right: 0x16233f });
      southQuad(g, 0, 0, 0.5, 0.34, 0, 1, 15, 17).fill({ color: 0x9cf5ff, alpha: 0.85 });
      break;
    case "wall":
    case "rim": {
      const h = kind === "wall" ? WALL_H : RIM_H;
      box(g, 0, 0, 0.5, 0.5, 0, h, { top: WALL_TOP, left: WALL_SOUTH, right: WALL_EAST });
      break;
    }
    case "glass":
    case "glassRim": {
      const h = kind === "glass" ? GLASS_H : RIM_H + 2;
      box(g, 0, 0, 0.5, 0.5, 0, h, { top: 0x9cf5ff, left: 0x9cf5ff, right: 0x9cf5ff, alpha: 0.08 });
      g.moveTo(px(-0.5, 0.5), py(-0.5, 0.5) - h)
        .lineTo(px(0.5, 0.5), py(0.5, 0.5) - h)
        .lineTo(px(0.5, -0.5), py(0.5, -0.5) - h)
        .stroke({ width: 1.5, color: 0x9cf5ff, alpha: 0.5 });
      g.moveTo(px(0.5, 0.5), py(0.5, 0.5))
        .lineTo(px(0.5, 0.5), py(0.5, 0.5) - h)
        .stroke({ width: 1, color: 0x9cf5ff, alpha: 0.25 });
      break;
    }
  }
}

type WallArt = "wall" | "rim" | "glass" | "glassRim";

function wallArt(kind: WallKind, back: boolean): WallArt {
  if (kind === "glass") return back ? "glass" : "glassRim";
  return kind === "wall" ? "wall" : "rim";
}

/** LED positions (relative to the rack's tile centre) on the rack's camera-facing front. */
export function rackLeds(): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const a = 0.4;
  const b = 0.36;
  for (let z = 12; z < 76; z += 9)
    for (const t of [0.1, 0.18, 0.26]) {
      const c = -a + 2 * a * t;
      out.push({ x: px(c, b), y: py(c, b) - z });
    }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Baked base layer
// ---------------------------------------------------------------------------------------------

const tilePoly = (c: number, r: number, w = 1, h = 1) => [
  isoX(c, r),
  isoY(c, r),
  isoX(c + w, r),
  isoY(c + w, r),
  isoX(c + w, r + h),
  isoY(c + w, r + h),
  isoX(c, r + h),
  isoY(c, r + h),
];

/** A quad on the inside face of an outer wall: north wall (plane r = 1) or west wall (c = 1). */
function wallQuad(
  g: PIXI.Graphics,
  wall: "north" | "west",
  u0: number,
  u1: number,
  z0: number,
  z1: number,
) {
  const p = (u: number) => (wall === "north" ? [isoX(u, 1), isoY(u, 1)] : [isoX(1, u), isoY(1, u)]);
  const [x0, y0] = p(u0) as [number, number];
  const [x1, y1] = p(u1) as [number, number];
  return g.poly([x0, y0 - z0, x1, y1 - z0, x1, y1 - z1, x0, y0 - z1]);
}

function drawSkyline(g: PIXI.Graphics) {
  const rnd = seeded(42);
  const top = (x: number) => Math.abs(x) / 2 - OUTER_H;
  const minX = isoX(0, 33);
  const maxX = isoX(39, 0);
  // Stars.
  for (let i = 0; i < 90; i++) {
    const x = minX + rnd() * (maxX - minX);
    const y = top(x) - 60 - rnd() * 260;
    g.circle(x, y, rnd() < 0.15 ? 1.4 : 0.8).fill({ color: 0xcfd6ff, alpha: 0.3 + rnd() * 0.5 });
  }
  // Moon.
  g.circle(860, -240, 40).fill({ color: 0xcfd6ff, alpha: 0.05 });
  g.circle(860, -240, 22).fill({ color: 0xe6e9ff, alpha: 0.85 });
  g.circle(870, -246, 20).fill({ color: 0x0b1020, alpha: 0.9 });
  // Two rows of buildings standing behind the outer walls.
  for (const [layer, color, maxH] of [
    [0, 0x0e1534, 150],
    [1, 0x131c42, 95],
  ] as const) {
    let x = minX - 20;
    while (x < maxX + 20) {
      const w = 26 + rnd() * 52;
      const h = 30 + rnd() * maxH;
      const yTop = Math.min(top(x), top(x + w)) - h - (layer === 0 ? 30 : 0);
      g.poly([x, top(x) + 4, x + w, top(x + w) + 4, x + w, yTop, x, yTop]).fill(color);
      for (let wy = yTop + 6; wy < Math.min(top(x), top(x + w)) - 4; wy += 9)
        for (let wx = x + 5; wx < x + w - 5; wx += 8)
          if (rnd() < 0.22)
            g.rect(wx, wy, 3, 4).fill({
              color: rnd() < 0.8 ? 0xffd98a : 0x9cf5ff,
              alpha: 0.35 + rnd() * 0.45,
            });
      if (rnd() < 0.2) g.circle(x + w / 2, yTop - 3, 1.6).fill(0xff4d6d);
      x += w + 2 + rnd() * 6;
    }
  }
}

function drawWindowsAndWalls(g: PIXI.Graphics) {
  // West wall (c 0..1, r 0..32): its east face looks into the rooms.
  box(g, 0.5, 16.5, 0.5, 16.5, 0, OUTER_H, { top: WALL_TOP, left: 0x101634, right: 0x151d44 });
  // North wall (c 1..39, r 0..1): its south face looks into the rooms.
  box(g, 20, 0.5, 19, 0.5, 0, OUTER_H, { top: WALL_TOP, left: 0x1a2350, right: 0x101634 });

  const rnd = seeded(9);
  const windows: ["north" | "west", number][] = [];
  for (let c = 1; c <= 37; c++) {
    if (c >= 14 && c <= 22) continue; // sticky-note wall
    if (c >= 27 && c <= 35) continue; // trading wall screen
    if (c === 12 || c === 24) continue;
    windows.push(["north", c]);
  }
  for (let r = 1; r <= 31; r++) {
    if (r >= 17 && r <= 23) continue; // lounge TV
    if (r === 10 || r === 15 || r === 25) continue;
    windows.push(["west", r]);
  }
  for (const [wall, u] of windows) {
    const u0 = u + 0.12;
    const u1 = u + 0.88;
    wallQuad(g, wall, u0, u1, 30, 104).fill(0x0c1430);
    // A slice of city inside each window.
    let t = u0;
    while (t < u1 - 0.05) {
      const w = 0.12 + rnd() * 0.22;
      const t1 = Math.min(u1, t + w);
      const h = 10 + rnd() * 42;
      wallQuad(g, wall, t, t1, 30, 30 + h).fill(rnd() < 0.5 ? 0x18224d : 0x1d2a5c);
      for (let z = 36; z < 26 + h; z += 7)
        if (rnd() < 0.35) {
          const lt = t + (t1 - t) * (0.2 + rnd() * 0.6);
          wallQuad(g, wall, lt, lt + 0.03, z, z + 3).fill({ color: 0xffd98a, alpha: 0.75 });
        }
      t = t1 + 0.01;
    }
    wallQuad(g, wall, u0, u1, 102, 104).fill({ color: 0x3a4680, alpha: 0.9 });
    wallQuad(g, wall, u0, u1, 30, 32).fill({ color: 0x3a4680, alpha: 0.9 });
    wallQuad(g, wall, (u0 + u1) / 2 - 0.01, (u0 + u1) / 2 + 0.01, 30, 104).fill({
      color: 0x3a4680,
      alpha: 0.9,
    });
    // Moonlight on the glass.
    wallQuad(g, wall, u0 + 0.05, u0 + 0.12, 70, 98).fill({ color: 0xffffff, alpha: 0.04 });
  }
  // Baseboards and a soft neon trim along the top.
  wallQuad(g, "north", 1, 39, 0, 4).fill(0x101634);
  wallQuad(g, "west", 1, 33, 0, 4).fill(0x0c1230);
  wallQuad(g, "north", 1, 39, 110, 111.5).fill({ color: 0x00ff41, alpha: 0.18 });
  wallQuad(g, "west", 1, 33, 110, 111.5).fill({ color: 0x00ff41, alpha: 0.18 });
}

function drawFloors(P: Pixi, g: PIXI.Graphics, labels: PIXI.Container) {
  for (const key of ROOM_KEYS) {
    const room = ROOMS[key];
    const w = room.c1 - room.c0 + 1;
    const h = room.r1 - room.r0 + 1;
    g.poly(tilePoly(room.c0, room.r0, w, h)).fill(room.floor);
    if (key === "solpit") {
      const bullW = PIT_DIVIDER_C - room.c0;
      g.poly(tilePoly(room.c0, room.r0, bullW, h)).fill({ color: 0x00ff41, alpha: 0.07 });
      g.poly(tilePoly(PIT_DIVIDER_C + 1, room.r0, room.c1 - PIT_DIVIDER_C, h)).fill({
        color: 0xff4d6d,
        alpha: 0.08,
      });
      g.poly(tilePoly(PIT_DIVIDER_C, room.r0, 1, h)).fill({ color: 0xffffff, alpha: 0.05 });
      g.moveTo(isoX(PIT_DIVIDER_C + 0.5, room.r0), isoY(PIT_DIVIDER_C + 0.5, room.r0))
        .lineTo(isoX(PIT_DIVIDER_C + 0.5, room.r1 + 1), isoY(PIT_DIVIDER_C + 0.5, room.r1 + 1))
        .stroke({ width: 2, color: 0xffffff, alpha: 0.25 });
    }
    for (let r = room.r0; r <= room.r1; r++)
      for (let c = room.c0; c <= room.c1; c++)
        if ((c + r) % 2 === 0) g.poly(tilePoly(c, r)).fill({ color: 0xffffff, alpha: 0.022 });
    for (let r = room.r0; r <= room.r1 + 1; r++)
      g.moveTo(isoX(room.c0, r), isoY(room.c0, r)).lineTo(
        isoX(room.c1 + 1, r),
        isoY(room.c1 + 1, r),
      );
    for (let c = room.c0; c <= room.c1 + 1; c++)
      g.moveTo(isoX(c, room.r0), isoY(c, room.r0)).lineTo(
        isoX(c, room.r1 + 1),
        isoY(c, room.r1 + 1),
      );
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.045 });
  }
  for (const [c, r] of DOORS) {
    g.poly(tilePoly(c, r)).fill(0x1a2648);
    g.poly(tilePoly(c, r)).stroke({ width: 1, color: 0x9cf5ff, alpha: 0.12 });
  }
  // Lounge rug and lobby door mat.
  g.poly(tilePoly(3, 18, 5, 5)).fill({ color: 0x3b2a45, alpha: 0.9 });
  g.poly(tilePoly(3, 18, 5, 5)).stroke({ width: 2, color: 0xffb347, alpha: 0.18 });
  g.poly(tilePoly(ENTRANCE.c0, ENTRANCE.r - 1, 2, 1)).fill({ color: 0x2a3366, alpha: 0.9 });
  // Big floor lettering in the SOL Pit, laid flat on the floor plane.
  const floorText = (text: string, c: number, r: number, color: number) => {
    const t = new P.Text({
      text,
      style: { fontFamily: "Space Mono, monospace", fontSize: 34, fontWeight: "700", fill: color },
    });
    t.alpha = 0.22;
    t.anchor.set(0.5);
    t.setFromMatrix(new P.Matrix(0.894, 0.447, -0.894, 0.447, isoX(c, r), isoY(c, r)));
    labels.addChild(t);
  };
  floorText("BULL", 28, 20.5, 0x00ff41);
  floorText("BEAR", 34.5, 20.5, 0xff4d6d);
}

function drawEntrance(g: PIXI.Graphics) {
  const { c0, c1, r } = ENTRANCE;
  const post = (c: number) =>
    g.rect(isoX(c, r) - 2, isoY(c, r) - 46, 4, 46).fill({ color: 0x9cf5ff, alpha: 0.7 });
  g.poly([
    isoX(c0, r),
    isoY(c0, r),
    isoX(c1 + 1, r),
    isoY(c1 + 1, r),
    isoX(c1 + 1, r),
    isoY(c1 + 1, r) - 44,
    isoX(c0, r),
    isoY(c0, r) - 44,
  ]).fill({ color: 0x9cf5ff, alpha: 0.06 });
  post(c0);
  post(c1 + 1);
  post((c0 + c1 + 1) / 2);
  g.moveTo(isoX(c0, r), isoY(c0, r) - 46)
    .lineTo(isoX(c1 + 1, r), isoY(c1 + 1, r) - 46)
    .stroke({ width: 3, color: 0x9cf5ff, alpha: 0.85 });
}

// ---------------------------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------------------------

export function buildOffice(P: Pixi, renderer: PIXI.Renderer): BuiltOffice {
  const owned: PIXI.Texture[] = [];
  const cache = new Map<string, Baked>();

  const bake = (key: string, draw: (g: PIXI.Graphics) => void): Baked => {
    const hit = cache.get(key);
    if (hit) return hit;
    const g = new P.Graphics();
    draw(g);
    const b = g.getLocalBounds();
    const texture = renderer.generateTexture({ target: g, resolution: 2, antialias: true });
    g.destroy();
    owned.push(texture);
    const baked = { texture, ax: -b.minX / (b.maxX - b.minX), ay: -b.minY / (b.maxY - b.minY) };
    cache.set(key, baked);
    return baked;
  };

  const sprite = (baked: Baked, c: number, r: number, z: number) => {
    const s = new P.Sprite(baked.texture);
    s.anchor.set(baked.ax, baked.ay);
    s.position.set(isoX(c + 0.5, r + 0.5), isoY(c + 0.5, r + 0.5));
    s.zIndex = depthOf(c + 0.5, r + 0.5) + z;
    return s;
  };

  // ---- Static base, rendered once into a RenderTexture ----
  const bakeRoot = new P.Container();
  const g = new P.Graphics();
  drawSkyline(g);
  drawFloors(P, g, bakeRoot);
  for (const lamp of LAMPS)
    lightPool(g, isoX(lamp.c, lamp.r), isoY(lamp.c, lamp.r), lamp.radius, 0xffb347);
  for (const key of ROOM_KEYS) {
    if (key === "corridor") continue;
    const room = ROOMS[key];
    const c = (room.c0 + room.c1 + 1) / 2;
    const r = (room.r0 + room.r1 + 1) / 2;
    lightPool(g, isoX(c, r), isoY(c, r), 4.5, room.accent, 0.5);
  }
  drawWindowsAndWalls(g);
  drawEntrance(g);
  bakeRoot.addChildAt(g, 0);

  const bounds = bakeRoot.getLocalBounds();
  const bw = Math.ceil(bounds.maxX - bounds.minX);
  const bh = Math.ceil(bounds.maxY - bounds.minY);
  const resolution = Math.max(
    0.75,
    Math.min(Math.min(window.devicePixelRatio || 1, 1.5), 4096 / Math.max(bw, bh)),
  );
  const rt = P.RenderTexture.create({ width: bw, height: bh, resolution, antialias: true });
  bakeRoot.position.set(-bounds.minX, -bounds.minY);
  renderer.render({ container: bakeRoot, target: rt, clear: true });
  bakeRoot.destroy({ children: true });
  owned.push(rt);
  const base = new P.Sprite(rt);
  base.position.set(bounds.minX, bounds.minY);

  // ---- Depth-sorted furniture and interior walls ----
  const sorted: PIXI.Container[] = [];
  const deskGlows: PIXI.Sprite[] = [];
  const leds: PIXI.Sprite[] = [];
  for (const f of FURNITURE) {
    sorted.push(
      sprite(
        bake(f.kind, (gr) => drawFurniture(gr, f.kind)),
        f.c,
        f.r,
        0,
      ),
    );
    if (f.kind === "pod")
      sorted.push(
        sprite(
          bake("podLid", (gr) => drawFurniture(gr, "podLid")),
          f.c,
          f.r,
          1,
        ),
      );
    if (f.kind === "rack") {
      const x0 = isoX(f.c + 0.5, f.r + 0.5);
      const y0 = isoY(f.c + 0.5, f.r + 0.5);
      for (const p of rackLeds()) {
        const led = new P.Sprite(P.Texture.WHITE);
        led.width = 3;
        led.height = 2;
        led.position.set(x0 + p.x, y0 + p.y);
        led.zIndex = depthOf(f.c + 0.5, f.r + 0.5) + 0.3;
        leds.push(led);
        sorted.push(led);
      }
    }
  }
  const glow = bake("deskGlow", (gr) => drawFurniture(gr, "deskGlow"));
  for (const d of TRADING_DESKS) {
    const s = sprite(glow, d.c, d.r, 0.2);
    s.visible = false;
    s.blendMode = "add";
    deskGlows.push(s);
    sorted.push(s);
  }
  for (const w of WALL_BLOCKS) {
    if (w.kind === "outer") continue;
    const art = wallArt(w.kind, w.back);
    sorted.push(
      sprite(
        bake(art, (gr) => drawFurniture(gr, art)),
        w.c,
        w.r,
        0,
      ),
    );
  }

  // ---- Room signs ----
  const signs = new P.Container();
  for (const s of SIGNS) {
    const room = ROOMS[s.room];
    const sign = new P.Container();
    const text = new P.Text({
      text: room.label,
      style: {
        fontFamily: "Space Mono, monospace",
        fontSize: 13,
        fontWeight: "700",
        fill: room.accent,
        letterSpacing: 1.5,
        dropShadow: { color: room.accent, blur: 6, distance: 0, alpha: 0.85, angle: 0 },
      },
      resolution: 2,
    });
    text.anchor.set(0.5);
    const w = text.width + 18;
    const plate = new P.Graphics()
      .roundRect(-w / 2, -12, w, 24, 6)
      .fill({ color: 0x0b1020, alpha: 0.85 })
      .stroke({ width: 1.5, color: room.accent, alpha: 0.7 });
    sign.addChild(plate, text);
    sign.position.set(isoX(s.c, s.r), isoY(s.c, s.r) - 58);
    signs.addChild(sign);
  }

  return {
    base,
    sorted,
    deskGlows,
    leds,
    signs,
    destroy: () => {
      for (const t of owned) t.destroy(true);
    },
  };
}
