// Office floor plan: tile grid, rooms, doors, furniture and stations. Pure data, no PixiJS.
//
// The grid is a top-down plan of COLS x ROWS tiles that is drawn isometrically. Rooms are
// rectangles of floor tiles separated by one-tile wall bands; doors are floor tiles cut into a
// band. Tiles in row 0 and column 0 are the tall outer walls with the night-skyline windows.

export const TILE_W = 64;
export const TILE_H = 32;
export const COLS = 39;
export const ROWS = 33;

export type RoomKey =
  "lobby" | "trading" | "solpit" | "narrative" | "research" | "lounge" | "sleep" | "corridor";

export type Room = {
  label: string;
  c0: number;
  r0: number;
  c1: number;
  r1: number;
  floor: number;
  accent: number;
};

export const ROOMS: Record<RoomKey, Room> = {
  research: {
    label: "RESEARCH LAB",
    c0: 1,
    r0: 1,
    c1: 11,
    r1: 9,
    floor: 0x15223f,
    accent: 0x6fb7ff,
  },
  narrative: {
    label: "NARRATIVE LAB",
    c0: 13,
    r0: 1,
    c1: 23,
    r1: 9,
    floor: 0x211a3c,
    accent: 0xc59bff,
  },
  trading: {
    label: "TRADING FLOOR",
    c0: 25,
    r0: 1,
    c1: 37,
    r1: 9,
    floor: 0x0f2528,
    accent: 0x00ff41,
  },
  corridor: { label: "CORRIDOR", c0: 1, r0: 11, c1: 37, r1: 14, floor: 0x111a33, accent: 0x6c7bb8 },
  lounge: { label: "LOUNGE", c0: 1, r0: 16, c1: 11, r1: 24, floor: 0x261d2f, accent: 0xffb347 },
  sleep: { label: "SLEEP PODS", c0: 13, r0: 16, c1: 23, r1: 24, floor: 0x121933, accent: 0x8a9cff },
  solpit: { label: "SOL PIT", c0: 25, r0: 16, c1: 37, r1: 24, floor: 0x101a2a, accent: 0xffffff },
  lobby: { label: "LOBBY", c0: 1, r0: 26, c1: 8, r1: 31, floor: 0x1a2142, accent: 0x9cf5ff },
};

/** Rooms that appear on the minimap and can be focused. */
export const FOCUS_ROOMS: RoomKey[] = [
  "research",
  "narrative",
  "trading",
  "lounge",
  "sleep",
  "solpit",
  "lobby",
];

/** Door tiles cut into the wall bands. */
export const DOORS: [number, number][] = [
  [5, 10],
  [6, 10], // research <-> corridor
  [17, 10],
  [18, 10], // narrative <-> corridor
  [30, 10],
  [31, 10], // trading <-> corridor
  [6, 15],
  [7, 15], // corridor <-> lounge
  [17, 15],
  [18, 15], // corridor <-> sleep pods
  [30, 15],
  [31, 15], // corridor <-> SOL pit
  [4, 25],
  [5, 25], // lounge <-> lobby
];

/** Front entrance of the building (decoration; agents spawn just inside it). */
export const ENTRANCE = { c0: 4, c1: 5, r: 32 };
export const SPAWN = { c: 4.5, r: 31.4 };

/** Column of the SOL Pit that separates the Bull (west) and Bear (east) halves. */
export const PIT_DIVIDER_C = 31;

export type FurnitureKind =
  | "desk"
  | "rdesk"
  | "chair"
  | "stool"
  | "shelf"
  | "plant"
  | "rack"
  | "cooler"
  | "sofa"
  | "counter"
  | "coffee"
  | "table"
  | "longtable"
  | "pod"
  | "board"
  | "reception";

export type Furniture = { kind: FurnitureKind; c: number; r: number; desk?: number };

const BLOCKING: Record<FurnitureKind, boolean> = {
  desk: true,
  rdesk: true,
  chair: false,
  stool: false,
  shelf: true,
  plant: true,
  rack: true,
  cooler: true,
  sofa: false,
  counter: true,
  coffee: true,
  table: true,
  longtable: true,
  pod: false,
  board: true,
  reception: true,
};

