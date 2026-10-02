// Live screens inside the office: the trading wall screen, the Narrative Lab sticky-note wall,
// the lounge TV and the SOL Pit whiteboard. Each is a container skewed onto its wall plane and
// redrawn only when its data changes.
import type * as PIXI from "pixi.js";
import { PIT_DIVIDER_C, depthOf, isoX, isoY } from "./layout";

type Pixi = typeof PIXI;

/** Skew that maps a container's x axis onto a wall running along +c (north walls, boards). */
const ALONG_C = Math.atan(0.5);
/** Skew for the west wall: x runs along -r (up and to the right on screen). */
const ALONG_MINUS_R = -Math.atan(0.5);
/** Screen length of one tile edge. */
const EDGE = Math.hypot(32, 16);
/** Width of the SOL Pit whiteboard in tiles (its stand legs sit at the panel edges). */
export const BOARD_TILES = 2.6;

export type ScreenLine = { text: string; color?: number };

export type ScreenView = {
  price: { usd: number; change24h: number | null } | null;
  trades: ScreenLine[];
  bull: number;
  bear: number;
  pitches: { title: string; votes: number }[];
  feed: { name: string; text: string }[];
  demo: boolean;
};

const GREEN = 0x00ff41;
const RED = 0xff4d6d;
const NOTE_COLORS = [0xffe17a, 0xff9dc4, 0x9cf5ff, 0xc6ff7a, 0xffc6a8];

export const clip = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

export class Screens {
  private readonly P: Pixi;
  private readonly price: PIXI.Text;
  private readonly change: PIXI.Text;
  private readonly trades: PIXI.Text[] = [];
  private readonly wallTag: PIXI.Text;
  private readonly notes: {
    note: PIXI.Container;
    g: PIXI.Graphics;
    title: PIXI.Text;
    votes: PIXI.Text;
  }[] = [];
  private readonly notesEmpty: PIXI.Text;
  private readonly tv: PIXI.Text[] = [];
  private readonly tvEmpty: PIXI.Text;
  private readonly bar: PIXI.Graphics;
  private readonly bullText: PIXI.Text;
  private readonly bearText: PIXI.Text;
  private last = "";

  constructor(P: Pixi, decor: PIXI.Container, sorted: PIXI.Container) {
    this.P = P;
    const text = (size: number, fill: number, mono = false, weight: "400" | "700" = "400") =>
      new P.Text({
        text: "",
        style: {
          fontFamily: mono ? "Space Mono, monospace" : "Inter, system-ui, sans-serif",
          fontSize: size,
          fill,
          fontWeight: weight,
        },
        resolution: 2,
      });

    // ---- Trading floor wall screen (north wall, c 27.3 .. 35.7) ----
    {
      const W = 8.4 * EDGE;
      const H = 86;
      const c = this.wall(decor, isoX(27.3, 1), isoY(27.3, 1) - 110, ALONG_C);
      c.addChild(
        new P.Graphics()
          .roundRect(-4, -4, W + 8, H + 8, 6)
          .fill(0x0d1326)
          .roundRect(0, 0, W, H, 4)
          .fill(0x040915)
          .stroke({ width: 1.5, color: GREEN, alpha: 0.55 }),
      );
      const label = text(10, 0x9aa4d6, true, "700");
      label.text = "SOL / USD";
      label.position.set(10, 7);
      this.price = text(28, 0xe6e9ff, true, "700");
      this.price.position.set(10, 22);
      this.change = text(13, GREEN, true, "700");
      this.change.position.set(12, 60);
      const head = text(9, 0x9aa4d6, true, "700");
      head.text = "RECENT TRADES";
      head.position.set(150, 7);
      this.wallTag = text(8, 0xffd166, true, "700");
      this.wallTag.position.set(W - 40, 7);
      c.addChild(label, this.price, this.change, head, this.wallTag);
      for (let i = 0; i < 4; i++) {
        const t = text(10, 0xcfd6ff);
        t.position.set(150, 22 + i * 15);
        this.trades.push(t);
        c.addChild(t);
      }
      const divider = new P.Graphics().rect(140, 8, 1, H - 16).fill({ color: GREEN, alpha: 0.25 });
      c.addChild(divider);
    }

    // ---- Narrative Lab sticky-note wall (north wall, c 14.2 .. 22.8) ----
    {
      const W = 8.6 * EDGE;
      const H = 78;
      const c = this.wall(decor, isoX(14.2, 1), isoY(14.2, 1) - 108, ALONG_C);
      c.addChild(
        new P.Graphics()
          .roundRect(-3, -3, W + 6, H + 6, 4)
          .fill(0x3a2a1a)
          .roundRect(0, 0, W, H, 3)
          .fill(0x6b4e2e),
      );
      const head = text(9, 0xffe7c2, true, "700");
      head.text = "TOP PITCHES · THIS WEEK";
      head.position.set(8, 4);
      c.addChild(head);
      this.notesEmpty = text(10, 0xffe7c2);
      this.notesEmpty.text = "No pitches yet this week";
      this.notesEmpty.position.set(8, 34);
      c.addChild(this.notesEmpty);
      const noteW = (W - 16 - 4 * 6) / 5;
      for (let i = 0; i < 5; i++) {
        const note = new P.Container();
        const g = new P.Graphics();
        note.position.set(8 + i * (noteW + 6), 19);
        note.rotation = (i % 2 ? 1 : -1) * 0.03;
        const title = text(8, 0x2a2140, false, "700");
        title.style.wordWrap = true;
        title.style.wordWrapWidth = noteW - 8;
        title.style.lineHeight = 10;
        title.position.set(4, 4);
        const votes = text(8, 0x2a2140, true, "700");
        votes.position.set(4, 42);
        note.addChild(g, title, votes);
        note.visible = false;
        c.addChild(note);
        this.notes.push({ note, g, title, votes });
      }
    }

    // ---- Lounge TV (west wall, r 22.8 .. 17.2) ----
    {
      const W = 5.6 * EDGE;
      const H = 84;
      const c = this.wall(decor, isoX(1, 22.8), isoY(1, 22.8) - 108, ALONG_MINUS_R);
      c.addChild(
        new P.Graphics()
          .roundRect(-5, -5, W + 10, H + 10, 6)
          .fill(0x07090f)
          .roundRect(0, 0, W, H, 3)
          .fill(0x0d1a33)
          .stroke({ width: 1, color: 0x6fb7ff, alpha: 0.4 }),
      );
      const head = text(9, 0xffb347, true, "700");
      head.text = "LOUNGE TV · LATEST FEED";
      head.position.set(8, 5);
      c.addChild(head);
      this.tvEmpty = text(10, 0x9aa4d6);
      this.tvEmpty.text = "Waiting for the first post…";
      this.tvEmpty.position.set(8, 36);
      c.addChild(this.tvEmpty);
      for (let i = 0; i < 3; i++) {
        const t = text(9, 0xe6e9ff);
        t.style.wordWrap = true;
        t.style.wordWrapWidth = W - 16;
        t.style.lineHeight = 11;
        t.position.set(8, 20 + i * 21);
        this.tv.push(t);
        c.addChild(t);
      }
    }

    // ---- SOL Pit whiteboard (free-standing, on the divider) ----
    {
      const W = BOARD_TILES * EDGE;
      const H = 46;
      const c0 = PIT_DIVIDER_C + 0.5 - BOARD_TILES / 2;
      const r = 17.5;
      const c = this.wall(sorted, isoX(c0, r), isoY(c0, r) - 72, ALONG_C);
      c.zIndex = depthOf(PIT_DIVIDER_C + 0.5, r) + 0.1;
      c.addChild(
        new P.Graphics()
          .roundRect(-2, -2, W + 4, H + 4, 3)
          .fill(0x9aa4d6)
          .roundRect(0, 0, W, H, 2)
          .fill(0xf2f4ff),
      );
      const head = text(8, 0x0b1020, true, "700");
      head.text = "OPEN SOL CALLS";
      head.anchor.set(0.5, 0);
      head.position.set(W / 2, 3);
      this.bullText = text(10, 0x0a7a2f, true, "700");
      this.bullText.position.set(5, 15);
      this.bearText = text(10, 0xc22745, true, "700");
      this.bearText.anchor.set(1, 0);
      this.bearText.position.set(W - 5, 15);
      this.bar = new P.Graphics();
      this.bar.position.set(5, 32);
      c.addChild(head, this.bullText, this.bearText, this.bar);
    }
  }

