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

- `releasectl promote-production --sha <branch|sha|ref> [--allow-untagged]`
  - First-class production-lineage promotion step.
- `releasectl sanity-check [--sha <sha>] [--skip-smoke]`
  - Run the governed pre-deploy sanity check flow (`scripts/fleet/internal/sanity-check.sh`).
  - `--sha` pins candidate validation to a specific commit.
  - `--skip-smoke` skips the staging smoke sub-check.
  - Verifies the candidate is on `origin/main` lineage and (by default) that the candidate commit itself has a validated `v*-x.*` tag.
  - Creates/pushes a non-fast-forward merge commit onto `origin/production`.
  - Prints the resulting production-lineage commit SHA and the exact deploy follow-up command.
- `releasectl deploy [args...]`
  - Run governed production deploy flow.
  - This is the **production tag+deploy** step: it creates/pushes the next fork release tag and deploys production.
  - It only accepts candidates that are already on the allowed **production lineage**.
  - Local sanity state is still enforced for normal local runs; stale sanity is bypassed when the candidate already has a validated `v*-x.*` tag and is already on production lineage.
- `releasectl rollback [args...]`
  - Run governed rollback flow.

### Maintenance

- `releasectl repair-perms [--repo <path>] [--dry-run]`
  - Normalize file mode drift in governed repos.
- `releasectl bundle-sync [--check|--sync]`
  - Front-door command for installed governed bundle drift detection (`--check`) and reconciliation (`--sync`).
- `releasectl verify-config`
  - Print effective governed paths and detect legacy `TEST_REPO`/`openclaw-test` config drift.

## Canonical release-gate model

Required release control now lives in the local governed lane, not GitHub PR status checks.

### Required gates (canonical)

1. Governed local validation via `releasectl test-deploy --sha <candidate>` (plus local sanity verification).
2. `validation.yml` on `main` creates the validated `v*-x.*` artifact tag after sanity passes.
3. `staging-deploy.yml` consumes that validated tag and deploys staging.
4. Promote the validated artifact onto production lineage via `releasectl promote-production --sha <validated-tag-or-sha>`.
5. Execute production tag+deploy via `releasectl deploy --sha <production-lineage-commit>` (or rollback via `releasectl rollback ...`).

### GitHub checks (supporting hygiene / automation)

- **Still expected for automation glue**
  - `.github/workflows/validation.yml` (validation branch + validated tag)
  - `.github/workflows/staging-deploy.yml` (tag-triggered staging deploy)
- **Optional/non-gating for release control**
  - `.github/workflows/ci.yml` PR checks are intentionally lightweight; slow multi-platform test lanes run on `main` push.
  - `.github/workflows/install-smoke.yml` runs on `main`/manual only.
  - `.github/workflows/sandbox-common-smoke.yml` runs on `main` only.
  - `workflow-sanity.yml`, `codeql.yml`, `labeler.yml`, `auto-response.yml`, `stale.yml`, `docker-release.yml` are repo hygiene/ops workflows, not release gates.

### Workflow inventory and classification

- **Canonical release-gate path:**
  - `validation.yml` → required for validated tag creation.
  - `staging-deploy.yml` → required to turn validated tags into staging artifacts.
  - Local governed `releasectl` steps (outside GitHub Actions) remain the required gate for test/prod promotion.
- **PR hygiene (non-blocking for release control):**
  - `ci.yml` (now lightweight on PR; heavy jobs on `main` only)
  - `workflow-sanity.yml`
- **Mainline confidence / packaging hygiene (non-gating):**
  - `install-smoke.yml`
  - `sandbox-common-smoke.yml`
  - `docker-release.yml`
- **Repo maintenance / triage automation:**
  - `labeler.yml`, `auto-response.yml`, `stale.yml`
- **Security analysis (manual/scheduled, non-gating for release path):**
  - `codeql.yml`

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
  5. promote validated artifact to production lineage via `releasectl promote-production --sha <validated-tag-or-sha>`
  6. deploy via `releasectl deploy --sha <resulting-production-lineage-sha>`
- Important: a merged `main` SHA is **not automatically** a production deploy candidate. If `releasectl deploy --sha ...` refuses ancestry, the next governed step is to run `releasectl promote-production --sha <validated-tag-or-sha>` first.
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
