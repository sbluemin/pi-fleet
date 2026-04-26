import { cp, mkdir, rename } from "node:fs/promises";
import path from "node:path";

import {
  ARCHIVE_DIRNAME,
  CONFLICTS_DIRNAME,
  INDEX_FILENAME,
  LEGACY_MEMORY_ROOT_DIRNAME,
  LOG_DIRNAME,
  QUEUE_DIRNAME,
  RAW_DIRNAME,
  SCHEMA_DIRNAME,
  WIKI_ROOT_DIRNAME,
  WIKI_DIRNAME,
} from "./constants.js";
import type { MemoryPaths } from "./types.js";

export function resolveMemoryPaths(cwd: string): MemoryPaths {
  const root = path.join(cwd, WIKI_ROOT_DIRNAME);
  return {
    root,
    rawDir: path.join(root, RAW_DIRNAME),
    wikiDir: path.join(root, WIKI_DIRNAME),
    schemaDir: path.join(root, SCHEMA_DIRNAME),
    logDir: path.join(root, LOG_DIRNAME),
    queueDir: path.join(root, QUEUE_DIRNAME),
    archiveDir: path.join(root, ARCHIVE_DIRNAME),
    conflictsDir: path.join(root, CONFLICTS_DIRNAME),
    indexFile: path.join(root, INDEX_FILENAME),
  };
}

export async function ensureMemoryRoot(paths: MemoryPaths): Promise<void> {
  await migrateLegacyMemoryRoot(paths);
  await mkdir(paths.root, { recursive: true });
  await mkdir(paths.rawDir, { recursive: true });
  await mkdir(paths.wikiDir, { recursive: true });
  await mkdir(paths.schemaDir, { recursive: true });
  await mkdir(paths.logDir, { recursive: true });
  await mkdir(paths.queueDir, { recursive: true });
  await mkdir(paths.archiveDir, { recursive: true });
  await mkdir(paths.conflictsDir, { recursive: true });
}

async function migrateLegacyMemoryRoot(paths: MemoryPaths): Promise<void> {
  const legacyRoot = path.join(path.dirname(path.dirname(paths.root)), LEGACY_MEMORY_ROOT_DIRNAME);

  try {
    await mkdir(path.dirname(paths.root), { recursive: true });
    await rename(legacyRoot, paths.root);
    return;
  } catch (error) {
    if (!isRecoverableMigrationError(error)) {
      throw error;
    }
  }

  try {
    await cp(legacyRoot, paths.root, { recursive: true, errorOnExist: true });
  } catch (error) {
    if (!isRecoverableMigrationError(error)) {
      throw error;
    }
  }
}

function isRecoverableMigrationError(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    ["ENOENT", "EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "");
}
