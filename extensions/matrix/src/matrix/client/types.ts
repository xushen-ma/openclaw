export type MatrixResolvedConfig = {
  homeserver: string;
  userId: string;
  accessToken?: string;
  password?: string;
  deviceName?: string;
  initialSyncLimit?: number;
  encryption?: boolean;
};

/**
 * Authenticated Matrix configuration.
 * deviceId is optional because token-only flows may not always provide it,
 * but when available (login response / cached credentials) it should be carried
 * through so matrix-js-sdk crypto bootstrap can bind to the correct session device.
 */
export type MatrixAuth = {
  homeserver: string;
  userId: string;
  accessToken: string;
  deviceId?: string;
  deviceName?: string;
  initialSyncLimit?: number;
  encryption?: boolean;
};

export type MatrixStoragePaths = {
  rootDir: string;
  storagePath: string;
  cryptoPath: string;
  metaPath: string;
  accountKey: string;
  tokenHash: string;
};
