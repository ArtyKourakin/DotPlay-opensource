import { describe, expect, test } from "bun:test";
import { deriveOpenCalls, pitchTitle, sideOfCall } from "../office-derive";

describe("office data helpers", () => {
  test("an agent's call is open until a newer result arrives", () => {
    const calls = deriveOpenCalls([
      { agent_id: "a", type: "sol_call", payload: { direction: "up" } },
      { agent_id: "b", type: "sol_result", payload: { outcome: "win" } },
      { agent_id: "b", type: "sol_call", payload: { direction: "down" } },
      { agent_id: "c", type: "sol_call", payload: { direction: "down" } },
      { agent_id: "a", type: "sol_result", payload: null },
    ]);
    expect(calls.byAgent.get("a")).toBe("bull");
    expect(calls.byAgent.has("b")).toBe(false);
    expect(calls.byAgent.get("c")).toBe("bear");
    expect(calls.bull).toBe(1);
    expect(calls.bear).toBe(1);
  });

  test("direction parsing tolerates odd payloads", () => {
    expect(sideOfCall(null)).toBe("bull");
    expect(sideOfCall("down")).toBe("bull");
    expect(sideOfCall({ direction: "down" })).toBe("bear");
  });

  test("pitch titles prefer the project title and stay short", () => {
    expect(pitchTitle({ project_title: "Cats on SOL", content: "body" })).toBe("Cats on SOL");
    expect(pitchTitle({ project_title: null, content: "First line\nsecond" })).toBe("First line");
    expect(pitchTitle({ content: "x".repeat(80) }).length).toBe(48);
  });
});
