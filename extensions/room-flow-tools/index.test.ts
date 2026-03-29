import { describe, expect, it } from "vitest";
import { mapSessionRowToContext } from "./index.js";

describe("room-flow-tools get_agent_context helpers", () => {
  it("maps session row token fields into the planned payload shape", () => {
    const result = mapSessionRowToContext({
      agentId: "mini",
      row: {
        key: "agent:mini:main",
        kind: "main",
        channel: "matrix",
        contextTokens: 1250,
        totalTokens: 5000,
        model: "openai-codex/gpt-5.4",
      },
    });

    expect(result).toEqual({
      agentId: "mini",
      contextPct: 25,
      tokensUsed: 1250,
      tokensMax: 5000,
      model: "openai-codex/gpt-5.4",
      sessionKey: "agent:mini:main",
    });
  });

  it("returns null percentages when token totals are unavailable", () => {
    const result = mapSessionRowToContext({
      agentId: "mini",
      row: {
        key: "agent:mini:main",
        kind: "main",
        channel: "matrix",
      },
    });

    expect(result).toEqual({
      agentId: "mini",
      contextPct: null,
      tokensUsed: null,
      tokensMax: null,
      model: null,
      sessionKey: "agent:mini:main",
    });
  });
});
