---
summary: "Governed releasectl command surface for test/staging and production"
---

# releasectl command reference

`releasectl` is the governed front door for release operations.

## Intended command surface

### Test / staging lane

- `releasectl test-deploy --sha <branch|sha|ref>`
  - Deploy a specific branch/SHA/ref to the governed staging test lane.
- `releasectl test-status`
  - Show staging/test lane lock status.
- `releasectl test-release [--force]`
  - Release a stale staging/test lane lock.
- `releasectl staging-deploy --sha <branch|sha|ref>`
  - Backward-compatible alias of `test-deploy`.

### Production lane

- `releasectl deploy [args...]`
  - Run governed production deploy flow.
- `releasectl rollback [args...]`
  - Run governed rollback flow.

### Maintenance

- `releasectl repair-perms [--repo <path>] [--dry-run]`
  - Normalize file mode drift in governed repos.

## Notes

- `test-deploy`/`staging-deploy` call the internal staging deployment flow.
- `deploy`/`rollback` call production internal flows.
- Permission normalization runs after deploy/test-deploy/rollback flows.
- Ownership is never changed by `releasectl`.
- If the governed tool/runtime placement itself drifts, first sync the controlled repo through the canonical `oc-release` fast-forward path before concluding the front door is broken:

```bash
sudo -u oc-release git -C /Users/openclaw/workspace/openclaw-fleet-mgmt checkout main && \
sudo -u oc-release git -C /Users/openclaw/workspace/openclaw-fleet-mgmt pull --ff-only
```
