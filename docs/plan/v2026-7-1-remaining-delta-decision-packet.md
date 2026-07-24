# OpenClaw v2026.7.1-2 Remaining Delta Decision Packet

- Date: 2026-07-24
- Branch: `mini/upgrade-v2026.7.1-fork-integration`
- Current candidate head before dependency-audit remediation: `eb3e7466b577`
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

| Delta                                    | Classification                  | Recommendation                                                                                                                                               | Next artifact and required evidence                                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nina `2026.7.1-2` package source mapping | Proven for current Nina package | Keep the candidate based on `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`; re-check if Nina upgrades again before promotion.                                    | Promotion packet must include Nina package `dist/build-info.json` evidence and the `git branch --contains` proof for `upstream/release/2026.7.1`.                                                                               |
| Quick Memory Search                      | Approved: keep as plugin        | Keep the fleet fast OpenViking/session shortcut as an external/pinned local plugin, not core fork code.                                                      | Plugin BOM + 7.1 plugin implementation/design; tests for plugin registration, `quick_memory_search`, `quick_session_search`, per-agent routing/access boundaries, status, sidecar common behavior, and two-agent staging smoke. |
| ZenMux image provider                    | Approved: drop                  | Do not replay ZenMux into this upgrade. Rely on upstream 7.1 official image providers unless a future explicit requirement appears.                          | No code artifact. Ensure old ZenMux bundled files/dependencies are absent from the candidate and no model/image route depends on `zenmux`.                                                                                      |
| `tools.fs.extraRoots`                    | Approved: restore               | Replay explicit extra-root support for workspace-only tools so Uri and Cici can access the Backtrader root. Keep default disabled unless config names roots. | Schema/runtime patch plus focused tests covering read-only roots as readable but not writable/editable/patchable, and read-write roots as writable.                                                                             |
| Matrix SDK install guard                 | Implemented safe replay         | Replayed as a startup preflight before Matrix monitor runtime import so missing deps fail with repair guidance instead of import-time failure.               | Commit `05c2e4678c6`; tests: `channel.startup.test.ts`, `matrix/deps.test.ts`, `onboarding.test.ts`, `doctor-contract-api.test.ts`, and full Phase 2 focused suite under isolated `node@25.9.0`.                                |

## Recommended Next Sequence

1. Open the PR for `mini/upgrade-v2026.7.1-fork-integration` after preserving the staging remediation evidence below.
2. After merge to `origin/main`, rerun governed sanity on the merged main SHA; the remaining lineage failure must clear there.
3. Prepare the promotion packet only after merged-main sanity, plugin inventory, Matrix, Discord, model-route, and Quick Memory smokes are all clean.
4. Keep production blocked pending explicit Mini/Xushen approval.

## Non-Actions

- No merge, staging approval, production promotion, production deploy, or production state restore has been performed.
- Candidate branch has an open PR (`xushen-ma/openclaw#137`). Candidate
  `e757e1b9150` was pushed and deployed through the governed test lane; the
  test-lane lock was released.
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

- Staging config has no `zenmux` or `gpt-5.6` references. Removed stale ZenMux
  auth/profile/model/plugin/skill entries and left Quick Memory as an explicit
  local plugin. `tools.fs.extraRoots` was initially removed, then restored by
  updated Xushen decision for Uri/Cici Backtrader access.
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
- LaunchAgent root cause isolated on 2026-07-24: launchd-spawned Node can read
  ordinary `/Users/openclaw` files, but hangs opening files or scanning
  directories under `/Users/openclaw/workspace/openclaw-staging`, whose realpath
  is `/Volumes/ExtData/openclaw-lanes/openclaw-staging`. Shell-launched Node
  succeeds against the same paths, so this is a launchd/macOS protected-volume
  access boundary, not an OpenClaw candidate startup failure.
- Updated `tools.fs.extraRoots` remediation on 2026-07-24 after Xushen clarified
  that Uri and Cici require Backtrader access. Candidate `306ae73206e8`
  restores `extraRoots` schema/runtime support and staging config now gives
  `uri` and `cici` the read-only root
  `/Users/openclaw/workspace/backtrader`. Backups:
  `openclaw.staging.json.bak.extraRoots-uri-cici-20260724-204612` in both the
  ExtData staging runtime and the internal launchd runtime mirror.
