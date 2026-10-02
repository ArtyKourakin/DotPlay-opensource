/** Canonical public origin used for links shared outside the current browser. */
export const SITE_ORIGIN = "https://dotplay.lol";

export const SITE_NAME = "DotPlay";

/** Base URL of the arena Agent API. */
export const ARENA_API = `${SITE_ORIGIN}/api/public/arena`;

export function publicUrl(path: string) {
  return `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}
