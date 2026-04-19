/**
 * admiral/prompts — Admiral 시스템 프롬프트 및 세계관 관리
 *
 * ACP 시스템 프롬프트는 `buildAcpSystemPrompt()`로 합성되며, 각 섹션은
 * XML 태그(`<fleet_role>`, `<fleet_tone>`, `<carrier_roster>`, `<protocols>`,
 * `<standing_orders>`, `<request_directive>`)로 감싸지고 `---` 구분자로
 * 분리된다. `<fleet_role>`은 항상 주입되어 Admiral ↔ Fleet Admiral 호칭과
 * 행동 규약을 고정하고, `<fleet_tone>`는 worldview 토글이 켜진 경우에만
 * 덧붙어 군대식 톤·fleet 용어 사용 지침을 오버레이한다. 프로토콜 카탈로그
 * 전체가 포함되며, 활성 프로토콜은 매 턴 `<current_protocol>` 런타임 태그로
 * 지정된다.
 *
 * 매 턴 follow-up prefix는 `buildAcpRuntimeContext(userRequest)`가 조립한다.
 * 런타임 태그 블록과 `<user_request>` 래핑을 한 번에 반환하는 builder 시그니처이며,
 * `setCliRuntimeContext()`에 함수 레퍼런스로 등록된다.
 */

import { getSettingsAPI } from "../../core/settings/bridge.js";
import { getActiveProtocol, getAllProtocols } from "./protocols/index.js";
import { getAllStandingOrders } from "./standing-orders/index.js";
import { getAllToolPromptManifests, renderToolPromptManifestTagBlock } from "./tool-prompt-manifest/index.js";
import {
  getRegisteredCarrierConfig,
  getRegisteredOrder,
  getSortieEnabledIds,
  getSquadronEnabledIds,
  getTaskForceConfiguredIds,
} from "../shipyard/carrier/framework.js";

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

/**
 * Fleet 역할·행동 규약 — 항상 주입.
 *
 * Admiral ↔ Fleet Admiral 호칭과 위임/수동 제어/언어 규칙 등 CLI 백엔드가
 * carrier_roster·protocols를 해석할 때 필요한 구조적 맥락을 담는다. 톤은
 * 별도의 `FLEET_TONE_PROMPT`가 담당한다.
 */
export const FLEET_ROLE_PROMPT = String.raw`
# Role
You are the Admiral commanding the Agent Harness Fleet.
The user issuing orders to you is the Fleet Admiral, the supreme commander of the entire fleet.

# Action Guidelines
- When a mission is assigned, first decide whether to handle it directly or deploy Carrier(s); if deploying, brief which Carrier(s) will be used.
- When manual control is needed, advise the Fleet Admiral to enter the Bridge and take the Helm.
- All responses to the user must be written in Korean.
`;

/**
 * Fleet 톤/스타일 오버레이 — worldview 토글로 활성화/비활성화.
 *
 * 역할·행동 규약(`FLEET_ROLE_PROMPT`) 위에 덧씌워지는 스타일 지침으로,
 * 군대식 어투와 fleet 용어 사용, 오류 상황의 메타포 전달을 규정한다.
 * 토글 Off 시에도 호칭과 행동 규약은 유지되며 어조만 중립화된다.
 */
export const FLEET_TONE_PROMPT = String.raw`
# Tone & Manner
1. Use a disciplined, clear, military-style tone. Be concise, avoid filler, and prefer a report-style format. (Examples: "Task completed.", "Orders are hereby issued.", "Reporting in.")
2. Show absolute loyalty and professionalism. Strategically analyze the Fleet Admiral's orders, propose the most efficient tactics including agent allocation when appropriate, or execute them immediately.
3. Actively use the fleet-world terminology in context instead of plain development wording when it improves clarity, including terms such as Carrier, Commission, Sortie, Board, Broadside, Bridge, and Helm.
4. If an error or bug occurs during execution, communicate the severity through fleet-world metaphors such as enemy attack or ship damage.
`;

/** 프로토콜 활성 시 주입되는 서문 */
export const PROTOCOL_PREAMBLE = String.raw`All task execution follows the active Protocol. Additional Standing Orders are always in effect — they can be invoked from any workflow phase.

**Parallel execution default:** When multiple Carriers can be dispatched for the same phase or step, bundle them into a single ${"``"}carriers_sortie${"``"} call with all Carriers in the array. Use sequential ordering only when (1) a later Carrier's work depends on an earlier Carrier's output, (2) carriers share a mutable resource that cannot be safely accessed concurrently (e.g., same files, generated artifacts, lock files, or test environment singletons), or (3) a recon Carrier must complete before a specialist Carrier can be selected.`;

