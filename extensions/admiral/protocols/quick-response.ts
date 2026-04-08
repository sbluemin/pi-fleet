/**
 * protocols/quick-response — Quick Response Protocol
 *
 * 단순 질문, 조회, 설명 요청에 최적화된 경량 프로토콜.
 * 분석 1단계만 수행하며, 나머지 Phase는 자동 스킵된다.
 */

import type { AdmiralProtocol } from "./types.js";

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

export const QUICK_RESPONSE: AdmiralProtocol = {
  id: "quick-response",
  name: "Quick Response",
  shortLabel: "Quick Response",
  slot: 2,
  color: "\x1b[38;2;120;220;120m",  // 밝은 초록
  prompt: String.raw`## Quick Response Protocol

A lightweight protocol for questions, lookups, explanations, and small clarifications that do not require code changes or multi-phase execution.

### When this protocol fits
- Conceptual questions ("What does this function do?", "How does X work?")
- Quick lookups (find a file, read a symbol, check a config value)
- Explanations of existing code, architecture, or design decisions
- Small clarifications that require reading ≤5 files
- Status checks and summaries

### When to escalate to Fleet Action
If during analysis you discover the task requires **code changes, multi-Carrier coordination, or review cycles**, notify the Fleet Admiral and recommend switching to Fleet Action Protocol. Do not attempt to execute implementation work under this protocol.

### Workflow

**Step 1 — Assess & Respond**
- Read the relevant code/docs (up to ~5 files).
- If a Carrier would be faster or more accurate (e.g., Vanguard for codebase exploration, Echelon for GitHub research), delegate via a single ${"``"}carriers_sortie${"``"} call.
- Synthesize findings and respond directly.

**Step 2 — Deep Dive check**
- If your response contains speculation, apply the Deep Dive Standing Order (capped at depth 2).
- Otherwise, deliver the answer.

No completion report is required. No Phase 2-7 evaluation is needed.`,
};
