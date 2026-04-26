import { Type } from "@sinclair/typebox";

import type { ToolPromptManifest } from "../admiral/tool-prompt-manifest/index.js";

export const MEMORY_INGEST_MANIFEST: ToolPromptManifest = {
  id: "memory_ingest",
  tag: "memory_ingest",
  title: "Fleet Memory Ingest",
  description: "워크스페이스 로컬 Fleet Memory 위키 패치를 제안합니다.",
  promptSnippet: "중요한 지식을 raw source와 함께 큐에 적재하고, 승인 전에는 위키를 직접 수정하지 마십시오.",
  whenToUse: [
    "사용자 요청이나 문서에서 장기 보관할 가치가 있는 지식을 위키 후보로 캡처할 때",
  ],
  whenNotToUse: [
    "즉시 실행만 필요하고 장기 기억으로 보관할 필요가 없을 때",
  ],
  usageGuidelines: [
    "wiki 변경은 반드시 queue 승인 흐름을 거칩니다.",
    "원본 소스는 raw 영역에 immutable하게 저장한 뒤 patch metadata에 raw ref를 남깁니다.",
  ],
};

export const MEMORY_BRIEFING_MANIFEST: ToolPromptManifest = {
  id: "memory_briefing",
  tag: "memory_briefing",
  title: "Fleet Memory Briefing",
  description: "Fleet Memory 위키에서 deterministic briefing을 조회합니다.",
  promptSnippet: "같은 입력에는 같은 정렬 결과를 반환하는 deterministic 검색 도구입니다.",
  whenToUse: [
    "이미 저장된 Fleet Memory 위키에서 반복 가능한 요약/근거 조회가 필요할 때",
  ],
  whenNotToUse: [
    "새 지식을 생성하거나 승인 대기 patch를 직접 병합하려고 할 때",
  ],
  usageGuidelines: [
    "임베딩이나 의미 검색 없이 id, tag, title, body 순으로 매칭합니다.",
  ],
};

export const MEMORY_AAR_MANIFEST: ToolPromptManifest = {
  id: "memory_aar_propose",
  tag: "memory_aar_propose",
  title: "Fleet Memory AAR",
  description: "AAR 로그 append 패치를 제안하거나 명시적으로 auto-apply 합니다.",
  promptSnippet: "AAR은 log에만 append할 수 있으며 auto_apply는 명시적으로 켜야 합니다.",
  whenToUse: [
    "실행 후 AAR을 append-only 로그로 남기거나 승인 대기 패치로 제안할 때",
  ],
  whenNotToUse: [
    "wiki 본문을 직접 갱신하려고 할 때",
  ],
  usageGuidelines: [
    "auto_apply=false 이면 queue만 기록합니다.",
    "auto_apply=true 여도 wiki는 절대 변경하지 않습니다.",
  ],
};

export const MEMORY_DRYDOCK_MANIFEST: ToolPromptManifest = {
  id: "memory_drydock",
  tag: "memory_drydock",
  title: "Fleet Memory Drydock",
  description: "Fleet Memory 저장소의 정적 건전성을 검사합니다.",
  promptSnippet: "frontmatter, 링크, queue 무결성을 검사해 file-first 보고를 제공합니다.",
  whenToUse: [
    "memory 저장소의 무결성, 링크, queue 상태를 점검할 때",
  ],
  whenNotToUse: [
    "새 patch를 만들거나 승인할 때",
  ],
  usageGuidelines: [
    "변경 없이 진단만 수행합니다.",
  ],
};

export const MEMORY_PATCH_QUEUE_MANIFEST: ToolPromptManifest = {
  id: "memory_patch_queue",
  tag: "memory_patch_queue",
  title: "Fleet Memory Patch Queue",
  description: "Fleet Memory patch queue를 list/show/approve/reject 합니다.",
  promptSnippet: "큐 항목을 검토하고 human approval gate를 집행합니다.",
  whenToUse: [
    "pending patch를 검토, 승인, 반려해야 할 때",
  ],
  whenNotToUse: [
    "raw source를 새로 저장하거나 위키 검색만 필요할 때",
  ],
  usageGuidelines: [
    "approve만 wiki/log mutation을 유발할 수 있습니다.",
    "reject는 archive만 갱신하고 wiki/log는 건드리지 않습니다.",
  ],
};

export const MEMORY_INGEST_DESCRIPTION = MEMORY_INGEST_MANIFEST.description;
export const MEMORY_BRIEFING_DESCRIPTION = MEMORY_BRIEFING_MANIFEST.description;
export const MEMORY_AAR_DESCRIPTION = MEMORY_AAR_MANIFEST.description;
export const MEMORY_DRYDOCK_DESCRIPTION = MEMORY_DRYDOCK_MANIFEST.description;
export const MEMORY_PATCH_QUEUE_DESCRIPTION = MEMORY_PATCH_QUEUE_MANIFEST.description;

export function buildMemoryIngestSchema() {
  return Type.Object({
    id: Type.String({ description: "위키 엔트리 ID" }),
    title: Type.String({ description: "위키 제목" }),
    body: Type.String({ description: "위키 본문 초안" }),
    tags: Type.Array(Type.String(), { description: "태그 목록" }),
    source: Type.String({ description: "immutable raw source로 저장할 원본 내용" }),
    source_type: Type.Optional(Type.String({ description: "raw source 종류. 기본값 inline" })),
    source_title: Type.Optional(Type.String({ description: "원본 제목 또는 파일명" })),
    proposer: Type.Optional(Type.String({ description: "제안자 식별자" })),
  });
}

export function buildMemoryBriefingSchema() {
  return Type.Object({
    topic: Type.Optional(Type.String({ description: "조회 주제 또는 위키 ID" })),
    tags: Type.Optional(Type.Array(Type.String(), { description: "필터 태그" })),
    limit: Type.Optional(Type.Number({ description: "최대 결과 수" })),
  });
}

export function buildMemoryAarSchema() {
  return Type.Object({
    id: Type.String({ description: "로그 엔트리 ID" }),
    kind: Type.String({ description: "AAR kind" }),
    title: Type.Optional(Type.String({ description: "로그 제목" })),
    body: Type.String({ description: "AAR 본문" }),
    tags: Type.Optional(Type.Array(Type.String(), { description: "태그 목록" })),
    refs: Type.Optional(Type.Array(Type.String(), { description: "참조 wiki ID" })),
    auto_apply: Type.Optional(Type.Boolean({ description: "true면 log와 archive에 즉시 반영" })),
    proposer: Type.Optional(Type.String({ description: "제안자 식별자" })),
  });
}

export function buildMemoryDryDockSchema() {
  return Type.Object({});
}

export function buildMemoryPatchQueueSchema() {
  return Type.Object({
    action: Type.Union([
      Type.Literal("list"),
      Type.Literal("show"),
      Type.Literal("approve"),
      Type.Literal("reject"),
    ], { description: "queue 작업" }),
    patch_id: Type.Optional(Type.String({ description: "대상 patch ID" })),
    reason: Type.Optional(Type.String({ description: "reject 사유" })),
  });
}
