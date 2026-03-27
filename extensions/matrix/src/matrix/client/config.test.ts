import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreConfig } from "../../types.js";

const {
  fetchWithSsrFGuardMock,
  loadMatrixCredentialsMock,
  saveMatrixCredentialsMock,
  credentialsMatchConfigMock,
  touchMatrixCredentialsMock,
  resolveConfiguredSecretInputWithFallbackMock,
  matrixClientGetUserIdMock,
  loadMatrixRecoveryMaterialMock,
  resolveMatrixStoragePathsMock,
} = vi.hoisted(() => ({
  fetchWithSsrFGuardMock: vi.fn(),
  loadMatrixCredentialsMock: vi.fn(),
  saveMatrixCredentialsMock: vi.fn(),
  credentialsMatchConfigMock: vi.fn(),
  touchMatrixCredentialsMock: vi.fn(),
  resolveConfiguredSecretInputWithFallbackMock: vi.fn(),
  matrixClientGetUserIdMock: vi.fn(),
  loadMatrixRecoveryMaterialMock: vi.fn(),
  resolveMatrixStoragePathsMock: vi.fn(),
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

vi.mock("../sdk-runtime.js", () => ({
  loadMatrixSdk: () => ({
    MatrixClient: class {
      getUserId = matrixClientGetUserIdMock;
      constructor(_homeserver: string, _accessToken: string) {}
    },
    ConsoleLogger: class {},
    LogService: {
      setLogger: vi.fn(),
      setLevel: vi.fn(),
      levels: { INFO: "info" },
      info: vi.fn(),
      warn: vi.fn(),
    },
  }),
}));

vi.mock("../recovery-material.js", () => ({
  loadMatrixRecoveryMaterial: loadMatrixRecoveryMaterialMock,
}));

vi.mock("./storage.js", () => ({
  resolveMatrixStoragePaths: resolveMatrixStoragePathsMock,
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
    resolveConfiguredSecretInputWithFallbackMock.mockImplementation(
      async ({ path }: { path: string }) => ({
        value: path.endsWith("accessToken") ? undefined : "resolved-pass",
      }),
    );
    resolveMatrixStoragePathsMock.mockReturnValue({ cryptoPath: "/tmp/matrix-crypto" });
    loadMatrixRecoveryMaterialMock.mockReturnValue({ privateKeyBase64: "abc" });
    matrixClientGetUserIdMock.mockResolvedValue("@bot:example.org");
    fetchWithSsrFGuardMock.mockResolvedValue({
      response: {
        ok: true,
        json: async () => ({
          access_token: "mx-token",
          user_id: "@bot:example.org",
          device_id: "DEVICE123",
        }),
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
        path: "channels.matrix.accounts.work.password",
      }),
    );
    const loginBody = JSON.parse(fetchWithSsrFGuardMock.mock.calls[0][0].init.body as string);
    expect(loginBody.password).toBe("resolved-pass");
    expect(auth.accessToken).toBe("mx-token");
    expect(auth.deviceId).toBe("DEVICE123");
  });

  it("resolves account accessToken SecretInput and returns resolved token", async () => {
    resolveConfiguredSecretInputWithFallbackMock.mockImplementation(
      async ({ path }: { path: string }) => ({
        value: path.endsWith("accessToken") ? "resolved-token" : undefined,
      }),
    );

    const cfg = {
      channels: {
        matrix: {
          accounts: {
            work: {
              homeserver: "https://matrix.example.org",
              accessToken: { source: "file", provider: "filemain", id: "/matrix/work-token" },
            },
          },
        },
      },
    } as CoreConfig;

    const auth = await resolveMatrixAuth({ cfg, accountId: "work", env: {} as NodeJS.ProcessEnv });

    expect(resolveConfiguredSecretInputWithFallbackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        value: { source: "file", provider: "filemain", id: "/matrix/work-token" },
        path: "channels.matrix.accounts.work.accessToken",
      }),
    );
    expect(auth.accessToken).toBe("resolved-token");
    expect(auth.deviceId).toBeUndefined();
    expect(saveMatrixCredentialsMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "resolved-token" }),
      expect.anything(),
      "work",
    );
  });

  it("re-logins instead of reusing cached credentials when crypto state is missing", async () => {
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const readDirSpy = vi.spyOn(fs, "readdirSync").mockReturnValue([]);
    loadMatrixRecoveryMaterialMock.mockReturnValue(null);
    loadMatrixCredentialsMock.mockReturnValue({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "cached-token",
      deviceId: "BZEYXVAHCX",
    });
    credentialsMatchConfigMock.mockReturnValue(true);

    const cfg = {
      channels: {
        matrix: {
          homeserver: "https://matrix.example.org",
          userId: "@bot:example.org",
          encryption: true,
          password: { source: "file", provider: "filemain", id: "/matrix/work" },
        },
      },
    } as CoreConfig;

    const auth = await resolveMatrixAuth({ cfg, env: {} as NodeJS.ProcessEnv });

    expect(auth.accessToken).toBe("mx-token");
    expect(fetchWithSsrFGuardMock).toHaveBeenCalledTimes(1);
    expect(touchMatrixCredentialsMock).not.toHaveBeenCalled();
    existsSpy.mockRestore();
    readDirSpy.mockRestore();
  });

  it("re-logins when cached credentials return M_UNKNOWN_TOKEN", async () => {
    loadMatrixCredentialsMock.mockReturnValue({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "stale-token",
      deviceId: "OLDDEVICE",
    });
    credentialsMatchConfigMock.mockReturnValue(true);

    fetchWithSsrFGuardMock
      .mockResolvedValueOnce({
        response: {
          ok: false,
          text: async () => JSON.stringify({ errcode: "M_UNKNOWN_TOKEN" }),
        },
        release: async () => undefined,
      })
      .mockResolvedValueOnce({
        response: {
          ok: true,
          json: async () => ({
            access_token: "fresh-token",
            user_id: "@bot:example.org",
            device_id: "NEWDEVICE",
          }),
        },
        release: async () => undefined,
      });

    const cfg = {
      channels: {
        matrix: {
          homeserver: "https://matrix.example.org",
          userId: "@bot:example.org",
          password: { source: "file", provider: "filemain", id: "/matrix/work" },
        },
      },
    } as CoreConfig;

    const auth = await resolveMatrixAuth({ cfg, env: {} as NodeJS.ProcessEnv });

    expect(auth.accessToken).toBe("fresh-token");
    expect(fetchWithSsrFGuardMock).toHaveBeenCalledTimes(2);
    expect(fetchWithSsrFGuardMock.mock.calls[0]?.[0]?.url).toContain(
      "/_matrix/client/v3/account/whoami",
    );
    expect(fetchWithSsrFGuardMock.mock.calls[1]?.[0]?.url).toContain("/_matrix/client/v3/login");
    expect(touchMatrixCredentialsMock).not.toHaveBeenCalled();
  });
});
