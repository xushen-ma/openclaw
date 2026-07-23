# OpenClaw v2026.7.1-2 Remaining Delta Decision Packet

- Date: 2026-07-24
- Branch: `mini/upgrade-v2026.7.1-fork-integration`
- Current candidate head at packet update: `e757e1b9150`
- Base: `upstream/release/2026.7.1` / `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`
- Tag anchor: `v2026.7.1` / `2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4`

## Current Safe-Replay State

- Retargeted from the plain `v2026.7.1` tag to Nina's proven `2026.7.1-2` source commit.
- Safe fork deltas are replayed:
  - Matrix named-account allowlist/room-map inheritance from `accounts.default`;
  - Matrix main-DM last-route guard;
  - `TEAM.md` workspace bootstrap recognition/order;
  - exact fork tag build-info preference;
  - Matrix SDK dependency guard before startup monitor import.
- Focused proof under isolated `node@25.9.0` passes: 5 Vitest shards, 13 files, 385 tests.
- Quick Memory approved local-plugin replay is implemented and hermetically validated after
  the tool-plugin authoring metadata fix.

## Decisions

| Delta                                    | Classification                  | Recommendation                                                                                                                                 | Next artifact and required evidence                                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nina `2026.7.1-2` package source mapping | Proven for current Nina package | Keep the candidate based on `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`; re-check if Nina upgrades again before promotion.                      | Promotion packet must include Nina package `dist/build-info.json` evidence and the `git branch --contains` proof for `upstream/release/2026.7.1`.                                                                               |
| Quick Memory Search                      | Approved: keep as plugin        | Keep the fleet fast OpenViking/session shortcut as an external/pinned local plugin, not core fork code.                                        | Plugin BOM + 7.1 plugin implementation/design; tests for plugin registration, `quick_memory_search`, `quick_session_search`, per-agent routing/access boundaries, status, sidecar common behavior, and two-agent staging smoke. |
| ZenMux image provider                    | Approved: drop                  | Do not replay ZenMux into this upgrade. Rely on upstream 7.1 official image providers unless a future explicit requirement appears.            | No code artifact. Ensure old ZenMux bundled files/dependencies are absent from the candidate and no model/image route depends on `zenmux`.                                                                                      |
| `tools.fs.extraRoots`                    | Approved: keep disabled         | Do not replay `tools.fs.extraRoots`. Keep the narrower 7.1 filesystem boundary.                                                                | No code artifact. Confirm candidate has no `extraRoots` schema/runtime expansion and staging config does not rely on it.                                                                                                        |
| Matrix SDK install guard                 | Implemented safe replay         | Replayed as a startup preflight before Matrix monitor runtime import so missing deps fail with repair guidance instead of import-time failure. | Commit `05c2e4678c6`; tests: `channel.startup.test.ts`, `matrix/deps.test.ts`, `onboarding.test.ts`, `doctor-contract-api.test.ts`, and full Phase 2 focused suite under isolated `node@25.9.0`.                                |

## Recommended Next Sequence

1. Fix or bypass the `ai.openclaw.staging` LaunchAgent health path so the governed staging `/health` check passes on `:18820`.
2. Rerun governed sanity after the LaunchAgent fix and require a clean staging health result.
3. Prepare the PR/promotion packet only after staging health, plugin inventory, Matrix, Discord, model-route, and Quick Memory smokes are all clean.
4. Keep production blocked pending explicit Mini/Xushen approval.

## Non-Actions

- No PR, merge, staging approval, production promotion, production deploy, or production state restore has been performed.
- Candidate `e757e1b9150` has been pushed and deployed through the governed test lane; the test-lane lock was released.
- Staging runtime config was intentionally remediated after Xushen's decisions. Backups were retained beside `openclaw.staging.json`.

## Live-State Validation Incident

During Quick Memory plugin validation, an OpenClaw plugin validation command was
mistakenly run without an isolated `OPENCLAW_HOME`/state root. It failed before
installing the plugin, but it did run migration/update-check startup paths
against the live OpenClaw home.

Observed live-state touch evidence on 2026-07-24:

