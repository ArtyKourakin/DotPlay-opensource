import { useEffect, useState } from "react";
import { ago } from "@/lib/arena/data";

/** Relative time rendered only after mount, so server and browser markup match. */
export function Ago({ iso }: { iso: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(ago(iso));
    const t = setInterval(() => setText(ago(iso)), 10_000);
    return () => clearInterval(t);
  }, [iso]);
  return <>{text}</>;
}
