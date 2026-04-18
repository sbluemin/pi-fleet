/**
 * admiral/prompts — Admiral 시스템 프롬프트 및 세계관 관리
 *
 * ACP 시스템 프롬프트는 `buildAcpSystemPrompt()`로 합성되며, 각 섹션은
 * XML 태그(`<worldview>`, `<carrier_roster>`, `<protocols>`,
 * `<standing_orders>`, `<request_directive>`)로 감싸지고 `---` 구분자로
 * 분리된다. 프로토콜 카탈로그 전체가 포함되며, 활성 프로토콜은 매 턴
 * `<current_protocol>` 런타임 태그로 지정된다.
 *
 * 매 턴 follow-up prefix는 `buildAcpRuntimeContext(userRequest)`가 조립한다.
 * 런타임 태그 블록과 `<user_request>` 래핑을 한 번에 반환하는 builder 시그니처이며,
 * `setCliRuntimeContext()`에 함수 레퍼런스로 등록된다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { getSettingsAPI } from "../../core/settings/bridge.js";
import { getActiveProtocol, getAllProtocols } from "./protocols/index.js";
import { getAllStandingOrders } from "./standing-orders/index.js";
import {
  getRegisteredCarrierConfig,
  getRegisteredOrder,
  getSortieEnabledIds,
  getSquadronEnabledIds,
  getTaskForceConfiguredIds,
} from "../shipyard/carrier/framework.js";
import { buildSortieToolConfig } from "../shipyard/carrier/sortie.js";
import { buildTaskForceToolConfig } from "../shipyard/taskforce/index.js";
import { buildSquadronToolConfig } from "../shipyard/squadron/index.js";

// ─────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────

/** admiral 섹션 설정 타입 */
export interface AdmiralSettings {
  worldview?: boolean;
  activeProtocol?: string;
}

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

/** 세계관(fleet metaphor) 프롬프트 — 토글로 활성화/비활성화 */
export const FLEET_WORLDVIEW_PROMPT = String.raw`
# Role
You are the Admiral commanding the Agent Harness Fleet.
The user issuing orders to you is the Fleet Admiral, the supreme commander of the entire fleet.

# Tone & Manner
1. Use a disciplined, clear, military-style tone. Be concise, avoid filler, and prefer a report-style format. (Examples: "Task completed.", "Orders are hereby issued.", "Reporting in.")
2. Show absolute loyalty and professionalism. Strategically analyze the Fleet Admiral's orders, propose the most efficient tactics including agent allocation when appropriate, or execute them immediately.
3. Actively use the fleet-world terminology in context instead of plain development wording when it improves clarity, including terms such as Carrier, Commission, Sortie, Board, Broadside, Bridge, and Helm.

# Action Guidelines
- When a mission is assigned, first decide whether to handle it directly or deploy Carrier(s); if deploying, brief which Carrier(s) will be used.
- If an error or bug occurs during execution, communicate the severity through fleet-world metaphors such as enemy attack or ship damage.
- When manual control is needed, advise the Fleet Admiral to enter the Bridge and take the Helm.
- All responses to the user must be written in Korean.
`;

/** 프로토콜 활성 시 주입되는 서문 */
export const PROTOCOL_PREAMBLE = String.raw`All task execution follows the active Protocol. Additional Standing Orders are always in effect — they can be invoked from any workflow phase.

**Parallel execution default:** When multiple Carriers can be dispatched for the same phase or step, bundle them into a single ${"``"}carriers_sortie${"``"} call with all Carriers in the array. Use sequential ordering only when (1) a later Carrier's work depends on an earlier Carrier's output, (2) carriers share a mutable resource that cannot be safely accessed concurrently (e.g., same files, generated artifacts, lock files, or test environment singletons), or (3) a recon Carrier must complete before a specialist Carrier can be selected.`;

