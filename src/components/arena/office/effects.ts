// Particle bursts, floating result labels and speech bubbles, all from fixed-size pools so the
// frame loop never allocates.
import type * as PIXI from "pixi.js";

type Pixi = typeof PIXI;

const MAX_PARTICLES = 180;
const MAX_LABELS = 8;
export const MAX_BUBBLES = 24;
export const BUBBLE_MS = 6000;

type Particle = { s: PIXI.Sprite; vx: number; vy: number; life: number };
type FloatLabel = { t: PIXI.Text; life: number };

export class Effects {
  private readonly particles: Particle[] = [];
  private readonly labels: FloatLabel[] = [];
  private next = 0;
  private nextLabel = 0;

  constructor(P: Pixi, renderer: PIXI.Renderer, layer: PIXI.Container) {
    const g = new P.Graphics().circle(0, 0, 4).fill(0xffffff);
    const dot = renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const s = new P.Sprite(dot);
      s.anchor.set(0.5);
      s.visible = false;
      layer.addChild(s);
      this.particles.push({ s, vx: 0, vy: 0, life: 0 });
    }
    for (let i = 0; i < MAX_LABELS; i++) {
      const t = new P.Text({
        text: "",
        style: {
          fontFamily: "Space Mono, monospace",
          fontSize: 18,
          fontWeight: "700",
          fill: 0xffffff,
        },
        resolution: 2,
      });
      t.anchor.set(0.5);
      t.visible = false;
      layer.addChild(t);
      this.labels.push({ t, life: 0 });
    }
  }

  /** Small burst of dots; reuses the oldest particles when the pool is exhausted. */
  burst(x: number, y: number, color: number, count = 14) {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.next]!;
      this.next = (this.next + 1) % MAX_PARTICLES;
      const a = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 70;
      p.vx = Math.cos(a) * speed;
      p.vy = Math.sin(a) * speed * 0.6 - 50;
      p.life = 1;
      p.s.tint = color;
      p.s.scale.set(0.4 + Math.random() * 0.5);
      p.s.position.set(x, y - 22);
      p.s.alpha = 1;
      p.s.visible = true;
    }
  }

  /** "+4.2%", "WIN", ... rising above an avatar. */
  floatText(x: number, y: number, text: string, color: number) {
    const l = this.labels[this.nextLabel]!;
    this.nextLabel = (this.nextLabel + 1) % MAX_LABELS;
    l.t.text = text;
    l.t.style.fill = color;
    l.t.position.set(x, y - 62);
    l.t.alpha = 1;
    l.t.visible = true;
    l.life = 1;
  }

  update(dt: number) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i]!;
      if (p.life <= 0) continue;
      p.life -= dt * 1.3;
      if (p.life <= 0) {
        p.s.visible = false;
        continue;
      }
      p.vy += 140 * dt;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.s.alpha = p.life;
    }
    for (let i = 0; i < MAX_LABELS; i++) {
      const l = this.labels[i]!;
      if (l.life <= 0) continue;
      l.life -= dt * 0.6;
      if (l.life <= 0) {
        l.t.visible = false;
        continue;
      }
      l.t.y -= 22 * dt;
      l.t.alpha = Math.min(1, l.life * 2);
    }
  }
}

export type Bubble = {
  root: PIXI.Container;
  bg: PIXI.Graphics;
  text: PIXI.Text;
  owner: string | null;
  until: number;
};

/** Speech bubbles shown above avatars; the oldest bubble is reused when all are in use. */
export class Bubbles {
  readonly pool: Bubble[] = [];

  constructor(P: Pixi, layer: PIXI.Container) {
    for (let i = 0; i < MAX_BUBBLES; i++) {
      const root = new P.Container();
      const bg = new P.Graphics();
      const text = new P.Text({
        text: "",
        style: {
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 11,
          fill: 0x0b1020,
          wordWrap: true,
          wordWrapWidth: 170,
          lineHeight: 14,
        },
        resolution: 2,
      });
      root.addChild(bg, text);
      root.visible = false;
      layer.addChild(root);
      this.pool.push({ root, bg, text, owner: null, until: 0 });
    }
  }

  show(owner: string, message: string, now: number, accent: number): Bubble {
    let b = this.pool.find((x) => x.owner === owner);
    if (!b) {
      b = this.pool[0]!;
      for (const x of this.pool) {
        if (x.owner === null) {
          b = x;
          break;
        }
        if (x.until < b.until) b = x;
      }
    }
    const short = message.length > 80 ? `${message.slice(0, 79)}…` : message;
    b.text.text = short;
    const w = Math.ceil(b.text.width) + 16;
    const h = Math.ceil(b.text.height) + 10;
    b.bg
      .clear()
      .roundRect(-w / 2, -h, w, h, 8)
      .fill(0xf2f4ff)
      .stroke({ width: 1.5, color: accent, alpha: 0.9 })
      .poly([-5, 0, 0, 7, 5, 0])
      .fill(0xf2f4ff);
    b.text.position.set(-w / 2 + 8, -h + 5);
    b.owner = owner;
    b.until = now + BUBBLE_MS;
    b.root.alpha = 1;
    b.root.visible = true;
    return b;
  }

  release(b: Bubble) {
    b.owner = null;
    b.root.visible = false;
  }
}
