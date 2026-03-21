import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreConfig } from "../../types.js";

const {
  fetchWithSsrFGuardMock,
  loadMatrixCredentialsMock,
  saveMatrixCredentialsMock,
  credentialsMatchConfigMock,
  touchMatrixCredentialsMock,
  resolveConfiguredSecretInputWithFallbackMock,
} = vi.hoisted(() => ({
  fetchWithSsrFGuardMock: vi.fn(),
  loadMatrixCredentialsMock: vi.fn(),
  saveMatrixCredentialsMock: vi.fn(),
  credentialsMatchConfigMock: vi.fn(),
  touchMatrixCredentialsMock: vi.fn(),
  resolveConfiguredSecretInputWithFallbackMock: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/matrix", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/matrix")>(
    "openclaw/plugin-sdk/matrix",
  );
  return {
    ...actual,
    fetchWithSsrFGuard: fetchWithSsrFGuardMock,
  };
});

vi.mock("../../../../../src/gateway/resolve-configured-secret-input-string.js", () => ({
  resolveConfiguredSecretInputWithFallback: resolveConfiguredSecretInputWithFallbackMock,
}));

vi.mock("../credentials.js", () => ({
  loadMatrixCredentials: loadMatrixCredentialsMock,
  saveMatrixCredentials: saveMatrixCredentialsMock,
  credentialsMatchConfig: credentialsMatchConfigMock,
  touchMatrixCredentials: touchMatrixCredentialsMock,
}));

import { resolveMatrixAuth } from "./config.js";

describe("resolveMatrixAuth secret refs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadMatrixCredentialsMock.mockReturnValue(null);
    credentialsMatchConfigMock.mockReturnValue(false);
    resolveConfiguredSecretInputWithFallbackMock.mockResolvedValue({ value: "resolved-pass" });
    fetchWithSsrFGuardMock.mockResolvedValue({
      response: {
        ok: true,
        json: async () => ({ access_token: "mx-token", user_id: "@bot:example.org" }),
      },
      release: async () => undefined,
    });
  });

  it("resolves account password SecretInput at runtime for fresh accounts", async () => {
    const cfg = {
      channels: {
        matrix: {
          accounts: {
            work: {
              homeserver: "https://matrix.example.org",
              userId: "@bot:example.org",
              password: { source: "file", provider: "filemain", id: "/matrix/work" },
            },
          },
        },
      },
    } as CoreConfig;

    const auth = await resolveMatrixAuth({ cfg, accountId: "work", env: {} as NodeJS.ProcessEnv });

    expect(resolveConfiguredSecretInputWithFallbackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        value: { source: "file", provider: "filemain", id: "/matrix/work" },
        path: "channels.matrix.password",
      }),
    );
    const loginBody = JSON.parse(fetchWithSsrFGuardMock.mock.calls[0][0].init.body as string);
    expect(loginBody.password).toBe("resolved-pass");
    expect(auth.accessToken).toBe("mx-token");
  });
});
