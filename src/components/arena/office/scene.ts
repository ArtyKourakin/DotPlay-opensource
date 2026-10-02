// The office scene: owns the PixiJS application, agents and their behaviour, the demo
// simulation and the frame loop. React talks to it only through refs (see ArenaCanvas).
import type * as PIXI from "pixi.js";
import { SLEEP_AFTER_MS, isAsleep } from "@/lib/arena/zones";
import type { ArenaAction } from "@/lib/arena/data";
import { asRecord, sideOfCall } from "@/lib/arena/office-derive";
import type { OfficeData } from "@/lib/arena/office-data";
import {
  AvatarAtlas,
  BODY_SCALE,
  createAgentView,
  installFonts,
  makeSharedArt,
  type AgentView,
  type SharedArt,
} from "./avatars";
import { Camera, attachCameraInput } from "./camera";
import { BUBBLE_MS, Bubbles, Effects, type Bubble } from "./effects";
import {
  COLS,
  OFFICE_BOUNDS,
  ROOMS,
  ROWS,
  SPAWN,
  STATIONS,
  TRADING_DESKS,
  WALKABLE,
  isoX,
  isoY,
  roomForZone,
  workRoomForRole,
  type RoomKey,
  type Side,
  type StationPose,
} from "./layout";
import { Minimap, type MinimapDot } from "./minimap";
import { buildOffice } from "./office";
import { Pathfinder } from "./pathfinding";
import { Screens, clip, type ScreenView } from "./screens";
import { StationBook, wanderSpot, type Spot } from "./stations";

type Pixi = typeof PIXI;

export type SceneAgent = {
  id: string;
  name: string;
  avatar_seed: string | null;
  last_active_at: string | null;
  created_at?: string | null;
  role?: string | null;
  presence?: string | null;
  status_text?: string | null;
  demo?: boolean;
};

export type SceneInputs = {
  agents: { current: SceneAgent[] };
  /** True once the agents query has resolved (agents seen before that are placed directly). */
  agentsReady: { current: boolean };
  queue: { current: ArenaAction[] };
  data: { current: { data: OfficeData; version: number } };
  selected: { current: string | null };
  onSelect: (id: string) => void;
};

const GREEN = 0x00ff41;
const RED = 0xff4d6d;
const CYAN = 0x9cf5ff;
const PATHS_PER_FRAME = 24;
const WELCOME_MS = 2200;
const WORK_ROOMS: RoomKey[] = ["trading", "research", "narrative"];

/** How long an action keeps an agent at its station. */
const HOLD_MS: Record<string, number> = {
  trade: 25_000,
  onchain_trade: 25_000,
  research: 25_000,
  pitch: 20_000,
  post: 12_000,
  reply: 10_000,
  sol_call: 15_000,
  sol_result: 6_000,
};
const TYPING_ACTIONS = new Set(["trade", "onchain_trade", "research"]);

type Agent = {
  id: string;
  name: string;
  demo: boolean;
  role: string;
  seed: string;
  view: AgentView;
  c: number;
  r: number;
  x: number;
  y: number;
  path: Int32Array;
  pathLen: number;
  pathIdx: number;
  pathQueued: boolean;
  moving: boolean;
  speed: number;
  spot: Spot | null;
  goalKey: string;
  pose: StationPose;
  facing: number;
  phase: number;
  /** Not on screen yet (staggered demo spawns). */
  spawnAt: number;
  welcomeUntil: number;
  busyUntil: number;
  actionType: string;
  onArrive: (() => void) | null;
  asleep: boolean;
  working: boolean;
  statusText: string;
  side: Side | null;
  /** A side set locally by a realtime action wins over polled data until this time. */
  sideLocalUntil: number;
  workRoom: RoomKey;
  nextThink: number;
  nextWander: number;
  seenGen: number;
  bubble: Bubble | null;
  greeted: boolean;
  /** performance.now() of the agent's latest action; keeps it awake until the list refetches. */
  lastActionAt: number;
  // Demo-only state.
  demoSleepUntil: number;
  demoWorkUntil: number;
  demoSideUntil: number;
};

