import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HIGH_SEVERITIES = new Set(["high", "critical"]);
const VALID_ECOSYSTEMS = new Set(["composer", "npm"]);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultPolicyPath = join(scriptDirectory, "security-audit-policy.json");

function normalizeSeverity(value) {
  return String(value ?? "").toLowerCase();
}

function normalizeAdvisory(value) {
  return String(value ?? "").trim().toUpperCase();
}

function recordKey(record) {
  return [
    record.ecosystem,
    record.scope,
    record.advisory,
    record.package,
    record.severity,
  ].join("\u0000");
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function parseDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date`);
  }
  return value;
}

function parseJsonDocument(text, label) {
  try {
    return JSON.parse(text);
  } catch (initialError) {
    const firstObject = text.indexOf("{");
    if (firstObject >= 0) {
      try {
        return JSON.parse(text.slice(firstObject));
      } catch {
        // Report the original parse error below.
      }
    }
    throw new Error(`${label} is not valid JSON: ${initialError.message}`);
  }
}

function composerAdvisoryId(advisory) {
  const remoteIds = Array.isArray(advisory.sources)
    ? advisory.sources.map((source) => normalizeAdvisory(source?.remoteId))
    : [];
  return (
    remoteIds.find((id) => id.startsWith("GHSA-")) ||
    normalizeAdvisory(advisory.cve) ||
    normalizeAdvisory(advisory.advisoryId)
  );
}

function extractComposerRecords(audit, scope) {
  assertObject(audit, "Composer audit");
  if (audit.error) throw new Error(`Composer audit returned an error: ${audit.error.message ?? audit.error}`);
  const advisoriesAreEmptyArray = Array.isArray(audit.advisories) && audit.advisories.length === 0;
  if (!advisoriesAreEmptyArray) {
    assertObject(audit.advisories, "Composer audit advisories");
  }
  const records = [];

  for (const rawAdvisories of Object.values(audit.advisories ?? {})) {
    const advisories = Array.isArray(rawAdvisories)
      ? rawAdvisories
      : Object.values(rawAdvisories ?? {});
    for (const advisory of advisories) {
      const severity = normalizeSeverity(advisory?.severity);
      if (!HIGH_SEVERITIES.has(severity)) continue;
      const packageName = String(advisory.packageName ?? "").trim();
      const advisoryId = composerAdvisoryId(advisory);
      if (!packageName || !advisoryId) {
        throw new Error("Composer high/critical advisory is missing package or advisory ID");
      }
      records.push({
        ecosystem: "composer",
        scope,
        advisory: advisoryId,
        package: packageName,
        severity,
      });
    }
  }
  return records;
}

function npmAdvisoryId(advisory) {
  const ghsa = String(advisory.url ?? "").match(/GHSA-[0-9A-Za-z-]+/i)?.[0];
  if (ghsa) return normalizeAdvisory(ghsa);
  if (advisory.source !== undefined && advisory.source !== null) {
    return `NPM-${normalizeAdvisory(advisory.source)}`;
  }
  return "";
}

function extractNpmRecords(audit, scope) {
  assertObject(audit, "npm audit");
  if (audit.error) throw new Error(`npm audit returned an error: ${audit.error.summary ?? audit.error.message ?? "unknown error"}`);
  assertObject(audit.vulnerabilities, "npm audit vulnerabilities");
  assertObject(audit.metadata, "npm audit metadata");
  assertObject(audit.metadata.vulnerabilities, "npm audit metadata vulnerabilities");
  const vulnerabilities = audit.vulnerabilities;

  for (const severity of HIGH_SEVERITIES) {
    const reportedCount = audit.metadata.vulnerabilities[severity];
    if (!Number.isInteger(reportedCount) || reportedCount < 0) {
      throw new Error(
        `npm audit metadata vulnerabilities.${severity} must be a non-negative integer`,
      );
    }
    const detailCount = Object.values(vulnerabilities).filter(
      (vulnerability) => normalizeSeverity(vulnerability?.severity) === severity,
    ).length;
    if (reportedCount !== detailCount) {
      throw new Error(
        `npm audit ${severity} metadata count ${reportedCount} does not match ` +
          `${detailCount} vulnerability records`,
      );
    }
  }

  const memo = new Map();

  function resolve(name, stack = new Set()) {
    if (memo.has(name)) return memo.get(name);
    if (stack.has(name)) return [];
    const vulnerability = vulnerabilities[name];
    if (!vulnerability) return [];

    const nextStack = new Set(stack);
    nextStack.add(name);
    const records = [];
    for (const via of vulnerability.via ?? []) {
      if (typeof via === "string") {
        records.push(...resolve(via, nextStack));
        continue;
      }
      const severity = normalizeSeverity(via?.severity);
      if (!HIGH_SEVERITIES.has(severity)) continue;
      const packageName = String(via.name ?? via.dependency ?? name).trim();
      const advisoryId = npmAdvisoryId(via);
      if (!packageName || !advisoryId) {
        throw new Error(`npm high/critical advisory for ${name} is missing package or advisory ID`);
      }
      records.push({
        ecosystem: "npm",
        scope,
        advisory: advisoryId,
        package: packageName,
        severity,
      });
    }
    memo.set(name, records);
    return records;
  }

  const records = [];
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    const severity = normalizeSeverity(vulnerability?.severity);
    if (!HIGH_SEVERITIES.has(severity)) continue;
    const resolved = resolve(name);
    if (resolved.length === 0) {
      throw new Error(`npm ${severity} vulnerability ${name} has no resolvable advisory record`);
    }
    records.push(...resolved);
  }
  return records;
}

function uniqueRecords(records) {
  return [...new Map(records.map((record) => [recordKey(record), record])).values()];
}

function validatePolicy(policy, today) {
  assertObject(policy, "Security policy");
  if (policy.version !== 1) throw new Error("Security policy version must be 1");
  if (!Array.isArray(policy.exceptions)) {
    throw new Error("Security policy exceptions must be an array");
  }
  const maximumExpiry = parseDate(
    String(policy.maximum_exception_expiry ?? ""),
    "maximum_exception_expiry",
  );
  const seen = new Set();

  for (const [index, exception] of policy.exceptions.entries()) {
    const label = `exceptions[${index}]`;
    assertObject(exception, label);
    if (!VALID_ECOSYSTEMS.has(exception.ecosystem)) {
      throw new Error(`${label}.ecosystem must be composer or npm`);
    }
    for (const field of ["scope", "advisory", "package", "reason", "owner", "exit_criteria"]) {
      if (typeof exception[field] !== "string" || exception[field].trim() === "") {
        throw new Error(`${label}.${field} is required`);
      }
    }
    if ([exception.scope, exception.advisory, exception.package].some((value) => /[*]/.test(value))) {
      throw new Error(`${label} must not contain wildcard scope, advisory, or package values`);
    }
    if (!HIGH_SEVERITIES.has(exception.severity)) {
      throw new Error(`${label}.severity must be high or critical`);
    }
    const expiry = parseDate(exception.expires, `${label}.expires`);
    if (expiry > maximumExpiry) {
      throw new Error(`${label}.expires exceeds maximum_exception_expiry ${maximumExpiry}`);
    }
    if (expiry < today) throw new Error(`${label} expired on ${expiry}`);

    exception.advisory = normalizeAdvisory(exception.advisory);
    exception.package = exception.package.trim();
    exception.scope = exception.scope.trim();
    const key = recordKey(exception);
    if (seen.has(key)) throw new Error(`${label} duplicates another exception`);
    seen.add(key);
  }
  return policy;
}

export function evaluateSecurityAudit({ ecosystem, scope, audit, policy, today }) {
  if (!VALID_ECOSYSTEMS.has(ecosystem)) {
    throw new Error("ecosystem must be composer or npm");
  }
  if (typeof scope !== "string" || scope.trim() === "" || scope.includes("*")) {
    throw new Error("scope must be a non-wildcard string");
  }
  const effectiveToday = parseDate(
    today ?? new Date().toISOString().slice(0, 10),
    "today",
  );
  const validatedPolicy = validatePolicy(structuredClone(policy), effectiveToday);
  const extracted =
    ecosystem === "composer"
      ? extractComposerRecords(audit, scope)
      : extractNpmRecords(audit, scope);
  const actualRecords = uniqueRecords(extracted);
  const scopedExceptions = validatedPolicy.exceptions.filter(
    (exception) => exception.ecosystem === ecosystem && exception.scope === scope,
  );
  const actualKeys = new Set(actualRecords.map(recordKey));
  const exceptionKeys = new Set(scopedExceptions.map(recordKey));
  const unregistered = actualRecords.filter((record) => !exceptionKeys.has(recordKey(record)));
  const stale = scopedExceptions.filter((exception) => !actualKeys.has(recordKey(exception)));

  if (unregistered.length || stale.length) {
    const messages = [];
    for (const record of unregistered) {
      messages.push(
        `unregistered ${record.severity}: ${record.advisory} ${record.package} (${record.scope})`,
      );
    }
    for (const exception of stale) {
      messages.push(
        `stale exception: ${exception.advisory} ${exception.package} (${exception.scope})`,
      );
    }
    throw new Error(messages.join("\n"));
  }

  return {
    ecosystem,
    scope,
    advisories: actualRecords.length,
    exceptions: scopedExceptions.length,
  };
}

function parseArguments(argv) {
  const options = { policy: defaultPolicyPath };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error("Arguments must be --ecosystem, --scope, --audit, and optional --policy pairs");
    }
    const key = flag.slice(2);
    if (!["ecosystem", "scope", "audit", "policy"].includes(key)) {
      throw new Error(`Unknown argument ${flag}`);
    }
    options[key] = value;
  }
  for (const required of ["ecosystem", "scope", "audit"]) {
    if (!options[required]) throw new Error(`Missing --${required}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const policy = parseJsonDocument(readFileSync(options.policy, "utf8"), "Security policy");
  const audit = parseJsonDocument(readFileSync(options.audit, "utf8"), "Audit output");
  const result = evaluateSecurityAudit({
    ecosystem: options.ecosystem,
    scope: options.scope,
    audit,
    policy,
  });
  console.log(
    `Security audit passed for ${result.ecosystem}/${result.scope}: ` +
      `${result.advisories} high/critical advisories, ${result.exceptions} active exceptions`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`Security audit failed: ${error.message}`);
    process.exitCode = 1;
  });
}
