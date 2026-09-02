# Cloud-build cutover

This is an operator-controlled cutover. Commands do not fetch or print secret values. Keep `CLOUDBUILD_BACKEND=auto`; an explicit `local` or `remote` value is an operations lock and blocks runtime switching.

## Preconditions

- Ledger import and reconcile are complete with no hard differences.
- The callback endpoint, packaging repository, download signing, and mirror worker are configured through the deployment secret store.
- Cloud-build tests and database migrations pass on the release candidate.
- Dashboards expose queue depth, active phases, dispatch failures, callback failures, artifact fetch failures, and quota counts.
- Rollback ownership and the observation window are assigned in the change ticket.

## Cutover sequence

1. Freeze new requests:

```bash
php artisan cloud-build:cutover freeze
```

2. Pause dispatch and mirror workers:

```bash
php artisan cloud-build:cutover pause-workers
```

3. Drain active `queued`, `building`, and `artifact_pending` jobs:

```bash
php artisan cloud-build:cutover drain --timeout=900 --poll=5
```

Do not switch if the result contains any in-flight build ID.

4. Export and import the final incremental ledger, then reconcile it with the procedure in `runbook-export-import.md`.

5. Record the final source cursor and snapshot bound:

```bash
CLOUD_BUILD_LAST_ID='replace-with-final-build-id'
CLOUD_BUILD_SNAPSHOT_BOUND='replace-with-snapshot-bound'
php artisan cloud-build:cutover record-cursor --after-build-id="$CLOUD_BUILD_LAST_ID" --until="$CLOUD_BUILD_SNAPSHOT_BOUND"
```

6. Run the pre-switch gate:

```bash
php artisan cloud-build:cutover health --for=pre-switch
```

Proceed only on `CLOUD_BUILD_CUTOVER_OK` with no stop conditions.

7. Switch to the local backend, resume workers, and run the post-switch gate:

```bash
php artisan cloud-build:cutover switch-backend --backend=local
php artisan cloud-build:cutover resume-workers
php artisan cloud-build:cutover health --for=post-switch
```

8. Submit one controlled Windows job and one controlled macOS job. Verify queue, callback, artifact fetch, signed download, frontend status projection, and quota increments before unfreezing:

```bash
php artisan cloud-build:cutover unfreeze
```

## Hard stops

Stop or roll back for any reconcile hard difference, non-empty in-flight set at switch time, missing required configuration flag, backend mode mismatch, callback authentication failure, terminal-state resurrection, artifact hash mismatch, sustained queue growth, or quota divergence.

## Rollback

Rollback keeps new local requests frozen, restores the remote backend, and reports local in-flight jobs without rewriting callback ownership:

```bash
php artisan cloud-build:cutover rollback
php artisan cloud-build:cutover health --for=post-rollback
```

Do not rebind callbacks or silently move in-flight jobs. Finish or explicitly cancel each reported local job, reconcile the final ledger, and only then decide whether to unfreeze the remote path. Preserve the state report and metrics; never preserve or print credential values.
