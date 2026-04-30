import path from "node:path";

import { loadIndex, listWiki, readWikiEntry } from "./store.js";
import type { BriefingHit, MemoryPaths } from "./types.js";

interface BriefingQueryOptions {
  topic?: string;
  tags?: string[];
  limit?: number;
}

export async function briefingQuery(paths: MemoryPaths, options: BriefingQueryOptions): Promise<BriefingHit[]> {
  const topic = (options.topic ?? "").trim().toLowerCase();
  const tags = (options.tags ?? []).map((tag) => tag.toLowerCase());
  const limit = options.limit ?? 5;
  const wikiEntries = await listWiki(paths);
  const index = await loadIndex(paths);
  const hits: BriefingHit[] = [];

  for (const entry of wikiEntries) {
    if (!index[entry.id]) {
      index[entry.id] = {
        path: path.join("wiki", `${entry.id}.md`),
        title: entry.title,
        tags: entry.tags,
        updated: entry.updated,
      };
    }
  }

  if (topic && index[topic]) {
    const entry = await readWikiEntry(topic, paths);
    if (entry) hits.push(toHit(entry, 400, "id"));
  }

  for (const entry of wikiEntries) {
    const lowerTitle = entry.title.toLowerCase();
    const lowerBody = entry.body.toLowerCase();
    const lowerTags = entry.tags.map((tag) => tag.toLowerCase());

    if (tags.some((tag) => lowerTags.includes(tag))) {
      hits.push(toHit(entry, 300, "tag"));
      continue;
    }
    if (topic && lowerTitle.includes(topic)) {
      hits.push(toHit(entry, 200, "title"));
      continue;
    }
    if (topic && lowerBody.includes(topic)) {
      hits.push(toHit(entry, 100, "body"));
    }
  }

  return dedupeHits(hits)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit);
}

function toHit(entry: Awaited<ReturnType<typeof readWikiEntry>> extends infer T ? Exclude<T, null> : never, score: number, reason: BriefingHit["reason"]): BriefingHit {
  return {
    id: entry.id,
    title: entry.title,
    score,
    reason,
    excerpt: entry.body.slice(0, 160),
    path: path.join("wiki", `${entry.id}.md`),
    tags: entry.tags,
    updated: entry.updated,
  };
}

function dedupeHits(hits: BriefingHit[]): BriefingHit[] {
  const byId = new Map<string, BriefingHit>();
  for (const hit of hits) {
    const existing = byId.get(hit.id);
    if (!existing || hit.score > existing.score) {
      byId.set(hit.id, hit);
    }
  }
  return [...byId.values()];
}