- `~/.openclaw/state/openclaw.sqlite` and WAL were modified.
- Per-agent `agent/codex-home/{goals_1,logs_2,state_5}.sqlite` files were modified for fleet agents.
- Several session `*.codex-app-server.json.migrated` marker files were created or touched.

Required gate before any push, PR, governed test lane, staging, or production:

- live-state restore is not recommended based on Janko review; treat the
  startup migration/cache/index side effects as accepted forward state unless
  later health checks show damage;
- inspect live gateway health and current route matrix before staging;
- run future plugin validation only with an isolated OpenClaw home/state root.

Follow-up evidence:

- Janko gave conditional go to continue candidate work without restoring live
  state after read-only checks found no gateway config, secret, plugin install,
  staging, or production mutation.
- Isolated Quick Memory plugin validation passed with explicit isolated
  `OPENCLAW_HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`, `HOME`,
  `XDG_CACHE_HOME`, and `TMPDIR`; live `~/.openclaw/state` and
  `~/.openclaw/plugins` fingerprints were unchanged before/after validation.
- Live route-matrix check after the incident found the Mac default interactive
  route on `openai/gpt-5.5`, but `agents.defaults.heartbeat.model` and
  `agents.defaults.subagents.model` still configured as `openai/gpt-5.6`.
  Xushen approved reverting GPT-5.6 everywhere; Mini applied the protected-route
  remediation with a timestamped config backup and managed gateway restart.
  Verified after restart: current session, `agents.defaults.model`,
  `agents.defaults.heartbeat.model`, and `agents.defaults.subagents.model` are
  all `openai/gpt-5.5` with no default fallbacks.
- Pre-test-lane live snapshot recorded 2026-07-24 08:00:54 AEST:
  config SHA-256 `9d1fb9b570a8e3f1e7a7cd3e781c5bb60a62b0a2727498a5a85379649db55c2c`;
  state/plugins fingerprint
  `5c7986d827c376dfbc0a8993aad69a917e72bdf9d7d875f169f87d3213c4a4e6`;
  route matrix default/heartbeat/subagents all `openai/gpt-5.5`.
- Route matrix re-verified after the gateway restart on 2026-07-24 08:31 AEST:
  `agents.defaults.model.primary = openai/gpt-5.5` with empty fallbacks,
  `agents.defaults.heartbeat.model = openai/gpt-5.5`,
  `agents.defaults.subagents.model = openai/gpt-5.5`, and the current session
  status reports `openai/gpt-5.5`. GPT-5.6 remains present only as configured
  catalog/model aliases in live config, not as an active default route.

## Staging Evidence After Runtime Config Remediation

- Staging config now has no `zenmux`, `gpt-5.6`, or `tools.fs.extraRoots`
  references. Removed stale ZenMux auth/profile/model/plugin/skill entries and
  left Quick Memory as an explicit local plugin.
- Quick Memory staging plugin pin:
  `plugins.load.paths = ["/Volumes/ExtData/openclaw-lanes/openclaw-staging/local-plugins/quick-memory-search"]`.
  Migrated plugin config from old `ovBaseUrl` to `legacyOvBaseUrl`.
- Direct staging startup with isolated `node@25.9.0` and the exact staging
  config reaches `{"ok":true,"status":"live"}` on a spare port, starts Discord
  and Matrix, and logs `quick-memory-search registered perAgent=configured
legacy=configured sessionFallback=disabled`.
- Cold plugin inventory with the staging config reports Quick Memory loaded
  from `local-plugins/quick-memory-search/src/index.ts`, origin `config`,
  version `2026.7.1-2-local.0`.
- Remaining stop condition: the real `ai.openclaw.staging` LaunchAgent still
  does not bind `:18820`. Its Node child starts and stays alive, but samples show
  it stuck in Node package/module bootstrap opening parent `package.json` before
  the staged app reads or emits logs. Direct shell startup with a minimized
  LaunchAgent-like environment succeeds, so the blocker is specific to launchd
  execution. The stuck LaunchAgent was stopped and the plist was restored to its
  wrapper form after a direct-node experiment did not fix the hang.