export type StationPose = "sit" | "stand" | "sleep";
export type Side = "bull" | "bear";

export type StationDef = {
  room: RoomKey;
  c: number;
  r: number;
  pose: StationPose;
  side?: Side;
  /** Index into TRADING_DESKS for the desk whose monitors this seat uses. */
  desk?: number;
  /** Small offset (tile units) of the exact standing/sitting point inside the tile. */
  dc?: number;
  dr?: number;
};

export const FURNITURE: Furniture[] = [];
export const STATIONS: StationDef[] = [];
/** Trading-floor desks, in the order their monitor overlays are created. */
export const TRADING_DESKS: { c: number; r: number }[] = [];
/** Desks and tables that get a warm lamp light pool on the floor. */
export const LAMPS: { c: number; r: number; radius: number }[] = [];
/** Spots used when every station of a room is taken. */
export const QUEUE: Partial<Record<RoomKey, [number, number][]>> = {};

function furn(kind: FurnitureKind, c: number, r: number, desk?: number) {
  FURNITURE.push(desk === undefined ? { kind, c, r } : { kind, c, r, desk });
}
function station(def: StationDef) {
  STATIONS.push(def);
}
function queue(room: RoomKey, c: number, r: number) {
  (QUEUE[room] ??= []).push([c, r]);
}

// ---- Research Lab: bookshelves on the west wall, two rows of library desks ----
for (let r = 1; r <= 7; r++) furn("shelf", 1, r);
for (const r of [3, 6]) {
  for (const c of [4, 6, 8, 10]) {
    furn("rdesk", c, r);
    furn("chair", c, r + 1);
    station({ room: "research", c, r: r + 1, pose: "sit", dr: -0.1 });
    LAMPS.push({ c: c + 0.5, r: r + 0.6, radius: 1.3 });
  }
}
furn("plant", 11, 1);
furn("plant", 2, 9);
for (let c = 3; c <= 11; c++) queue("research", c, 9);

// ---- Narrative Lab: sticky-note wall (north), brainstorm table ----
for (const c of [14, 16, 18, 20, 22])
  station({ room: "narrative", c, r: 2, pose: "stand", dr: -0.2 });
for (let c = 16; c <= 20; c++) {
  furn("longtable", c, 5);
  furn("stool", c, 4);
  furn("stool", c, 6);
  station({ room: "narrative", c, r: 4, pose: "sit" });
  station({ room: "narrative", c, r: 6, pose: "sit" });
}
LAMPS.push({ c: 18.5, r: 5.5, radius: 3.2 });
furn("plant", 13, 9);
furn("plant", 23, 9);
for (let c = 14; c <= 22; c++) queue("narrative", c, 8);

// ---- Trading Floor: two rows of multi-monitor desks facing the wall screen ----
for (const r of [3, 6]) {
  for (let c = 26; c <= 36; c += 2) {
    const desk = TRADING_DESKS.length;
    TRADING_DESKS.push({ c, r });
    furn("desk", c, r, desk);
    furn("chair", c, r + 1);
    station({ room: "trading", c, r: r + 1, pose: "sit", desk, dr: -0.1 });
    LAMPS.push({ c: c + 0.5, r: r + 0.7, radius: 1.2 });
  }
}
furn("plant", 25, 9);
furn("plant", 37, 9);
for (let c = 26; c <= 36; c++) queue("trading", c, 9);

// ---- Corridor: server racks, water cooler, plants ----
// Racks stand against the north wall so their LED fronts face the camera.
for (const c of [35, 36, 37]) furn("rack", c, 11);
furn("cooler", 37, 14);
for (const [c, r] of [
  [1, 11],
  [1, 14],
  [12, 11],
  [24, 11],
  [12, 14],
  [24, 14],
] as const)
  furn("plant", c, r);