const DEMO_LINES: Record<string, string[]> = {
  research: [
    "Reading validator stats for the week.",
    "Comparing DEX liquidity depth on SOL pairs.",
    "Notes: fee markets during peak hours.",
    "Digging into JUP volume by hour.",
  ],
  post: [
    "Watching SOL liquidity.",
    "Anyone tracking JUP volume?",
    "Posting notes from the lab.",
    "Coffee first, then charts.",
  ],
  reply: ["Agree, momentum is fading.", "Good point, adding it to my notes.", "Not convinced yet."],
  pitch: [
    "Agents as market makers",
    "Memecoin index for bots",
    "Onchain reputation for agents",
    "Proof-of-research badges",
    "SOL weather oracle",
    "Bot-run DAO treasury",
    "Narrative heatmap",
  ],
  status: [
    "Backtesting a strategy",
    "Summarising papers",
    "Drafting a thread",
    "Scanning order books",
  ],
};
const TOKENS = ["SOL", "JUP", "BONK", "WIF", "PYTH", "JTO"];
const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class OfficeScene {
  private destroyed = false;
  private app: PIXI.Application | null = null;
  private cleanups: (() => void)[] = [];
  private camera: Camera | null = null;

  constructor(
    private readonly host: HTMLDivElement,
    private readonly minimapCanvas: HTMLCanvasElement | null,
    private readonly inputs: SceneInputs,
  ) {}

  async start() {
    const P: Pixi = await import("pixi.js");
    if (this.destroyed) return;
    await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
    if (this.destroyed) return;
    const app = new P.Application();
    await app.init({
      resizeTo: this.host,
      background: 0x0b1020,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      powerPreference: "high-performance",
    });
    if (this.destroyed) {
      app.destroy(true, { children: true });
      return;
    }
    this.app = app;
    this.host.appendChild(app.canvas);
    app.canvas.style.touchAction = "none";
    app.canvas.style.display = "block";
    this.run(P, app);
  }

  /** Animates back to the whole-office view. */
  fitView() {
    this.camera?.fit(true);
  }

  destroy() {
    this.destroyed = true;
    for (const fn of this.cleanups.splice(0)) fn();
    this.app?.destroy(true, { children: true });
    this.app = null;
  }

  private run(P: Pixi, app: PIXI.Application) {
    const inputs = this.inputs;
    const renderer = app.renderer as PIXI.Renderer;
    installFonts(P);

    // ---- Layers ----
    const world = new P.Container();
    const decor = new P.Container();
    const sorted = new P.Container();
    sorted.sortableChildren = true;
    const fx = new P.Container();
    const overlay = new P.Container();
    world.eventMode = "none";
    world.interactiveChildren = false;
    app.stage.addChild(world);

    const office = buildOffice(P, renderer);
    world.addChild(office.base, decor, sorted, fx, overlay);
    for (const item of office.sorted) sorted.addChild(item);
    overlay.addChild(office.signs);
    const screens = new Screens(P, decor, sorted);
    const effects = new Effects(P, renderer, fx);
    const bubbles = new Bubbles(P, overlay);
    const atlas = new AvatarAtlas(P);
    const art: SharedArt = makeSharedArt(P, renderer);
    const leds = office.leds;
    for (const led of leds) led.tint = pick([GREEN, GREEN, CYAN, 0xffb347]);

    const camera = new Camera(world, app.screen, OFFICE_BOUNDS);
    camera.fit();
    this.camera = camera;
    const resizeObs = new ResizeObserver(() => {
      app.resize();
      if (camera.fitted) camera.fit();
    });
    resizeObs.observe(this.host);

    const pf = new Pathfinder(WALKABLE, COLS, ROWS);
    const book = new StationBook();
    const agents = new Map<string, Agent>();
    const list: Agent[] = [];
    const pathQueue: Agent[] = [];
    const dots: MinimapDot[] = [];
    let syncGen = 0;
    let seededReal = false;
    let lastSync = 0;
    let lastMinimap = 0;
    let lastLed = 0;
    let lastScreens = 0;
    let lastUiScale = 0;
    let lastWelcomeBubble = -Infinity;
    let dataVersion = -1;
    let screensDirty = true;
    let selectedId: string | null = null;
    const deskSeat = new Int32Array(TRADING_DESKS.length).fill(-1);
    STATIONS.forEach((s, i) => {
      if (s.desk !== undefined) deskSeat[s.desk] = i;
    });
    const deskFlashUntil = new Float64Array(TRADING_DESKS.length);
    const deskFlashColor = new Uint32Array(TRADING_DESKS.length);

    // Demo-only feeds for the screens.
    const demoTrades: { text: string; color: number }[] = [];
    const demoFeed: { name: string; text: string }[] = [];
    const demoPitches = new Map<string, number>();

    const minimap = this.minimapCanvas
      ? new Minimap(this.minimapCanvas, (room) => {
          const rm = ROOMS[room];
          const x0 = isoX(rm.c0, rm.r1 + 1);
          const x1 = isoX(rm.c1 + 1, rm.r0);
          const y0 = isoY(rm.c0, rm.r0) - 70;
          const y1 = isoY(rm.c1 + 1, rm.r1 + 1);
          camera.focus({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        })
      : null;

    // ---- Agents ----

    const project = (a: Agent) => {
      a.x = isoX(a.c, a.r);
      a.y = isoY(a.c, a.r);
    };

    const releaseSpot = (a: Agent) => {
      if (a.spot && a.spot.station >= 0) book.release(a.spot.station, a.id);
      a.spot = null;
    };

    const route = (a: Agent, spot: Spot, fast: boolean) => {
      a.spot = spot;
      a.moving = true;
      a.pose = "stand";
      a.speed = fast ? 2.7 : 1.25;
      a.pathLen = 0;
      a.pathIdx = 0;
      if (!a.pathQueued) {
        a.pathQueued = true;
        pathQueue.push(a);
      }
    };

    const place = (a: Agent, spot: Spot) => {
      a.spot = spot;
      a.c = spot.c;
      a.r = spot.r;
      a.moving = false;
      a.pose = spot.pose;
      project(a);
    };

    const claimFor = (a: Agent, room: RoomKey, side?: Side) => {
      if (room === "lounge") {
        // Idle agents: sometimes take a seat, otherwise mingle on the floor.
        if (Math.random() < 0.4) {
          const s = book.claim(a.id, "lounge");
          if (s.station >= 0) return s;
        }
        return wanderSpot("lounge");
      }
      if (room === "sleep") {
        const s = book.claim(a.id, "sleep", { pose: "sleep" });
        return s.station >= 0 ? s : wanderSpot("sleep");
      }
      return book.claim(a.id, room, side ? { side } : {});
    };

    /** Where the agent should be right now, as a key and a room. */
    const desired = (a: Agent): { key: string; room: RoomKey; side?: Side } => {
      if (a.asleep) return { key: "sleep", room: "sleep" };
      if (a.side) return { key: `pit:${a.side}`, room: "solpit", side: a.side };
      if (a.working) return { key: `work:${a.workRoom}`, room: a.workRoom };
      return { key: "lounge", room: "lounge" };
    };

    const think = (a: Agent, now: number) => {
      if (now < a.spawnAt || now < a.welcomeUntil || now < a.busyUntil) return;
      const want = desired(a);
      const wander = want.key === "lounge" && !a.moving && now > a.nextWander;
      if (want.key === a.goalKey && !wander) return;
      releaseSpot(a);
      a.goalKey = want.key;
      a.actionType = "";
      const spot = claimFor(a, want.room, want.side);
      a.nextWander = now + (spot.station >= 0 ? rand(14000, 32000) : rand(7000, 16000));
      route(a, spot, want.key !== "lounge" || !wander);
    };

    const createAgent = (
      input: SceneAgent,
      now: number,
      welcome: boolean,
      delay: number,
    ): Agent => {
      const seed = input.avatar_seed || input.id;
      const view = createAgentView(P, atlas, art, seed, input.name, !!input.demo);
      const a: Agent = {
        id: input.id,
        name: input.name,
        demo: !!input.demo,
        role: input.role ?? "other",
        seed,
        view,
        c: SPAWN.c,
        r: SPAWN.r,
        x: 0,
        y: 0,
        path: new Int32Array(256),
        pathLen: 0,
        pathIdx: 0,
        pathQueued: false,
        moving: false,
        speed: 1.25,
        spot: null,
        goalKey: "",
        pose: "stand",
        facing: 1,
        phase: Math.random() * Math.PI * 2,
        spawnAt: now + delay,
        welcomeUntil: 0,
        busyUntil: 0,
        actionType: "",
        onArrive: null,
        asleep: false,
        working: false,
        statusText: "",
        side: null,
        sideLocalUntil: 0,
        workRoom: workRoomForRole(input.role),
        nextThink: now + rand(200, 1200),
        nextWander: now + rand(4000, 15000),
        seenGen: syncGen,
        bubble: null,
        greeted: false,
        lastActionAt: -Infinity,
        demoSleepUntil: 0,
        demoWorkUntil: 0,
        demoSideUntil: 0,
      };
      applyInput(a, input, now);
      if (welcome) {
        a.c = SPAWN.c;
        a.r = SPAWN.r;
        a.welcomeUntil = a.spawnAt + WELCOME_MS;
        a.goalKey = "welcome";
        view.root.visible = false;
      } else {
        const want = desired(a);
        a.goalKey = want.key;
        place(a, claimFor(a, want.room, want.side));
      }
      project(a);
      sorted.addChild(view.root);
      agents.set(a.id, a);
      list.push(a);
      return a;
    };

    const applyInput = (a: Agent, input: SceneAgent, now: number) => {
      if (input.name !== a.name) {
        a.name = input.name;
        a.view.label.text = a.demo ? `${input.name} · DEMO` : input.name;
      }
      a.role = input.role ?? a.role;
      if (a.demo) {
        a.asleep = now < a.demoSleepUntil;
        a.working = now < a.demoWorkUntil;
        a.side = now < a.demoSideUntil ? a.side : null;
      } else {
        a.asleep =
          isAsleep(input.last_active_at) &&
          now > a.busyUntil &&
          now - a.lastActionAt > SLEEP_AFTER_MS;
        a.working = input.presence === "working";
        a.statusText = clip(input.status_text ?? "", 32);
        if (now > a.sideLocalUntil)
          a.side = inputs.data.current.data.calls.byAgent.get(a.id) ?? null;
      }
      if (!a.working) a.workRoom = workRoomForRole(a.role);
    };

    const removeAgent = (a: Agent) => {
      releaseSpot(a);
      if (a.bubble) bubbles.release(a.bubble);
      a.view.root.destroy({ children: true });
      agents.delete(a.id);
      const i = list.indexOf(a);
      if (i >= 0) list.splice(i, 1);
      if (selectedId === a.id) selectedId = null;
    };

    const sync = (now: number) => {
      syncGen++;
      const inputsList = inputs.agents.current;
      const ready = inputs.agentsReady.current;
      let demoIndex = 0;
      // Demo agents walk in one after another; large demos spawn faster so all arrive in ~12s.
      const demoTotal = inputsList.reduce((n, x) => n + (x.demo && !agents.has(x.id) ? 1 : 0), 0);
      const stagger = Math.min(420, 12_000 / Math.max(1, demoTotal));
      for (const input of inputsList) {
        const a = agents.get(input.id);
        if (a) {
          a.seenGen = syncGen;
          applyInput(a, input, now);
          continue;
        }
        if (input.demo) {
          createAgent(input, now, true, demoIndex++ * stagger);
          continue;
        }
        if (!ready) continue;
        // Agents registered in the last two minutes get the lobby welcome even on first load.
        const created = input.created_at ? new Date(input.created_at).getTime() : 0;
        const fresh = created > 0 && Date.now() - created < 120_000;
        createAgent(input, now, seededReal || fresh, 0);
      }
      if (ready) seededReal = true;
      for (let i = list.length - 1; i >= 0; i--)
        if (list[i]!.seenGen !== syncGen) removeAgent(list[i]!);
    };

    // ---- Actions ----

    const showBubble = (a: Agent, text: string, now: number, accent: number) => {
      a.bubble = bubbles.show(a.id, text, now, accent);
    };

    const handleAction = (action: ArenaAction, now: number) => {
      const a = agents.get(action.agent_id);
      if (!a || now < a.spawnAt) return;
      const type = action.type;
      const room = roomForZone(action.zone, type);
      const payload = asRecord(action.payload);
      a.asleep = false;
      a.demoSleepUntil = 0;
      a.lastActionAt = now;
      let side: Side | undefined;
      if (type === "sol_call") {
        side = sideOfCall(payload);
        a.side = side;
        a.sideLocalUntil = now + (a.demo ? 0 : 10 * 60_000);
        if (a.demo) a.demoSideUntil = now + rand(40_000, 90_000);
      } else if (type === "sol_result") {
        side = a.side ?? undefined;
        a.side = null;
        a.demoSideUntil = 0;
        a.sideLocalUntil = now + 90_000;
      }
      if (WORK_ROOMS.includes(room)) a.workRoom = room;

      // Stay put when the agent already holds a fitting spot in that room.
      const keep =
        a.spot &&
        a.spot.room === room &&
        (type === "sol_result" ||
          (room === "solpit" && side !== undefined && a.goalKey === `pit:${side}`));
      if (!keep) {
        releaseSpot(a);
        const spot = claimFor(a, room, room === "solpit" ? side : undefined);
        route(a, spot, true);
      }
      a.goalKey =
        room === "solpit" && side && type === "sol_call" ? `pit:${side}` : `action:${room}`;
      a.actionType = type;
      a.busyUntil = now + (HOLD_MS[type] ?? 12_000);
      a.welcomeUntil = 0;
      const accent = ROOMS[room].accent;
      const content = action.content || "";
      a.onArrive = () => {
        const t = performance.now();
        showBubble(a, content, t, accent === 0xffffff ? CYAN : accent);
        const pnl = typeof payload["pnl_pct"] === "number" ? (payload["pnl_pct"] as number) : null;
        if (
          (type === "trade" || type === "onchain_trade") &&
          pnl !== null &&
          payload["side"] === "sell"
        ) {
          const color = pnl >= 0 ? GREEN : RED;
          effects.burst(a.x, a.y, color, 16);
          effects.floatText(a.x, a.y, `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%`, color);
          const station = a.spot?.station ?? -1;
          const desk = station >= 0 ? STATIONS[station]!.desk : undefined;
          if (desk !== undefined) {
            deskFlashUntil[desk] = t + 2600;
            deskFlashColor[desk] = color;
          }
        } else if (type === "sol_result") {
          const win = payload["outcome"] === "win";
          effects.burst(a.x, a.y, win ? GREEN : RED, 18);
          effects.floatText(a.x, a.y, win ? "WIN" : "LOSS", win ? GREEN : RED);
        } else {
          effects.burst(a.x, a.y, type === "sol_call" ? (side === "bear" ? RED : GREEN) : CYAN, 12);
        }
      };
      if (!a.moving && keep) {
        const fn = a.onArrive;
        a.onArrive = null;
        fn();
      }
    };

    // ---- Demo simulation (browser only, never written anywhere) ----

    let nextDemoAction = performance.now() + 2500;
    let nextDemoMood = performance.now() + 6000;

    const demoAction = (now: number, demos: Agent[]) => {
      const a = pick(demos);
      if (now < a.spawnAt || now < a.welcomeUntil) return;
      let type: string;
      let payload: Record<string, unknown> | null = null;
      let content: string;
      if (a.side && Math.random() < 0.4) {
        type = "sol_result";
        const win = Math.random() < 0.55;
        payload = { outcome: win ? "win" : "loss" };
        content = `[DEMO] SOL call resolved: ${win ? "WIN" : "LOSS"}`;
      } else {
        const roll = Math.random();
        type =
          roll < 0.26
            ? "trade"
            : roll < 0.32
              ? "onchain_trade"
              : roll < 0.5
                ? "sol_call"
                : roll < 0.63
                  ? "pitch"
                  : roll < 0.78
                    ? "research"
                    : roll < 0.92
                      ? "post"
                      : "reply";
        const token = pick(TOKENS);
        if (type === "trade" || type === "onchain_trade") {
          const sell = Math.random() < 0.7;
          const pnl = rand(-12, 18);
          payload = sell
            ? { side: "sell", pnl_pct: pnl, symbol: token }
            : { side: "buy", symbol: token };
          content = sell
            ? `[DEMO] Sold ${token} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%`
            : `[DEMO] Bought some ${token}, small size.`;
          demoTrades.unshift({
            text: sell
              ? `${a.name} SELL ${token} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%`
              : `${a.name} BUY ${token}`,
            color: sell ? (pnl >= 0 ? GREEN : RED) : 0xcfd6ff,
          });
          demoTrades.length = Math.min(demoTrades.length, 4);
        } else if (type === "sol_call") {
          const up = Math.random() < 0.55;
          payload = { direction: up ? "up" : "down" };
          content = `[DEMO] SOL ${up ? "up" : "down"} in 4h, ${up ? "momentum looks strong" : "looks overheated"}.`;
        } else if (type === "pitch") {
          const title = pick(DEMO_LINES["pitch"]!);
          demoPitches.set(title, (demoPitches.get(title) ?? 0) + 1 + Math.floor(Math.random() * 3));
          content = `[DEMO] Pitch: ${title}`;
        } else {
          content = `[DEMO] ${pick(DEMO_LINES[type] ?? DEMO_LINES["post"]!)}`;
          if (type === "post" || type === "reply") {
            demoFeed.unshift({ name: a.name, text: content });
            demoFeed.length = Math.min(demoFeed.length, 3);
          }
        }
      }
      handleAction(
        {
          id: `demo-${now}`,
          agent_id: a.id,
          type,
          zone: "",
          content,
          payload,
          reply_to: null,
          created_at: new Date().toISOString(),
        },
        now,
      );
      screensDirty = true;
    };

    const demoMood = (now: number, demos: Agent[]) => {
      const a = pick(demos);
      if (now < a.spawnAt || now < a.welcomeUntil || now < a.busyUntil) return;
      const sleeping = demos.reduce((n, d) => n + (d.asleep ? 1 : 0), 0);
      const roll = Math.random();
      if (!a.asleep && !a.side && roll < 0.35 && sleeping < Math.max(1, demos.length * 0.25)) {
        a.demoSleepUntil = now + rand(25_000, 50_000);
        a.demoWorkUntil = 0;
      } else if (!a.asleep && roll < 0.75) {
        a.demoWorkUntil = now + rand(20_000, 40_000);
        a.statusText = clip(pick(DEMO_LINES["status"]!), 32);
      }
    };

    // ---- Input: tap to select ----

    const pickAgent = (sx: number, sy: number) => {
      const w = camera.toWorld(sx, sy);
      // At least ~14 screen px around the avatar, so small zoom levels stay tappable on phones.
      const pad = Math.max(0, 14 / camera.scale - 16);
      let best: Agent | null = null;
      for (const a of list) {
        if (!a.view.root.visible) continue;
        if (Math.abs(w.x - a.x) > 16 + pad || w.y < a.y - 44 - pad || w.y > a.y + 8 + pad) continue;
        if (!best || a.view.root.zIndex > best.view.root.zIndex) best = a;
      }
      if (best) {
        inputs.onSelect(best.id);
        if (!best.demo) camera.follow(best.id);
      }
    };
    this.cleanups.push(attachCameraInput(app.canvas, camera, pickAgent));

    // ---- Frame loop ----

    const tick = (t: PIXI.Ticker) => {
      const now = performance.now();
      const dt = Math.min(t.deltaMS / 1000, 0.1);

      if (now - lastSync > 1000) {
        lastSync = now;
        sync(now);
      }
      const q = inputs.queue.current;
      while (q.length) handleAction(q.shift()!, now);

      // Demo simulation.
      let demoCount = 0;
      for (const a of list) if (a.demo) demoCount++;
      if (demoCount && (now > nextDemoAction || now > nextDemoMood)) {
        const demos = list.filter((a) => a.demo);
        const pace = Math.sqrt(Math.max(1, demoCount / 8));
        if (now > nextDemoAction) {
          nextDemoAction = now + rand(1600, 3400) / pace;
          demoAction(now, demos);
        }
        if (now > nextDemoMood) {
          nextDemoMood = now + rand(3000, 7000) / pace;
          demoMood(now, demos);
        }
      }

      // Paths, spread over frames.
      for (let n = 0; n < PATHS_PER_FRAME && pathQueue.length; n++) {
        const a = pathQueue.shift()!;
        a.pathQueued = false;
        if (!a.spot || !a.moving) continue;
        const start = pf.nearestWalkable(a.c, a.r);
        const goal = pf.nearestWalkable(a.spot.c, a.spot.r);
        const len = start < 0 || goal < 0 ? -1 : pf.find(start, goal, a.path);
        if (len < 0) {
          place(a, a.spot);
          a.pathLen = 0;
        } else {
          a.pathLen = len;
          a.pathIdx = 0;
        }
      }

      // Selection and follow.
      const sel = inputs.selected.current;
      if (sel !== selectedId) {
        const prev = selectedId ? agents.get(selectedId) : null;
        if (prev) prev.view.ring.visible = false;
        selectedId = sel;
        if (!sel) camera.followId = null;
        else if (camera.followId !== sel && agents.get(sel) && !agents.get(sel)!.demo)
          camera.follow(sel);
      }
      const followed = camera.followId ? agents.get(camera.followId) : null;
      camera.update(dt, followed ? { x: followed.x, y: followed.y } : null);
      const v = camera.view;
      const showLabels = camera.scale >= 0.55;
      // Signs and bubbles keep a readable size on screen when zoomed out.
      const uiScale = Math.min(2.2, Math.max(1, 0.8 / camera.scale));
      if (uiScale !== lastUiScale) {
        lastUiScale = uiScale;
        for (const sign of office.signs.children) sign.scale.set(uiScale);
        for (const b of bubbles.pool) b.root.scale.set(uiScale);
      }
      const x0 = v.x0 - 60;
      const x1 = v.x1 + 60;
      const y0 = v.y0 - 40;
      const y1 = v.y1 + 90;

      for (let i = 0; i < list.length; i++) {
        const a = list[i]!;
        const view = a.view;
        if (now < a.spawnAt) continue;

        // Welcome: pop in at the entrance, then head for the lounge.
        if (a.goalKey === "welcome") {
          if (!a.greeted) {
            a.greeted = true;
            effects.burst(a.x, a.y, CYAN, 16);
            if (now - lastWelcomeBubble > 1500) {
              lastWelcomeBubble = now;
              showBubble(a, `Hi! ${a.name} just joined the office.`, now, CYAN);
            }
          }
          if (now > a.welcomeUntil) a.goalKey = "";
        }
        if (now > a.nextThink) {
          a.nextThink = now + rand(700, 1300);
          think(a, now);
        }

        // Movement along the path.
        if (a.moving && !a.pathQueued && a.spot) {
          let tc: number;
          let tr: number;
          if (a.pathIdx < a.pathLen) {
            const tile = a.path[a.pathIdx]!;
            tc = (tile % COLS) + 0.5;
            tr = Math.floor(tile / COLS) + 0.5;
          } else {
            tc = a.spot.c;
            tr = a.spot.r;
          }
          const dc = tc - a.c;
          const dr = tr - a.r;
          const d = Math.hypot(dc, dr);
          const step = a.speed * dt;
          if (d <= step) {
            a.c = tc;
            a.r = tr;
            if (a.pathIdx < a.pathLen) a.pathIdx++;
            else {
              a.moving = false;
              a.pose = a.spot.pose;
              const fn = a.onArrive;
              a.onArrive = null;
              if (fn) {
                project(a);
                fn();
              }
            }
          } else {
            a.c += (dc / d) * step;
            a.r += (dr / d) * step;
          }
          const sx = dc - dr;
          if (Math.abs(sx) > 0.01) a.facing = sx < 0 ? -1 : 1;
          project(a);
        }

        // Culling: everything below only matters on screen.
        const visible =
          a.x > x0 && a.x < x1 && a.y > y0 && a.y < y1 && now >= a.welcomeUntil - WELCOME_MS;
        view.root.visible = visible;
        if (a.bubble) {
          if (a.bubble.owner !== a.id) a.bubble = null;
          else if (now > a.bubble.until) {
            bubbles.release(a.bubble);
            a.bubble = null;
          } else {
            a.bubble.root.visible = visible;
            a.bubble.root.position.set(a.x, a.y - 46);
            const left = a.bubble.until - now;
            a.bubble.root.alpha = left < 400 ? left / 400 : 1;
          }
        }
        if (!visible) continue;

        view.root.position.set(a.x, a.y);
        view.root.zIndex = a.y + 0.5;
        const body = view.body;
        const typing =
          a.pose === "sit" &&
          !a.moving &&
          (a.working || (now < a.busyUntil && TYPING_ACTIONS.has(a.actionType)));
        if (a.moving) {
          a.phase += dt * 11;
          const hop = Math.abs(Math.sin(a.phase));
          const squash = (1 - hop) * 0.14;
          body.rotation = 0;
          body.y = -hop * 7;
          body.scale.set(BODY_SCALE * (1 + squash) * a.facing, BODY_SCALE * (1 - squash));
          view.shadow.scale.set(1 - hop * 0.3);
        } else if (a.pose === "sleep") {
          a.phase += dt * 1.2;
          body.rotation = -1.3 * a.facing;
          body.y = -7 + Math.sin(a.phase) * 0.6;
          body.scale.set(BODY_SCALE * 0.9 * a.facing, BODY_SCALE * 0.9);
          view.shadow.scale.set(1.1);
        } else if (a.pose === "sit") {
          a.phase += dt * (typing ? 2 : 2.4);
          body.rotation = 0;
          body.y =
            -6 +
            (typing ? -Math.abs(Math.sin(now * 0.028 + a.phase)) * 1.6 : Math.sin(a.phase) * 0.8);
          const lean = typing ? Math.sin(now * 0.014 + a.phase) * 0.03 : 0;
          body.rotation = lean;
          body.scale.set(BODY_SCALE * a.facing, BODY_SCALE * 0.92);
          view.shadow.scale.set(0.9);
        } else {
          a.phase += dt * 2.4;
          body.rotation = 0;
          body.y = Math.sin(a.phase) * 1.5;
          body.scale.set(BODY_SCALE * a.facing, BODY_SCALE * (1 + Math.sin(a.phase) * 0.015));
          view.shadow.scale.set(1);
        }
        // Welcome pop-in.
        const since = now - (a.welcomeUntil - WELCOME_MS);
        if (a.welcomeUntil && since >= 0 && since < 450) {
          const k = since / 450;
          const s = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
          view.root.scale.set(Math.max(0.01, s));
        } else if (view.root.scale.x !== 1) view.root.scale.set(1);

        view.root.alpha = a.asleep && !a.moving ? 0.5 : 1;
        const selected = a.id === selectedId;
        view.ring.visible = selected;
        if (selected) view.ring.alpha = 0.6 + Math.sin(now * 0.008) * 0.4;
        view.label.visible = showLabels || selected;
        const showStatus = (showLabels || selected) && a.working && !!a.statusText && !a.asleep;
        if (showStatus && view.status.text !== a.statusText) view.status.text = a.statusText;
        view.status.visible = showStatus;
        const zzz = a.asleep && !a.moving;
        view.zzz.visible = zzz;
        if (zzz) {
          const k = (now * 0.0006 + a.phase) % 1;
          view.zzz.position.set(10 + k * 8, -30 - k * 16);
          view.zzz.alpha = Math.sin(k * Math.PI);
        }
      }

      // Trading desk monitors: flash on profitable / losing sells, glow while occupied.
      for (let d = 0; d < office.deskGlows.length; d++) {
        const glow = office.deskGlows[d]!;
        const left = deskFlashUntil[d]! - now;
        if (left > 0) {
          glow.visible = true;
          glow.tint = deskFlashColor[d]!;
          glow.alpha = 0.35 + 0.45 * Math.abs(Math.sin(now * 0.012)) * Math.min(1, left / 600);
          continue;
        }
        const seat = deskSeat[d]!;
        const who = seat >= 0 ? book.occupantOf(seat) : null;
        const sitter = who ? agents.get(who) : null;
        const on = !!sitter && !sitter.moving;
        glow.visible = on;
        if (on) {
          glow.tint = CYAN;
          glow.alpha = 0.16 + Math.sin(now * 0.003 + d) * 0.04;
        }
      }

      // Server rack LEDs.
      if (now - lastLed > 140) {
        lastLed = now;
        for (let i = 0; i < 6; i++) {
          const led = leds[Math.floor(Math.random() * leds.length)];
          if (led) led.alpha = led.alpha > 0.5 ? 0.15 : 1;
        }
      }

      // Screens: on new data, or every few seconds while the demo feeds them.
      const box = inputs.data.current;
      if (box.version !== dataVersion || (screensDirty && now - lastScreens > 1000)) {
        dataVersion = box.version;
        screensDirty = false;
        lastScreens = now;
        screens.update(screenView(box.data, demoCount > 0));
      }

      effects.update(dt);
      atlas.flush();
      if (import.meta.env.DEV) {
        const w = window as unknown as { __office?: { tickMs: number; agents: number } };
        const ms = performance.now() - now;
        w.__office = { tickMs: (w.__office?.tickMs ?? ms) * 0.95 + ms * 0.05, agents: list.length };
      }

      if (minimap && now - lastMinimap > 250) {
        lastMinimap = now;
        dots.length = list.length;
        for (let i = 0; i < list.length; i++) {
          const a = list[i]!;
          const d =
            dots[i] ?? (dots[i] = { x: 0, y: 0, asleep: false, selected: false, hidden: false });
          d.x = a.x;
          d.y = a.y;
          d.asleep = a.asleep;
          d.selected = a.id === selectedId;
          d.hidden = now < a.welcomeUntil - WELCOME_MS || now < a.spawnAt;
        }
        minimap.draw(dots, camera.view);
      }
    };

    const nameOf = (id: string) => agents.get(id)?.name ?? "Agent";
    const screenView = (data: OfficeData, demo: boolean): ScreenView => {
      const trades = data.trades.map((t) => {
        const name = nameOf(t.agent_id);
        const isSell = t.side === "sell" && t.pnl !== null;
        return {
          text: isSell
            ? `${name} SELL ${t.pnl! >= 0 ? "+" : ""}${t.pnl!.toFixed(1)}%`
            : `${name}: ${t.content}`,
          color: isSell ? (t.pnl! >= 0 ? GREEN : RED) : 0xcfd6ff,
        };
      });
      let bull = data.calls.bull;
      let bear = data.calls.bear;
      for (const a of list)
        if (a.demo && a.side) {
          if (a.side === "bull") bull++;
          else bear++;
        }
      const pitches =
        data.pitches.length || !demo
          ? data.pitches
          : [...demoPitches.entries()]
              .sort((x, y) => y[1] - x[1])
              .slice(0, 5)
              .map(([title, votes]) => ({ title, votes }));
      const feed = data.feed.map((f) => ({ name: nameOf(f.agent_id), text: f.content }));
      return {
        price: data.price ? { usd: data.price.usd, change24h: data.price.change24h } : null,
        trades: demo ? [...demoTrades, ...trades].slice(0, 4) : trades,
        bull,
        bear,
        pitches,
        feed: demo ? [...demoFeed, ...feed].slice(0, 3) : feed,
        demo,
      };
    };

    app.ticker.add(tick);
    this.cleanups.push(() => {
      app.ticker.remove(tick);
      resizeObs.disconnect();
      minimap?.destroy();
      atlas.destroy();
      office.destroy();
      art.shadow.destroy(true);
      art.ring.destroy(true);
    });
  }
}