  private wall(parent: PIXI.Container, x: number, y: number, skew: number) {
    const c = new this.P.Container();
    c.position.set(x, y);
    c.skew.y = skew;
    parent.addChild(c);
    return c;
  }

  update(v: ScreenView) {
    const key = JSON.stringify(v);
    if (key === this.last) return;
    this.last = key;

    // Wall screen.
    if (v.price) {
      this.price.text = `$${v.price.usd.toFixed(2)}`;
      const ch = v.price.change24h;
      this.change.text =
        ch === null ? "24h —" : `${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(2)}% 24h`;
      this.change.style.fill = ch === null ? 0x9aa4d6 : ch >= 0 ? GREEN : RED;
    } else {
      this.price.text = "—";
      this.change.text = "price unavailable";
      this.change.style.fill = 0x9aa4d6;
    }
    this.wallTag.text = v.demo ? "DEMO" : "";
    for (let i = 0; i < this.trades.length; i++) {
      const line = v.trades[i];
      const t = this.trades[i]!;
      t.text = line ? clip(line.text, 30) : i === 0 ? "No trades yet" : "";
      t.style.fill = line?.color ?? 0x9aa4d6;
    }

    // Sticky notes.
    this.notesEmpty.visible = v.pitches.length === 0;
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i]!;
      const p = v.pitches[i];
      n.note.visible = !!p;
      if (!p) continue;
      const w = n.title.style.wordWrapWidth + 8;
      n.g
        .clear()
        .rect(0, 0, w, 54)
        .fill(NOTE_COLORS[i % NOTE_COLORS.length]!);
      n.g.rect(0, 0, w, 3).fill({ color: 0x000000, alpha: 0.12 });
      n.title.text = clip(p.title, 44);
      n.votes.text = `▲ ${p.votes}`;
    }

    // Lounge TV.
    this.tvEmpty.visible = v.feed.length === 0;
    for (let i = 0; i < this.tv.length; i++) {
      const item = v.feed[i];
      this.tv[i]!.text = item ? `${clip(item.name, 16)}: ${clip(item.text, 70)}` : "";
    }

    // SOL Pit whiteboard.
    this.bullText.text = `BULL ${v.bull}`;
    this.bearText.text = `${v.bear} BEAR`;
    const total = v.bull + v.bear;
    const W = BOARD_TILES * EDGE - 10;
    const bullW = total ? (W * v.bull) / total : W / 2;
    this.bar
      .clear()
      .rect(0, 0, bullW, 9)
      .fill(total ? GREEN : 0xcfd6ff)
      .rect(bullW, 0, W - bullW, 9)
      .fill(total ? RED : 0xcfd6ff);
  }
}