- Staging launchd mirror was synced to candidate `306ae73206e8`; after restart,
  `/health` returned `{"ok":true,"status":"live"}` on `:18820`. Manual staging
  build under isolated `node@25.9.0` passed. Governed sanity reached 5 passed /
  2 failed: feature tests, staging boot, staging smoke, patch presence, and tag
  format passed; lineage remains the expected pre-merge failure; governed build
  failed only because the governed helper build environment still invoked
  unsupported Homebrew Node `25.6.0`.
- Staging remediation for the gate:
  - mirrored staged code to
    `/Users/openclaw/.openclaw/tmp/openclaw-staging-launchd-run`;
  - mirrored staging runtime config/state to
    `/Users/openclaw/.openclaw/tmp/openclaw-staging-runtime-launchd`;
  - changed the staging LaunchAgent working directory to `/Users/openclaw`;
  - pointed `OPENCLAW_CONFIG_PATH` and `OPENCLAW_STATE_DIR` at the internal
    runtime mirror;
  - updated the staging wrapper to execute the internal code mirror with
    isolated `node@25.9.0`.
- LaunchAgent health proof after remediation:
  `curl http://127.0.0.1:18820/health` returned
  `{"ok":true,"status":"live"}` after 5 seconds.
- Governed sanity against `86e073678770` at 2026-07-24 09:08 AEST:
  6 passed / 1 failed. Passed: build, focused tests, LaunchAgent staging boot
  with pid `34272`, staging `/health` smoke, patch presence, and tag format.
  The only failure was `candidate is not an ancestor of refs/remotes/origin/main`,
  which is expected before the PR is merged.
- Governed sanity build helper remediation on 2026-07-24 21:40 AEST:
  Mini fixed the release-helper source in `xushen-ma/openclaw-fleet-mgmt#81`
  so `internal/sanity-check.sh` selects a compatible Node runtime before
  `pnpm install` / `pnpm build`. The PR was merged to fleet-management `main`
  as `d0b38d3`, then installed via approval-gated `releasectl bundle-sync
--sync`; bundle-sync reported only `internal/sanity-check.sh` changed and
  zero residual drift. Installed `releasectl sanity-check --sha
d8605eeec360b4f88062aa5cb1be4f2b5ccbf5cb` now selects isolated
  `node@25.9.0` and passes build, focused tests, LaunchAgent staging boot,
  staging `/health` smoke, patch presence, and tag format. The only remaining
  sanity failure is the expected pre-merge lineage check:
  `candidate is not an ancestor of refs/remotes/origin/main`.
- PR mergeability remediation on 2026-07-24 21:55-22:04 AEST:
  Mini replayed fork-main Backtrader readiness commits on top of the v2026.7.1
  candidate and recorded `origin/main` as an ours-merge parent, preserving the
  7.1 candidate tree while making PR #137 mergeable. Focused agent-tool tests
  passed under isolated `node@25.9.0` (2 shards, 91 tests).
- CI `security-fast` dependency-audit remediation on 2026-07-24 22:04 AEST:
  local reproduction of `node scripts/pre-commit/pnpm-audit-prod.mjs
--audit-level=high` found production advisories in `@vitest/browser`,
  `@opentelemetry/propagator-jaeger`, `axios`, and `fast-uri`. The candidate
  now raises the affected dependency floors (`vitest` browser stack 4.1.10,
  OpenTelemetry SDK/core family 0.221.0/2.10.0, `axios` 1.18.1, `fast-uri`
  3.1.4). Verification passed: production audit reports no high-or-higher
  advisories, `pnpm why --prod` resolves only the remediated versions, focused
  audit/diagnostics tests passed (2 shards, 127 tests), dependency pin guard
  passed, and `pnpm build` passed under isolated `node@25.9.0`.
- Governed sanity optional-dependency remediation on 2026-07-24 22:21 AEST:
  the first installed sanity run on `7ead657c946` hung after pnpm printed
  `Done`, because optional cross-platform tarball retries kept the pnpm process
  open. A manual rerun with `npm_config_optional=false` reached 6 passed / 1
  failed. Mini then fixed `xushen-ma/openclaw-fleet-mgmt#82`, merged it as
  `12b59ac`, and installed it via approval-gated `releasectl bundle-sync
--sync`; installed/source `internal/sanity-check.sh` SHA-256 now both equal
  `26fc750aa676d9e9596d2152472f36daf9ada251065f02be53fd7583fc29a063`.
  Plain installed `releasectl sanity-check --sha 7ead657c946` now gets past
  install, passes build, focused tests, LaunchAgent staging boot, staging
  `/health`, patch presence, and tag format. The only remaining failure is the
  expected pre-merge lineage check.
