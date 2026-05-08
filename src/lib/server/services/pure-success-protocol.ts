import path from "node:path";
import { readdir } from "node:fs/promises";
import * as fs from "node:fs";

import { convertToMultipleFormats } from "@/lib/server/font-converter";
import type { DownloadedFile } from "@/lib/downloader-protocol";

const FONT_EXTENSIONS = new Set(["woff2", "woff", "ttf", "otf"]);
const DEFAULT_REQUIRED_FORMATS = ["woff", "woff2", "otf", "ttf"] as const;
const DEFAULT_MAX_RECOVERY_ATTEMPTS = 24;

const normalizeFsPath = (value: string): string => {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

const toRelative = (absolutePath: string): string => path.relative(process.cwd(), absolutePath);

const getFileExt = (filePath: string): string => path.extname(filePath).toLowerCase().replace(/^\./, "");

const isSupportedFontFile = (filePath: string): boolean => FONT_EXTENSIONS.has(getFileExt(filePath));

const sanitizeRequiredFormats = (formats: readonly string[]): string[] => {
  const unique = new Set<string>();
  for (const item of formats) {
    const token = String(item || "").trim().toLowerCase();
    if (!FONT_EXTENSIONS.has(token)) continue;
    unique.add(token);
  }
  return Array.from(unique.values());
};

const listFontFilesRecursive = async (rootDir: string): Promise<string[]> => {
  const output: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isSupportedFontFile(fullPath)) continue;
      output.push(path.resolve(fullPath));
    }
  }

  return output;
};

const countFormats = (files: string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const filePath of files) {
    const ext = getFileExt(filePath);
    if (!ext) continue;
    counts[ext] = (counts[ext] || 0) + 1;
  }
  return counts;
};

const detectMissingFormats = (requiredFormats: string[], counts: Record<string, number>): string[] =>
  requiredFormats.filter((format) => (counts[format] || 0) <= 0);

const prioritizeCandidates = (files: string[]): string[] => {
  const score = (filePath: string): number => {
    const ext = getFileExt(filePath);
    const base = path.basename(filePath).toLowerCase();
    let value = 0;

    if (base.includes("variable")) value += 100;
    if (ext === "woff2") value += 40;
    else if (ext === "woff") value += 25;
    else if (ext === "ttf") value += 20;
    else if (ext === "otf") value += 15;
    if (base.includes("italic")) value -= 1;

    return value;
  };

  return [...files].sort((a, b) => score(b) - score(a));
};

const getSourceUrlByFilePath = (
  downloaded: DownloadedFile[],
  outputDir: string,
  absolutePath: string
): string | undefined => {
  const normalizedTarget = normalizeFsPath(absolutePath);
  const resolvedOutputDir = path.resolve(outputDir);
  const relativeToOutput = path.relative(resolvedOutputDir, absolutePath);

  for (const entry of downloaded) {
    if (typeof entry.filePath !== "string") continue;

    const resolved = path.resolve(process.cwd(), entry.filePath);
    if (normalizeFsPath(resolved) === normalizedTarget) {
      return entry.sourceUrl;
    }

    const altResolved = path.resolve(outputDir, entry.filePath);
    if (normalizeFsPath(altResolved) === normalizedTarget) {
      return entry.sourceUrl;
    }

    if (path.basename(entry.filePath).toLowerCase() === path.basename(absolutePath).toLowerCase()) {
      return entry.sourceUrl;
    }

    if (relativeToOutput && relativeToOutput.toLowerCase() === entry.filePath.replace(/\\/g, "/").toLowerCase()) {
      return entry.sourceUrl;
    }
  }

  return undefined;
};

const buildDownloadedPathSet = (downloaded: DownloadedFile[]): Set<string> => {
  const set = new Set<string>();
  for (const entry of downloaded) {
    if (typeof entry.filePath !== "string" || !entry.filePath.trim()) continue;
    const resolved = path.resolve(process.cwd(), entry.filePath);
    set.add(normalizeFsPath(resolved));
  }
  return set;
};

