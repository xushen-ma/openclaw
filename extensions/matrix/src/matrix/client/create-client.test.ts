import { EventEmitter } from "node:events";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ensureMatrixSdkLoggingConfiguredMock = vi.hoisted(() => vi.fn());
const resolveValidatedMatrixHomeserverUrlMock = vi.hoisted(() => vi.fn());
const maybeMigrateLegacyStorageMock = vi.hoisted(() => vi.fn(async () => undefined));
const resolveMatrixStoragePathsMock = vi.hoisted(() => vi.fn());
const writeStorageMetaMock = vi.hoisted(() => vi.fn());
const MatrixClientMock = vi.hoisted(() => vi.fn());

vi.mock("./logging.js", () => ({
  ensureMatrixSdkLoggingConfigured: ensureMatrixSdkLoggingConfiguredMock,
}));

vi.mock("./config.js", () => ({
  resolveValidatedMatrixHomeserverUrl: resolveValidatedMatrixHomeserverUrlMock,
}));

vi.mock("./storage.js", () => ({
  maybeMigrateLegacyStorage: maybeMigrateLegacyStorageMock,
  resolveMatrixStoragePaths: resolveMatrixStoragePathsMock,
  writeStorageMeta: writeStorageMetaMock,
}));

vi.mock("../sdk.js", () => ({
  MatrixClient: MatrixClientMock,
}));

let createMatrixClient: typeof import("./create-client.js").createMatrixClient;
let attachMatrixFleetMgmtEmitProbe: typeof import("./create-client.js").attachMatrixFleetMgmtEmitProbe;

