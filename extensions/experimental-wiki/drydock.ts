import path from "node:path";

import { PATCH_FILENAME, PATCH_META_FILENAME, REQUIRED_LOG_FRONTMATTER_KEYS, REQUIRED_WIKI_FRONTMATTER_KEYS } from "./constants.js";
import { findUnsafeMemoryText } from "./safety.js";
import { listDirectoryNames, listFileNames, readJsonFile, readPatchFile } from "./store.js";
import type { DryDockIssue, DryDockReport, MemoryPaths, PatchMeta } from "./types.js";

const INLINE_RAW_SOURCE_REF_PATTERN = /(^|\n)raw_source_ref\s*:/i;

export async function runDryDock(paths: MemoryPaths): Promise<DryDockReport> {
  const issues: DryDockIssue[] = [];
  const wikiIds = new Map<string, string>();
  const parsedWikiFiles: Array<{ filePath: string; body: string }> = [];

  for (const fileName of await listFileNames(paths.wikiDir)) {
    if (!fileName.endsWith(".md")) continue;
    const filePath = path.join(paths.wikiDir, fileName);
    const content = await readPatchFile(filePath);
    issues.push(...safetyIssues(content, filePath));
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      issues.push(issue("missing_frontmatter", "error", "위키 frontmatter가 없습니다.", filePath));
      continue;
    }
    for (const key of REQUIRED_WIKI_FRONTMATTER_KEYS) {
      if (!(key in parsed.frontmatter)) {
        issues.push(issue("missing_frontmatter", "error", `위키 필수 키 누락: ${key}`, filePath));
      }
    }
    const id = String(parsed.frontmatter.id ?? "");
    if (wikiIds.has(id)) {
      issues.push(issue("duplicate_id", "error", `중복 wiki id: ${id}`, filePath));
    } else if (id) {
      wikiIds.set(id, filePath);
    }
    if (INLINE_RAW_SOURCE_REF_PATTERN.test(parsed.body)) {
      issues.push(issue("inline_raw_source_ref", "warning", "위키 본문에 inline raw_source_ref 잔여물이 있습니다.", filePath));
    }
    parsedWikiFiles.push({ filePath, body: parsed.body });
  }

  for (const parsedWikiFile of parsedWikiFiles) {
    for (const linkedId of extractWikiLinks(parsedWikiFile.body)) {
      if (!wikiIds.has(linkedId)) {
        issues.push(issue("broken_link", "error", `깨진 wiki 링크: ${linkedId}`, parsedWikiFile.filePath));
      }
    }
  }

  for (const fileName of await listFileNames(paths.logDir)) {
    if (!fileName.endsWith(".md")) continue;
    const filePath = path.join(paths.logDir, fileName);
    const content = await readPatchFile(filePath);
    issues.push(...safetyIssues(content, filePath));
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      issues.push(issue("missing_frontmatter", "error", "로그 frontmatter가 없습니다.", filePath));
      continue;
    }
    for (const key of REQUIRED_LOG_FRONTMATTER_KEYS) {
      if (!(key in parsed.frontmatter)) {
        issues.push(issue("missing_frontmatter", "error", `로그 필수 키 누락: ${key}`, filePath));
      }
    }
    const refs = Array.isArray(parsed.frontmatter.refs) ? parsed.frontmatter.refs.map(String) : [];
    for (const ref of refs) {
      if (!wikiIds.has(ref)) {
        issues.push(issue("orphan_log_ref", "warning", `존재하지 않는 wiki 참조: ${ref}`, filePath));
      }
    }
  }

  for (const fileName of await listFileNames(paths.rawDir)) {
    if (!fileName.endsWith(".md")) continue;
    const filePath = path.join(paths.rawDir, fileName);
    issues.push(...safetyIssues(await readPatchFile(filePath), filePath));
  }

  for (const queueId of await listDirectoryNames(paths.queueDir)) {
    const queueDir = path.join(paths.queueDir, queueId);
    try {
      const patchContent = await readPatchFile(path.join(queueDir, PATCH_FILENAME));
      issues.push(...safetyIssues(patchContent, path.join(queueDir, PATCH_FILENAME)));
      await readJsonFile<PatchMeta>(path.join(queueDir, PATCH_META_FILENAME));
    } catch {
      issues.push(issue("malformed_queue", "error", "손상된 queue 엔트리", queueDir));
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

function safetyIssues(content: string, filePath: string): DryDockIssue[] {
  return findUnsafeMemoryText(content).map((issueItem) => ({
    ...issueItem,
    path: filePath,
  }));
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const [, rawFrontmatter, body] = match;
  const frontmatter: Record<string, unknown> = {};
  for (const line of rawFrontmatter.split("\n")) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      const inner = rawValue.slice(1, -1).trim();
      frontmatter[key] = inner ? inner.split(",").map((item) => item.trim().replace(/^"(.*)"$/, "$1")) : [];
      continue;
    }
    frontmatter[key] = rawValue.replace(/^"(.*)"$/, "$1");
  }
  return { frontmatter, body };
}

function extractWikiLinks(body: string): string[] {
  return [...body.matchAll(/\[\[wiki:([^\]]+)\]\]/g)].map((match) => match[1]);
}

function issue(code: DryDockIssue["code"], severity: DryDockIssue["severity"], message: string, filePath: string): DryDockIssue {
  return {
    code,
    severity,
    message,
    path: filePath,
  };
}
