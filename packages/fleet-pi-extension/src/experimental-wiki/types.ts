export interface WikiEntryFrontmatter {
  id: string;
  title: string;
  tags: string[];
  created: string;
  updated: string;
  version: number;
  rawSourceRef?: string;
}

export interface WikiEntry extends WikiEntryFrontmatter {
  body: string;
}

export interface LogEntryFrontmatter {
  id: string;
  created: string;
  kind: string;
  title?: string;
  tags?: string[];
  refs?: string[];
}

export interface LogEntry extends LogEntryFrontmatter {
  body: string;
}

export interface RawSourceEntry {
  id: string;
  created: string;
  sourceType: "inline" | "file";
  title?: string;
  tags: string[];
  content: string;
}

export type PatchOp = "create_wiki" | "update_wiki" | "append_log";
export type PatchStatus = "pending" | "accepted" | "rejected";

export interface PatchFrontmatter {
  op: PatchOp;
  target: string;
  summary: string;
  proposer: string;
  created: string;
}

export interface Patch {
  frontmatter: PatchFrontmatter;
  body: string;
}

export interface PatchMeta {
  id: string;
  status: PatchStatus;
  createdAt: string;
  decidedAt?: string;
  reason?: string;
  rawSourceRef?: string;
  warnings?: string[];
}

export interface MemoryPaths {
  root: string;
  rawDir: string;
  wikiDir: string;
  schemaDir: string;
  logDir: string;
  queueDir: string;
  archiveDir: string;
  conflictsDir: string;
  indexFile: string;
}

export interface WikiIndexEntry {
  path: string;
  title: string;
  tags: string[];
  updated: string;
}

export interface BriefingHit {
  id: string;
  title: string;
  score: number;
  reason: "id" | "tag" | "title" | "body";
  excerpt: string;
  path: string;
  tags: string[];
  updated: string;
}

export interface DryDockIssue {
  code:
    | "missing_frontmatter"
    | "broken_link"
    | "duplicate_id"
    | "orphan_log_ref"
    | "malformed_queue"
    | "inline_raw_source_ref"
    | "unsafe_secret"
    | "prompt_injection";
  severity: "error" | "warning";
  message: string;
  path: string;
}

export interface WikiSafetyIssue {
  code: "unsafe_secret" | "prompt_injection";
  severity: "error" | "warning";
  message: string;
}

export interface DryDockReport {
  ok: boolean;
  issues: DryDockIssue[];
}
