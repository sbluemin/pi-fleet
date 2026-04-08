/**
 * protocols/research — Research Protocol
 *
 * 탐색, 조사, 정보 수집에 특화된 프로토콜.
 * 정찰 → 분석 → 종합의 3단계로 구성된다.
 */

import type { AdmiralProtocol } from "./types.js";

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

export const RESEARCH: AdmiralProtocol = {
  id: "research",
  name: "Research Protocol",
  shortLabel: "Research",
  slot: 3,
  color: "\x1b[38;2;200;160;255m",  // 밝은 보라
  prompt: String.raw`## Research Protocol

A focused protocol for investigation, exploration, and information gathering tasks that require Carrier-assisted research but do not involve code changes.

### When this protocol fits
- Codebase exploration across many files or modules
- External library/repo investigation
- Technical research and comparison
- Root-cause investigation for bugs (analysis only, not fixing)
- Architecture survey and dependency mapping

### When to escalate to Fleet Action
If the research reveals a clear action plan that requires **implementation**, notify the Fleet Admiral and recommend switching to Fleet Action Protocol. Do not begin code changes under this protocol.

### Phase 1 — Reconnaissance
- Assess the research scope and select the right Carrier(s):
  - **Vanguard** for local codebase exploration, symbol tracing, web research
  - **Echelon** for external GitHub repos, library internals, upstream analysis
  - **Oracle** for technical path decisions and trade-off evaluation
- Sortie the selected Carrier(s). Bundle parallel recon into a single ${"``"}carriers_sortie${"``"} call when multiple Carriers are needed.

### Phase 2 — Analysis
- Synthesize Carrier results into a coherent understanding.
- If findings are incomplete or raise new questions, sortie additional Carriers for follow-up.
- Apply the Deep Dive Standing Order if results contain speculation.

### Phase 3 — Report
Deliver a structured research summary:
- **Findings** — Key discoveries organized by relevance.
- **Implications** — How the findings affect the current project or task.
- **Recommendations** — Suggested next steps (max 5 bullets).
- **Confidence** — Overall confidence level (high / medium / low) with justification.
- **Open questions** — Anything that remains unresolved.

### Constraints
- No code modification allowed under this protocol.
- Maximum 3 Carrier sorties per research cycle to control cost. If more are needed, report findings so far and request Fleet Admiral approval to continue.`,
};