/** 런타임 프로토콜 전환 메타 지시 — ACP 초기 프롬프트에만 포함 */
export const RUNTIME_PROTOCOL_SWITCHING_PROMPT = String.raw`
## Runtime Protocol Switching

Each user message is prefixed with a ${"`"}<current_protocol>${"`"} tag indicating the currently active protocol.

**Rules:**
1. Always check the ${"`"}<current_protocol>${"`"} tag at the start of every user message.
2. Apply ONLY the protocol whose ID matches the tag value.
3. If the matched protocol has **Standing Orders: suspended**, do NOT apply Standing Orders for that turn.
4. If the matched protocol has **Standing Orders: active**, apply all Standing Orders as defined above.
5. When the protocol changes between turns, immediately switch your behavior — do not carry over rules from the previous protocol.
6. If the tag is missing, continue using the last known protocol.
`;

/** 런타임 캐리어 편제 상태 해석 규칙 — ACP 초기 프롬프트에만 포함 */
export const RUNTIME_CARRIER_FORMATION_PROMPT = String.raw`
## Runtime Carrier Formation

Each user message includes formation tags indicating the current carrier availability:

- ${"`"}<sortie_carriers>${"`"} — Carrier IDs available for ${"`"}carriers_sortie${"`"}. Only these carriers can be dispatched via sortie.
- ${"`"}<squadron_carriers>${"`"} — Carrier IDs assigned to squadron mode. These are excluded from sortie and operate independently.
- ${"`"}<taskforce_configured_carriers>${"`"} — Carrier IDs with Task Force configuration (≥2 backends) completed. These carriers can be dispatched via ${"`"}carrier_taskforce${"`"} for cross-model validation.

**Rules:**
1. Always check formation tags at the start of every user message.
2. These tags are **authoritative** — they override any carrier availability stated in the initial system prompt or tool schema.
3. A value of ${"`"}-${"`"} means no carriers are assigned to that formation.
4. ${"`"}sortie_carriers${"`"} and ${"`"}squadron_carriers${"`"} are mutually exclusive — a carrier cannot appear in both.
5. ${"`"}taskforce_configured_carriers${"`"} indicates capability, not exclusivity — a carrier may appear in both sortie and taskforce tags.
`;

/** request_directive tool 시스템 프롬프트 가이드라인 — 항상 주입 */
export const REQUEST_DIRECTIVE_PROMPT = String.raw`
## request_directive Tool Guidelines

Use ${"`"}request_directive${"`"} when you need the Fleet Admiral's judgment to proceed. This tool is for **strategic decisions**, not routine confirmations.

### When to use
1. **Ambiguity resolution** — The Fleet Admiral's orders contain unclear or conflicting requirements.
2. **Direction selection** — Multiple viable approaches exist, each with meaningful trade-offs.
3. **Scope confirmation** — The mission scope needs clarification before committing resources.
4. **Preference gathering** — Implementation details that depend on the Fleet Admiral's priorities.

### When NOT to use
- Routine status confirmations ("Should I proceed?", "Is this okay?").
- Questions you can answer by reading code or documentation.
- Asking for approval on something you've already decided — just do it.
- Rephrasing your analysis as a question to appear thorough.

### Usage guidelines
- Users will always see an "직접 입력" (type your own) option — do not include an "Other" choice in your options.
- Use ${"`"}multiSelect: true${"`"} when choices are not mutually exclusive.
- Question texts must be unique, and option labels must be unique within each question.
- If ${"`"}multiSelect${"`"} is true, do not attach ${"`"}preview${"`"} fields to its options.
- If you recommend a specific option, make it the first in the list and append "(Recommended)" to its label.
- Keep headers concise (max 12 chars) — they appear as tab labels.
- Use the optional ${"`"}preview${"`"} field when presenting concrete artifacts that the Fleet Admiral needs to visually compare (ASCII mockups, code snippets, config examples). Previews are only supported for single-select questions.

### Plan mode guard
In plan mode, use ${"`"}request_directive${"`"} to clarify requirements or choose between approaches **before** finalizing a plan. Do **not** use it to ask "Is the plan ready?" or "Should I execute?" — that is what plan approval is for.
`;

// ─────────────────────────────────────────────────────────
// 함수
// ─────────────────────────────────────────────────────────

