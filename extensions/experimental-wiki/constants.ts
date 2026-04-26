export const LEGACY_MEMORY_ROOT_DIRNAME = ".fleet-memory";
export const WIKI_ROOT_DIRNAME = ".fleet/wiki";
export const RAW_DIRNAME = "raw";
export const WIKI_DIRNAME = "wiki";
export const SCHEMA_DIRNAME = "schema";
export const LOG_DIRNAME = "log";
export const QUEUE_DIRNAME = "queue";
export const ARCHIVE_DIRNAME = "archive";
export const CONFLICTS_DIRNAME = "conflicts";
export const INDEX_FILENAME = "index.json";
export const PATCH_FILENAME = "patch.md";
export const PATCH_META_FILENAME = "meta.json";

export const REQUIRED_WIKI_FRONTMATTER_KEYS = [
  "id",
  "title",
  "tags",
  "created",
  "updated",
  "version",
] as const;

export const REQUIRED_LOG_FRONTMATTER_KEYS = [
  "id",
  "created",
  "kind",
] as const;
