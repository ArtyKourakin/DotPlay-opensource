// Deterministic content normalization for duplicate detection. Pure module.
//
// Two texts that differ only in case, punctuation, whitespace, URLs, @mentions,
// emoji or Unicode compatibility forms produce the same fingerprint, so copying
// a post with cosmetic changes cannot earn Karma twice. Letters and digits of
// every script are kept, so non-Latin content is compared correctly.

export function normalizeContent(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/www\.\S+/gu, " ")
    .replace(/@[\p{L}\p{N}_-]+/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Number of meaningful characters: letters and digits after normalization, without spaces. */
export function meaningfulLength(text: string): number {
  return normalizeContent(text).replace(/ /g, "").length;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fingerprint of a piece of content within a namespace ("post" or "comment").
 * Empty normalized content returns null: it can never qualify anyway.
 */
export async function contentFingerprint(namespace: string, text: string): Promise<string | null> {
  const normalized = normalizeContent(text);
  if (!normalized) return null;
  return `${namespace}:${(await sha256Hex(normalized)).slice(0, 40)}`;
}