export type PureSuccessProtocolStatus = "noop" | "pass" | "partial" | "error";

export type PureSuccessRecoveryAttempt = {
  attempt: number;
  sourceFile: string;
  sourceExt: string;
  missingBefore: string[];
  missingAfter: string[];
  generatedFiles: string[];
  addedFiles: string[];
  error?: string;
};

export type PureSuccessProtocolAudit = {
  protocolId: "pure-success-protocol-v1";
  status: PureSuccessProtocolStatus;
  startedAt: string;
  finishedAt: string;
  outputDir: string;
  foundry?: string;
  family?: string;
  requiredFormats: string[];
  sourceLimitedFormats: string[];
  effectiveRequiredFormats: string[];
  formatCountsBefore: Record<string, number>;
  formatCountsAfter: Record<string, number>;
  missingFormatsBefore: string[];
  missingFormatsAfter: string[];
  recoveredFormats: string[];
  unresolvedFormats: string[];
  recoveryAttempts: PureSuccessRecoveryAttempt[];
  attemptedCandidateCount: number;
};

export type RunPureSuccessProtocolParams = {
  outputDir: string;
  downloaded: DownloadedFile[];
  foundry?: string;
  family?: string;
  requiredFormats?: readonly string[];
  sourceLimitedFormats?: readonly string[];
  maxRecoveryAttempts?: number;
};

