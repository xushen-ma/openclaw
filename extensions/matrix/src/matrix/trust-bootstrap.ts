import { resolveMatrixBootstrapPassword } from "./client/config.js";
import type { MatrixAuth } from "./client/types.js";
import {
  loadMatrixRecoveryMaterial,
  saveMatrixRecoveryMaterial,
  type MatrixRecoveryMaterial,
} from "./recovery-material.js";
import { loadMatrixJsSdk } from "./sdk-runtime.js";

type LoggerLike = {
  info?: (message: string, ...args: unknown[]) => void;
  warn?: (message: string, ...args: unknown[]) => void;
  debug?: (message: string, ...args: unknown[]) => void;
};

type MatrixCrossSigningAuthRequest = (authDict: Record<string, unknown> | null) => Promise<void>;

type GeneratedSecretStorageKey = {
  keyInfo?: {
    passphrase?: {
      algorithm?: string;
      iterations?: number;
      salt?: string;
    };
    name?: string;
  };
  privateKey: Uint8Array;
  encodedPrivateKey?: string;
};

type MatrixCryptoTrustApi = {
  isCrossSigningReady?: () => Promise<boolean>;
  isSecretStorageReady?: () => Promise<boolean>;
  bootstrapCrossSigning?: (opts?: {
    authUploadDeviceSigningKeys?: (makeRequest: MatrixCrossSigningAuthRequest) => Promise<void>;
  }) => Promise<void>;
  bootstrapSecretStorage?: (opts?: {
    setupNewSecretStorage?: boolean;
    createSecretStorageKey?: () => Promise<GeneratedSecretStorageKey>;
  }) => Promise<void>;
  createRecoveryKeyFromPassphrase?: (passphrase?: string) => Promise<GeneratedSecretStorageKey>;
};

type MatrixJsTrustClient = {
  startClient?: (opts?: Record<string, unknown>) => Promise<void> | void;
  stopClient?: () => Promise<void> | void;
  stop?: () => Promise<void> | void;
  initRustCrypto?: (...args: unknown[]) => Promise<void>;
  getCrypto?: () => MatrixCryptoTrustApi | undefined;
  crypto?: MatrixCryptoTrustApi;
  bootstrapSecretStorage?: (opts?: {
    setupNewSecretStorage?: boolean;
    createSecretStorageKey?: () => Promise<GeneratedSecretStorageKey>;
  }) => Promise<void>;
  preseedSecretStorageKeyForBootstrap?: (key: Uint8Array) => void;
  getTrustBootstrapDiagnostics?: () => {
    secretStorageKeyAccessState: SecretStorageKeyAccessState;
  };
};

type TrustBootstrapReason =
  | "matrix_js_sdk_unavailable"
  | "crypto_unavailable"
  | "already_ready"
  | "bootstrap_unsupported"
  | "password_unavailable"
  | "uia_required"
  | "recovery_material_required"
  | "secret_storage_recovery_key_unavailable"
  | "bootstrap_succeeded"
  | "bootstrap_partially_succeeded"
  | "bootstrap_failed";

type TrustBootstrapState =
  | "ready"
  | "bootstrapped"
  | "partial"
  | "needs-user-auth"
  | "unsupported"
  | "error";

type SecretStorageKeyAccessState =
  | "unknown"
  | "passphrase_recoverable"
  | "recovery_key_only_unavailable"
  | "recovery_key_loaded";

export type MatrixTrustBootstrapStatus = {
  state: TrustBootstrapState;
  reason: TrustBootstrapReason;
  runtime: "matrix-js-sdk";
  crossSigningReady: boolean | null;
  secretStorageReady: boolean | null;
  attemptedBootstrap: boolean;
  attemptedCrossSigningBootstrap: boolean;
  attemptedSecretStorageBootstrap: boolean;
  bootstrapLevel: "full" | "partial" | "none";
  recoveryMaterial?: {
    created: boolean;
    encodedPrivateKey?: string;
    passphraseProtected: boolean;
    passphraseKdf?: string;
  };
  secretStorageKeyAccessState?: SecretStorageKeyAccessState;
  error?: string;
};

