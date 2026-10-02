// Agent avatars: procedurally generated from avatar_seed (the same generator as the rest of the
// site), packed into shared atlas pages so hundreds of avatars render in a handful of batches.
import type * as PIXI from "pixi.js";
import { avatarSvg } from "@/lib/arena/avatar-svg";

type Pixi = typeof PIXI;

const PAGE = 2048;
const CELL = 96;
const PER_ROW = Math.floor(PAGE / CELL);
const PER_PAGE = PER_ROW * PER_ROW;

/** Display scale of the 96px avatar art (about 40 world px tall). */
export const BODY_SCALE = 0.44;

type Page = { ctx: CanvasRenderingContext2D; source: PIXI.TextureSource; used: number };

export class AvatarAtlas {
  private readonly pages: Page[] = [];
  private readonly textures = new Map<string, PIXI.Texture>();
  private readonly dirty = new Set<Page>();

  constructor(private readonly P: Pixi) {}

  /** Texture for a seed. The atlas cell fills in as soon as the SVG has decoded. */
  texture(seed: string): PIXI.Texture {
    const hit = this.textures.get(seed);
    if (hit) return hit;
    let page = this.pages[this.pages.length - 1];
    if (!page || page.used >= PER_PAGE) page = this.addPage();
    const cell = page.used++;
    const x = (cell % PER_ROW) * CELL;
    const y = Math.floor(cell / PER_ROW) * CELL;
    const texture = new this.P.Texture({
      source: page.source,
      frame: new this.P.Rectangle(x, y, CELL, CELL),
    });
    this.textures.set(seed, texture);
    const img = new Image();
    img.onload = () => {
      page.ctx.drawImage(img, x, y, CELL, CELL);
      this.dirty.add(page);
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(seed, CELL, { shadow: false }))}`;
    return texture;
  }

  /** Uploads atlas pages that changed since the last frame. */
  flush() {
    if (!this.dirty.size) return;
    for (const page of this.dirty) page.source.update();
    this.dirty.clear();
  }

  destroy() {
    for (const t of this.textures.values()) t.destroy(false);
    for (const p of this.pages) p.source.destroy();
    this.textures.clear();
  }

  private addPage(): Page {
    const canvas = document.createElement("canvas");
    canvas.width = PAGE;
    canvas.height = PAGE;
    const ctx = canvas.getContext("2d")!;
    const source = new this.P.CanvasSource({ resource: canvas });
    const page = { ctx, source, used: 0 };
    this.pages.push(page);
    return page;
  }
}

/** Font names installed once per canvas for avatar labels. */
export const NAME_FONT = "OfficeName";
export const MONO_FONT = "OfficeMono";

export function installFonts(P: Pixi) {
  if (!P.Cache.has(`${NAME_FONT}-bitmap`))
    P.BitmapFont.install({
      name: NAME_FONT,
      style: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 22,
        fontWeight: "600",
        fill: 0xffffff,
      },
      resolution: 1,
      chars: [[" ", "~"]],
    });
  if (!P.Cache.has(`${MONO_FONT}-bitmap`))
    P.BitmapFont.install({
      name: MONO_FONT,
      style: {
        fontFamily: "Space Mono, monospace",
        fontSize: 20,
        fontWeight: "700",
        fill: 0xffffff,
      },
      resolution: 1,
      chars: [[" ", "~"]],
    });
}

export type AgentView = {
  root: PIXI.Container;
  shadow: PIXI.Sprite;
  ring: PIXI.Sprite;
  body: PIXI.Sprite;
  label: PIXI.BitmapText;
  status: PIXI.BitmapText;
  zzz: PIXI.BitmapText;
};

export type SharedArt = { shadow: PIXI.Texture; ring: PIXI.Texture };

export function makeSharedArt(P: Pixi, renderer: PIXI.Renderer): SharedArt {
  const s = new P.Graphics();
  for (let i = 0; i < 5; i++)
    s.ellipse(0, 0, 16 - i * 2.4, 6 - i * 0.9).fill({ color: 0x000000, alpha: 0.12 });
  const shadow = renderer.generateTexture({ target: s, resolution: 2, antialias: true });
  s.destroy();
  const r = new P.Graphics().ellipse(0, 0, 20, 8).stroke({ width: 2.5, color: 0xffffff });
  const ring = renderer.generateTexture({ target: r, resolution: 2, antialias: true });
  r.destroy();
  return { shadow, ring };
}

export function createAgentView(
  P: Pixi,
  atlas: AvatarAtlas,
  art: SharedArt,
  seed: string,
  name: string,
  demo: boolean,
): AgentView {
  const root = new P.Container();
  const shadow = new P.Sprite(art.shadow);
  shadow.anchor.set(0.5);
  const ring = new P.Sprite(art.ring);
  ring.anchor.set(0.5);
  ring.tint = 0x00ff41;
  ring.visible = false;
  const body = new P.Sprite(atlas.texture(seed));
  body.anchor.set(0.5, 0.82);
  body.scale.set(BODY_SCALE);
  const label = new P.BitmapText({
    text: demo ? `${name} · DEMO` : name,
    style: { fontFamily: NAME_FONT, fontSize: 11 },
  });
  label.tint = demo ? 0xffd166 : 0xe6e9ff;
  label.anchor.set(0.5, 0);
  label.position.set(0, 8);
  const status = new P.BitmapText({ text: "", style: { fontFamily: NAME_FONT, fontSize: 9.5 } });
  status.tint = 0x00ff41;
  status.anchor.set(0.5, 0);
  status.position.set(0, 21);
  status.visible = false;
  const zzz = new P.BitmapText({ text: "z z z", style: { fontFamily: MONO_FONT, fontSize: 11 } });
  zzz.tint = 0x9aa4d6;
  zzz.anchor.set(0.5);
  zzz.visible = false;
  root.addChild(shadow, ring, body, label, status, zzz);
  return { root, shadow, ring, body, label, status, zzz };
}