export const runPureSuccessProtocol = async (
  params: RunPureSuccessProtocolParams
): Promise<PureSuccessProtocolAudit> => {
  const startedAt = new Date();
  const outputDir = path.resolve(params.outputDir);
  const requiredFormats = sanitizeRequiredFormats(params.requiredFormats || DEFAULT_REQUIRED_FORMATS);
  const sourceLimitedFormats = sanitizeRequiredFormats(params.sourceLimitedFormats || []);
  const sourceLimitedSet = new Set(sourceLimitedFormats);
  const effectiveRequiredFormats = requiredFormats.filter((format) => !sourceLimitedSet.has(format));
  const maxRecoveryAttempts = Number.isFinite(params.maxRecoveryAttempts)
    ? Math.max(1, Math.floor(Number(params.maxRecoveryAttempts)))
    : DEFAULT_MAX_RECOVERY_ATTEMPTS;

  const recoveryAttempts: PureSuccessRecoveryAttempt[] = [];

  try {
    const initialFiles = await listFontFilesRecursive(outputDir);
    const knownFiles = new Set(initialFiles.map((item) => normalizeFsPath(item)));
    const downloadedPathSet = buildDownloadedPathSet(params.downloaded);

    const formatCountsBefore = countFormats(initialFiles);
    const missingFormatsBefore = detectMissingFormats(effectiveRequiredFormats, formatCountsBefore);

    if (effectiveRequiredFormats.length === 0 || missingFormatsBefore.length === 0) {
      return {
        protocolId: "pure-success-protocol-v1",
        status: "noop",
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        outputDir,
        foundry: params.foundry,
        family: params.family,
        requiredFormats,
        sourceLimitedFormats,
        effectiveRequiredFormats,
        formatCountsBefore,
        formatCountsAfter: { ...formatCountsBefore },
        missingFormatsBefore,
        missingFormatsAfter: [...missingFormatsBefore],
        recoveredFormats: [],
        unresolvedFormats: [...missingFormatsBefore],
        recoveryAttempts,
        attemptedCandidateCount: 0
      };
    }

    const candidates = prioritizeCandidates(initialFiles);
    let missingFormatsCurrent = [...missingFormatsBefore];
    let attemptCounter = 0;

    for (const candidate of candidates) {
      if (missingFormatsCurrent.length === 0) break;
      if (attemptCounter >= maxRecoveryAttempts) break;
      attemptCounter += 1;

      const missingBefore = [...missingFormatsCurrent];
      const sourceExt = getFileExt(candidate);

      try {
        const conversions = await convertToMultipleFormats(candidate, undefined, {
          disableInstanceExplosion: true,
          preserveBaseName: true
        });

        const generated = [
          conversions.ttf,
          conversions.otf,
          conversions.woff,
          conversions.woff2,
          ...(Array.isArray(conversions.instances) ? conversions.instances : [])
        ]
          .filter((item): item is string => Boolean(item))
          .map((item) => path.resolve(item));

        const generatedFiles = generated
          .filter((item) => isSupportedFontFile(item) && fs.existsSync(item))
          .map((item) => path.basename(item));
        const addedFiles: string[] = [];

        for (const absolute of generated) {
          if (!isSupportedFontFile(absolute)) continue;
          if (!fs.existsSync(absolute)) continue;

          const normalizedAbsolute = normalizeFsPath(absolute);
          const existedBefore = knownFiles.has(normalizedAbsolute);
          knownFiles.add(normalizedAbsolute);

          if (!downloadedPathSet.has(normalizedAbsolute)) {
            const sourceUrl =
              getSourceUrlByFilePath(params.downloaded, outputDir, candidate) || "pure-success://recovered-local";
            params.downloaded.push({
              fileName: path.basename(absolute),
              filePath: toRelative(absolute),
              sourceUrl,
              name: path.basename(absolute, path.extname(absolute))
            });
            downloadedPathSet.add(normalizedAbsolute);
          }

          if (!existedBefore) {
            addedFiles.push(path.basename(absolute));
          }
        }

        const currentFiles = Array.from(knownFiles.values()).map((item) => path.resolve(item));
        const formatCountsCurrent = countFormats(currentFiles);
        missingFormatsCurrent = detectMissingFormats(effectiveRequiredFormats, formatCountsCurrent);

        recoveryAttempts.push({
          attempt: attemptCounter,
          sourceFile: path.basename(candidate),
          sourceExt,
          missingBefore,
          missingAfter: [...missingFormatsCurrent],
          generatedFiles,
          addedFiles
        });
      } catch (error) {
        recoveryAttempts.push({
          attempt: attemptCounter,
          sourceFile: path.basename(candidate),
          sourceExt,
          missingBefore,
          missingAfter: [...missingFormatsCurrent],
          generatedFiles: [],
          addedFiles: [],
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const finalFiles = await listFontFilesRecursive(outputDir);
    const formatCountsAfter = countFormats(finalFiles);
    const missingFormatsAfter = detectMissingFormats(effectiveRequiredFormats, formatCountsAfter);
    const recoveredFormats = missingFormatsBefore.filter((format) => !missingFormatsAfter.includes(format));
    const unresolvedFormats = [...missingFormatsAfter];

    const status: PureSuccessProtocolStatus = unresolvedFormats.length === 0 ? "pass" : "partial";

    return {
      protocolId: "pure-success-protocol-v1",
      status,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      outputDir,
      foundry: params.foundry,
      family: params.family,
      requiredFormats,
      sourceLimitedFormats,
      effectiveRequiredFormats,
      formatCountsBefore,
      formatCountsAfter,
      missingFormatsBefore,
      missingFormatsAfter,
      recoveredFormats,
      unresolvedFormats,
      recoveryAttempts,
      attemptedCandidateCount: recoveryAttempts.length
    };
  } catch (error) {
    return {
      protocolId: "pure-success-protocol-v1",
      status: "error",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      outputDir,
      foundry: params.foundry,
      family: params.family,
      requiredFormats,
      sourceLimitedFormats,
      effectiveRequiredFormats,
      formatCountsBefore: {},
      formatCountsAfter: {},
      missingFormatsBefore: [...effectiveRequiredFormats],
      missingFormatsAfter: [...effectiveRequiredFormats],
      recoveredFormats: [],
      unresolvedFormats: [...effectiveRequiredFormats],
      recoveryAttempts: [
        {
          attempt: 1,
          sourceFile: "protocol-bootstrap",
          sourceExt: "",
          missingBefore: [...effectiveRequiredFormats],
          missingAfter: [...effectiveRequiredFormats],
          generatedFiles: [],
          addedFiles: [],
          error: error instanceof Error ? error.message : String(error)
        }
      ],
      attemptedCandidateCount: 0
    };
  }
};
