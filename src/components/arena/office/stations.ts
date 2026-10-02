// Who sits where. Stations are exclusive; when a room is full, agents share its queue spots.
import {
  QUEUE,
  ROOM_TILES,
  STATIONS,
  COLS,
  type RoomKey,
  type Side,
  type StationDef,
  type StationPose,
  PIT_DIVIDER_C,
} from "./layout";

export type Spot = {
  /** Index into STATIONS, or -1 for a queue / wander spot. */
  station: number;
  room: RoomKey;
  /** Exact target point in tile space. */
  c: number;
  r: number;
  pose: StationPose;
};

const byRoom = new Map<RoomKey, number[]>();
STATIONS.forEach((s, i) => {
  const list = byRoom.get(s.room) ?? [];
  list.push(i);
  byRoom.set(s.room, list);
});

const jitter = () => (Math.random() - 0.5) * 0.5;

export class StationBook {
  private readonly occupant: (string | null)[] = STATIONS.map(() => null);

  get size() {
    return STATIONS.length;
  }

  def(index: number): StationDef {
    return STATIONS[index]!;
  }

  occupantOf(index: number) {
    return this.occupant[index] ?? null;
  }

  /** Claims a random free station that matches; returns -1 when none is free. */
  acquire(agentId: string, room: RoomKey, opts: { side?: Side; pose?: StationPose } = {}): number {
    const list = byRoom.get(room);
    if (!list) return -1;
    let pick = -1;
    let seen = 0;
    for (const i of list) {
      const s = STATIONS[i]!;
      if (this.occupant[i] !== null) continue;
      if (opts.side && s.side !== opts.side) continue;
      if (opts.pose && s.pose !== opts.pose) continue;
      // Reservoir sampling: uniform choice without building a temporary array.
      seen++;
      if (Math.random() * seen < 1) pick = i;
    }
    if (pick >= 0) this.occupant[pick] = agentId;
    return pick;
  }

  release(index: number, agentId: string) {
    if (index >= 0 && this.occupant[index] === agentId) this.occupant[index] = null;
  }

  /** A station spot when one is free, otherwise a shared queue or floor spot in the room. */
  claim(agentId: string, room: RoomKey, opts: { side?: Side; pose?: StationPose } = {}): Spot {
    const index = this.acquire(agentId, room, opts);
    if (index >= 0) {
      const s = STATIONS[index]!;
      return {
        station: index,
        room,
        c: s.c + 0.5 + (s.dc ?? 0),
        r: s.r + 0.5 + (s.dr ?? 0),
        pose: s.pose,
      };
    }
    return overflowSpot(room, opts.side);
  }
}

/** A shared spot in the room: its queue when it has one, otherwise any walkable tile. */
export function overflowSpot(room: RoomKey, side?: Side): Spot {
  let spots = QUEUE[room];
  if (spots && side)
    spots = spots.filter(([c]) => (side === "bull" ? c < PIT_DIVIDER_C : c > PIT_DIVIDER_C));
  if (spots && spots.length) {
    const [c, r] = spots[Math.floor(Math.random() * spots.length)]!;
    return { station: -1, room, c: c + 0.5 + jitter(), r: r + 0.5 + jitter(), pose: "stand" };
  }
  return wanderSpot(room);
}

/** A random walkable tile of the room. */
export function wanderSpot(room: RoomKey): Spot {
  const tiles = ROOM_TILES[room];
  const t = tiles[Math.floor(Math.random() * tiles.length)]!;
  return {
    station: -1,
    room,
    c: (t % COLS) + 0.5 + jitter(),
    r: Math.floor(t / COLS) + 0.5 + jitter(),
    pose: room === "sleep" ? "sleep" : "stand",
  };
}
