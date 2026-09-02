import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDirectory, "..");
const mobileManifestPath = join(repoRoot, "agent-mobile", "package.json");
const rootManifestPath = join(repoRoot, "package.json");
const lockfilePath = join(repoRoot, "package-lock.json");

const CURRENT_DCloud_VERSION = "3.0.0-5010520260709002";
const CURRENT_TYPES_VERSION = "3.4.31";
const CURRENT_VITE_VERSION = "5.4.21";

const dcloudPackages = [
  "@dcloudio/uni-app",
  "@dcloudio/uni-app-harmony",
  "@dcloudio/uni-app-plus",
  "@dcloudio/uni-components",
  "@dcloudio/uni-h5",
  "@dcloudio/uni-mp-alipay",
  "@dcloudio/uni-mp-baidu",
  "@dcloudio/uni-mp-harmony",
  "@dcloudio/uni-mp-jd",
  "@dcloudio/uni-mp-kuaishou",
  "@dcloudio/uni-mp-lark",
  "@dcloudio/uni-mp-qq",
  "@dcloudio/uni-mp-toutiao",
  "@dcloudio/uni-mp-weixin",
  "@dcloudio/uni-mp-xhs",
  "@dcloudio/uni-quickapp-webview",
  "@dcloudio/uni-automator",
  "@dcloudio/uni-cli-shared",
  "@dcloudio/uni-stacktracey",
  "@dcloudio/vite-plugin-uni",
];

const lockVersionChecks = new Map([
  ["node_modules/@dcloudio/types", CURRENT_TYPES_VERSION],
  ...dcloudPackages.map((name) => [`node_modules/${name}`, CURRENT_DCloud_VERSION]),
  ["agent-mobile/node_modules/vite", CURRENT_VITE_VERSION],
  ["node_modules/vite", "5.2.8"],
  ["node_modules/@intlify/core-base", "9.1.9"],
  ["node_modules/@intlify/message-resolver", "9.1.9"],
  ["node_modules/adm-zip", "0.5.16"],
  ["node_modules/jpeg-js", "0.3.7"],
  ["node_modules/@dcloudio/uni-nvue-styler/node_modules/postcss", "8.5.6"],
  ["node_modules/postcss-selector-parser", "6.1.2"],
  ["node_modules/ws", "8.18.0"],
  ["node_modules/esbuild", "0.20.2"],
]);

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} could not be read as JSON: ${error.message}`);
  }
}

function recordFailure(failures, message) {
  failures.push(`[fail] ${message}`);
}

function checkManifestOverrides(failures, manifest, label) {
  if (Object.prototype.hasOwnProperty.call(manifest, "overrides")) {
    recordFailure(failures, `${label} declares overrides; no override is registered for this baseline`);
  }
}

function checkDCloudLine(failures, version, label) {
  if (typeof version !== "string" || version.startsWith("2.0.2-") || !/^3\.0\.0-(?:alpha-)?\d+$/.test(version)) {
    recordFailure(failures, `${label} uses a Vue 2/legacy or non-Vue-3 DCloud version: ${String(version)}`);
    return;
  }
  if (version !== CURRENT_DCloud_VERSION) {
    recordFailure(failures, `${label} drifted from the pinned Vue 3 DCloud version ${CURRENT_DCloud_VERSION}: ${version}`);
  }
}

function checkDeclaredPackage(failures, manifest, packageName, label) {
  const declared = manifest.dependencies?.[packageName] ?? manifest.devDependencies?.[packageName];
  if (declared === undefined) {
    recordFailure(failures, `${label} does not declare ${packageName}`);
    return;
  }
  if (declared !== CURRENT_DCloud_VERSION) {
    checkDCloudLine(failures, declared, `${label} ${packageName}`);
    recordFailure(failures, `${label} ${packageName} must be pinned to ${CURRENT_DCloud_VERSION}, found ${declared}`);
  }
}

function checkLockPackage(failures, lock, packagePath, expectedVersion) {
  const packageRecord = lock.packages?.[packagePath];
  if (!packageRecord) {
    recordFailure(failures, `package-lock.json is missing ${packagePath}`);
    return;
  }
  if (packageRecord.version !== expectedVersion) {
    recordFailure(failures, `${packagePath} must resolve ${expectedVersion}, found ${String(packageRecord.version)}`);
  }
}

function main() {
  const failures = [];
  let rootManifest;
  let mobileManifest;
  let lock;

  try {
    rootManifest = readJson(rootManifestPath, "root package.json");
    mobileManifest = readJson(mobileManifestPath, "agent-mobile/package.json");
    lock = readJson(lockfilePath, "package-lock.json");
  } catch (error) {
    console.error(`[fail] ${error.message}`);
    process.exitCode = 1;
    return;
  }

  checkManifestOverrides(failures, rootManifest, "root package.json");
  checkManifestOverrides(failures, mobileManifest, "agent-mobile/package.json");
  checkManifestOverrides(failures, lock.packages?.[""], "package-lock.json root package");

  if (lock.lockfileVersion !== 3) {
    recordFailure(failures, `package-lock.json lockfileVersion must be 3, found ${String(lock.lockfileVersion)}`);
  }

  for (const packageName of dcloudPackages) {
    checkDeclaredPackage(failures, mobileManifest, packageName, "agent-mobile/package.json");
    checkDCloudLine(failures, lock.packages?.[`node_modules/${packageName}`]?.version, `package-lock.json ${packageName}`);
  }

  const declaredTypes = mobileManifest.devDependencies?.["@dcloudio/types"];
  if (typeof declaredTypes !== "string" || !/^\^?3\.4\.\d+$/.test(declaredTypes)) {
    recordFailure(failures, `agent-mobile/package.json @dcloudio/types must remain on the Vue 3 type line, found ${String(declaredTypes)}`);
  }
  const mobileLockManifest = lock.packages?.["agent-mobile"];
  if (!mobileLockManifest) {
    recordFailure(failures, "package-lock.json is missing the agent-mobile workspace record");
  } else {
    for (const packageName of dcloudPackages) {
      const declared = mobileLockManifest.dependencies?.[packageName] ?? mobileLockManifest.devDependencies?.[packageName];
      if (declared !== CURRENT_DCloud_VERSION) {
        recordFailure(failures, `package-lock.json agent-mobile ${packageName} must declare ${CURRENT_DCloud_VERSION}, found ${String(declared)}`);
      }
    }
  }

  for (const [packagePath, expectedVersion] of lockVersionChecks) {
    checkLockPackage(failures, lock, packagePath, expectedVersion);
  }

  const declaredVite = mobileManifest.devDependencies?.vite;
  if (declaredVite !== CURRENT_VITE_VERSION) {
    recordFailure(failures, `agent-mobile/package.json vite must be pinned to ${CURRENT_VITE_VERSION}, found ${String(declaredVite)}`);
  }

  if (failures.length > 0) {
    console.error("DCloud dependency baseline: FAIL");
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
    return;
  }

  console.log("DCloud dependency baseline: PASS");
  console.log(`- DCloud Vue 3 toolchain: ${CURRENT_DCloud_VERSION}`);
  console.log(`- agent-mobile Vite: ${CURRENT_VITE_VERSION}; compiler Vite: 5.2.8`);
  console.log("- audited transitive pins match the 2026-09-02 baseline");
  console.log("- no unregistered npm overrides");
}

main();

