import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifests = [
  "docs/provenance/agent-web.source.json",
  "docs/provenance/agent-mobile.source.json",
];
const failures = [];

function runGit(cwd, args, encoding = "utf8") {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const generatedDirectories = new Set([".next", "node_modules", "dist", "unpackage"]);

function walk(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && !generatedDirectories.has(entry.name)) files.push(...walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function sourceToTarget(sourcePath, sourceRoot) {
  if (!sourceRoot) return sourcePath;
  const prefix = `${sourceRoot}/`;
  return sourcePath.startsWith(prefix) ? sourcePath.slice(prefix.length) : sourcePath;
}

function verifyAgainstLocalSource(manifest, targetRoot) {
  if (!existsSync(manifest.sourceLocalPath)) {
    console.log(`INFO  ${manifest.target}: local source unavailable; target snapshot verification only`);
    return;
  }

  try {
    runGit(manifest.sourceLocalPath, ["cat-file", "-e", `${manifest.commit}^{commit}`]);
  } catch {
    failures.push(`${manifest.target}: source commit ${manifest.commit} is unavailable`);
    return;
  }

  const sourceFiles = runGit(manifest.sourceLocalPath, [
    "ls-tree",
    "-r",
    "--name-only",
    manifest.commit,
    "--",
    ...manifest.includePaths,
  ]).trim().split("\n").filter(Boolean);

  if (sourceFiles.length !== manifest.importedFileCount) {
    failures.push(
      `${manifest.target}: source whitelist has ${sourceFiles.length} files, expected ${manifest.importedFileCount}`,
    );
  }

  const modified = new Set(manifest.modifiedFiles || []);
  const removed = new Set(manifest.removedFiles || []);
  for (const sourcePath of sourceFiles) {
    const targetPath = sourceToTarget(sourcePath, manifest.sourceRoot);
    if (modified.has(targetPath) || removed.has(targetPath)) continue;
    const absoluteTarget = join(targetRoot, targetPath);
    if (!existsSync(absoluteTarget)) {
      failures.push(`${manifest.target}: missing imported file ${targetPath}`);
      continue;
    }
    const sourceContent = runGit(
      manifest.sourceLocalPath,
      ["show", `${manifest.commit}:${sourcePath}`],
      "buffer",
    );
    const targetContent = readFileSync(absoluteTarget);
    if (!sourceContent.equals(targetContent)) {
      failures.push(`${manifest.target}: unregistered source modification ${targetPath}`);
    }
  }
}

function verifyTargetSnapshot(manifest, targetRoot) {
  const targetFiles = manifest.targetFiles;
  if (!targetFiles || typeof targetFiles !== "object" || !Object.keys(targetFiles).length) {
    failures.push(`${manifest.target}: targetFiles SHA-256 snapshot is missing`);
    return;
  }
  for (const [targetPath, expectedHash] of Object.entries(targetFiles)) {
    const absoluteTarget = join(targetRoot, targetPath);
    if (!existsSync(absoluteTarget) || !statSync(absoluteTarget).isFile()) {
      failures.push(`${manifest.target}: snapshot file is missing ${targetPath}`);
      continue;
    }
    const actualHash = createHash("sha256").update(readFileSync(absoluteTarget)).digest("hex");
    if (actualHash !== expectedHash) {
      failures.push(`${manifest.target}: snapshot hash mismatch ${targetPath}`);
    }
  }
}

const forbiddenSegments = new Set([".git"]);
const forbiddenFiles = new Set(["package-lock.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]);
const forbiddenText = [
  "VITE_REQUEST_PASSWORD",
  "test.dev.shequlefu.com",
  "x-request-token",
  "client_id=GITHUB_CLIENT_ID",
  "client_id=GOOGLE_CLIENT_ID",
  "api.qrserver.com",
  "lingmi",
];

for (const manifestPath of manifests) {
  const manifest = JSON.parse(readFileSync(join(repoRoot, manifestPath), "utf8"));
  const targetRoot = join(repoRoot, manifest.target);
  if (!existsSync(targetRoot)) {
    failures.push(`${manifest.target}: target directory is missing`);
    continue;
  }

  for (const file of walk(targetRoot)) {
    const path = relative(targetRoot, file);
    const segments = path.split(sep);
    if (segments.some((segment) => forbiddenSegments.has(segment))) {
      failures.push(`${manifest.target}: forbidden generated path ${path}`);
    }
    const filename = segments.at(-1);
    if (
      forbiddenFiles.has(filename) ||
      filename === ".env" ||
      (filename?.startsWith(".env.") && filename !== ".env.example")
    ) {
      failures.push(`${manifest.target}: forbidden imported file ${path}`);
    }
    if (statSync(file).size <= 2_000_000) {
      const content = readFileSync(file, "utf8");
      for (const marker of forbiddenText) {
        if (content.includes(marker)) failures.push(`${manifest.target}: forbidden marker ${marker} in ${path}`);
      }
    }
  }

  verifyAgainstLocalSource(manifest, targetRoot);
  verifyTargetSnapshot(manifest, targetRoot);
}

if (failures.length) {
  console.error("UI import check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("UI import check passed");
