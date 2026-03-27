import fs from "node:fs";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/matrix";
import { resolveConfiguredSecretInputWithFallback } from "../../../../../src/gateway/resolve-configured-secret-input-string.js";
import { getMatrixRuntime } from "../../runtime.js";
import {
  normalizeResolvedSecretInputString,
  normalizeSecretInputString,
} from "../../secret-input.js";
import type { CoreConfig } from "../../types.js";
import { resolveDefaultMatrixAccountId } from "../accounts.js";
import { loadMatrixRecoveryMaterial } from "../recovery-material.js";
import { loadMatrixSdk } from "../sdk-runtime.js";
import { ensureMatrixSdkLoggingConfigured } from "./logging.js";
import { resolveMatrixStoragePaths } from "./storage.js";
import type { MatrixAuth, MatrixResolvedConfig } from "./types.js";

function clean(value: unknown, path: string): string {
  return normalizeResolvedSecretInputString({ value, path }) ?? "";
}

/** Shallow-merge known nested config sub-objects so partial overrides inherit base values. */
function deepMergeConfig<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const merged = { ...base, ...override } as Record<string, unknown>;
  // Merge known nested objects (dm, actions) so partial overrides keep base fields
  for (const key of ["dm", "actions"] as const) {
    const b = base[key];
    const o = override[key];
    if (typeof b === "object" && b !== null && typeof o === "object" && o !== null) {
      merged[key] = { ...(b as Record<string, unknown>), ...(o as Record<string, unknown>) };
    }
  }
  return merged as T;
}

function resolveMatrixAccountConfig(cfg: CoreConfig, accountId?: string | null) {
  const normalizedAccountId = normalizeAccountId(accountId);
  const matrixBase = cfg.channels?.matrix ?? {};
  const accounts = cfg.channels?.matrix?.accounts;

  // Try to get account-specific config first (direct lookup, then case-insensitive fallback)
  let accountConfig = accounts?.[normalizedAccountId];
  if (!accountConfig && accounts) {
    for (const key of Object.keys(accounts)) {
      if (normalizeAccountId(key) === normalizedAccountId) {
        accountConfig = accounts[key];
        break;
      }
    }
  }

  return { normalizedAccountId, matrixBase, accountConfig };
}

function resolveMatrixChannelConfigForAccount(cfg: CoreConfig, accountId?: string | null) {
  const { matrixBase, accountConfig } = resolveMatrixAccountConfig(cfg, accountId);

  // Deep merge: account-specific values override top-level values, preserving
  // nested object inheritance (dm, actions, groups) so partial overrides work.
  return accountConfig ? deepMergeConfig(matrixBase, accountConfig) : matrixBase;
}

function resolveSecretInputPath(
  cfg: CoreConfig,
  accountId: string | null | undefined,
  field: "accessToken" | "password",
): string {
  const { normalizedAccountId, accountConfig } = resolveMatrixAccountConfig(cfg, accountId);
  if (accountConfig && field in accountConfig) {
    return `channels.matrix.accounts.${normalizedAccountId}.${field}`;
  }
  return `channels.matrix.${field}`;
}

function hasExistingMatrixCryptoState(params: {
  homeserver: string;
  userId: string;
  accessToken: string;
  accountId?: string | null;
  env: NodeJS.ProcessEnv;
}): boolean {
  const storagePaths = resolveMatrixStoragePaths({
    homeserver: params.homeserver,
    userId: params.userId,
    accessToken: params.accessToken,
    accountId: params.accountId,
    env: params.env,
  });

  try {
    if (!fs.existsSync(storagePaths.cryptoPath)) {
      return false;
    }
    return fs.readdirSync(storagePaths.cryptoPath).length > 0;
  } catch {
    return false;
  }
}

function shouldBypassCachedCredentialsForCryptoReset(params: {
  encryptionEnabled: boolean;
  cachedCredentials: { homeserver: string; userId: string; accessToken: string; deviceId?: string };
  accountId?: string | null;
  env: NodeJS.ProcessEnv;
}): boolean {
  if (!params.encryptionEnabled || !params.cachedCredentials.deviceId) {
    return false;
  }

  const hasCryptoState = hasExistingMatrixCryptoState({
    homeserver: params.cachedCredentials.homeserver,
    userId: params.cachedCredentials.userId,
    accessToken: params.cachedCredentials.accessToken,
    accountId: params.accountId,
    env: params.env,
  });
  if (hasCryptoState) {
    return false;
  }

  const recoveryMaterial = loadMatrixRecoveryMaterial(params.env, params.accountId);
  return !recoveryMaterial?.privateKeyBase64;
}

