/**
 * admiral/prompts — Admiral 시스템 프롬프트 및 세계관 관리
 *
 * - FLEET_WORLDVIEW_PROMPT: 세계관 토글이 켜진 경우에만 주입
 * - Standing Orders: 항상 주입 (getAllStandingOrders)
 * - Active Protocol: 활성 프로토콜이 있을 때만 주입 (getActiveProtocol)
 * - REQUEST_DIRECTIVE_PROMPT: request_directive tool 가이드라인 (항상 주입)
 */

import { getSettingsAPI } from "../core/settings/bridge.js";
import { getActiveProtocol, getAllProtocols } from "./protocols/index.js";
import { getAllStandingOrders } from "./standing-orders/index.js";
import {
  getRegisteredOrder,
  getSortieEnabledIds,
  getSquadronEnabledIds,
} from "../fleet/shipyard/carrier/framework.js";
import { buildCarrierRoster } from "../fleet/shipyard/carrier/prompts.js";
import { getConfiguredTaskForceCarrierIds } from "../fleet/shipyard/store.js";

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
- ${"`"}<taskforce_configured_carriers>${"`"} — Carrier IDs with Task Force configuration completed. These carriers can be dispatched via ${"`"}carrier_taskforce${"`"} for cross-model validation.

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
 * 3계층 우선순위로 구성:
 *  1순위 admiral/: worldview, Standing Orders, 프로토콜 카탈로그, 런타임 전환 메타 지시, request_directive 가이드
 *  2순위 carriers/: Available Carriers 로스터
 *  3순위 fleet/shipyard/: carriers_sortie, carrier_taskforce, carrier_squadron 가이드라인
 *
 * pi 내부 주입(appendAdmiralSystemPrompt)과 달리, ACP에서는 시스템 프롬프트가
 * 최초 1회만 전달되므로 모든 프로토콜 정의를 카탈로그로 포함하고,
 * 런타임 전환은 매 턴 `<current_protocol>` 태그로 제어한다.
 */
export function buildAcpSystemPrompt(): string {
  const parts = buildAcpAdmiralDirectives();
  return parts.join("\n\n");
}

/**
 * 매 턴 사용자 메시지 앞에 주입할 런타임 컨텍스트를 생성한다.
 *
 * - `<current_protocol>`: 활성 프로토콜 ID
 * - `<sortie_carriers>`: sortie 가용 캐리어 ID 목록
 * - `<squadron_carriers>`: squadron 모드 캐리어 ID 목록
 * - `<taskforce_configured_carriers>`: Task Force 설정 완료 캐리어 ID 목록
 *
 * 빈 목록은 `-` sentinel로 표기하여 모델의 상태 추론을 방지한다.
 */
export function buildAcpRuntimeContext(): string {
  const protocol = getActiveProtocol();
  const registeredIds = getRegisteredOrder();

  // 순서 정규화: 모두 registeredOrder 기준으로 필터
  const sortieIds = getSortieEnabledIds();
  const squadronIds = registeredIds.filter(
    (id) => getSquadronEnabledIds().includes(id),
  );
  const taskforceIds = getConfiguredTaskForceCarrierIds(registeredIds);

  const fmt = (ids: string[]) => ids.length > 0 ? ids.join(",") : "-";

  return [
    `<current_protocol>${protocol.id}</current_protocol>`,
    `<sortie_carriers>${fmt(sortieIds)}</sortie_carriers>`,
    `<squadron_carriers>${fmt(squadronIds)}</squadron_carriers>`,
    `<taskforce_configured_carriers>${fmt(taskforceIds)}</taskforce_configured_carriers>`,
  ].join("\n");
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

/**
 * 시스템 프롬프트에 Admiral 지침을 추가한다.
 *
 * - FLEET_WORLDVIEW_PROMPT: worldview 토글이 켜진 경우에만 주입
 * - Standing Orders: 항상 주입 (getAllStandingOrders)
 * - Active Protocol: 활성 프로토콜의 PROTOCOL_PREAMBLE + prompt 주입
 */
export function appendAdmiralSystemPrompt(systemPrompt: string): string {
  const parts: string[] = [systemPrompt, ...buildAdmiralDirectives()];
  return parts.join("\n\n");
}

/**
 * ACP용 Admiral 지침을 합성한다.
 *
 * pi 내부용(buildAdmiralDirectives)과 달리:
 * - 활성 프로토콜 하나만이 아닌 **전체 프로토콜 카탈로그**를 포함
 * - 런타임 전환 메타 지시를 포함
 */
function buildAcpAdmiralDirectives(): string[] {
  const parts: string[] = [];

  if (isWorldviewEnabled()) {
    parts.push(FLEET_WORLDVIEW_PROMPT.trim());
  }

  // Standing Orders — 카탈로그에서 항상 포함 (런타임에 프로토콜별로 활성/비활성 전환)
  const orders = getAllStandingOrders();
  if (orders.length > 0) {
    const ordersBody = orders.map((o) => o.prompt.trim()).join("\n\n---\n\n");
    parts.push(`# Admiral Directives\n\n${ordersBody}`);
  }

  // 캐리어 로스터 — 등록된 모든 캐리어의 Tier 1 메타데이터 (라우팅용)
  const carrierIds = getRegisteredOrder();
  if (carrierIds.length > 0) {
    parts.push(buildCarrierRoster(carrierIds));
  }

  // 프로토콜 카탈로그 — 모든 프로토콜 정의를 포함
  parts.push(buildProtocolCatalog());

  parts.push(REQUEST_DIRECTIVE_PROMPT.trim());

  return parts;
}

/** 모든 프로토콜을 카탈로그 형태로 합성한다. */
function buildProtocolCatalog(): string {
  const protocols = getAllProtocols();
  const sections: string[] = [];

  sections.push(`# Protocols\n\n${PROTOCOL_PREAMBLE.trim()}`);

  // 각 프로토콜 정의
  const catalogEntries = protocols.map((p) => {
    const meta = [
      `- **ID**: \`${p.id}\``,
      `- **Control Mode**: ${p.controlMode}`,
      `- **Standing Orders**: ${p.injectStandingOrders ? "active" : "suspended"}`,
    ].join("\n");

    const preamble = p.preamble ? `\n\n${p.preamble.trim()}` : "";
    return `### ${p.name}\n\n${meta}${preamble}\n\n${p.prompt.trim()}`;
  });

  sections.push(`## Available Protocols\n\n${catalogEntries.join("\n\n---\n\n")}`);

  // 런타임 전환 메타 지시
  sections.push(RUNTIME_PROTOCOL_SWITCHING_PROMPT.trim());

  // 런타임 캐리어 편제 해석 규칙
  sections.push(RUNTIME_CARRIER_FORMATION_PROMPT.trim());

  return sections.join("\n\n");
}

function buildAdmiralDirectives(): string[] {
  const parts: string[] = [];
  const protocol = getActiveProtocol();

  if (isWorldviewEnabled()) {
    parts.push(FLEET_WORLDVIEW_PROMPT.trim());
  }

  if (protocol.injectStandingOrders) {
    const orders = getAllStandingOrders();
    if (orders.length > 0) {
      const ordersBody = orders.map((o) => o.prompt.trim()).join("\n\n---\n\n");
      parts.push(`# Admiral Directives\n\n${ordersBody}`);
    }
  }

  const preamble = protocol.preamble ?? PROTOCOL_PREAMBLE;
  parts.push(
    `# Protocols\n\n${preamble.trim()}\n\n${protocol.prompt.trim()}`,
  );
  parts.push(REQUEST_DIRECTIVE_PROMPT.trim());

  return parts;
}