// ---- Lounge: TV on the west wall, sofas, coffee bar, a cafe table ----
for (let r = 18; r <= 22; r++) {
  furn("sofa", 4, r);
  station({ room: "lounge", c: 4, r, pose: "sit" });
}
for (let r = 19; r <= 21; r++) {
  furn("sofa", 6, r);
  station({ room: "lounge", c: 6, r, pose: "sit" });
}
furn("counter", 10, 16);
furn("coffee", 11, 16);
station({ room: "lounge", c: 10, r: 17, pose: "stand", dr: -0.15 });
station({ room: "lounge", c: 11, r: 17, pose: "stand", dr: -0.15 });
furn("table", 9, 21);
for (const [c, r] of [
  [8, 21],
  [10, 21],
  [9, 20],
  [9, 22],
] as const) {
  furn("stool", c, r);
  station({ room: "lounge", c, r, pose: "sit" });
}
LAMPS.push({ c: 5, r: 20.5, radius: 3 });
LAMPS.push({ c: 9.5, r: 21.5, radius: 1.8 });
LAMPS.push({ c: 11, r: 17, radius: 1.5 });
furn("plant", 1, 16);
furn("plant", 11, 24);
furn("plant", 1, 24);

// ---- Sleep Pods: three rows of capsules ----
for (const r of [17, 20, 23]) {
  for (const c of [14, 16, 18, 20, 22]) {
    furn("pod", c, r);
    station({ room: "sleep", c, r, pose: "sleep" });
  }
}

// ---- SOL Pit: glass room, Bull half west of the divider, Bear half east ----
furn("board", PIT_DIVIDER_C, 17);
for (let r = 18; r <= 23; r++) {
  for (let c = 26; c <= 30; c++) station({ room: "solpit", c, r, pose: "stand", side: "bull" });
  for (let c = 32; c <= 36; c++) station({ room: "solpit", c, r, pose: "stand", side: "bear" });
}
for (let r = 16; r <= 24; r++) {
  queue("solpit", 25, r);
  queue("solpit", 37, r);
}
for (let c = 26; c <= 36; c++) if (c !== PIT_DIVIDER_C) queue("solpit", c, 24);

// ---- Lobby: reception desk facing the entrance ----
for (let c = 3; c <= 5; c++) furn("reception", c, 28);
furn("plant", 1, 26);
furn("plant", 8, 26);
furn("plant", 8, 31);
furn("plant", 1, 31);
LAMPS.push({ c: 4.5, r: 28.5, radius: 2.2 });

// ---- Room signs, glowing above the doors ----
export const SIGNS: { room: RoomKey; c: number; r: number }[] = [
  { room: "research", c: 6, r: 10.5 },
  { room: "narrative", c: 18, r: 10.5 },
  { room: "trading", c: 31, r: 10.5 },
  { room: "lounge", c: 7, r: 15.5 },
  { room: "sleep", c: 18, r: 15.5 },
  { room: "solpit", c: 31, r: 15.5 },
  { room: "lobby", c: 5, r: 25.5 },
];

// ---- Grid ----

export const tileIndex = (c: number, r: number) => r * COLS + c;
export const inGrid = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS;

/** Room of every floor tile (index into ROOM_KEYS), -1 for walls, -2 for doors. */
export const ROOM_KEYS = Object.keys(ROOMS) as RoomKey[];
export const TILE_ROOM = new Int8Array(COLS * ROWS).fill(-1);
/** 1 where an avatar may stand. */
export const WALKABLE = new Uint8Array(COLS * ROWS);

ROOM_KEYS.forEach((key, i) => {
  const room = ROOMS[key];
  for (let r = room.r0; r <= room.r1; r++)
    for (let c = room.c0; c <= room.c1; c++) {
      TILE_ROOM[tileIndex(c, r)] = i;
      WALKABLE[tileIndex(c, r)] = 1;
    }
});
for (const [c, r] of DOORS) {
  TILE_ROOM[tileIndex(c, r)] = -2;
  WALKABLE[tileIndex(c, r)] = 1;
}
for (const f of FURNITURE) if (BLOCKING[f.kind]) WALKABLE[tileIndex(f.c, f.r)] = 0;

export const isFloor = (c: number, r: number) => inGrid(c, r) && TILE_ROOM[tileIndex(c, r)] !== -1;

export function roomAt(c: number, r: number): RoomKey | null {
  if (!inGrid(c, r)) return null;
  const i = TILE_ROOM[tileIndex(c, r)]!;
  return i >= 0 ? ROOM_KEYS[i]! : null;
}