/**
 * ACP 프로바이더용 CLI 시스템 지침을 합성한다.
 *
 * 각 섹션은 XML 태그로 감싸지며 `---` 구분자로 분리된다.
 * 섹션 순서:
 *  1. `<worldview>` — 세계관 프롬프트 (토글 시에만)
 *  2. `<carrier_roster>` — 등록 캐리어 Tier 1 메타데이터
 *  3. `<protocols>` — 프로토콜 카탈로그 + 런타임 전환/편제 메타 지시
 *  4. `<standing_orders>` — Standing Orders (프로토콜별 활성/비활성은 런타임 결정)
 *  5. `<request_directive>` — request_directive tool 사용 가이드라인
 *
 * ACP에서는 시스템 프롬프트가 최초 1회만 전달되므로 모든 프로토콜 정의를
 * 카탈로그로 포함하고, 런타임 전환은 매 턴 `<current_protocol>` 태그로 제어한다.
 */
export function buildAcpSystemPrompt(): string {
  const parts: string[] = [];

  // ── 1. Worldview (토글 시에만) ──
  if (isWorldviewEnabled()) {
    parts.push(`<worldview>\n${FLEET_WORLDVIEW_PROMPT.trim()}\n</worldview>`);
  }

  // ── 2. 캐리어 로스터 — 등록된 모든 캐리어의 Tier 1 메타데이터 (라우팅용) ──
  const carrierIds = getRegisteredOrder();
  if (carrierIds.length > 0) {
    parts.push(`<carrier_roster>\n${buildCarrierRoster(carrierIds)}\n</carrier_roster>`);
  }

  // ── 3. 프로토콜 카탈로그 — 모든 프로토콜 정의 + 런타임 전환 메타 지시 ──
  const protocols = getAllProtocols();
  const catalogSections: string[] = [];

  catalogSections.push(`# Protocols\n\n${PROTOCOL_PREAMBLE.trim()}`);

  const catalogEntries = protocols.map((p) => {
    const meta = [
      `- **ID**: \`${p.id}\``,
      `- **Control Mode**: ${p.controlMode}`,
      `- **Standing Orders**: ${p.injectStandingOrders ? "active" : "suspended"}`,
    ].join("\n");

    const preamble = p.preamble ? `\n\n${p.preamble.trim()}` : "";
    return `### ${p.name}\n\n${meta}${preamble}\n\n${p.prompt.trim()}`;
  });

  catalogSections.push(`## Available Protocols\n\n${catalogEntries.join("\n\n---\n\n")}`);
  catalogSections.push(RUNTIME_PROTOCOL_SWITCHING_PROMPT.trim());
  catalogSections.push(RUNTIME_CARRIER_FORMATION_PROMPT.trim());

  parts.push(`<protocols>\n${catalogSections.join("\n\n")}\n</protocols>`);

  // ── 4. Standing Orders — 항상 포함 (런타임에 프로토콜별로 활성/비활성 전환) ──
  const orders = getAllStandingOrders();
  if (orders.length > 0) {
    const ordersBody = orders.map((o) => o.prompt.trim()).join("\n\n---\n\n");
    parts.push(`<standing_orders>\n${ordersBody}\n</standing_orders>`);
  }

  // ── 5. request_directive 가이드라인 ──
  parts.push(`<request_directive>\n${REQUEST_DIRECTIVE_PROMPT.trim()}\n</request_directive>`);

  return parts.join("\n\n---\n\n");
}

/**
 * 매 턴 follow-up 요청용 prefix를 조립한다 (CliRuntimeContextBuilder 시그니처).
 *
 * 런타임 태그:
 *  - `<current_protocol>`: 활성 프로토콜 ID
 *  - `<sortie_carriers>`: sortie 가용 캐리어 ID 목록
 *  - `<squadron_carriers>`: squadron 모드 캐리어 ID 목록
 *  - `<taskforce_configured_carriers>`: Task Force 설정 완료(2개 이상 백엔드) 캐리어 ID 목록
 *
 * 그리고 사용자 요청 본문은 `<user_request>` 블록으로 감싸 마지막에 배치한다.
 * 빈 캐리어 목록은 `-` sentinel로 표기하여 모델의 상태 추론을 방지한다.
 */
