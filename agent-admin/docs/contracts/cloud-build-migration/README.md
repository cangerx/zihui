# Cloud-build migration contract baseline

## Provenance

The original cloud-build fixture was never committed to this repository and could not be recovered from repository history or the delivered source archive. This directory therefore contains a newly rebuilt deterministic, redacted contract baseline. It is not a recovery of historical production data and must not be treated as evidence of historical job values.

The baseline has six synthetic jobs with stable IDs. Together they cover `queued`, `building`, `artifact_pending`, `ready`, `delivered`, and `failed`; both `client-a` and `client-b`; quota totals `3/2`; and exactly two terminal jobs. All names, IDs, artifact hashes, sizes, and executor run IDs are test-only values.

## Files

- `fixture.json`: source-shaped rows and their target canonical projection.
- `frontend-api.fixture.json`: response keys and phase-to-status projection required by the existing frontend.
- `runbook-export-import.md`: deterministic export, integrity verification, cursor resume, import, and reconcile procedure.
- `runbook-cutover.md`: freeze, drain, incremental catch-up, switch, health, and rollback procedure.
- `runbook-retire.md`: observation and retirement gates for the legacy backend.

## Canonical hash

`CloudBuildLedgerCanonical` is the authoritative implementation. It normalizes only stable business fields, sorts artifacts and jobs, and excludes URLs, paths, secrets, timestamps, and database IDs. The rebuilt fixture canonical SHA-256 is `f33b7624fe8ddb0aa7408e2897b063e087a459ff7d48a1a332bab0b769f3ca44`; it is recorded in `fixture.json` and `CloudBuildLedgerMigrationTest`.

Recompute and compare both source and target from `agent-admin/backend`:

```bash
php -r 'require "vendor/autoload.php"; $f=json_decode(file_get_contents("../docs/contracts/cloud-build-migration/fixture.json"), true, 512, JSON_THROW_ON_ERROR); $s=App\Services\CloudBuild\CloudBuildLedgerCanonical::digest($f["source"], true); $t=App\Services\CloudBuild\CloudBuildLedgerCanonical::digest($f["target"], false); fwrite(STDOUT, "source=$s\ntarget=$t\n"); exit(hash_equals($s, $t) && hash_equals($s, $f["canonical_sha256"]) ? 0 : 1);'
```

Run the complete contract tests:

```bash
php artisan test --without-tty --filter=CloudBuild
```

Any intended fixture change requires a new computed hash, an explicit test update, a security scan, and independent review. Never weaken the digest, redaction, terminal-state, cursor, or reconcile assertions to accept a changed fixture.

## Security constraints

- Do not add callback tokens, access tokens, private keys, object-storage credentials, personal data, live hostnames, absolute paths, or downloadable URLs.
- Use reserved test identities and `.example.test` hostnames only in generated ledger validation.
- Exported ledgers must pass `CloudBuildLedgerFile::assertIntact` before import.
- Migration files are data-transfer artifacts, not application configuration and not credential transport.
