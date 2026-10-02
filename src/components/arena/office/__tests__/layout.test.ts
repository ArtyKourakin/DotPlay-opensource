import { describe, expect, test } from "bun:test";
import {
  COLS,
  DOORS,
  FURNITURE,
  ROOMS,
  ROOM_KEYS,
  ROWS,
  SPAWN,
  STATIONS,
  TRADING_DESKS,
  WALKABLE,
  WALL_BLOCKS,
  isoX,
  isoY,
  roomForZone,
  tileAt,
  tileIndex,
  workRoomForRole,
} from "../layout";
import { Pathfinder } from "../pathfinding";
import { StationBook, overflowSpot } from "../stations";

const spawnTile = tileIndex(Math.floor(SPAWN.c), Math.floor(SPAWN.r));

describe("office layout", () => {
  test("every station stands on a walkable tile", () => {
    for (const s of STATIONS) expect(WALKABLE[tileIndex(s.c, s.r)]).toBe(1);
  });

  test("every station and room is reachable from the lobby spawn", () => {
    const pf = new Pathfinder(WALKABLE, COLS, ROWS);
    const out = new Int32Array(512);
    expect(WALKABLE[spawnTile]).toBe(1);
    for (const s of STATIONS) {
      expect(pf.find(spawnTile, tileIndex(s.c, s.r), out)).toBeGreaterThan(0);
    }
    for (const key of ROOM_KEYS) {
      const room = ROOMS[key];
      const goal = pf.nearestWalkable((room.c0 + room.c1) / 2, (room.r0 + room.r1) / 2);
      expect(pf.find(spawnTile, goal, out)).toBeGreaterThanOrEqual(0);
    }
  });

  test("paths never cross a wall or cut a wall corner", () => {
    const pf = new Pathfinder(WALKABLE, COLS, ROWS);
    const out = new Int32Array(512);
    const goal = tileIndex(36, 2); // far corner of the trading floor
    const len = pf.find(spawnTile, goal, out);
    expect(len).toBeGreaterThan(0);
    let prev = spawnTile;
    for (let i = 0; i < len; i++) {
      const t = out[i]!;
      expect(WALKABLE[t]).toBe(1);
      const dc = (t % COLS) - (prev % COLS);
      const dr = Math.floor(t / COLS) - Math.floor(prev / COLS);
      expect(Math.abs(dc) <= 1 && Math.abs(dr) <= 1).toBe(true);
      if (dc !== 0 && dr !== 0) {
        expect(WALKABLE[prev + dc]).toBe(1);
        expect(WALKABLE[prev + dr * COLS]).toBe(1);
      }
      prev = t;
    }
    expect(prev).toBe(goal);
  });

  test("walls are not walkable and doors are", () => {
    for (const b of WALL_BLOCKS) expect(WALKABLE[tileIndex(b.c, b.r)]).toBe(0);
    for (const [c, r] of DOORS) expect(WALKABLE[tileIndex(c, r)]).toBe(1);
  });

  test("trading seats point at a trading desk", () => {
    const seats = STATIONS.filter((s) => s.room === "trading");
    expect(seats.length).toBe(TRADING_DESKS.length);
    for (const s of seats) expect(TRADING_DESKS[s.desk!]).toBeDefined();
    expect(FURNITURE.filter((f) => f.kind === "desk").length).toBe(TRADING_DESKS.length);
  });

  test("SOL pit has bull and bear stations on their own halves", () => {
    const bull = STATIONS.filter((s) => s.side === "bull");
    const bear = STATIONS.filter((s) => s.side === "bear");
    expect(bull.length).toBeGreaterThan(10);
    expect(bear.length).toBe(bull.length);
    for (const s of bull) expect(s.c).toBeLessThan(31);
    for (const s of bear) expect(s.c).toBeGreaterThan(31);
  });

  test("isometric projection round-trips", () => {
    const p = tileAt(isoX(12.25, 7.5), isoY(12.25, 7.5));
    expect(Math.abs(p.c - 12.25)).toBeLessThan(1e-9);
    expect(Math.abs(p.r - 7.5)).toBeLessThan(1e-9);
  });

  test("zones and action types map onto rooms", () => {
    expect(roomForZone("town_square")).toBe("lounge");
    expect(roomForZone("trading_floor", "trade")).toBe("trading");
    expect(roomForZone(null, "onchain_trade")).toBe("trading");
    expect(roomForZone(null, "sol_call")).toBe("solpit");
    expect(roomForZone(null, "sol_result")).toBe("solpit");
    expect(roomForZone(null, "pitch")).toBe("narrative");
    expect(roomForZone(null, "research")).toBe("research");
    expect(roomForZone(null, "reply")).toBe("lounge");
    expect(roomForZone("sleep_pods")).toBe("sleep");
    expect(workRoomForRole("trader")).toBe("trading");
    expect(workRoomForRole("other")).toBe("research");
  });
});

describe("stations", () => {
  test("stations are exclusive and fall back to queue spots", () => {
    const book = new StationBook();
    const seats = STATIONS.filter((s) => s.room === "trading").length;
    const taken = new Set<number>();
    for (let i = 0; i < seats; i++) {
      const spot = book.claim(`a${i}`, "trading");
      expect(spot.station).toBeGreaterThanOrEqual(0);
      expect(taken.has(spot.station)).toBe(false);
      taken.add(spot.station);
    }
    const queued = book.claim("late", "trading");
    expect(queued.station).toBe(-1);
    expect(queued.room).toBe("trading");
    const first = [...taken][0]!;
    book.release(first, book.occupantOf(first)!);
    expect(book.claim("late", "trading").station).toBe(first);
  });

  test("side-specific claims stay on their side", () => {
    const book = new StationBook();
    for (let i = 0; i < 80; i++) {
      const spot = book.claim(`b${i}`, "solpit", { side: "bear" });
      expect(spot.c).toBeGreaterThan(31);
    }
    for (let i = 0; i < 20; i++) expect(overflowSpot("solpit", "bull").c).toBeLessThan(31.5);
  });
});
