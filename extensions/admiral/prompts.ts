/**
 * admiral/prompts — Admiral 시스템 프롬프트 및 세계관 관리
 *
 * - FLEET_WORLDVIEW_PROMPT: 세계관 토글이 켜진 경우에만 주입
 * - Standing Orders: 항상 주입 (getAllStandingOrders)
 * - Active Protocol: 활성 프로토콜이 있을 때만 주입 (getActiveProtocol)
 * - REQUEST_DIRECTIVE_PROMPT: request_directive tool 가이드라인 (항상 주입)
 */

import { getSettingsAPI } from "../core/settings/bridge.js";
import { getActiveProtocol } from "./protocols/index.js";
import { getAllStandingOrders } from "./standing-orders/index.js";

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
  const parts: string[] = [systemPrompt];
  const protocol = getActiveProtocol();

  // [토글] 세계관 프롬프트
  if (isWorldviewEnabled()) {
    parts.push(FLEET_WORLDVIEW_PROMPT.trim());
  }

  // [분기] Standing Orders — 프로토콜 설정에 따라 주입 여부 결정
  if (protocol.injectStandingOrders) {
    const orders = getAllStandingOrders();
    if (orders.length > 0) {
      const ordersBody = orders.map((o) => o.prompt.trim()).join("\n\n---\n\n");
      parts.push(`# Admiral Directives\n\n${ordersBody}`);
    }
  }

  // [항상] 활성 프로토콜 서문 + 프롬프트 주입
  const preamble = protocol.preamble ?? PROTOCOL_PREAMBLE;
  parts.push(
    `# Protocols\n\n${preamble.trim()}\n\n${protocol.prompt.trim()}`,
  );

  return parts.join("\n\n");
}
