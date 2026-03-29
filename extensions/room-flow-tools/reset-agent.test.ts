import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import register from "./index.js";

const mockedPerformTargetedReset = vi.fn();

vi.mock("../../src/agents/tools/sessions-list-tool.js", () => ({
  createSessionsListTool: () => ({
    execute: vi.fn(async () => ({
      details: {
        sessions: [{ key: "agent:kiki:main", updatedAt: 100, kind: "main", channel: "matrix" }],
      },
    })),
  }),
}));

vi.mock("../../src/agents/tools/session-status-tool.js", () => ({
  createSessionStatusTool: () => ({ execute: vi.fn() }),
}));

vi.mock("../../src/agents/targeted-reset.js", () => ({
  performTargetedReset: mockedPerformTargetedReset,
}));

describe("room-flow-tools reset_agent", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resolves agentId to target session and returns reset result", async () => {
    mockedPerformTargetedReset.mockResolvedValue({
      ok: true,
      targetSessionKey: "agent:kiki:main",
      previousSessionId: "old-1",
      newSessionId: "new-1",
      targetAgentId: "kiki",
      rebriefDisposition: "injected",
    });

    const registered: Array<any> = [];
    register({ config: {}, registerTool: (tool: any) => registered.push(tool) } as any);
    const resetFactory = registered[1];
    const resetTool = resetFactory({ sessionKey: "agent:mini:main" });

    const result = await resetTool.execute("tc1", {
      agentId: "kiki",
      rebrief: "Resume from handover.",
    });
    expect(mockedPerformTargetedReset).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterSessionKey: "agent:mini:main",
        targetSessionKey: "agent:kiki:main",
        rebrief: "Resume from handover.",
      }),
    );
    expect(result.details).toMatchObject({
      agentId: "kiki",
      status: "reset",
      targetSessionKey: "agent:kiki:main",
      previousSessionId: "old-1",
      newSessionId: "new-1",
      rebriefDisposition: "injected",
    });
  });
});