export type MatrixTrustBootstrapDeps = {
  createClient?: (params: {
    homeserver: string;
    userId: string;
    accessToken: string;
    deviceId?: string;
  }) => Promise<MatrixJsTrustClient> | MatrixJsTrustClient;
  loadRecoveryMaterial?: (
    env?: NodeJS.ProcessEnv,
    accountId?: string | null,
  ) => MatrixRecoveryMaterial | null;
  saveRecoveryMaterial?: (
    params: {
      homeserver: string;
      userId: string;
      encodedRecoveryKey?: string;
      privateKey: Uint8Array;
    },
    env?: NodeJS.ProcessEnv,
    accountId?: string | null,
  ) => void;
};

type SecretStorageKeyDescription = {
  algorithm?: string;
  name?: string;
  passphrase?: {
    algorithm?: string;
    iterations?: number;
    salt?: string;
  };
};

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUiaError(err: unknown): boolean {
  const message = toErrorMessage(err).toLowerCase();
  return (
    message.includes("m_unrecognized") ||
    message.includes("m_forbidden") ||
    message.includes("m_unauthorized") ||
    message.includes("unauthorized") ||
    message.includes("uia") ||
    message.includes("user-interactive") ||
    message.includes("authentication")
  );
}

function isRecoveryMaterialError(err: unknown): boolean {
  const message = toErrorMessage(err).toLowerCase();
  return (
    message.includes("recovery") ||
    message.includes("passphrase") ||
    message.includes("security key") ||
    message.includes("secret storage")
  );
}

async function safeCheck(fn: (() => Promise<boolean>) | undefined): Promise<boolean | null> {
  if (!fn) return null;
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function deriveSecretStorageKeyFromPassphrase(params: {
  passphrase: string;
  salt: string;
  iterations: number;
}): Promise<Uint8Array | null> {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === "undefined") {
    return null;
  }

  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(params.passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );

  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(params.salt),
      iterations: params.iterations,
      hash: "SHA-512",
    },
    key,
    256,
  );

  return new Uint8Array(bits);
}

function decodePrivateKeyBase64(value: string | undefined): Uint8Array | null {
  if (!value) return null;
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.length > 0 ? new Uint8Array(bytes) : null;
  } catch {
    return null;
  }
}

async function createMatrixJsTrustClient(params: {
  auth: MatrixAuth;
  bootstrapPassword?: string;
  storedRecoveryPrivateKey?: Uint8Array | null;
}): Promise<MatrixJsTrustClient> {
  const sdk = loadMatrixJsSdk();
  const createClientFn = (
    sdk as { createClient?: (opts: Record<string, unknown>) => MatrixJsTrustClient }
  ).createClient;
  if (!createClientFn) {
    throw new Error("matrix-js-sdk createClient() is unavailable");
  }

  const keyCache = new Map<string, Uint8Array>();
  let lastKey: Uint8Array | null = params.storedRecoveryPrivateKey ?? null;
  let accessState: SecretStorageKeyAccessState = params.storedRecoveryPrivateKey
    ? "recovery_key_loaded"
    : "unknown";

  const cryptoCallbacks = {
    getSecretStorageKey: async ({
      keys,
    }: {
      keys: Record<string, SecretStorageKeyDescription>;
    }) => {
      const requestedKeyIds = Object.keys(keys ?? {});
      for (const keyId of requestedKeyIds) {
        const cached = keyCache.get(keyId);
        if (cached) {
          return [keyId, cached] as [string, Uint8Array];
        }
      }

      if (requestedKeyIds.length === 1 && lastKey) {
        return [requestedKeyIds[0]!, lastKey] as [string, Uint8Array];
      }

      if (requestedKeyIds.length === 1 && params.bootstrapPassword) {
        const keyId = requestedKeyIds[0]!;
        const passphrase = keys?.[keyId]?.passphrase;
        if (
          passphrase?.algorithm === "m.pbkdf2" &&
          typeof passphrase.salt === "string" &&
          typeof passphrase.iterations === "number"
        ) {
          const derived = await deriveSecretStorageKeyFromPassphrase({
            passphrase: params.bootstrapPassword,
            salt: passphrase.salt,
            iterations: passphrase.iterations,
          });
          if (derived) {
            keyCache.set(keyId, derived);
            lastKey = derived;
            accessState = "passphrase_recoverable";
            return [keyId, derived] as [string, Uint8Array];
          }
        }
      }

      accessState = Object.values(keys ?? {}).some((entry) => Boolean(entry.passphrase))
        ? "passphrase_recoverable"
        : "recovery_key_only_unavailable";
      return null;
    },
    cacheSecretStorageKey: (
      keyId: string,
      _keyInfo: SecretStorageKeyDescription,
      key: Uint8Array,
    ) => {
      keyCache.set(keyId, key);
      lastKey = key;
    },
  };

  const client = createClientFn({
    baseUrl: params.auth.homeserver,
    userId: params.auth.userId,
    accessToken: params.auth.accessToken,
    deviceId: params.auth.deviceId,
    timelineSupport: false,
    cryptoCallbacks,
  });

  client.preseedSecretStorageKeyForBootstrap = (key) => {
    lastKey = key;
  };
  client.getTrustBootstrapDiagnostics = () => ({ secretStorageKeyAccessState: accessState });

  try {
    if (client.initRustCrypto) {
      await client.initRustCrypto({ useIndexedDB: false });
    }
    if (client.startClient) {
      await client.startClient({ initialSyncLimit: 1 });
    }
    return client;
  } catch (err) {
    await stopClientQuietly(client);
    throw err;
  }
}

