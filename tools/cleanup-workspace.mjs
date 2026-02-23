import fs from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;

const ROOT_FILE_PATTERNS = [
  /^tmp[-_].+/i,
  /^\.tmp-.+/i,
  /^\.temp-.+/i,
  /^server\.log$/i,
  /^tsc_errors\.log$/i,
  /^validation-log\.json$/i,
  /^final_fix\.cjs$/i
];

const ROOT_DIR_PATTERNS = [
  /^tmp$/i,
  /^tmp-.+/i,
  /^tmp_.+/i,
  /^\.tmp-.+/i,
  /^\.temp-.+/i
];

const RECURSIVE_DIR_PATTERNS = [/^__pycache__$/i];
const RECURSION_SKIP = new Set([".git", ".next", "node_modules", "downloads", "backup"]);

const matchesAny = (value, patterns) => patterns.some((re) => re.test(value));

const collectRootTargets = async () => {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const targets = [];

  for (const entry of entries) {
    if (entry.isDirectory() && matchesAny(entry.name, ROOT_DIR_PATTERNS)) {
      targets.push(path.join(rootDir, entry.name));
      continue;
    }
    if (entry.isFile() && matchesAny(entry.name, ROOT_FILE_PATTERNS)) {
      targets.push(path.join(rootDir, entry.name));
    }
  }

  return targets;
};

const collectRecursiveDirTargets = async (startDir) => {
  const targets = [];

  const walk = async (dir) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (RECURSION_SKIP.has(entry.name)) continue;

      const full = path.join(dir, entry.name);
      if (matchesAny(entry.name, RECURSIVE_DIR_PATTERNS)) {
        targets.push(full);
        continue;
      }

      await walk(full);
    }
  };

  await walk(startDir);
  return targets;
};

const uniqueSorted = (items) => [...new Set(items)].sort((a, b) => a.localeCompare(b));

const removePath = async (target) => {
  await fs.rm(target, { recursive: true, force: true });
};

const formatRelative = (target) => path.relative(rootDir, target) || ".";

const run = async () => {
  const rootTargets = await collectRootTargets();
  const recursiveTargets = await collectRecursiveDirTargets(rootDir);
  const targets = uniqueSorted([...rootTargets, ...recursiveTargets]);

  if (targets.length === 0) {
    console.log("[cleanup] nothing to remove");
    return;
  }

  console.log(`[cleanup] mode=${dryRun ? "dry-run" : "apply"}`);
  for (const target of targets) {
    console.log(`[cleanup] target ${formatRelative(target)}`);
  }

  if (dryRun) {
    console.log(`[cleanup] complete (planned ${targets.length} target(s))`);
    return;
  }

  let removed = 0;
  for (const target of targets) {
    try {
      await removePath(target);
      removed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[cleanup] failed ${formatRelative(target)}: ${message}`);
    }
  }

  console.log(`[cleanup] complete (removed ${removed}/${targets.length} target(s))`);
};

run().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error("[cleanup] fatal:", message);
  process.exitCode = 1;
});
