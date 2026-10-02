// Builds the SVG markup of an agent character. Only fixed shapes and hex colors.
import { bodyPath, traitsFor } from "./avatar-gen";

function eyes(kind: string) {
  switch (kind) {
    case "ovals":
      return '<ellipse cx="-7" cy="-2" rx="3" ry="4.5" fill="#0b1020"/><ellipse cx="7" cy="-2" rx="3" ry="4.5" fill="#0b1020"/>';
    case "sleepy":
      return '<path d="M-11,-1 Q-7,2 -3,-1 M3,-1 Q7,2 11,-1" stroke="#0b1020" stroke-width="2.4" fill="none" stroke-linecap="round"/>';
    case "sparkly":
      return '<circle cx="-7" cy="-2" r="4" fill="#0b1020"/><circle cx="7" cy="-2" r="4" fill="#0b1020"/><circle cx="-5.5" cy="-3.5" r="1.4" fill="#fff"/><circle cx="8.5" cy="-3.5" r="1.4" fill="#fff"/>';
    case "visor":
      return '<rect x="-13" y="-6" width="26" height="8" rx="4" fill="#0b1020"/><rect x="-9" y="-4" width="10" height="2" rx="1" fill="#00ff41"/>';
    default:
      return '<circle cx="-7" cy="-2" r="2.6" fill="#0b1020"/><circle cx="7" cy="-2" r="2.6" fill="#0b1020"/>';
  }
}

function accessory(kind: string) {
  switch (kind) {
    case "cap":
      return '<path d="M-14,-16 Q0,-28 14,-16 Z" fill="#ff4d6d"/><rect x="6" y="-18" width="12" height="3" rx="1.5" fill="#ff4d6d"/>';
    case "antenna":
      return '<line x1="0" y1="-20" x2="0" y2="-30" stroke="#e6e9ff" stroke-width="2"/><circle cx="0" cy="-31" r="3" fill="#00ff41"/>';
    case "scarf":
      return '<path d="M-15,12 Q0,18 15,12 L15,16 Q0,22 -15,16 Z" fill="#ffd166"/><rect x="6" y="15" width="5" height="9" rx="2" fill="#ffd166"/>';
    case "headset":
      return '<path d="M-18,-4 Q-18,-24 0,-24 Q18,-24 18,-4" stroke="#e6e9ff" stroke-width="2.5" fill="none"/><rect x="-21" y="-6" width="6" height="9" rx="2" fill="#e6e9ff"/><rect x="15" y="-6" width="6" height="9" rx="2" fill="#e6e9ff"/>';
    case "crown":
      return '<path d="M-9,-19 L-9,-27 L-4,-22 L0,-29 L4,-22 L9,-27 L9,-19 Z" fill="#ffd166"/>';
    case "goggles":
      return '<rect x="-16" y="-15" width="32" height="3" fill="#0b1020"/><circle cx="-7" cy="-14" r="5" fill="#9cf5ff" stroke="#0b1020" stroke-width="2"/><circle cx="7" cy="-14" r="5" fill="#9cf5ff" stroke="#0b1020" stroke-width="2"/>';
    default:
      return '<path d="M0,-20 Q8,-30 14,-26 Q8,-18 0,-20 Z" fill="#38d96b"/>';
  }
}

/** `shadow: false` leaves out the ground shadow (the office canvas draws its own). */
export function avatarSvg(seed: string, size = 64, opts: { shadow?: boolean } = {}) {
  const t = traitsFor(seed);
  const id = `g${(seed || "a").replace(/[^a-z0-9]/gi, "").slice(0, 10)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-32 -36 64 68"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.colors[0]}"/><stop offset="1" stop-color="${t.colors[1]}"/></linearGradient></defs>${opts.shadow === false ? "" : '<ellipse cx="0" cy="26" rx="14" ry="3.5" fill="#000" opacity="0.35"/>'}<path d="${bodyPath(t.body)}" fill="url(#${id})"/>${eyes(t.eyes)}${accessory(t.accessory)}</svg>`;
}
