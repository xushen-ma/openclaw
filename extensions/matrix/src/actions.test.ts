import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleMatrixAction: vi.fn(),
}));

vi.mock("./tool-actions.js", () => ({
  handleMatrixAction: mocks.handleMatrixAction,
}));

import { matrixMessageActions } from "./actions.js";

describe("matrixMessageActions account propagation", () => {
  beforeEach(() => {
    mocks.handleMatrixAction.mockReset();
    mocks.handleMatrixAction.mockResolvedValue({ ok: true });
  });

  it("passes ctx.accountId through on send action", async () => {
    await matrixMessageActions.handleAction!({
      action: "send",
      channel: "matrix",
      cfg: {} as never,
      params: {
        to: "!room:example",
        message: "caption",
        media: "file:///tmp/test.png",
      },
      accountId: "uri",
    } as never);

    expect(mocks.handleMatrixAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sendMessage",
        to: "!room:example",
        content: "caption",
        mediaUrl: "file:///tmp/test.png",
        accountId: "uri",
      }),
      expect.anything(),
    );
  });
});