async function isUnknownTokenError(params: {
  homeserver: string;
  accessToken: string;
}): Promise<boolean> {
  const { response, release } = await fetchWithSsrFGuard({
    url: `${params.homeserver}/_matrix/client/v3/account/whoami`,
    init: {
      method: "GET",
      headers: { Authorization: `Bearer ${params.accessToken}` },
    },
    auditContext: "matrix.whoami",
  });

  try {
    if (response.ok) {
      return false;
    }
    const body = await response.text();
    return body.includes("M_UNKNOWN_TOKEN");
  } finally {
    await release();
  }
}

/**
 * Resolve Matrix config for a specific account, with fallback to top-level config.
 * This supports both multi-account (channels.matrix.accounts.*) and
 * single-account (channels.matrix.*) configurations.
 */
export function resolveMatrixConfigForAccount(
  cfg: CoreConfig = getMatrixRuntime().config.loadConfig() as CoreConfig,
  accountId?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): MatrixResolvedConfig {
  const matrix = resolveMatrixChannelConfigForAccount(cfg, accountId);

  const homeserver =
    clean(matrix.homeserver, "channels.matrix.homeserver") ||
    clean(env.MATRIX_HOMESERVER, "MATRIX_HOMESERVER");
  const userId =
    clean(matrix.userId, "channels.matrix.userId") || clean(env.MATRIX_USER_ID, "MATRIX_USER_ID");
  const accessToken =
    normalizeSecretInputString(matrix.accessToken) ||
    normalizeSecretInputString(env.MATRIX_ACCESS_TOKEN) ||
    undefined;
  const password =
    normalizeSecretInputString(matrix.password) ||
    normalizeSecretInputString(env.MATRIX_PASSWORD) ||
    undefined;
  const deviceName =
    clean(matrix.deviceName, "channels.matrix.deviceName") ||
    clean(env.MATRIX_DEVICE_NAME, "MATRIX_DEVICE_NAME") ||
    undefined;
  const initialSyncLimit =
    typeof matrix.initialSyncLimit === "number"
      ? Math.max(0, Math.floor(matrix.initialSyncLimit))
      : undefined;
  const encryption = matrix.encryption ?? false;
  return {
    homeserver,
    userId,
    accessToken,
    password,
    deviceName,
    initialSyncLimit,
    encryption,
  };
}

/**
 * Single-account function for backward compatibility - resolves default account config.
 */
export function resolveMatrixConfig(
  cfg: CoreConfig = getMatrixRuntime().config.loadConfig() as CoreConfig,
  env: NodeJS.ProcessEnv = process.env,
): MatrixResolvedConfig {
  const defaultAccountId = resolveDefaultMatrixAccountId(cfg) || DEFAULT_ACCOUNT_ID;
  return resolveMatrixConfigForAccount(cfg, defaultAccountId, env);
}

export async function resolveMatrixBootstrapPassword(params?: {
  cfg?: CoreConfig;
  env?: NodeJS.ProcessEnv;
  accountId?: string | null;
}): Promise<string | undefined> {
  const cfg = params?.cfg ?? (getMatrixRuntime().config.loadConfig() as CoreConfig);
  const env = params?.env ?? process.env;
  const accountId = params?.accountId;
  const matrix = resolveMatrixChannelConfigForAccount(cfg, accountId);

  const resolvedPassword = await resolveConfiguredSecretInputWithFallback({
    config: cfg,
    env,
    value: matrix.password,
    path: resolveSecretInputPath(cfg, accountId, "password"),
    readFallback: () => normalizeSecretInputString(env.MATRIX_PASSWORD),
  });

  return normalizeResolvedSecretInputString({
    value: resolvedPassword.value,
    path: resolveSecretInputPath(cfg, accountId, "password"),
  });
}

