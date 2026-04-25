import fs from "node:fs";
import type { PinnedDispatcherPolicy } from "openclaw/plugin-sdk/ssrf-dispatcher";
import { normalizeOptionalString } from "openclaw/plugin-sdk/string-coerce-runtime";
import {
  ssrfPolicyFromDangerouslyAllowPrivateNetwork,
  type SsrFPolicy,
} from "../../runtime-api.js";
import type { MatrixClient } from "../sdk.js";
import { resolveValidatedMatrixHomeserverUrl } from "./config.js";
import { logMatrixFleetMgmtProbe } from "./fleet-mgmt-probe.js";
import {
  maybeMigrateLegacyStorage,
  resolveMatrixStoragePaths,
  writeStorageMeta,
} from "./storage.js";

type MatrixCreateClientRuntimeDeps = {
  MatrixClient: typeof import("../sdk.js").MatrixClient;
  ensureMatrixSdkLoggingConfigured: typeof import("./logging.js").ensureMatrixSdkLoggingConfigured;
};

const MATRIX_CLIENT_EMIT_PROBE_PATCHED = Symbol("matrixClientEmitProbePatched");

type MatrixEmitterLike = {
  emit: (eventName: string, ...args: unknown[]) => boolean;
  listenerCount?: (eventName: string) => number;
  [MATRIX_CLIENT_EMIT_PROBE_PATCHED]?: boolean;
};

let matrixCreateClientRuntimeDepsPromise: Promise<MatrixCreateClientRuntimeDeps> | undefined;

async function loadMatrixCreateClientRuntimeDeps(): Promise<MatrixCreateClientRuntimeDeps> {
  matrixCreateClientRuntimeDepsPromise ??= Promise.all([
    import("../sdk.js"),
    import("./logging.js"),
  ]).then(([sdkModule, loggingModule]) => ({
    MatrixClient: sdkModule.MatrixClient,
    ensureMatrixSdkLoggingConfigured: loggingModule.ensureMatrixSdkLoggingConfigured,
  }));
  return await matrixCreateClientRuntimeDepsPromise;
}

function isMatrixEmitterLike(value: unknown): value is MatrixEmitterLike {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const maybeEmitter = value as { emit?: unknown };
  return typeof maybeEmitter.emit === "function";
}

function extractProbeEvent(args: unknown[]): {
  roomId: string | null;
  event: Record<string, unknown> | null;
} {
  const roomId = typeof args[0] === "string" ? args[0] : null;
  const event =
    args.find(
      (value): value is Record<string, unknown> =>
        value != null &&
        typeof value === "object" &&
        ("event_id" in value || "type" in value || "room_id" in value),
    ) ?? null;
  return { roomId, event };
}

export function attachMatrixFleetMgmtEmitProbe(params: {
  client: unknown;
  accountId?: string | null;
  userId: string;
  log: (message: string) => void;
}): void {
  if (!isMatrixEmitterLike(params.client)) {
    return;
  }
  const { client } = params;
  if (client[MATRIX_CLIENT_EMIT_PROBE_PATCHED]) {
    return;
  }

  const originalEmit = client.emit.bind(client);
  client.emit = (eventName: string, ...args: unknown[]) => {
    try {
      const { roomId, event } = extractProbeEvent(args);
      const eventRoomId = typeof event?.room_id === "string" ? event.room_id : null;
      const resolvedRoomId = roomId ?? eventRoomId;
      const eventType = typeof event?.type === "string" ? event.type : "unknown";
      const eventId = typeof event?.event_id === "string" ? event.event_id : "unknown";
      const listeners =
        typeof client.listenerCount === "function"
          ? String(client.listenerCount(eventName))
          : "unknown";
      logMatrixFleetMgmtProbe(params.log, {
        stage: "client.emit",
        roomId: resolvedRoomId,
        accountId: params.accountId ?? "default",
        userId: params.userId,
        eventName,
        eventType,
        eventId,
        listeners,
      });
    } catch {
      // Never let probe logging interfere with Matrix event delivery.
    }
    return originalEmit(eventName, ...args);
  };
  client[MATRIX_CLIENT_EMIT_PROBE_PATCHED] = true;
}

export async function createMatrixClient(params: {
  homeserver: string;
  userId?: string;
  accessToken: string;
  password?: string;
  deviceId?: string;
  persistStorage?: boolean;
  encryption?: boolean;
  localTimeoutMs?: number;
  initialSyncLimit?: number;
  accountId?: string | null;
  autoBootstrapCrypto?: boolean;
  allowPrivateNetwork?: boolean;
  ssrfPolicy?: SsrFPolicy;
  dispatcherPolicy?: PinnedDispatcherPolicy;
}): Promise<MatrixClient> {
  const { MatrixClient, ensureMatrixSdkLoggingConfigured } =
    await loadMatrixCreateClientRuntimeDeps();
  ensureMatrixSdkLoggingConfigured();
  const homeserver = await resolveValidatedMatrixHomeserverUrl(params.homeserver, {
    dangerouslyAllowPrivateNetwork: params.allowPrivateNetwork,
  });
  const matrixClientUserId = normalizeOptionalString(params.userId);
  const userId = matrixClientUserId ?? "unknown";
  const persistStorage = params.persistStorage !== false;
  const storagePaths = persistStorage
    ? resolveMatrixStoragePaths({
        homeserver,
        userId,
        accessToken: params.accessToken,
        accountId: params.accountId,
        deviceId: params.deviceId,
        env: process.env,
      })
    : null;

  if (storagePaths) {
    await maybeMigrateLegacyStorage({
      storagePaths,
      env: process.env,
    });
    fs.mkdirSync(storagePaths.rootDir, { recursive: true });
    writeStorageMeta({
      storagePaths,
      homeserver,
      userId,
      accountId: params.accountId,
      deviceId: params.deviceId,
    });
  }

  const cryptoDatabasePrefix = storagePaths
    ? `openclaw-matrix-${storagePaths.accountKey}-${storagePaths.tokenHash}`
    : undefined;

  const client = new MatrixClient(homeserver, params.accessToken, {
    userId: matrixClientUserId,
    password: params.password,
    deviceId: params.deviceId,
    encryption: params.encryption,
    localTimeoutMs: params.localTimeoutMs,
    initialSyncLimit: params.initialSyncLimit,
    storagePath: storagePaths?.storagePath,
    recoveryKeyPath: storagePaths?.recoveryKeyPath,
    idbSnapshotPath: storagePaths?.idbSnapshotPath,
    cryptoDatabasePrefix,
    autoBootstrapCrypto: params.autoBootstrapCrypto,
    ssrfPolicy:
      params.ssrfPolicy ?? ssrfPolicyFromDangerouslyAllowPrivateNetwork(params.allowPrivateNetwork),
    dispatcherPolicy: params.dispatcherPolicy,
  });

  attachMatrixFleetMgmtEmitProbe({
    client,
    accountId: params.accountId,
    userId,
    log: (message) => console.info(message),
  });

  return client;
}