export function buildAcpRuntimeContext(userRequest: string): string {
  const protocol = getActiveProtocol();
  const registeredIds = getRegisteredOrder();

  // 순서 정규화: 모두 registeredOrder 기준으로 필터
  const sortieIds = getSortieEnabledIds();
  const squadronIds = registeredIds.filter(
    (id) => getSquadronEnabledIds().includes(id),
  );
  const taskforceIds = registeredIds.filter(
    (id) => getTaskForceConfiguredIds().includes(id),
  );

  const fmt = (ids: string[]) => ids.length > 0 ? ids.join(",") : "-";

  const runtimeTags = [
    `<current_protocol>${protocol.id}</current_protocol>`,
    `<sortie_carriers>${fmt(sortieIds)}</sortie_carriers>`,
    `<squadron_carriers>${fmt(squadronIds)}</squadron_carriers>`,
    `<taskforce_configured_carriers>${fmt(taskforceIds)}</taskforce_configured_carriers>`,
  ].join("\n");

  return `${runtimeTags}\n\n<user_request>\n${userRequest}\n</user_request>`;
}

/** admiral 섹션에서 worldview 활성 여부를 읽는다 (기본: false). */
export function isWorldviewEnabled(): boolean {
  const api = getSettingsAPI();
  if (!api) return false;

  const cfg = api.load<AdmiralSettings>("admiral");
  return cfg.worldview === true;
}

/** admiral 섹션의 worldview 설정을 저장한다 (기존 설정 병합) */
export function setWorldviewEnabled(enabled: boolean): void {
  const api = getSettingsAPI();
  if (!api) return;
  const cfg = api.load<AdmiralSettings>("admiral");
  api.save("admiral", { ...cfg, worldview: enabled });
}

// ─────────────────────────────────────────────────────────
// pi 도구 등록 오너쉽 — Admiral이 pi.registerTool 호출자
// (shipyard는 도구 기능을 ToolDefinition 팩토리로 제공, 등록 행위는 admiral)
// ─────────────────────────────────────────────────────────

/** carriers_sortie 도구를 pi에 등록한다 (가용 Carrier가 없으면 no-op). */
export function registerSortieTool(pi: ExtensionAPI): void {
  const config = buildSortieToolConfig();
  if (config) pi.registerTool(config);
}

/** carrier_taskforce 도구를 pi에 등록한다 (가용 Carrier가 없으면 no-op). */
export function registerTaskForceTool(pi: ExtensionAPI): void {
  const config = buildTaskForceToolConfig();
  if (config) pi.registerTool(config);
}

/** carrier_squadron 도구를 pi에 등록한다 (가용 Carrier가 없으면 no-op). */
export function registerSquadronTool(pi: ExtensionAPI): void {
  const config = buildSquadronToolConfig();
  if (config) pi.registerTool(config);
}

/**
 * 등록 캐리어의 Tier 1 메타데이터로 compact roster 문자열을 조립한다.
 *
 * ACP 시스템 프롬프트의 `<carrier_roster>` 섹션 전용. Admiral이 직접
 * 조립 주체를 맡아 shipyard의 sortie 로스터 합성과 독립적으로 운영한다
 * (squadron/taskforce가 각자 자체 로스터를 조립하는 패턴과 동일).
 */
function buildCarrierRoster(carrierIds: string[]): string {
  const lines: string[] = [];
  lines.push(`## Available Carriers`);

  for (const carrierId of carrierIds) {
    const config = getRegisteredCarrierConfig(carrierId);
    if (!config) continue;

    const meta = config.carrierMetadata;
    if (!meta) {
      // 메타데이터 없는 carrier는 기본 1줄 표시
      lines.push(`- **${carrierId}** (${config.displayName}): Delegate tasks to ${config.displayName}.`);
      continue;
    }

    const name = config.displayName;
    lines.push(`- **${carrierId}** (${name} · ${meta.title}): ${meta.summary}`);
    lines.push(`  Use for: ${meta.whenToUse.join(", ")}.`);
    lines.push(`  NOT for: ${meta.whenNotToUse}`);
    if (meta.requestBlocks.length > 0) {
      const tags = meta.requestBlocks
        .map((b) => b.required ? `<${b.tag}>` : `<${b.tag}?>`)
        .join(" ");
      lines.push(`  Required request blocks — wrap content in these (? = optional): ${tags}`);
    }
  }

  return lines.join("\n");
}
