import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveMatrixClient: vi.fn(),
  getAnyActiveMatrixClient: vi.fn(),
  resolveSharedMatrixClient: vi.fn(),
  resolveMatrixAuth: vi.fn(),
  createPreparedMatrixClient: vi.fn(),
}));

vi.mock("../../runtime.js", () => ({
  getMatrixRuntime: () => ({ config: { loadConfig: () => ({}) } }),
}));

vi.mock("../active-client.js", () => ({
  getActiveMatrixClient: mocks.getActiveMatrixClient,
  getAnyActiveMatrixClient: mocks.getAnyActiveMatrixClient,
}));

vi.mock("../client.js", () => ({
  isBunRuntime: () => false,
  resolveSharedMatrixClient: mocks.resolveSharedMatrixClient,
  resolveMatrixAuth: mocks.resolveMatrixAuth,
}));

vi.mock("../client-bootstrap.js", () => ({
  createPreparedMatrixClient: mocks.createPreparedMatrixClient,
}));

import { resolveMatrixClient } from "./client.js";

describe("resolveMatrixClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveMatrixClient.mockReturnValue(null);
    mocks.getAnyActiveMatrixClient.mockReturnValue(null);
    mocks.resolveSharedMatrixClient.mockResolvedValue({ id: "shared-client" });
    mocks.resolveMatrixAuth.mockResolvedValue({});
    mocks.createPreparedMatrixClient.mockResolvedValue({ id: "created-client" });
  });

  it("uses configured defaultAccount when no accountId is provided", async () => {
    const miniClient = { id: "mini-client" };
    mocks.getActiveMatrixClient.mockImplementation((accountId?: string) => {
      if (accountId === "mini") return miniClient;
      return null;
    });

    const result = await resolveMatrixClient({
      cfg: {
        channels: {
          matrix: {
            defaultAccount: "mini",
            accounts: {
              default: { homeserver: "https://default.example.org", accessToken: "tok-default" },
              mini: { homeserver: "https://mini.example.org", accessToken: "tok-mini" },
            },
          },
        },
      } as any,
    });

    expect(mocks.getActiveMatrixClient).toHaveBeenNthCalledWith(1, undefined);
    expect(mocks.getActiveMatrixClient).toHaveBeenNthCalledWith(2, "mini");
    expect(result).toEqual({ client: miniClient, stopOnDone: false });
    expect(mocks.getAnyActiveMatrixClient).not.toHaveBeenCalled();
  });
});