function getCryptoApi(client: MatrixJsTrustClient): MatrixCryptoTrustApi | undefined {
  return client.getCrypto?.() ?? client.crypto;
}

async function stopClientQuietly(client: MatrixJsTrustClient): Promise<void> {
  try {
    if (client.stopClient) {
      await client.stopClient();
      return;
    }
    if (client.stop) {
      await client.stop();
    }
  } catch {
    // no-op
  }
}

// Supported product slice:
// 1) fresh bootstrap for OpenClaw-owned accounts (generates + stores recovery material)
// 2) recovery-key-assisted continuation for moved/new devices (loads stored material)
// Intentionally de-emphasized: generic migration/provider workflows and exploratory branches.
export async function bootstrapMatrixTrustWithMatrixJsSdk(params: {
  auth: MatrixAuth;
  cfg?: unknown;
  env?: NodeJS.ProcessEnv;
  accountId?: string | null;
  logger?: LoggerLike;
  deps?: MatrixTrustBootstrapDeps;
}): Promise<MatrixTrustBootstrapStatus> {
  const bootstrapPassword = await resolveMatrixBootstrapPassword({
    cfg: params.cfg,
    env: params.env,
    accountId: params.accountId,
  });

  const readRecovery =
    params.deps?.loadRecoveryMaterial ??
    ((env?: NodeJS.ProcessEnv, accountId?: string | null) => {
      try {
        return loadMatrixRecoveryMaterial(env, accountId);
      } catch {
        return null;
      }
    });
  const writeRecovery =
    params.deps?.saveRecoveryMaterial ??
    ((
      recoveryParams: {
        homeserver: string;
        userId: string;
        encodedRecoveryKey?: string;
        privateKey: Uint8Array;
      },
      env?: NodeJS.ProcessEnv,
      accountId?: string | null,
    ) => {
      try {
        saveMatrixRecoveryMaterial(recoveryParams, env, accountId);
      } catch (err) {
        params.logger?.warn?.("matrix: failed to persist recovery material", {
          error: toErrorMessage(err),
          accountId: accountId ?? "default",
        });
      }
    });
  const storedRecovery = readRecovery(params.env, params.accountId);
  const storedPrivateKey = decodePrivateKeyBase64(storedRecovery?.privateKeyBase64);

  const createClient =
    params.deps?.createClient ??
    (async ({ homeserver, userId, accessToken, deviceId }) =>
      createMatrixJsTrustClient({
        auth: { ...params.auth, homeserver, userId, accessToken, deviceId },
        bootstrapPassword,
        storedRecoveryPrivateKey: storedPrivateKey,
      }));

  let client: MatrixJsTrustClient;
  try {
    client = await createClient({
      homeserver: params.auth.homeserver,
      userId: params.auth.userId,
      accessToken: params.auth.accessToken,
      deviceId: params.auth.deviceId,
    });
  } catch (err) {
    return {
      state: "unsupported",
      reason: "matrix_js_sdk_unavailable",
      runtime: "matrix-js-sdk",
      crossSigningReady: null,
      secretStorageReady: null,
      attemptedBootstrap: false,
      attemptedCrossSigningBootstrap: false,
      attemptedSecretStorageBootstrap: false,
      bootstrapLevel: "none",
      error: toErrorMessage(err),
    };
  }

  try {
    const cryptoApi = getCryptoApi(client);
    if (!cryptoApi) {
      return {
        state: "unsupported",
        reason: "crypto_unavailable",
        runtime: "matrix-js-sdk",
        crossSigningReady: null,
        secretStorageReady: null,
        attemptedBootstrap: false,
        attemptedCrossSigningBootstrap: false,
        attemptedSecretStorageBootstrap: false,
        bootstrapLevel: "none",
      };
    }

    const crossReadyBefore = await safeCheck(cryptoApi.isCrossSigningReady?.bind(cryptoApi));
    const secretReadyBefore = await safeCheck(cryptoApi.isSecretStorageReady?.bind(cryptoApi));

    if (crossReadyBefore === true && secretReadyBefore === true) {
      return {
        state: "ready",
        reason: "already_ready",
        runtime: "matrix-js-sdk",
        crossSigningReady: true,
        secretStorageReady: true,
        attemptedBootstrap: false,
        attemptedCrossSigningBootstrap: false,
        attemptedSecretStorageBootstrap: false,
        bootstrapLevel: "full",
      };
    }

    if (!cryptoApi.bootstrapCrossSigning) {
      return {
        state: "unsupported",
        reason: "bootstrap_unsupported",
        runtime: "matrix-js-sdk",
        crossSigningReady: crossReadyBefore,
        secretStorageReady: secretReadyBefore,
        attemptedBootstrap: false,
        attemptedCrossSigningBootstrap: false,
        attemptedSecretStorageBootstrap: false,
        bootstrapLevel: crossReadyBefore === true && secretReadyBefore === true ? "full" : "none",
      };
    }

    if (!bootstrapPassword) {
      return {
        state: "needs-user-auth",
        reason: "password_unavailable",
        runtime: "matrix-js-sdk",
        crossSigningReady: crossReadyBefore,
        secretStorageReady: secretReadyBefore,
        attemptedBootstrap: false,
        attemptedCrossSigningBootstrap: false,
        attemptedSecretStorageBootstrap: false,
        bootstrapLevel: crossReadyBefore === true && secretReadyBefore === true ? "full" : "none",
      };
    }

    let attemptedCrossSigningBootstrap = false;
    let attemptedSecretStorageBootstrap = false;
    let generatedRecoveryMaterial: MatrixTrustBootstrapStatus["recoveryMaterial"] | undefined;
    let generatedPrivateKeyForStorage: Uint8Array | undefined;

    try {
      if (crossReadyBefore !== true) {
        attemptedCrossSigningBootstrap = true;
        await cryptoApi.bootstrapCrossSigning({
          authUploadDeviceSigningKeys: async (makeRequest) => {
            await makeRequest({
              type: "m.login.password",
              identifier: { type: "m.id.user", user: params.auth.userId },
              user: params.auth.userId,
              password: bootstrapPassword,
            });
          },
        });
      }
    } catch (err) {
      return {
        state: isUiaError(err) ? "needs-user-auth" : "error",
        reason: isUiaError(err) ? "uia_required" : "bootstrap_failed",
        runtime: "matrix-js-sdk",
        crossSigningReady: crossReadyBefore,
        secretStorageReady: secretReadyBefore,
        attemptedBootstrap: true,
        attemptedCrossSigningBootstrap,
        attemptedSecretStorageBootstrap,
        bootstrapLevel: "none",
        error: toErrorMessage(err),
      };
    }

    const crossReadyAfterCross = await safeCheck(cryptoApi.isCrossSigningReady?.bind(cryptoApi));

    try {
      const secretReadyAfterCross = await safeCheck(
        cryptoApi.isSecretStorageReady?.bind(cryptoApi),
      );
      if (secretReadyAfterCross !== true) {
        const bootstrapSecretStorage =
          cryptoApi.bootstrapSecretStorage?.bind(cryptoApi) ??
          client.bootstrapSecretStorage?.bind(client);

        if (!bootstrapSecretStorage) {
          return {
            state: crossReadyAfterCross === true ? "partial" : "unsupported",
            reason: "bootstrap_unsupported",
            runtime: "matrix-js-sdk",
            crossSigningReady: crossReadyAfterCross,
            secretStorageReady: secretReadyAfterCross,
            attemptedBootstrap: attemptedCrossSigningBootstrap,
            attemptedCrossSigningBootstrap,
            attemptedSecretStorageBootstrap,
            bootstrapLevel: crossReadyAfterCross === true ? "partial" : "none",
          };
        }

        const createRecoveryKeyFromPassphrase =
          cryptoApi.createRecoveryKeyFromPassphrase?.bind(cryptoApi);
        if (!createRecoveryKeyFromPassphrase) {
          return {
            state: crossReadyAfterCross === true ? "partial" : "unsupported",
            reason: "bootstrap_unsupported",
            runtime: "matrix-js-sdk",
            crossSigningReady: crossReadyAfterCross,
            secretStorageReady: secretReadyAfterCross,
            attemptedBootstrap: attemptedCrossSigningBootstrap,
            attemptedCrossSigningBootstrap,
            attemptedSecretStorageBootstrap,
            bootstrapLevel: crossReadyAfterCross === true ? "partial" : "none",
            error: "matrix-js-sdk crypto.createRecoveryKeyFromPassphrase() is unavailable",
          };
        }

        attemptedSecretStorageBootstrap = true;
        await bootstrapSecretStorage({
          setupNewSecretStorage: true,
          createSecretStorageKey: async () => {
            const generated = await createRecoveryKeyFromPassphrase();
            // Snapshot bytes immediately: rust-sdk/wasm-backed key buffers may be
            // mutated or detached after bootstrapSecretStorage consumes them.
            generatedPrivateKeyForStorage = new Uint8Array(generated.privateKey);
            generatedRecoveryMaterial = {
              created: true,
              encodedPrivateKey: generated.encodedPrivateKey,
              passphraseProtected: Boolean(generated.keyInfo?.passphrase),
              passphraseKdf: generated.keyInfo?.passphrase?.algorithm,
            };
            client.preseedSecretStorageKeyForBootstrap?.(generated.privateKey);
            return generated;
          },
        });
      }
    } catch (err) {
      const secretStorageKeyAccessState =
        client.getTrustBootstrapDiagnostics?.().secretStorageKeyAccessState;
      return {
        state: "needs-user-auth",
        reason:
          secretStorageKeyAccessState === "recovery_key_only_unavailable"
            ? "secret_storage_recovery_key_unavailable"
            : isUiaError(err)
              ? "uia_required"
              : isRecoveryMaterialError(err)
                ? "recovery_material_required"
                : "bootstrap_failed",
        runtime: "matrix-js-sdk",
        crossSigningReady: crossReadyAfterCross,
        secretStorageReady: false,
        attemptedBootstrap: true,
        attemptedCrossSigningBootstrap,
        attemptedSecretStorageBootstrap,
        bootstrapLevel: crossReadyAfterCross === true ? "partial" : "none",
        secretStorageKeyAccessState,
        ...(generatedRecoveryMaterial ? { recoveryMaterial: generatedRecoveryMaterial } : {}),
        error: toErrorMessage(err),
      };
    }

    const crossReadyAfter = await safeCheck(cryptoApi.isCrossSigningReady?.bind(cryptoApi));
    const secretReadyAfter = await safeCheck(cryptoApi.isSecretStorageReady?.bind(cryptoApi));
    const full = crossReadyAfter === true && secretReadyAfter === true;

    if (generatedPrivateKeyForStorage) {
      writeRecovery(
        {
          homeserver: params.auth.homeserver,
          userId: params.auth.userId,
          encodedRecoveryKey: generatedRecoveryMaterial?.encodedPrivateKey,
          privateKey: generatedPrivateKeyForStorage,
        },
        params.env,
        params.accountId,
      );
    }

    return {
      state: full ? "bootstrapped" : "partial",
      reason: full ? "bootstrap_succeeded" : "bootstrap_partially_succeeded",
      runtime: "matrix-js-sdk",
      crossSigningReady: crossReadyAfter,
      secretStorageReady: secretReadyAfter,
      attemptedBootstrap: attemptedCrossSigningBootstrap || attemptedSecretStorageBootstrap,
      attemptedCrossSigningBootstrap,
      attemptedSecretStorageBootstrap,
      bootstrapLevel: full ? "full" : crossReadyAfter === true ? "partial" : "none",
      ...(generatedRecoveryMaterial ? { recoveryMaterial: generatedRecoveryMaterial } : {}),
    };
  } finally {
    await stopClientQuietly(client);
  }
}
