// Matrix tests cover accounts plugin behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMatrixScopedEnvVarNames } from "../env-vars.js";
import type { CoreConfig } from "../types.js";
import { resolveMatrixAccountAllowlistConfig } from "./account-config.js";
import {
  listMatrixAccountIds,
  resolveConfiguredMatrixBotUserIds,
  resolveDefaultMatrixAccountId,
  resolveMatrixAccount,
} from "./accounts.js";
import type { MatrixStoredCredentials } from "./credentials-state.js";

const loadMatrixCredentialsMock = vi.hoisted(() =>
  vi.fn<(env?: NodeJS.ProcessEnv, accountId?: string | null) => MatrixStoredCredentials | null>(
    () => null,
  ),
);

vi.mock("./credentials-read.js", () => ({
  loadMatrixCredentials: (env?: NodeJS.ProcessEnv, accountId?: string | null) =>
    loadMatrixCredentialsMock(env, accountId),
  credentialsMatchConfig: () => false,
}));

const envKeys = [
  "MATRIX_HOMESERVER",
  "MATRIX_USER_ID",
  "MATRIX_ACCESS_TOKEN",
  "MATRIX_PASSWORD",
  "MATRIX_DEVICE_NAME",
  "MATRIX_DEFAULT_HOMESERVER",
  "MATRIX_DEFAULT_ACCESS_TOKEN",
  getMatrixScopedEnvVarNames("team-ops").homeserver,
  getMatrixScopedEnvVarNames("team-ops").accessToken,
];

type MatrixRoomScopeKey = "groups" | "rooms";

function createMatrixAccountConfig(accessToken: string) {
  return {
    homeserver: "https://matrix.example.org",
    accessToken,
  };
}

function createMatrixScopedEntriesConfig(scopeKey: MatrixRoomScopeKey): CoreConfig {
  return {
    channels: {
      matrix: {
        [scopeKey]: {
          "!default-room:example.org": {
            enabled: true,
            account: "default",
          },
          "!axis-room:example.org": {
            enabled: true,
            account: "axis",
          },
          "!unassigned-room:example.org": {
            enabled: true,
          },
        },
        accounts: {
          default: createMatrixAccountConfig("default-token"),
          axis: createMatrixAccountConfig("axis-token"),
        },
      },
    },
  } as unknown as CoreConfig;
}

function createMatrixTopLevelDefaultScopedEntriesConfig(scopeKey: MatrixRoomScopeKey): CoreConfig {
  return {
    channels: {
      matrix: {
        ...createMatrixAccountConfig("default-token"),
        [scopeKey]: {
          "!default-room:example.org": {
            enabled: true,
            account: "default",
          },
          "!ops-room:example.org": {
            enabled: true,
            account: "ops",
          },
          "!shared-room:example.org": {
            enabled: true,
          },
        },
        accounts: {
          ops: createMatrixAccountConfig("ops-token"),
        },
      },
    },
  } as unknown as CoreConfig;
}

function expectMatrixScopedEntries(
  cfg: CoreConfig,
  scopeKey: MatrixRoomScopeKey,
  accountId: string,
  expected: Record<string, { enabled: true; account?: string }>,
): void {
  expect(resolveMatrixAccount({ cfg, accountId }).config[scopeKey]).toEqual(expected);
}

function expectMultiAccountMatrixScopedEntries(
  cfg: CoreConfig,
  scopeKey: MatrixRoomScopeKey,
): void {
  expectMatrixScopedEntries(cfg, scopeKey, "default", {
    "!default-room:example.org": {
      enabled: true,
      account: "default",
    },
    "!unassigned-room:example.org": {
      enabled: true,
    },
  });
  expectMatrixScopedEntries(cfg, scopeKey, "axis", {
    "!axis-room:example.org": {
      enabled: true,
      account: "axis",
    },
    "!unassigned-room:example.org": {
      enabled: true,
    },
  });
}