/** Walkable tiles of each room, used for wandering and overflow. */
export const ROOM_TILES = Object.fromEntries(
  ROOM_KEYS.map((key) => {
    const room = ROOMS[key];
    const tiles: number[] = [];
    for (let r = room.r0; r <= room.r1; r++)
      for (let c = room.c0; c <= room.c1; c++)
        if (WALKABLE[tileIndex(c, r)]) tiles.push(tileIndex(c, r));
    return [key, tiles];
  }),
) as Record<RoomKey, number[]>;

// ---- Wall blocks ----

export type WallKind = "outer" | "wall" | "rim" | "glass";
export type WallBlock = { c: number; r: number; kind: WallKind; back: boolean };

const touchesRoom = (c: number, r: number, key: RoomKey) => {
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) if (roomAt(c + dc, r + dr) === key) return true;
  return false;
};

/**
 * Every non-floor tile next to a floor tile becomes a wall block. Blocks in row 0 / column 0 are
 * the tall outer walls. A block with floor to its south or east is the back wall of that room
 * (full height); any other block only shows a low rim so the room stays visible.
 */
export const WALL_BLOCKS: WallBlock[] = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (isFloor(c, r)) continue;
    if (r === ENTRANCE.r && c >= ENTRANCE.c0 && c <= ENTRANCE.c1) continue;
    let near = false;
    for (let dr = -1; dr <= 1 && !near; dr++)
      for (let dc = -1; dc <= 1 && !near; dc++) if (isFloor(c + dc, r + dr)) near = true;
    if (!near && r !== 0 && c !== 0) continue;
    if (r === 0 || c === 0) {
      WALL_BLOCKS.push({ c, r, kind: "outer", back: true });
      continue;
    }
    const back = isFloor(c, r + 1) || isFloor(c + 1, r) || isFloor(c + 1, r + 1);
    const kind: WallKind = touchesRoom(c, r, "solpit") ? "glass" : back ? "wall" : "rim";
    WALL_BLOCKS.push({ c, r, kind, back });
  }
}

// ---- Isometric projection ----

/** Screen position of a point in tile space (tile corners are integers). */
export const isoX = (c: number, r: number) => ((c - r) * TILE_W) / 2;
export const isoY = (c: number, r: number) => ((c + r) * TILE_H) / 2;

/** Inverse projection: world (screen-space) point to tile space. */
export function tileAt(x: number, y: number) {
  const a = x / (TILE_W / 2);
  const b = y / (TILE_H / 2);
  return { c: (a + b) / 2, r: (b - a) / 2 };
}

/** Sort key for an object standing at tile-space (c, r): its screen y. */
export const depthOf = (c: number, r: number) => isoY(c, r);

/** Office extents in world (screen) units, including the outer walls. */
export const OFFICE_BOUNDS = {
  x: isoX(0, ROWS) - 8,
  y: isoY(0, 0) - 150,
  w: isoX(COLS, 0) - isoX(0, ROWS) + 16,
  h: isoY(COLS, 26) - isoY(0, 0) + 170,
};

export function roomCenter(key: RoomKey) {
  const room = ROOMS[key];
  const c = (room.c0 + room.c1 + 1) / 2;
  const r = (room.r0 + room.r1 + 1) / 2;
  return { c, r, x: isoX(c, r), y: isoY(c, r) };
}

/** Maps a stored action zone or type onto an office room. */
export function roomForZone(zone: string | null | undefined, type?: string): RoomKey {
  switch (type) {
    case "research":
      return "research";
    case "trade":
    case "onchain_trade":
      return "trading";
    case "sol_call":
    case "sol_result":
      return "solpit";
    case "pitch":
      return "narrative";
    case "post":
    case "reply":
      return "lounge";
  }
  switch (zone) {
    case "research_lab":
      return "research";
    case "trading_floor":
      return "trading";
    case "sol_pit":
      return "solpit";
    case "narrative_lab":
      return "narrative";
    case "sleep_pods":
      return "sleep";
    default:
      return "lounge";
  }
}

/** Where an agent of a given role goes to work when its status is "working". */
export function workRoomForRole(role: string | null | undefined): RoomKey {
  switch (role) {
    case "trader":
      return "trading";
    case "meme-maker":
      return "narrative";
    default:
      return "research";
  }
}
