# Cloud-build ledger export and import

This procedure copies the cloud-build execution ledger without changing traffic. Run every command from `agent-admin/backend`. Use a restricted working directory outside the web root, and supply ledger filenames as relative paths.

## 1. Prepare

1. Confirm the target database has all cloud-build migrations applied.
2. Confirm the target application is still using the current backend; an import must never switch traffic.
3. Create a restricted working directory and record the snapshot time in the change ticket.
4. Do not place credentials, user data, URLs, local storage paths, or callback tokens in ledger files.

## 2. Export

Export the first deterministic batch ordered by `build_id`:

```bash
php artisan cloud-build:export-ledger migration-work/ledger-001.json --limit=500
```

Read `cursor.next_after_build_id` and `cursor.has_more` from the generated file. When `has_more` is true, export the next batch using the exact returned cursor:

```bash
CLOUD_BUILD_NEXT_ID='replace-with-returned-build-id'
php artisan cloud-build:export-ledger migration-work/ledger-002.json --after-build-id="$CLOUD_BUILD_NEXT_ID" --limit=500
```

Never use an offset cursor. Keep every batch immutable after export.

## 3. Verify before transfer

For each batch, load the JSON with `CloudBuildLedgerFile::assertIntact`. Verification must confirm:

- `format` is `cloud-build-ledger-v1`;
- build IDs are unique;
- `manifest.canonical_sha256` matches the canonical jobs;
- `manifest.payload_sha256` matches the redacted payload;
- no credential, personal-data, URL, or absolute-path field is present.

Stop immediately on malformed JSON, duplicate build IDs, either digest mismatch, or any sensitive value.

## 4. Import with resumable cursor

Import the first slice:

```bash
php artisan cloud-build:import-ledger migration-work/ledger-001.json --limit=100
```

Record `next_after_build_id` from the command output. Continue from that exact value until `has_more=false`:

```bash
CLOUD_BUILD_NEXT_ID='replace-with-returned-build-id'
php artisan cloud-build:import-ledger migration-work/ledger-001.json --after-build-id="$CLOUD_BUILD_NEXT_ID" --limit=100
```

The import is idempotent. Re-running a completed batch updates the same jobs and overwrites the same quota rows; it must not create duplicates or double-count quota. A terminal target job must never be overwritten by an active source state.

## 5. Reconcile

After every imported batch and again after the final batch:

```bash
php artisan cloud-build:reconcile-ledger migration-work/ledger-001.json
```

Proceed only when `ok=true`, `hard_diffs=[]`, canonical source and target digests match, terminal counts match, and quota differences are empty. Treat missing or extra build IDs, phase mismatches, terminal resurrection, attempt mismatches, artifact mismatches, digest mismatches, and quota mismatches as hard stops.

## 6. Interrupted import

If an import stops, do not edit the ledger and do not infer the cursor from row count. Re-run reconcile, read the last successfully recorded `build_id` from the operator log, and resume with `--after-build-id`. Re-importing the previous slice is safe when the last cursor is uncertain.

Retain the redacted ledgers only for the approved migration audit window, then delete them under the retention policy after the retirement gates pass.