describe("createMatrixClient", () => {
  const storagePaths = {
    rootDir: "/tmp/openclaw-matrix-create-client-test",
    storagePath: "/tmp/openclaw-matrix-create-client-test/storage.json",
    recoveryKeyPath: "/tmp/openclaw-matrix-create-client-test/recovery.key",
    idbSnapshotPath: "/tmp/openclaw-matrix-create-client-test/idb.snapshot",
    metaPath: "/tmp/openclaw-matrix-create-client-test/storage-meta.json",
    accountKey: "default",
    tokenHash: "token-hash",
  };

  beforeAll(async () => {
    ({ createMatrixClient, attachMatrixFleetMgmtEmitProbe } = await import("./create-client.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    ensureMatrixSdkLoggingConfiguredMock.mockReturnValue(undefined);
    resolveValidatedMatrixHomeserverUrlMock.mockResolvedValue("https://matrix.example.org");
    resolveMatrixStoragePathsMock.mockReturnValue(storagePaths);
    MatrixClientMock.mockImplementation(function MockMatrixClient() {
      return {
        stop: vi.fn(),
      };
    });
  });

  it("persists storage metadata by default", async () => {
    await createMatrixClient({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "tok",
    });

    expect(writeStorageMetaMock).toHaveBeenCalledWith({
      storagePaths,
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accountId: undefined,
      deviceId: undefined,
    });
    expect(resolveMatrixStoragePathsMock).toHaveBeenCalledTimes(1);
    expect(MatrixClientMock).toHaveBeenCalledWith("https://matrix.example.org", "tok", {
      userId: "@bot:example.org",
      password: undefined,
      deviceId: undefined,
      encryption: undefined,
      localTimeoutMs: undefined,
      initialSyncLimit: undefined,
      storagePath: storagePaths.storagePath,
      recoveryKeyPath: storagePaths.recoveryKeyPath,
      idbSnapshotPath: storagePaths.idbSnapshotPath,
      cryptoDatabasePrefix: "openclaw-matrix-default-token-hash",
      autoBootstrapCrypto: undefined,
      ssrfPolicy: undefined,
      dispatcherPolicy: undefined,
    });
  });

  it("derives ssrfPolicy from allowPrivateNetwork when no explicit policy is provided", async () => {
    await createMatrixClient({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "tok",
      persistStorage: false,
      allowPrivateNetwork: true,
    });

    expect(MatrixClientMock).toHaveBeenCalledWith(
      "https://matrix.example.org",
      "tok",
      expect.objectContaining({
        ssrfPolicy: { allowPrivateNetwork: true },
      }),
    );
  });

  it("prefers explicit ssrfPolicy over allowPrivateNetwork", async () => {
    const explicitPolicy = { allowPrivateNetwork: true, customField: "test" };
    await createMatrixClient({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "tok",
      persistStorage: false,
      allowPrivateNetwork: false,
      ssrfPolicy: explicitPolicy as never,
    });

    expect(MatrixClientMock).toHaveBeenCalledWith(
      "https://matrix.example.org",
      "tok",
      expect.objectContaining({
        ssrfPolicy: explicitPolicy,
      }),
    );
  });

  it("leaves ssrfPolicy undefined when allowPrivateNetwork is falsy and no explicit policy", async () => {
    await createMatrixClient({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "tok",
      persistStorage: false,
    });

    expect(MatrixClientMock).toHaveBeenCalledWith(
      "https://matrix.example.org",
      "tok",
      expect.objectContaining({
        ssrfPolicy: undefined,
      }),
    );
  });

  it("skips persistent storage wiring when persistence is disabled", async () => {
    await createMatrixClient({
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "tok",
      persistStorage: false,
    });

    expect(resolveMatrixStoragePathsMock).not.toHaveBeenCalled();
    expect(writeStorageMetaMock).not.toHaveBeenCalled();
    expect(MatrixClientMock).toHaveBeenCalledWith("https://matrix.example.org", "tok", {
      userId: "@bot:example.org",
      password: undefined,
      deviceId: undefined,
      encryption: undefined,
      localTimeoutMs: undefined,
      initialSyncLimit: undefined,
      storagePath: undefined,
      recoveryKeyPath: undefined,
      idbSnapshotPath: undefined,
      cryptoDatabasePrefix: undefined,
      autoBootstrapCrypto: undefined,
      ssrfPolicy: undefined,
      dispatcherPolicy: undefined,
    });
  });

  it("logs targeted room emits with listener count", () => {
    class ProbeClient extends EventEmitter {}
    const client = new ProbeClient();
    const log = vi.fn();
    const handler = vi.fn();
    client.on("room.message", handler);

    attachMatrixFleetMgmtEmitProbe({
      client,
      accountId: "mini",
      userId: "@mini:home.jxs.com.au",
      log,
    });

    const event = {
      type: "m.room.message",
      event_id: "$event1",
    };
    client.emit("room.message", "!bSZooEPKekiUuHRikF:home.jxs.com.au", event);

    expect(handler).toHaveBeenCalledWith("!bSZooEPKekiUuHRikF:home.jxs.com.au", event);
    expect(log).toHaveBeenCalledWith(
      "matrix-probe: emit account=mini user=@mini:home.jxs.com.au event=room.message room=!bSZooEPKekiUuHRikF:home.jxs.com.au type=m.room.message id=$event1 listeners=1",
    );
  });

  it("ignores other rooms", () => {
    class ProbeClient extends EventEmitter {}
    const client = new ProbeClient();
    const log = vi.fn();
    attachMatrixFleetMgmtEmitProbe({
      client,
      accountId: "mini",
      userId: "@mini:home.jxs.com.au",
      log,
    });

    client.emit("room.message", "!other:example.org", {
      type: "m.room.message",
      event_id: "$event2",
    });

    expect(log).not.toHaveBeenCalled();
  });

  it("patches a client only once", () => {
    class ProbeClient extends EventEmitter {}
    const client = new ProbeClient();
    const firstLog = vi.fn();
    const secondLog = vi.fn();
    attachMatrixFleetMgmtEmitProbe({
      client,
      accountId: "mini",
      userId: "@mini:home.jxs.com.au",
      log: firstLog,
    });
    attachMatrixFleetMgmtEmitProbe({
      client,
      accountId: "mini",
      userId: "@mini:home.jxs.com.au",
      log: secondLog,
    });

    client.emit("room.event", "!bSZooEPKekiUuHRikF:home.jxs.com.au", {
      type: "m.room.encrypted",
      event_id: "$event3",
    });

    expect(firstLog).toHaveBeenCalledTimes(1);
    expect(secondLog).not.toHaveBeenCalled();
  });
});
