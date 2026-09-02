# Cloud-build legacy backend retirement

Retirement is separate from cutover. A successful switch does not authorize removal of legacy routes, pull commands, data, rollback state, or configuration.

## Observation gate

Keep the legacy remote backend available throughout the approved observation window. Retirement may begin only when all of the following remain true for that window:

- local backend mode and post-switch health are stable;
- no legacy-created job remains active;
- no local job is waiting for a legacy callback or artifact;
- queue latency, failure rate, callback failures, artifact integrity, downloads, and quota totals meet the release thresholds;
- repeated ledger reconcile reports have `hard_diffs=[]`;
- Windows and macOS controlled builds have completed end to end;
- rollback has been rehearsed and the recorded cursor is retained;
- support and operations owners approve retirement.

## Retirement sequence

1. Freeze changes to both backend implementations during the retirement window.
2. Export a final redacted ledger and verify both hashes.
3. Reconcile the final ledger and archive only the approved audit report and canonical digests.
4. Confirm the runtime selector resolves to `local` and no deployment explicitly locks an unintended backend.
5. Disable legacy outbound credentials in the deployment secret store without copying their values into logs or tickets.
6. Monitor for unexpected legacy requests before deleting any integration configuration.
7. Remove legacy scheduling or routes only in a separately reviewed release with compatibility tests updated intentionally.
8. Retain database rows according to the product retention policy; do not drop legacy tables as part of credential retirement.
9. Remove temporary redacted migration ledgers after the audit retention period.

## Abort conditions

Abort retirement if any legacy job is still active, reconcile has a hard difference, an unknown callback arrives, frontend status differs between backends, quota totals diverge, a required artifact cannot be verified, or the rollback owner has not signed off.

## Evidence to retain

Retain release identifiers, timestamps, operator approvals, canonical and payload digests, cursor bounds, reconcile reports, aggregate metrics, and the list of disabled configuration keys. Do not retain secret values, callback tokens, personal data, artifact URLs, or absolute storage paths.
