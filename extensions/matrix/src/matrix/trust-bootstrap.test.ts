import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveMatrixBootstrapPasswordMock, matrixJsCreateClientMock } = vi.hoisted(() => ({
  resolveMatrixBootstrapPasswordMock: vi.fn(),
  matrixJsCreateClientMock: vi.fn(),
}));

vi.mock("./client/config.js", () => ({
  resolveMatrixBootstrapPassword: resolveMatrixBootstrapPasswordMock,
}));

vi.mock("./sdk-runtime.js", () => ({
  loadMatrixJsSdk: () => ({ createClient: matrixJsCreateClientMock }),
}));

import { bootstrapMatrixTrustWithMatrixJsSdk } from "./trust-bootstrap.js";

describe("bootstrapMatrixTrustWithMatrixJsSdk", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  function makeEnv(): NodeJS.ProcessEnv {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-trust-bootstrap-"));
    tempRoots.push(root);
    return { OPENCLAW_STATE_DIR: root } as NodeJS.ProcessEnv;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resolveMatrixBootstrapPasswordMock.mockResolvedValue("matrix-password");
    matrixJsCreateClientMock.mockReset();
    const env = makeEnv();
    vi.stubEnv("OPENCLAW_STATE_DIR", env.OPENCLAW_STATE_DIR as string);
  });

  it("reports ready when cross-signing + secret storage are already ready", async () => {
    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
      deps: {
        createClient: async () => ({
          getCrypto: () => ({
            isCrossSigningReady: async () => true,
            isSecretStorageReady: async () => true,
            bootstrapCrossSigning: vi.fn(),
            bootstrapSecretStorage: vi.fn(),
          }),
          stopClient: async () => undefined,
        }),
      },
    });

    expect(status).toEqual({
      state: "ready",
      reason: "already_ready",
      runtime: "matrix-js-sdk",
      crossSigningReady: true,
      secretStorageReady: true,
      attemptedBootstrap: false,
      attemptedCrossSigningBootstrap: false,
      attemptedSecretStorageBootstrap: false,
      bootstrapLevel: "full",
    });
  });

  it("bootstraps cross-signing and secret storage for fresh device", async () => {
    let crossReady = false;
    let secretStorageReady = false;
    const uiAuthRequest = vi.fn(async () => undefined);

    const bootstrapCrossSigning = vi.fn(async ({ authUploadDeviceSigningKeys }) => {
      await authUploadDeviceSigningKeys?.(uiAuthRequest);
      crossReady = true;
    });

    const createRecoveryKeyFromPassphrase = vi.fn(async () => ({
      privateKey: new Uint8Array(32),
      encodedPrivateKey: "EsTJ8B72vWc5fj7rNEQJuA2h9xXXwDkCZ5zcb7TMQwA",
    }));

    const bootstrapSecretStorage = vi.fn(
      async ({ createSecretStorageKey }: { createSecretStorageKey?: () => Promise<unknown> }) => {
        await createSecretStorageKey?.();
        secretStorageReady = true;
      },
    );

    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
      deps: {
        createClient: async () => ({
          getCrypto: () => ({
            isCrossSigningReady: async () => crossReady,
            isSecretStorageReady: async () => secretStorageReady,
            bootstrapCrossSigning,
            bootstrapSecretStorage,
            createRecoveryKeyFromPassphrase,
          }),
          stopClient: async () => undefined,
        }),
      },
    });

    expect(bootstrapCrossSigning).toHaveBeenCalledTimes(1);
    expect(bootstrapSecretStorage).toHaveBeenCalledTimes(1);
    expect(createRecoveryKeyFromPassphrase).toHaveBeenCalledTimes(1);
    expect(bootstrapSecretStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        setupNewSecretStorage: true,
        createSecretStorageKey: expect.any(Function),
      }),
    );
    expect(uiAuthRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "m.login.password",
        user: "@bot:example.org",
        password: "matrix-password",
      }),
    );
    expect(status).toEqual(
      expect.objectContaining({
        state: "bootstrapped",
        reason: "bootstrap_succeeded",
        runtime: "matrix-js-sdk",
        attemptedBootstrap: true,
        attemptedCrossSigningBootstrap: true,
        attemptedSecretStorageBootstrap: true,
        crossSigningReady: true,
        secretStorageReady: true,
        bootstrapLevel: "full",
        recoveryMaterial: {
          created: true,
          encodedPrivateKey: "EsTJ8B72vWc5fj7rNEQJuA2h9xXXwDkCZ5zcb7TMQwA",
          passphraseProtected: false,
          passphraseKdf: undefined,
        },
      }),
    );
  });

  it("returns partial when cross-signing is ready but secret storage bootstrap is unsupported", async () => {
    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
      deps: {
        createClient: async () => ({
          getCrypto: () => ({
            isCrossSigningReady: async () => true,
            isSecretStorageReady: async () => false,
            bootstrapCrossSigning: vi.fn(),
          }),
          stopClient: async () => undefined,
        }),
      },
    });

    expect(status).toEqual({
      state: "partial",
      reason: "bootstrap_unsupported",
      runtime: "matrix-js-sdk",
      crossSigningReady: true,
      secretStorageReady: false,
      attemptedBootstrap: false,
      attemptedCrossSigningBootstrap: false,
      attemptedSecretStorageBootstrap: false,
      bootstrapLevel: "partial",
    });
  });

  it("passes deviceId through to js-sdk provisioning client", async () => {
    const createClient = vi.fn(async () => ({
      getCrypto: () => ({
        isCrossSigningReady: async () => true,
        isSecretStorageReady: async () => true,
        bootstrapCrossSigning: vi.fn(),
        bootstrapSecretStorage: vi.fn(),
      }),
      stopClient: async () => undefined,
    }));

    await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
        deviceId: "DEVICE123",
      },
      deps: { createClient },
    });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
        deviceId: "DEVICE123",
      }),
    );
  });

  it("initializes matrix-js-sdk rust crypto in in-memory mode for node provisioning", async () => {
    const initRustCrypto = vi.fn(async () => undefined);

    matrixJsCreateClientMock.mockReturnValue({
      initRustCrypto,
      startClient: vi.fn(),
      getCrypto: () => ({
        isCrossSigningReady: async () => true,
        isSecretStorageReady: async () => true,
        bootstrapCrossSigning: vi.fn(),
        bootstrapSecretStorage: vi.fn(),
      }),
      stopClient: async () => undefined,
    });

    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
    });

    expect(initRustCrypto).toHaveBeenCalledWith(
      expect.objectContaining({
        useIndexedDB: false,
      }),
    );
    expect(status.reason).toBe("already_ready");
  });

  it("provides cryptoCallbacks so secret-storage readback can resolve generated recovery key", async () => {
    let crossReady = true;
    let secretStorageReady = false;
    let createClientOpts: Record<string, unknown> | undefined;

    matrixJsCreateClientMock.mockImplementation((opts: Record<string, unknown>) => {
      createClientOpts = opts;
      return {
        initRustCrypto: vi.fn(async () => undefined),
        startClient: vi.fn(),
        getCrypto: () => ({
          isCrossSigningReady: async () => crossReady,
          isSecretStorageReady: async () => secretStorageReady,
          bootstrapCrossSigning: vi.fn(),
          createRecoveryKeyFromPassphrase: async () => ({
            privateKey: new Uint8Array(32).fill(7),
            encodedPrivateKey: "EsTJ8B72vWc5fj7rNEQJuA2h9xXXwDkCZ5zcb7TMQwA",
          }),
          bootstrapSecretStorage: async ({
            createSecretStorageKey,
          }: {
            createSecretStorageKey?: () => Promise<{ privateKey: Uint8Array }>;
          }) => {
            const generated = await createSecretStorageKey?.();
            if (!generated) throw new Error("missing generated recovery key");

            const callbacks = (createClientOpts?.cryptoCallbacks ?? {}) as {
              cacheSecretStorageKey?: (
                keyId: string,
                keyInfo: Record<string, unknown>,
                key: Uint8Array,
              ) => void;
              getSecretStorageKey?: (
                opts: { keys: Record<string, Record<string, unknown>> },
                name: string,
              ) => Promise<[string, Uint8Array] | null>;
            };

            callbacks.cacheSecretStorageKey?.("sss-key-id", {}, generated.privateKey);
            const keyTuple = await callbacks.getSecretStorageKey?.(
              { keys: { "sss-key-id": {} } },
              "m.cross_signing.master",
            );
            if (!keyTuple) throw new Error("No getSecretStorageKey callback supplied");

            secretStorageReady = true;
            crossReady = true;
          },
        }),
        stopClient: async () => undefined,
      };
    });

    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
    });

    expect(createClientOpts).toEqual(
      expect.objectContaining({
        cryptoCallbacks: expect.objectContaining({
          getSecretStorageKey: expect.any(Function),
          cacheSecretStorageKey: expect.any(Function),
        }),
      }),
    );
    expect(status.reason).toBe("bootstrap_succeeded");
    expect(status.secretStorageReady).toBe(true);
  });

  it("uses the sole cached key when sdk requests a single mismatched key id", async () => {
    let secretStorageReady = false;
    let createClientOpts: Record<string, unknown> | undefined;

    matrixJsCreateClientMock.mockImplementation((opts: Record<string, unknown>) => {
      createClientOpts = opts;
      return {
        initRustCrypto: vi.fn(async () => undefined),
        startClient: vi.fn(),
        getCrypto: () => ({
          isCrossSigningReady: async () => true,
          isSecretStorageReady: async () => secretStorageReady,
          bootstrapCrossSigning: vi.fn(),
          createRecoveryKeyFromPassphrase: async () => ({
            privateKey: new Uint8Array(32).fill(9),
          }),
          bootstrapSecretStorage: async ({
            createSecretStorageKey,
          }: {
            createSecretStorageKey?: () => Promise<{ privateKey: Uint8Array }>;
          }) => {
            const generated = await createSecretStorageKey?.();
            if (!generated) throw new Error("missing generated recovery key");

            const callbacks = (createClientOpts?.cryptoCallbacks ?? {}) as {
              cacheSecretStorageKey?: (
                keyId: string,
                keyInfo: Record<string, unknown>,
                key: Uint8Array,
              ) => void;
              getSecretStorageKey?: (
                opts: { keys: Record<string, Record<string, unknown>> },
                name: string,
              ) => Promise<[string, Uint8Array] | null>;
            };

            callbacks.cacheSecretStorageKey?.("cached-key-id", {}, generated.privateKey);
            const keyTuple = await callbacks.getSecretStorageKey?.(
              { keys: { "requested-key-id": {} } },
              "m.cross_signing.master",
            );
            expect(keyTuple).toEqual(["requested-key-id", generated.privateKey]);

            secretStorageReady = true;
          },
        }),
        stopClient: async () => undefined,
      };
    });

    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
    });

    expect(status.reason).toBe("bootstrap_succeeded");
    expect(status.secretStorageReady).toBe(true);
  });

  it("derives passphrase-based secret-storage key on demand when callback cache is empty", async () => {
    let secretStorageReady = false;
    let createClientOpts: Record<string, unknown> | undefined;

    matrixJsCreateClientMock.mockImplementation((opts: Record<string, unknown>) => {
      createClientOpts = opts;
      return {
        initRustCrypto: vi.fn(async () => undefined),
        startClient: vi.fn(),
        getCrypto: () => ({
          isCrossSigningReady: async () => true,
          isSecretStorageReady: async () => secretStorageReady,
          bootstrapCrossSigning: vi.fn(),
          createRecoveryKeyFromPassphrase: async () => ({
            privateKey: new Uint8Array(32).fill(1),
          }),
          bootstrapSecretStorage: async ({
            createSecretStorageKey,
          }: {
            createSecretStorageKey?: () => Promise<{ privateKey: Uint8Array }>;
          }) => {
            await createSecretStorageKey?.();

            const callbacks = (createClientOpts?.cryptoCallbacks ?? {}) as {
              getSecretStorageKey?: (
                opts: { keys: Record<string, Record<string, unknown>> },
                name: string,
              ) => Promise<[string, Uint8Array] | null>;
            };

            const keyTuple = await callbacks.getSecretStorageKey?.(
              {
                keys: {
                  "derived-key-id": {
                    passphrase: {
                      algorithm: "m.pbkdf2",
                      salt: "matrix-secret-salt",
                      iterations: 1000,
                    },
                  },
                },
              },
              "m.cross_signing.master",
            );

            expect(keyTuple).toBeTruthy();
            expect(keyTuple?.[0]).toBe("derived-key-id");
            expect(keyTuple?.[1]).toBeInstanceOf(Uint8Array);
            expect(keyTuple?.[1].length).toBe(32);

            secretStorageReady = true;
          },
        }),
        stopClient: async () => undefined,
      };
    });

    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
    });

    expect(status.reason).toBe("bootstrap_succeeded");
    expect(status.secretStorageReady).toBe(true);
  });

  it("uses preseeded last-generated key when callback cache is empty and passphrase metadata is absent", async () => {
    let secretStorageReady = false;
    let createClientOpts: Record<string, unknown> | undefined;

    matrixJsCreateClientMock.mockImplementation((opts: Record<string, unknown>) => {
      createClientOpts = opts;
      return {
        initRustCrypto: vi.fn(async () => undefined),
        startClient: vi.fn(),
        getCrypto: () => ({
          isCrossSigningReady: async () => true,
          isSecretStorageReady: async () => secretStorageReady,
          bootstrapCrossSigning: vi.fn(),
          createRecoveryKeyFromPassphrase: async () => ({
            privateKey: new Uint8Array(32).fill(4),
          }),
          bootstrapSecretStorage: async ({
            createSecretStorageKey,
          }: {
            createSecretStorageKey?: () => Promise<{ privateKey: Uint8Array }>;
          }) => {
            const generated = await createSecretStorageKey?.();
            if (!generated) throw new Error("missing generated recovery key");

            const callbacks = (createClientOpts?.cryptoCallbacks ?? {}) as {
              getSecretStorageKey?: (
                opts: { keys: Record<string, Record<string, unknown>> },
                name: string,
              ) => Promise<[string, Uint8Array] | null>;
            };

            const keyTuple = await callbacks.getSecretStorageKey?.(
              { keys: { "requested-key-id": {} } },
              "m.cross_signing.master",
            );
            expect(keyTuple).toEqual(["requested-key-id", generated.privateKey]);

            secretStorageReady = true;
          },
        }),
        stopClient: async () => undefined,
      };
    });

    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
    });

    expect(status.reason).toBe("bootstrap_succeeded");
    expect(status.secretStorageReady).toBe(true);
  });

  it("returns unsupported when matrix-js-sdk client cannot be created", async () => {
    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
      deps: {
        createClient: async () => {
          throw new Error("Cannot find module 'matrix-js-sdk'");
        },
      },
    });

    expect(status.state).toBe("unsupported");
    expect(status.reason).toBe("matrix_js_sdk_unavailable");
    expect(status.runtime).toBe("matrix-js-sdk");
  });

  it("returns needs-user-auth with exact reason when password is unavailable", async () => {
    resolveMatrixBootstrapPasswordMock.mockResolvedValue(undefined);

    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
      deps: {
        createClient: async () => ({
          getCrypto: () => ({
            isCrossSigningReady: async () => false,
            isSecretStorageReady: async () => false,
            bootstrapCrossSigning: vi.fn(),
            bootstrapSecretStorage: vi.fn(),
          }),
          stopClient: async () => undefined,
        }),
      },
    });

    expect(status).toEqual({
      state: "needs-user-auth",
      reason: "password_unavailable",
      runtime: "matrix-js-sdk",
      crossSigningReady: false,
      secretStorageReady: false,
      attemptedBootstrap: false,
      attemptedCrossSigningBootstrap: false,
      attemptedSecretStorageBootstrap: false,
      bootstrapLevel: "none",
    });
  });

  it("returns needs-user-auth when SDK reports UIA requirement", async () => {
    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
      deps: {
        createClient: async () => ({
          getCrypto: () => ({
            isCrossSigningReady: async () => false,
            isSecretStorageReady: async () => false,
            bootstrapCrossSigning: async () => {
              throw new Error("M_UNAUTHORIZED: User-Interactive Authentication required");
            },
            bootstrapSecretStorage: vi.fn(),
          }),
          stopClient: async () => undefined,
        }),
      },
    });

    expect(status.state).toBe("needs-user-auth");
    expect(status.reason).toBe("uia_required");
    expect(status.attemptedBootstrap).toBe(true);
  });

  it("returns unsupported when SDK lacks recovery key creation API", async () => {
    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
      deps: {
        createClient: async () => ({
          getCrypto: () => ({
            isCrossSigningReady: async () => true,
            isSecretStorageReady: async () => false,
            bootstrapCrossSigning: vi.fn(),
            bootstrapSecretStorage: vi.fn(),
          }),
          stopClient: async () => undefined,
        }),
      },
    });

    expect(status).toEqual(
      expect.objectContaining({
        state: "partial",
        reason: "bootstrap_unsupported",
        runtime: "matrix-js-sdk",
        crossSigningReady: true,
        secretStorageReady: false,
        attemptedBootstrap: false,
        attemptedCrossSigningBootstrap: false,
        attemptedSecretStorageBootstrap: false,
        bootstrapLevel: "partial",
        error: "matrix-js-sdk crypto.createRecoveryKeyFromPassphrase() is unavailable",
      }),
    );
  });

  it("classifies passphrase-backed existing SSSS as recovery_material_required", async () => {
    let createClientOpts: Record<string, unknown> | undefined;

    matrixJsCreateClientMock.mockImplementation((opts: Record<string, unknown>) => {
      createClientOpts = opts;
      return {
        initRustCrypto: vi.fn(async () => undefined),
        startClient: vi.fn(),
        getCrypto: () => ({
          isCrossSigningReady: async () => true,
          isSecretStorageReady: async () => false,
          bootstrapCrossSigning: vi.fn(),
          createRecoveryKeyFromPassphrase: async () => ({
            privateKey: new Uint8Array(32).fill(6),
          }),
          bootstrapSecretStorage: async () => {
            const callbacks = (createClientOpts?.cryptoCallbacks ?? {}) as {
              getSecretStorageKey?: (
                opts: { keys: Record<string, Record<string, unknown>> },
                name: string,
              ) => Promise<[string, Uint8Array] | null>;
            };
            const keyTuple = await callbacks.getSecretStorageKey?.(
              {
                keys: {
                  "existing-passphrase-key": {
                    passphrase: {
                      algorithm: "m.pbkdf2",
                      salt: "existing-salt",
                      iterations: 1000,
                    },
                  },
                },
              },
              "m.cross_signing.master",
            );
            expect(keyTuple).toBeTruthy();
            throw new Error("Secret storage passphrase required");
          },
        }),
        stopClient: async () => undefined,
      };
    });

    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
    });

    expect(status).toEqual(
      expect.objectContaining({
        state: "needs-user-auth",
        reason: "recovery_material_required",
        secretStorageKeyAccessState: "passphrase_recoverable",
      }),
    );
  });

  it("classifies recovery-key-only existing SSSS as unrecoverable without key material", async () => {
    let createClientOpts: Record<string, unknown> | undefined;

    matrixJsCreateClientMock.mockImplementation((opts: Record<string, unknown>) => {
      createClientOpts = opts;
      return {
        initRustCrypto: vi.fn(async () => undefined),
        startClient: vi.fn(),
        getCrypto: () => ({
          isCrossSigningReady: async () => true,
          isSecretStorageReady: async () => false,
          bootstrapCrossSigning: vi.fn(),
          createRecoveryKeyFromPassphrase: async () => ({
            privateKey: new Uint8Array(32).fill(8),
          }),
          bootstrapSecretStorage: async () => {
            const callbacks = (createClientOpts?.cryptoCallbacks ?? {}) as {
              getSecretStorageKey?: (
                opts: { keys: Record<string, Record<string, unknown>> },
                name: string,
              ) => Promise<[string, Uint8Array] | null>;
            };
            const keyTuple = await callbacks.getSecretStorageKey?.(
              {
                keys: {
                  "existing-raw-recovery-key": {},
                },
              },
              "m.cross_signing.master",
            );
            expect(keyTuple).toBeNull();
            throw new Error("Failed to get secret storage key");
          },
        }),
        stopClient: async () => undefined,
      };
    });

    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
    });

    expect(status).toEqual(
      expect.objectContaining({
        state: "needs-user-auth",
        reason: "secret_storage_recovery_key_unavailable",
        secretStorageKeyAccessState: "recovery_key_only_unavailable",
        crossSigningReady: true,
        secretStorageReady: false,
      }),
    );
  });

  it("returns recovery-material-required when secret storage bootstrap needs existing recovery", async () => {
    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
      deps: {
        createClient: async () => ({
          getCrypto: () => ({
            isCrossSigningReady: async () => true,
            isSecretStorageReady: async () => false,
            bootstrapCrossSigning: vi.fn(),
            createRecoveryKeyFromPassphrase: async () => ({
              privateKey: new Uint8Array(32),
              encodedPrivateKey: "EsTJ8B72vWc5fj7rNEQJuA2h9xXXwDkCZ5zcb7TMQwA",
            }),
            bootstrapSecretStorage: async () => {
              throw new Error("Secret storage recovery passphrase required");
            },
          }),
          stopClient: async () => undefined,
        }),
      },
    });

    expect(status).toEqual(
      expect.objectContaining({
        state: "needs-user-auth",
        reason: "recovery_material_required",
        runtime: "matrix-js-sdk",
        crossSigningReady: true,
        secretStorageReady: false,
        attemptedBootstrap: true,
        attemptedCrossSigningBootstrap: false,
        attemptedSecretStorageBootstrap: true,
        bootstrapLevel: "partial",
      }),
    );
  });

  it("persists generated recovery material via dedicated writer", async () => {
    const saveRecoveryMaterial = vi.fn();

    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
      deps: {
        saveRecoveryMaterial,
        createClient: async () => ({
          getCrypto: () => ({
            isCrossSigningReady: async () => true,
            isSecretStorageReady: async () => false,
            bootstrapCrossSigning: vi.fn(),
            createRecoveryKeyFromPassphrase: async () => ({
              privateKey: new Uint8Array(32).fill(3),
              encodedPrivateKey: "RECOVERY_KEY",
            }),
            bootstrapSecretStorage: async ({
              createSecretStorageKey,
            }: {
              createSecretStorageKey?: () => Promise<unknown>;
            }) => {
              await createSecretStorageKey?.();
            },
          }),
          stopClient: async () => undefined,
        }),
      },
    });

    expect(status.reason).toBe("bootstrap_partially_succeeded");
    expect(saveRecoveryMaterial).toHaveBeenCalledWith(
      expect.objectContaining({
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        encodedRecoveryKey: "RECOVERY_KEY",
        privateKey: expect.any(Uint8Array),
      }),
      undefined,
      undefined,
    );
  });

  it("snapshots generated recovery key bytes before sdk lifecycle can mutate them", async () => {
    const saveRecoveryMaterial = vi.fn();

    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
      deps: {
        saveRecoveryMaterial,
        createClient: async () => ({
          getCrypto: () => ({
            isCrossSigningReady: async () => true,
            isSecretStorageReady: async () => false,
            bootstrapCrossSigning: vi.fn(),
            createRecoveryKeyFromPassphrase: async () => ({
              privateKey: new Uint8Array([1, 2, 3, 4]),
              encodedPrivateKey: "RECOVERY_KEY",
            }),
            bootstrapSecretStorage: async ({
              createSecretStorageKey,
            }: {
              createSecretStorageKey?: () => Promise<{ privateKey: Uint8Array }>;
            }) => {
              const generated = await createSecretStorageKey?.();
              generated?.privateKey.fill(0);
            },
          }),
          stopClient: async () => undefined,
        }),
      },
    });

    expect(status.reason).toBe("bootstrap_partially_succeeded");
    expect(saveRecoveryMaterial).toHaveBeenCalledTimes(1);
    expect(saveRecoveryMaterial.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        encodedRecoveryKey: "RECOVERY_KEY",
        privateKey: new Uint8Array([1, 2, 3, 4]),
      }),
    );
  });

  it("uses stored recovery private key to satisfy recovery-key-only bootstrap callback", async () => {
    let createClientOpts: Record<string, unknown> | undefined;

    matrixJsCreateClientMock.mockImplementation((opts: Record<string, unknown>) => {
      createClientOpts = opts;
      return {
        initRustCrypto: vi.fn(async () => undefined),
        startClient: vi.fn(),
        getCrypto: () => ({
          isCrossSigningReady: async () => true,
          isSecretStorageReady: async () => false,
          bootstrapCrossSigning: vi.fn(),
          createRecoveryKeyFromPassphrase: async () => ({ privateKey: new Uint8Array(32).fill(9) }),
          bootstrapSecretStorage: async () => {
            const callbacks = (createClientOpts?.cryptoCallbacks ?? {}) as {
              getSecretStorageKey?: (
                opts: { keys: Record<string, Record<string, unknown>> },
                name: string,
              ) => Promise<[string, Uint8Array] | null>;
            };
            const keyTuple = await callbacks.getSecretStorageKey?.(
              { keys: { "remote-key-id": {} } },
              "m.cross_signing.master",
            );
            expect(keyTuple?.[0]).toBe("remote-key-id");
            expect(keyTuple?.[1]).toBeInstanceOf(Uint8Array);
          },
        }),
        stopClient: async () => undefined,
      };
    });

    const status = await bootstrapMatrixTrustWithMatrixJsSdk({
      auth: {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        accessToken: "token",
      },
      deps: {
        loadRecoveryMaterial: () => ({
          version: 1,
          accountId: "default",
          homeserver: "https://matrix.example.org",
          userId: "@bot:example.org",
          privateKeyBase64: Buffer.from(new Uint8Array(32).fill(5)).toString("base64"),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      },
    });

    expect(status.reason).toBe("bootstrap_partially_succeeded");
  });
});