export async function resolveMatrixAuth(params?: {
  cfg?: CoreConfig;
  env?: NodeJS.ProcessEnv;
  accountId?: string | null;
}): Promise<MatrixAuth> {
  const cfg = params?.cfg ?? (getMatrixRuntime().config.loadConfig() as CoreConfig);
  const env = params?.env ?? process.env;
  const accountId = params?.accountId;
  const matrix = resolveMatrixChannelConfigForAccount(cfg, accountId);
  const resolved = resolveMatrixConfigForAccount(cfg, accountId, env);
  if (!resolved.homeserver) {
    throw new Error("Matrix homeserver is required (matrix.homeserver)");
  }

  const {
    loadMatrixCredentials,
    saveMatrixCredentials,
    credentialsMatchConfig,
    touchMatrixCredentials,
  } = await import("../credentials.js");

  const cached = loadMatrixCredentials(env, accountId);
  const cachedCredentials =
    cached &&
    credentialsMatchConfig(cached, {
      homeserver: resolved.homeserver,
      userId: resolved.userId || "",
    })
      ? cached
      : null;

  const resolvedAccessToken = (
    await resolveConfiguredSecretInputWithFallback({
      config: cfg,
      env,
      value: matrix.accessToken,
      path: resolveSecretInputPath(cfg, accountId, "accessToken"),
      readFallback: () => normalizeSecretInputString(env.MATRIX_ACCESS_TOKEN),
    })
  ).value;

  // If we have an access token, we can fetch userId via whoami if not provided
  if (resolvedAccessToken) {
    let userId = resolved.userId;
    let deviceId = cachedCredentials?.deviceId;
    if (!userId) {
      // Fetch userId from access token via whoami
      ensureMatrixSdkLoggingConfigured();
      const { MatrixClient } = loadMatrixSdk();
      const tempClient = new MatrixClient(resolved.homeserver, resolvedAccessToken);
      const whoami = await tempClient.getUserId();
      userId = whoami;
      // Save the credentials with the fetched userId
      saveMatrixCredentials(
        {
          homeserver: resolved.homeserver,
          userId,
          accessToken: resolvedAccessToken,
          deviceId,
        },
        env,
        accountId,
      );
    } else if (cachedCredentials && cachedCredentials.accessToken === resolvedAccessToken) {
      touchMatrixCredentials(env, accountId);
    }
    return {
      homeserver: resolved.homeserver,
      userId,
      accessToken: resolvedAccessToken,
      deviceId,
      deviceName: resolved.deviceName,
      initialSyncLimit: resolved.initialSyncLimit,
      encryption: resolved.encryption,
    };
  }

  const password =
    resolved.password ?? (await resolveMatrixBootstrapPassword({ cfg, env, accountId }));

  if (cachedCredentials) {
    let shouldBypassCached =
      Boolean(password) &&
      shouldBypassCachedCredentialsForCryptoReset({
        encryptionEnabled: resolved.encryption,
        cachedCredentials,
        accountId,
        env,
      });

    if (!shouldBypassCached && password) {
      try {
        const unknownToken = await isUnknownTokenError({
          homeserver: cachedCredentials.homeserver,
          accessToken: cachedCredentials.accessToken,
        });
        if (unknownToken) {
          shouldBypassCached = true;
          loadMatrixSdk().LogService.info(
            "MatrixClientLite",
            "Cached Matrix token rejected with M_UNKNOWN_TOKEN; rotating to password login",
          );
        }
      } catch (err) {
        loadMatrixSdk().LogService.warn(
          "MatrixClientLite",
          "Failed to validate cached Matrix token via whoami; continuing with cached token",
          err,
        );
      }
    }

    if (!shouldBypassCached) {
      touchMatrixCredentials(env, accountId);
      return {
        homeserver: cachedCredentials.homeserver,
        userId: cachedCredentials.userId,
        accessToken: cachedCredentials.accessToken,
        deviceId: cachedCredentials.deviceId,
        deviceName: resolved.deviceName,
        initialSyncLimit: resolved.initialSyncLimit,
        encryption: resolved.encryption,
      };
    }

    loadMatrixSdk().LogService.info(
      "MatrixClientLite",
      "Bypassing cached Matrix credentials; rotating to a fresh login token/device",
    );
  }

  if (!resolved.userId) {
    throw new Error("Matrix userId is required when no access token is configured (matrix.userId)");
  }

  if (!password) {
    throw new Error(
      "Matrix password is required when no access token is configured (matrix.password)",
    );
  }

  // Login with password using HTTP API.
  const { response: loginResponse, release: releaseLoginResponse } = await fetchWithSsrFGuard({
    url: `${resolved.homeserver}/_matrix/client/v3/login`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "m.login.password",
        identifier: { type: "m.id.user", user: resolved.userId },
        password,
        initial_device_display_name: resolved.deviceName ?? "OpenClaw Gateway",
      }),
    },
    auditContext: "matrix.login",
  });
  const login = await (async () => {
    try {
      if (!loginResponse.ok) {
        const errorText = await loginResponse.text();
        throw new Error(`Matrix login failed: ${errorText}`);
      }
      return (await loginResponse.json()) as {
        access_token?: string;
        user_id?: string;
        device_id?: string;
      };
    } finally {
      await releaseLoginResponse();
    }
  })();

  const accessToken = login.access_token?.trim();
  if (!accessToken) {
    throw new Error("Matrix login did not return an access token");
  }

  const auth: MatrixAuth = {
    homeserver: resolved.homeserver,
    userId: login.user_id ?? resolved.userId,
    accessToken,
    deviceId: login.device_id,
    deviceName: resolved.deviceName,
    initialSyncLimit: resolved.initialSyncLimit,
    encryption: resolved.encryption,
  };

  saveMatrixCredentials(
    {
      homeserver: auth.homeserver,
      userId: auth.userId,
      accessToken: auth.accessToken,
      deviceId: login.device_id,
    },
    env,
    accountId,
  );

  return auth;
}