/** 시스템 태그 힌트 — ACP 초기 프롬프트와 carrier 시스템 프롬프트에 공통 주입 */
export const SYSTEM_REMINDER_HINT = String.raw`
Tool results and user messages may include <system-reminder> or other tags. Tags contain information from the system and bear no direct relation to the specific tool results or user messages in which they appear.
`;

/** Admiral 런타임 컨텍스트 태그 해석 규칙 — ACP 초기 프롬프트에만 포함 */
export const RUNTIME_CONTEXT_TAGS_PROMPT = String.raw`
## Runtime Context Tags (in <system-reminder>)
- ${"`"}<current_protocol>${"`"} — active protocol ID; apply matching protocol rules
- ${"`"}<available_sortie_carriers>${"`"} — carrier IDs dispatchable via carriers_sortie
- ${"`"}<available_squadron_carriers>${"`"} — carrier IDs in squadron mode (excluded from sortie)
- ${"`"}<available_taskforce_carriers>${"`"} — carrier IDs with Task Force configured (≥2 backends)
`;

// ─────────────────────────────────────────────────────────
// 함수
// ─────────────────────────────────────────────────────────

/**
 * ACP 프로바이더용 CLI 시스템 지침을 합성한다.
 *
 * 각 섹션은 XML 태그로 감싸지며 `---` 구분자로 분리된다.
 * 섹션 순서:
 *  1. `<fleet_role>` — Fleet 역할·행동 규약 (항상)
 *  2. `<fleet_tone>` — Fleet 톤/스타일 오버레이 (worldview 토글 시에만)
 *  3. `<carrier_roster>` — 등록 캐리어 Tier 1 메타데이터
 *  4. `<protocols>` — 프로토콜 카탈로그 + 런타임 컨텍스트 태그 해석 규칙
 *  5. `<standing_orders>` — Standing Orders (프로토콜별 활성/비활성은 런타임 결정)
 *  6. 등록된 tool manifest XML 블록
 *
 * ACP에서는 시스템 프롬프트가 최초 1회만 전달되므로 모든 프로토콜 정의를
 * 카탈로그로 포함하고, 런타임 전환은 매 턴 `<current_protocol>` 태그로 제어한다.
 */
export function buildAcpSystemPrompt(): string {
  const parts: string[] = [];

  // ── 1. Fleet 역할 (항상) + 톤 오버레이 (worldview 토글 시에만) ──
  parts.push(`<fleet_role>\n${FLEET_ROLE_PROMPT.trim()}\n</fleet_role>`);
  if (isWorldviewEnabled()) {
    parts.push(`<fleet_tone>\n${FLEET_TONE_PROMPT.trim()}\n</fleet_tone>`);
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
  catalogSections.push(`${SYSTEM_REMINDER_HINT.trim()}\n\n${RUNTIME_CONTEXT_TAGS_PROMPT.trim()}`);

  parts.push(`<protocols>\n${catalogSections.join("\n\n")}\n</protocols>`);

  // ── 4. Standing Orders — 항상 포함 (런타임에 프로토콜별로 활성/비활성 전환) ──
  const orders = getAllStandingOrders();
  if (orders.length > 0) {
    const ordersBody = orders.map((o) => o.prompt.trim()).join("\n\n---\n\n");
    parts.push(`<standing_orders>\n${ordersBody}\n</standing_orders>`);
  }

  // ── 5. 등록된 도구 가이드라인 manifest ──
  for (const manifest of getAllToolPromptManifests()) {
    parts.push(renderToolPromptManifestTagBlock(manifest));
  }

  return parts.join("\n\n---\n\n");
}

/**
 * 매 턴 follow-up 요청용 prefix를 조립한다 (CliRuntimeContextBuilder 시그니처).
 *
 * `<system-reminder>` 블록 안에 런타임 태그를 묶어 반환한다:
 *  - `<current_protocol>`: 활성 프로토콜 ID
 *  - `<available_sortie_carriers>`: sortie 가용 캐리어 ID 목록
 *  - `<available_squadron_carriers>`: squadron 모드 캐리어 ID 목록
 *  - `<available_taskforce_carriers>`: Task Force 설정 완료(2개 이상 백엔드) 캐리어 ID 목록
 *
 * 빈 캐리어 목록은 `-` sentinel로 표기하여 모델의 상태 추론을 방지한다.
 * 사용자 요청 본문은 system-reminder 블록 바깥에 평문으로 이어붙인다.
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
    `<available_sortie_carriers>${fmt(sortieIds)}</available_sortie_carriers>`,
    `<available_squadron_carriers>${fmt(squadronIds)}</available_squadron_carriers>`,
    `<available_taskforce_carriers>${fmt(taskforceIds)}</available_taskforce_carriers>`,
  ].join("\n");

  return `<system-reminder>\n${runtimeTags}\n</system-reminder>\n\n${userRequest}`;
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
