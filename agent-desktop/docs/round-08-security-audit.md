# Round 08 desktop production dependency audit

## Scope and command

The authoritative scope is the independent `agent-desktop/package-lock.json` production graph:

```text
npm audit --prefix agent-desktop --omit=dev --registry=https://registry.npmjs.org --json
node scripts/check-security-audit.mjs --ecosystem npm --scope agent-desktop --audit <audit.json>
```

The explicit npm registry is required because the repository mirror does not implement the npm audit endpoint. The policy checker rejects endpoint-error JSON, unknown high/critical advisories, expired exceptions, stale exceptions, duplicate entries and wildcards.

## Compatible remediation

The initial audit reported 13 vulnerable package records: 3 moderate, 10 high and 0 critical. It expanded to 19 unique high/critical advisory records.

Compatible upgrades were applied before creating exceptions:

- `electron-updater` 6.8.3 to 6.8.9, including its fixed `builder-util-runtime` 9.7.0 dependency.
- `js-yaml` 4.1.1 to 4.3.2 within the updater's declared range.
- `postcss` 8.5.12 to 8.5.26 and `nanoid` 3.3.11 to 3.3.18 within existing major-version ranges.

The resulting production audit reports 8 vulnerable package records: 3 moderate, 5 high and 0 critical. The five npm package records expand to 12 unique high advisory records because Electron and other aggregate records each include multiple GHSAs.

## Temporary exceptions

`scripts/security-audit-policy.json` contains exactly 12 entries for scope `agent-desktop`, all owned by the desktop platform owner and expiring on 2026-09-30:

- Seven Electron advisories requiring a maintained Electron major upgrade.
- One `extract-zip` traversal advisory inherited from Electron, with no fixed release in the current dependency line.
- Two `image-size` denial-of-service advisories inherited from `pptxgenjs`; the published line has no unaffected compatible version and npm proposes an incompatible downgrade.
- Two `xlsx` advisories; the npm-published 0.18.5 line has no fixed release.

Each entry names its exact GHSA, affected package, reason and measurable exit criteria. CI regenerates the desktop audit from the independent lock and requires a one-to-one policy match. Exceptions do not lower audit severity and cannot hide new advisories.

## Verification

```text
Node 22.23.2 / npm 10.9.9 clean npm ci: passed
Node 22.23.2 parser tests: 7/7 passed
Node 22.23.2 electron-vite main/preload/renderer build: passed
Production audit: 0 critical, 5 high package records, 3 moderate, 8 total
Policy expansion: 12 unique high/critical advisories, 12 exact active exceptions
Security policy tests: 13/13 passed
Clean-install lock SHA-256 matched the source lock
git diff --check: passed
```

## Exit work

Before the exception deadline:

1. Upgrade Electron to a maintained release and run IPC, context-isolation, protocol, updater, packaging and supported-OS smoke tests.
2. Replace or isolate the vulnerable PPTX image metadata path while preserving deck export behavior.
3. Replace the npm `xlsx` line with a maintained spreadsheet parser and retain hostile-input and XLS/XLSX extraction tests.
