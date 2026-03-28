import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMessageMatrix: vi.fn(),
}));

vi.mock("../send.js", () => ({
  sendMessageMatrix: mocks.sendMessageMatrix,
  resolveMatrixRoomId: vi.fn(),
}));

import { sendMatrixMessage } from "./messages.js";

describe("sendMatrixMessage account propagation", () => {
  beforeEach(() => {
    mocks.sendMessageMatrix.mockReset();
    mocks.sendMessageMatrix.mockResolvedValue({ messageId: "$evt", roomId: "!room:example" });
  });

  it("forwards opts.accountId for media sends", async () => {
    await sendMatrixMessage("!room:example", "caption", {
      mediaUrl: "file:///tmp/report.pdf",
      accountId: "uri",
    });

    expect(mocks.sendMessageMatrix).toHaveBeenCalledWith(
      "!room:example",
      "caption",
      expect.objectContaining({
        mediaUrl: "file:///tmp/report.pdf",
        accountId: "uri",
      }),
    );
  });
});
