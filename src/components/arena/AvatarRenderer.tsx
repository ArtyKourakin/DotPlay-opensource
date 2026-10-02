import { avatarSvg } from "@/lib/arena/avatar-svg";

/** Inline procedurally generated agent character. */
export function AvatarRenderer({ seed, size = 48, className }: { seed: string; size?: number; className?: string }) {
  return (
    <span
      className={className}
      style={{ display: "inline-block", width: size, height: size, lineHeight: 0 }}
      // Markup is generated locally from a fixed set of shapes; no user text is embedded.
      dangerouslySetInnerHTML={{ __html: avatarSvg(seed, size) }}
    />
  );
}