function expectTopLevelDefaultMatrixScopedEntries(
  cfg: CoreConfig,
  scopeKey: MatrixRoomScopeKey,
): void {
  expectMatrixScopedEntries(cfg, scopeKey, "default", {
    "!default-room:example.org": {
      enabled: true,
      account: "default",
    },
    "!shared-room:example.org": {
      enabled: true,
    },
  });
  expectMatrixScopedEntries(cfg, scopeKey, "ops", {
    "!ops-room:example.org": {
      enabled: true,
      account: "ops",
    },
    "!shared-room:example.org": {
      enabled: true,
    },
  });
}

describe("resolveMatrixAccount", () => {
  let prevEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    loadMatrixCredentialsMock.mockReset().mockReturnValue(null);
    prevEnv = {};
    for (const key of envKeys) {
      prevEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = prevEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("treats access-token-only config as configured", () => {
    const cfg: CoreConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.example.org",
          accessToken: "tok-access",
        },
      },
    };

    const account = resolveMatrixAccount({ cfg });
    expect(account.configured).toBe(true);
  });

  it.each([
    {
      name: "treats SecretRef access-token config as configured",
      matrix: {
        homeserver: "https://matrix.example.org",
        accessToken: { source: "file", provider: "matrix-file", id: "value" },
      },
      path: "/tmp/matrix-token",
    },
    {
      name: "treats accounts.default SecretRef access-token config as configured",
      matrix: {
        accounts: {
          default: {
            homeserver: "https://matrix.example.org",
            accessToken: { source: "file", provider: "matrix-file", id: "value" },
          },
        },
      },
      path: "/tmp/matrix-token",
    },
    {
      name: "treats accounts.default SecretRef password config as configured",
      matrix: {
        accounts: {
          default: {
            homeserver: "https://matrix.example.org",
            userId: "@bot:example.org",
            password: { source: "file", provider: "matrix-file", id: "value" },
          },
        },
      },
      path: "/tmp/matrix-password",
    },
  ])("$name", ({ matrix, path }) => {
    const cfg = {
      channels: { matrix },
      secrets: { providers: { "matrix-file": { source: "file", path } } },
    } as CoreConfig;
    expect(resolveMatrixAccount({ cfg }).configured).toBe(true);
  });

  it("requires userId + password when no access token is set", () => {
    const cfg: CoreConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.example.org",
          userId: "@bot:example.org",
        },
      },
    };

    const account = resolveMatrixAccount({ cfg });
    expect(account.configured).toBe(false);
  });

  it("marks password auth as configured when userId is present", () => {
    const cfg: CoreConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.example.org",
          userId: "@bot:example.org",
          password: "secret",
        },
      },
    };

    const account = resolveMatrixAccount({ cfg });
    expect(account.configured).toBe(true);
  });

  it("merges account bot loop protection over top-level defaults field-by-field", () => {
    const cfg: CoreConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.example.org",
          userId: "@bot:example.org",
          accessToken: "top-token",
          botLoopProtection: {
            maxEventsPerWindow: 8,
            windowSeconds: 120,
            cooldownSeconds: 240,
          },
          accounts: {
            ops: {
              accessToken: "ops-token",
              botLoopProtection: {
                maxEventsPerWindow: 3,
              },
            },
          },
        },
      },
    };

    const account = resolveMatrixAccount({ cfg, accountId: "ops" });
    expect(account.config.botLoopProtection).toEqual({
      maxEventsPerWindow: 3,
      windowSeconds: 120,
      cooldownSeconds: 240,
    });
  });

  it("normalizes and de-duplicates configured account ids", () => {
    const cfg: CoreConfig = {
      channels: {
        matrix: {
          defaultAccount: "Main Bot",
          accounts: {
            "Main Bot": {
              homeserver: "https://matrix.example.org",
              accessToken: "main-token",
            },
            "main-bot": {
              homeserver: "https://matrix.example.org",
              accessToken: "duplicate-token",
            },
            OPS: {
              homeserver: "https://matrix.example.org",
              accessToken: "ops-token",
            },
          },
        },
      },
    };

    expect(listMatrixAccountIds(cfg)).toEqual(["main-bot", "ops"]);
    expect(resolveDefaultMatrixAccountId(cfg)).toBe("main-bot");
  });

  it("returns the only named account when no explicit default is set", () => {
    const cfg: CoreConfig = {
      channels: {
        matrix: {
          accounts: {
            ops: {
              homeserver: "https://matrix.example.org",
              accessToken: "ops-token",
            },
          },
        },
      },
    };

    expect(resolveDefaultMatrixAccountId(cfg)).toBe("ops");
  });

  it("uses configured defaultAccount when accountId is omitted", () => {
    const cfg: CoreConfig = {
      channels: {
        matrix: {
          defaultAccount: "ops",
          homeserver: "https://matrix.example.org",
          accessToken: "default-token",
          accounts: {
            ops: {
              homeserver: "https://ops.example.org",
              accessToken: "ops-token",
            },
          },
        },
      },
    };

    const account = resolveMatrixAccount({ cfg });
    expect(account.accountId).toBe("ops");
    expect(account.homeserver).toBe("https://ops.example.org");
    expect(account.configured).toBe(true);
  });

  it("includes env-backed named accounts in plugin account enumeration", () => {
    const keys = getMatrixScopedEnvVarNames("team-ops");
    process.env[keys.homeserver] = "https://matrix.example.org";
    process.env[keys.accessToken] = "ops-token";

    const cfg: CoreConfig = {
      channels: {
        matrix: {},
      },
    };

    expect(listMatrixAccountIds(cfg)).toEqual(["team-ops"]);
    expect(resolveDefaultMatrixAccountId(cfg)).toBe("team-ops");
  });

  it("includes default accounts backed only by global env vars in plugin account enumeration", () => {
    process.env.MATRIX_HOMESERVER = "https://matrix.example.org";
    process.env.MATRIX_ACCESS_TOKEN = "default-token";

    const cfg: CoreConfig = {};

    expect(listMatrixAccountIds(cfg)).toEqual(["default"]);
    expect(resolveDefaultMatrixAccountId(cfg)).toBe("default");
  });

  it("treats mixed default and named env-backed accounts as multi-account", () => {
    const keys = getMatrixScopedEnvVarNames("team-ops");
    process.env.MATRIX_HOMESERVER = "https://matrix.example.org";
    process.env.MATRIX_ACCESS_TOKEN = "default-token";
    process.env[keys.homeserver] = "https://matrix.example.org";
    process.env[keys.accessToken] = "ops-token";

    const cfg: CoreConfig = {
      channels: {
        matrix: {},
      },
    };

    expect(listMatrixAccountIds(cfg)).toEqual(["default", "team-ops"]);
    expect(resolveDefaultMatrixAccountId(cfg)).toBe("default");
  });

  it("includes a top-level configured default account alongside named accounts", () => {
    const cfg: CoreConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.example.org",
          accessToken: "default-token",
          accounts: {
            ops: {
              homeserver: "https://matrix.example.org",
              accessToken: "ops-token",
            },
          },
        },
      },
    };

    expect(listMatrixAccountIds(cfg)).toEqual(["default", "ops"]);
    expect(resolveDefaultMatrixAccountId(cfg)).toBe("default");
  });

  it("does not materialize a default account from shared top-level defaults alone", () => {
    const cfg: CoreConfig = {
      channels: {
        matrix: {
          name: "Shared Defaults",
          enabled: true,
          accounts: {
            ops: {
              homeserver: "https://matrix.example.org",
              accessToken: "ops-token",
            },
          },
        },
      },
    };

    expect(listMatrixAccountIds(cfg)).toEqual(["ops"]);
    expect(resolveDefaultMatrixAccountId(cfg)).toBe("ops");
  });

  it('uses the synthetic "default" account when multiple named accounts need explicit selection', () => {
    const cfg: CoreConfig = {
      channels: {
        matrix: {
          accounts: {
            alpha: {
              homeserver: "https://matrix.example.org",
              accessToken: "alpha-token",
            },
            beta: {
              homeserver: "https://matrix.example.org",
              accessToken: "beta-token",
            },
          },
        },
      },
    };

    expect(resolveDefaultMatrixAccountId(cfg)).toBe("default");
  });

  it("collects other configured Matrix account user ids for bot detection", () => {
    const cfg: CoreConfig = {
      channels: {
        matrix: {
          userId: "@main:example.org",
          homeserver: "https://matrix.example.org",
          accessToken: "main-token",
          accounts: {
            ops: {
              homeserver: "https://matrix.example.org",
              userId: "@ops:example.org",
              accessToken: "ops-token",
            },
            alerts: {
              homeserver: "https://matrix.example.org",
              userId: "@alerts:example.org",
              accessToken: "alerts-token",
            },
          },
        },
      },
    };

    expect(
      Array.from(resolveConfiguredMatrixBotUserIds({ cfg, accountId: "ops" })).toSorted(),
    ).toEqual(["@alerts:example.org", "@main:example.org"]);
  });

  it("honors injected env when detecting configured bot accounts", () => {
    const env = {
      MATRIX_HOMESERVER: "https://matrix.example.org",
      MATRIX_USER_ID: "@main:example.org",
      MATRIX_ACCESS_TOKEN: "main-token",
      MATRIX_ALERTS_HOMESERVER: "https://matrix.example.org",
      MATRIX_ALERTS_USER_ID: "@alerts:example.org",
      MATRIX_ALERTS_ACCESS_TOKEN: "alerts-token",
    } as NodeJS.ProcessEnv;

    const cfg: CoreConfig = {
      channels: {
        matrix: {},
      },
    };

    expect(
      Array.from(resolveConfiguredMatrixBotUserIds({ cfg, accountId: "ops", env })).toSorted(),
    ).toEqual(["@alerts:example.org", "@main:example.org"]);
  });

  it("falls back to stored credentials when an access-token-only account omits userId", () => {
    loadMatrixCredentialsMock.mockImplementation(
      (env?: NodeJS.ProcessEnv, accountId?: string | null) =>
        accountId === "ops"
          ? {
              homeserver: "https://matrix.example.org",
              userId: "@ops:example.org",
              accessToken: "ops-token",
              createdAt: "2026-03-19T00:00:00.000Z",
            }
          : null,
    );

    const cfg: CoreConfig = {
      channels: {
        matrix: {
          userId: "@main:example.org",
          homeserver: "https://matrix.example.org",
          accessToken: "main-token",
          accounts: {
            ops: {
              homeserver: "https://matrix.example.org",
              accessToken: "ops-token",
            },
          },
        },
      },
    };

    expect(Array.from(resolveConfiguredMatrixBotUserIds({ cfg, accountId: "default" }))).toEqual([
      "@ops:example.org",
    ]);
  });

  it("preserves shared nested dm and actions config when an account overrides one field", () => {
    const account = resolveMatrixAccount({
      cfg: {
        channels: {
          matrix: {
            homeserver: "https://matrix.example.org",
            accessToken: "main-token",
            dm: {
              enabled: true,
              policy: "pairing",
            },
            actions: {
              reactions: true,
              messages: true,
            },
            accounts: {
              ops: {
                accessToken: "ops-token",
                dm: {
                  allowFrom: ["@ops:example.org"],
                },
                actions: {
                  messages: false,
                },
              },
            },
          },
        },
      },
      accountId: "ops",
    });

    expect(account.config.dm).toEqual({
      enabled: true,
      policy: "pairing",
      allowFrom: ["@ops:example.org"],
    });
    expect(account.config.actions).toEqual({
      reactions: true,
      messages: false,
    });
  });

  it("inherits only Matrix policy defaults into named accounts and honors explicit empty overrides", () => {
    const cfg: CoreConfig = {
      channels: {
        matrix: {
          name: "Shared Matrix",
          enabled: true,
          homeserver: "https://root.example.org",
          accessToken: "root-token",
          dm: {
            policy: "pairing",
            allowFrom: ["@root-owner:example.org"],
          },
          groupPolicy: "allowlist",
          groupAllowFrom: ["@root-room-owner:example.org"],
          groups: {
            "!ops-root-room:example.org": {
              account: "ops",
              requireMention: true,
            },
            "!default-root-room:example.org": {
              account: "default",
              enabled: true,
            },
            "!shared-root-room:example.org": {
              enabled: true,
            },
          },
          rooms: {
            "!ops-root-legacy-room:example.org": {
              account: "ops",
              skills: ["root-skill"],
            },
          },
          accounts: {
            default: {
              name: "Default Identity",
              enabled: false,
              homeserver: "https://default.example.org",
              userId: "@default:example.org",
              accessToken: "default-token",
              password: "default-password",
              deviceId: "DEFAULTDEVICE",
              deviceName: "Default Device",
              avatarUrl: "mxc://example.org/default-avatar",
              initialSyncLimit: 1,
              dm: {
                enabled: false,
                policy: "disabled",
                allowFrom: ["@default-owner:example.org"],
              },
              groupPolicy: "disabled",
              groupAllowFrom: ["@default-room-owner:example.org"],
              groups: {
                "!ops-root-room:example.org": {
                  autoReply: true,
                },
                "!default-policy-room:example.org": {
                  requireMention: true,
                  tools: { allow: ["read"] },
                },
              },
              rooms: {
                "!default-policy-legacy-room:example.org": {
                  skills: ["default-skill"],
                },
              },
            },
            ops: {
              accessToken: "ops-token",
              dm: {
                threadReplies: "always",
              },
              groups: {
                "!default-policy-room:example.org": {
                  systemPrompt: "Ops room",
                },
              },
              rooms: {
                "!ops-policy-legacy-room:example.org": {
                  enabled: true,
                },
              },
            },
            muted: {
              accessToken: "muted-token",
              dm: { allowFrom: [] },
              groupAllowFrom: [],
              groups: {},
              rooms: {},
            },
          },
        },
      },
    };

    const account = resolveMatrixAccount({ cfg, accountId: "ops" });

    expect(account.config.dm).toEqual({
      policy: "pairing",
      allowFrom: ["@default-owner:example.org"],
      threadReplies: "always",
    });
    expect(account.config.groupPolicy).toBe("allowlist");
    expect(account.config.groupAllowFrom).toEqual(["@default-room-owner:example.org"]);
    expect(account.config.groups).toEqual({
      "!ops-root-room:example.org": {
        account: "ops",
        requireMention: true,
        autoReply: true,
      },
      "!shared-root-room:example.org": {
        enabled: true,
      },
      "!default-policy-room:example.org": {
        requireMention: true,
        tools: { allow: ["read"] },
        systemPrompt: "Ops room",
      },
    });
    expect(account.config.rooms).toEqual({
      "!ops-root-legacy-room:example.org": {
        account: "ops",
        skills: ["root-skill"],
      },
      "!default-policy-legacy-room:example.org": {
        skills: ["default-skill"],
      },
      "!ops-policy-legacy-room:example.org": {
        enabled: true,
      },
    });
    expect(resolveMatrixAccountAllowlistConfig({ cfg, accountId: "ops" })).toEqual({
      dmAllowFrom: ["@default-owner:example.org"],
      groupAllowFrom: ["@default-room-owner:example.org"],
    });

    expect(account).toMatchObject({
      accountId: "ops",
      name: "Shared Matrix",
      enabled: true,
      configured: true,
      homeserver: "https://root.example.org",
      userId: undefined,
    });
    expect(account.config).toMatchObject({
      accessToken: "ops-token",
    });
    expect(account.config.userId).toBeUndefined();
    expect(account.config.password).toBeUndefined();
    expect(account.config.deviceId).toBeUndefined();
    expect(account.config.deviceName).toBeUndefined();
    expect(account.config.avatarUrl).toBeUndefined();
    expect(account.config.initialSyncLimit).toBeUndefined();

    const muted = resolveMatrixAccount({ cfg, accountId: "muted" });
    expect(muted.config.dm?.allowFrom).toEqual([]);
    expect(muted.config.groupAllowFrom).toEqual([]);
    expect(muted.config.groups).toBeUndefined();
    expect(muted.config.rooms).toBeUndefined();
    expect(resolveMatrixAccountAllowlistConfig({ cfg, accountId: "muted" })).toEqual({
      dmAllowFrom: [],
      groupAllowFrom: [],
    });
  });

  it.each([
    {
      name: "filters channel-level groups by room account in multi-account setups",
      scopeKey: "groups",
      createConfig: createMatrixScopedEntriesConfig,
      expectEntries: expectMultiAccountMatrixScopedEntries,
    },
    {
      name: "filters channel-level groups when the default account is configured at the top level",
      scopeKey: "groups",
      createConfig: createMatrixTopLevelDefaultScopedEntriesConfig,
      expectEntries: expectTopLevelDefaultMatrixScopedEntries,
    },
    {
      name: "filters legacy channel-level rooms by room account in multi-account setups",
      scopeKey: "rooms",
      createConfig: createMatrixScopedEntriesConfig,
      expectEntries: expectMultiAccountMatrixScopedEntries,
    },
    {
      name: "filters legacy channel-level rooms when the default account is configured at the top level",
      scopeKey: "rooms",
      createConfig: createMatrixTopLevelDefaultScopedEntriesConfig,
      expectEntries: expectTopLevelDefaultMatrixScopedEntries,
    },
  ] as const)("$name", ({ scopeKey, createConfig, expectEntries }) => {
    expectEntries(createConfig(scopeKey), scopeKey);
  });

  it("honors injected env when scoping room entries in multi-account setups", () => {
    const env = {
      MATRIX_HOMESERVER: "https://matrix.example.org",
      MATRIX_ACCESS_TOKEN: "default-token",
      MATRIX_OPS_HOMESERVER: "https://matrix.example.org",
      MATRIX_OPS_ACCESS_TOKEN: "ops-token",
    } as NodeJS.ProcessEnv;

    const cfg = {
      channels: {
        matrix: {
          groups: {
            "!default-room:example.org": {
              enabled: true,
              account: "default",
            },
            "!ops-room:example.org": {
              enabled: true,
              account: "ops",
            },
            "!shared-room:example.org": {
              enabled: true,
            },
          },
        },
      },
    } as unknown as CoreConfig;

    expect(resolveMatrixAccount({ cfg, accountId: "ops", env }).config.groups).toEqual({
      "!ops-room:example.org": {
        enabled: true,
        account: "ops",
      },
      "!shared-room:example.org": {
        enabled: true,
      },
    });
  });

  it.each([
    {
      name: "keeps scoped groups bound to their account even when only one account is active",
      scopeKey: "groups",
    },
    {
      name: "keeps scoped legacy rooms bound to their account even when only one account is active",
      scopeKey: "rooms",
    },
  ] as const)("$name", ({ scopeKey }) => {
    const cfg = {
      channels: {
        matrix: {
          [scopeKey]: {
            "!default-room:example.org": {
              enabled: true,
              account: "default",
            },
            "!shared-room:example.org": {
              enabled: true,
            },
          },
          accounts: {
            ops: {
              homeserver: "https://matrix.example.org",
              accessToken: "ops-token",
            },
          },
        },
      },
    } as unknown as CoreConfig;

    expect(resolveMatrixAccount({ cfg, accountId: "ops" }).config[scopeKey]).toEqual({
      "!shared-room:example.org": {
        enabled: true,
      },
    });
  });

  it.each([
    {
      name: "lets an account clear inherited groups with an explicit empty map",
      scopeKey: "groups",
    },
    {
      name: "lets an account clear inherited legacy rooms with an explicit empty map",
      scopeKey: "rooms",
    },
  ] as const)("$name", ({ scopeKey }) => {
    const cfg = {
      channels: {
        matrix: {
          [scopeKey]: {
            "!shared-room:example.org": {
              enabled: true,
            },
          },
          accounts: {
            ops: {
              homeserver: "https://matrix.example.org",
              accessToken: "ops-token",
              [scopeKey]: {},
            },
          },
        },
      },
    } as unknown as CoreConfig;

    expect(resolveMatrixAccount({ cfg, accountId: "ops" }).config[scopeKey]).toBeUndefined();
  });
});
