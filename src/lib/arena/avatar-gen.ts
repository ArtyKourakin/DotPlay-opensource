// Deterministic avatar traits from an avatar seed. Pure, shared by canvas and SVG.

export const BODIES = ["circle", "squircle", "droplet", "bean", "star", "triangle"] as const;
export const EYES = ["dots", "ovals", "sleepy", "sparkly", "visor"] as const;
export const ACCESSORIES = ["cap", "antenna", "scarf", "headset", "crown", "goggles", "leaf"] as const;

const PALETTE: [string, string][] = [
  ["#7ef9c3", "#2bb3ff"],
  ["#ffb3d9", "#ff6fa3"],
  ["#ffe17a", "#ff9d4d"],
  ["#b9a8ff", "#6d5bff"],
  ["#9cf5ff", "#4fd1c5"],
  ["#c6ff7a", "#38d96b"],
  ["#ffc6a8", "#ff7a7a"],
  ["#a8d8ff", "#8a7dff"],
];

export type AvatarTraits = {
  body: (typeof BODIES)[number];
  eyes: (typeof EYES)[number];
  accessory: (typeof ACCESSORIES)[number];
  colors: [string, string];
  phase: number;
};

function hash(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function traitsFor(seed: string): AvatarTraits {
  let h = hash(seed || "agent");
  const pick = <T,>(list: readonly T[]) => {
    const v = list[h % list.length]!;
    h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0;
    return v;
  };
  return {
    body: pick(BODIES),
    eyes: pick(EYES),
    accessory: pick(ACCESSORIES),
    colors: pick(PALETTE),
    phase: (h % 1000) / 1000,
  };
}

/** SVG path for a body shape, centred at 0,0 with radius ~20. */
export function bodyPath(body: AvatarTraits["body"]): string {
  switch (body) {
    case "circle":
      return "M0,-20 A20,20 0 1 1 0,20 A20,20 0 1 1 0,-20 Z";
    case "squircle":
      return "M-20,0 C-20,-18 -18,-20 0,-20 C18,-20 20,-18 20,0 C20,18 18,20 0,20 C-18,20 -20,18 -20,0 Z";
    case "droplet":
      return "M0,-24 C10,-10 20,0 20,8 A20,16 0 0 1 -20,8 C-20,0 -10,-10 0,-24 Z";
    case "bean":
      return "M-14,-18 C2,-24 20,-14 18,2 C16,16 4,22 -8,20 C-20,18 -22,4 -16,-4 C-12,-10 -24,-14 -14,-18 Z";
    case "star":
      return "M0,-22 C4,-10 8,-8 20,-6 C12,2 10,6 12,18 C4,12 -4,12 -12,18 C-10,6 -12,2 -20,-6 C-8,-8 -4,-10 0,-22 Z";
    case "triangle":
      return "M0,-20 C6,-20 22,10 20,16 C18,20 -18,20 -20,16 C-22,10 -6,-20 0,-20 Z";
  }
}
