import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSecurityAudit } from "../check-security-audit.mjs";

const today = "2026-08-26";

function npmAudit(severity = "high") {
  const high = severity === "high" ? 2 : 0;
  const critical = severity === "critical" ? 2 : 0;
  return {
    vulnerabilities: {
      aggregate: { severity, via: ["affected-package"] },
      "affected-package": {
        severity,
        via: [
          {
            source: 12345,
            name: "affected-package",
            severity,
            url: "https://github.com/advisories/GHSA-AAAA-BBBB-CCCC",
          },
        ],
      },
    },
    metadata: {
      vulnerabilities: { low: 0, moderate: 0, high, critical, total: 2 },
    },
  };
}

function emptyNpmAudit() {
  return {
    vulnerabilities: {},
    metadata: {
      vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
    },
  };
}

function composerAudit() {
  return {
    advisories: {
      "vendor/package": {
        1: {
          packageName: "vendor/package",
          advisoryId: "PKSA-example",
          severity: "high",
          sources: [{ remoteId: "GHSA-DDDD-EEEE-FFFF" }],
        },
      },
    },
  };
}

function policy(exception) {
  return {
    version: 1,
    maximum_exception_expiry: "2026-09-30",
    exceptions: [
      {
        ecosystem: "npm",
        scope: "root",
        advisory: "GHSA-AAAA-BBBB-CCCC",
        package: "affected-package",
        severity: "high",
        reason: "Pinned upstream dependency requires a separately verified upgrade.",
        owner: "Platform owner",
        expires: "2026-09-30",
        exit_criteria: "Install an unaffected version and pass clean production builds.",
        ...exception,
      },
    ],
  };
}

test("accepts an exact active npm exception and follows aggregate via links", () => {
  const result = evaluateSecurityAudit({
    ecosystem: "npm",
    scope: "root",
    audit: npmAudit(),
    policy: policy(),
    today,
  });
  assert.deepEqual(result, { ecosystem: "npm", scope: "root", advisories: 1, exceptions: 1 });
});

test("rejects a newly introduced high advisory", () => {
  assert.throws(
    () =>
      evaluateSecurityAudit({
        ecosystem: "npm",
        scope: "root",
        audit: npmAudit(),
        policy: { ...policy(), exceptions: [] },
        today,
      }),
    /unregistered high/,
  );
});

test("rejects an expired exception", () => {
  assert.throws(
    () =>
      evaluateSecurityAudit({
        ecosystem: "npm",
        scope: "root",
        audit: npmAudit(),
        policy: policy({ expires: "2026-08-25" }),
        today,
      }),
    /expired on 2026-08-25/,
  );
});

test("rejects an exception after its advisory disappears", () => {
  assert.throws(
    () =>
      evaluateSecurityAudit({
        ecosystem: "npm",
        scope: "root",
        audit: emptyNpmAudit(),
        policy: policy(),
        today,
      }),
    /stale exception/,
  );
});

for (const field of ["reason", "owner", "exit_criteria"]) {
  test(`rejects a missing ${field}`, () => {
    assert.throws(
      () =>
        evaluateSecurityAudit({
          ecosystem: "npm",
          scope: "root",
          audit: npmAudit(),
          policy: policy({ [field]: "" }),
          today,
        }),
      new RegExp(`${field} is required`),
    );
  });
}

test("rejects wildcard exceptions", () => {
  assert.throws(
    () =>
      evaluateSecurityAudit({
        ecosystem: "npm",
        scope: "root",
        audit: npmAudit(),
        policy: policy({ package: "*" }),
        today,
      }),
    /must not contain wildcard/,
  );
});

test("parses Composer advisory objects with numeric keys", () => {
  const composerPolicy = policy();
  composerPolicy.exceptions = [
    {
      ...composerPolicy.exceptions[0],
      ecosystem: "composer",
      scope: "backend",
      advisory: "GHSA-DDDD-EEEE-FFFF",
      package: "vendor/package",
    },
  ];
  const result = evaluateSecurityAudit({
    ecosystem: "composer",
    scope: "backend",
    audit: composerAudit(),
    policy: composerPolicy,
    today,
  });
  assert.equal(result.advisories, 1);
});

test("rejects missing audit schemas instead of treating endpoint failures as clean", () => {
  assert.throws(
    () =>
      evaluateSecurityAudit({
        ecosystem: "npm",
        scope: "root",
        audit: { error: { summary: "audit endpoint unavailable" } },
        policy: { ...policy(), exceptions: [] },
        today,
      }),
    /audit endpoint unavailable/,
  );
  assert.throws(
    () =>
      evaluateSecurityAudit({
        ecosystem: "composer",
        scope: "backend",
        audit: {},
        policy: { ...policy(), exceptions: [] },
        today,
      }),
    /Composer audit advisories must be an object/,
  );
  assert.throws(
    () =>
      evaluateSecurityAudit({
        ecosystem: "npm",
        scope: "root",
        audit: { vulnerabilities: {} },
        policy: { ...policy(), exceptions: [] },
        today,
      }),
    /npm audit metadata must be an object/,
  );
});

test("rejects npm metadata that reports an unrepresented high vulnerability", () => {
  const audit = emptyNpmAudit();
  audit.metadata.vulnerabilities.high = 1;
  audit.metadata.vulnerabilities.total = 1;

  assert.throws(
    () =>
      evaluateSecurityAudit({
        ecosystem: "npm",
        scope: "agent-admin/frontend",
        audit,
        policy: { ...policy(), exceptions: [] },
        today,
      }),
    /high metadata count 1 does not match 0 vulnerability records/,
  );
});

test("rejects a high vulnerability omitted from npm metadata totals", () => {
  const audit = npmAudit();
  audit.metadata.vulnerabilities.high = 0;

  assert.throws(
    () =>
      evaluateSecurityAudit({
        ecosystem: "npm",
        scope: "root",
        audit,
        policy: policy(),
        today,
      }),
    /high metadata count 0 does not match 2 vulnerability records/,
  );
});
