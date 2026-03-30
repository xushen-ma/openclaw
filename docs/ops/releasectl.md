---
summary: "Governed releasectl command surface for test/staging and production"
---

# releasectl command reference

`releasectl` is the governed front door for release operations.

## Intended command surface

### Test / staging lane

- `releasectl test-deploy --sha <branch|sha|ref>`
  - Deploy a specific branch/SHA/ref to the governed **test checkout** on this host.
- `releasectl test-status`
  - Show the test-checkout lock status (`openclaw-test/.test-env.lock` on this host).
- `releasectl test-release [--force]`
  - Release a stale test-checkout lock.
- `releasectl staging-deploy --sha <branch|sha|ref>`
  - Backward-compatible alias of `test-deploy`.

### Production lane

- `releasectl deploy [args...]`
  - Run governed production deploy flow.
  - This is the **production tag+deploy** step: it creates/pushes the next fork release tag and deploys production.
  - It only accepts candidates that are already on the allowed **production lineage**.
- `releasectl rollback [args...]`
  - Run governed rollback flow.

### Maintenance

- `releasectl repair-perms [--repo <path>] [--dry-run]`
  - Normalize file mode drift in governed repos.
- `releasectl bundle-sync [--check|--sync]`
  - Front-door command for installed governed bundle drift detection (`--check`) and reconciliation (`--sync`).
- `releasectl verify-config`
  - Print effective governed paths and detect legacy `TEST_REPO`/`openclaw-test` config drift.

## Notes

- `test-deploy`/`staging-deploy` currently drive the governed **test checkout** flow on this host (`/Users/openclaw/workspace/openclaw-test`), even though the internal helper name remains `staging-deploy.sh`.
- `deploy`/`rollback` call production internal flows.
- Permission normalization runs after deploy/test-deploy/rollback flows.
- Ownership is never changed by `releasectl`.
- The current release chain is split across governed tooling and GitHub workflows:
  1. merge to `main`
  2. `.github/workflows/validation.yml` creates a `validation` branch and runs sanity
  3. on success, `validation.yml` creates/pushes the next validated `v*-x.*` tag
  4. `.github/workflows/staging-deploy.yml` reacts to that tag and deploys staging automatically
  5. production deployment happens later via `releasectl deploy --version <tag>` (or another production-lineage-allowed candidate)
- Important: a merged `main` SHA is **not automatically** a production deploy candidate. If `releasectl deploy --sha ...` refuses ancestry, the next step is usually to check the validation/tag/staging workflow artifact rather than trying to deploy the raw `main` commit.
- If governed bundle files under `/usr/local/lib/openclaw-fleet` drift from `scripts/fleet`, use `releasectl bundle-sync --sync` (or `--check` for read-only verification).
- `bundle-sync` is pinned to the caller's checked-out `scripts/fleet` source when handed off to `oc-release`, so stale config overrides cannot silently re-sync legacy trees.
- If the governed tool/runtime placement itself drifts beyond bundle files, first sync the controlled repo through the canonical `oc-release` fast-forward path before concluding the front door is broken:

```bash
sudo -u oc-release git -C /Users/openclaw/workspace/openclaw-fleet-mgmt checkout main && \
sudo -u oc-release git -C /Users/openclaw/workspace/openclaw-fleet-mgmt pull --ff-only
```

- The controlled-repo front door on this host is:

```bash
/Users/openclaw/workspace/openclaw-fleet-mgmt/bin/releasectl
```

- Do not assume the controlled repo mirrors the dev repo layout exactly; for example, the governed entrypoint here is `bin/releasectl`, not `scripts/fleet/releasectl`.
- Treat `/Users/openclaw/workspace/openclaw-fleet-mgmt` as a governed boundary repo. Prefer `oc-release` for authoritative checks there.
