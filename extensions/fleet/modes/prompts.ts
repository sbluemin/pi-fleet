/**
 * fleet/modes/prompts.ts — All 모드 전용 프롬프트
 *
 * All 모드의 교차 보고서 합성 프롬프트를 관리합니다.
 * tools/prompts.ts의 도구 프롬프트와 분리하여 응집도를 높입니다.
 */

// ─── All 모드 교차 보고서 ─────────────────────────────────

/** 에이전트 응답 정보 (교차 보고서 생성용) */
export interface AgentResponse {
  cli: string;
  displayName: string;
  text: string;
}

/**
 * All 모드 교차 보고서 합성 프롬프트를 생성합니다.
 *
 * 3개 에이전트의 응답을 받아 PI가 교차 분석 보고서를 작성하도록 유도합니다.
 * 프롬프트는 영어로 작성하되, 출력은 한글로 지시합니다.
 */
export function crossReportPrompt(
  originalRequest: string,
  responses: AgentResponse[],
): string {
  const agentSections = responses
    .map((r) => `### ${r.displayName}\n\n${r.text.trim() || "(no response)"}`)
    .join("\n\n---\n\n");

  return `Below are responses from ${responses.length} AI coding agents to the same request.
Cross-analyze them and produce a structured report.

## Original Request
${originalRequest}

## Agent Responses

${agentSections}

---

Cross-analyze the responses above and produce a report in the following format.

# 🔀 Cross-Analysis Report

## 1. Consensus
Summarize the key points where all agents agree.
- Shared conclusions, identical approaches, and commonly cited facts.
- Higher agreement implies higher reliability.

## 2. Divergence
Analyze areas where agents differ in approach, implementation details, or conclusions.
- For each difference: specify which agent holds which position.
- Use a table format where comparison is helpful.
- Ignore superficial wording/style differences — focus on substantive divergences only.

## 3. Unique Insights
Extract valuable points mentioned by only one or two agents.
- Points or details the other agents missed but are worth noting.
- Attribute each insight to its source agent.

## 4. Recommendation
Based on the cross-analysis, provide a final actionable recommendation.
- Build on consensus, supplement with unique insights.
- Where divergence exists, argue which approach is more appropriate with reasoning.
- Write in an actionable, concrete form.

## 5. Confidence
Assess overall confidence in the synthesized conclusion:
- **High**: All agents agree on the core.
- **Medium**: Partial agreement, or 2 agree + 1 differs.
- **Low**: All agents differ, or significant uncertainty remains.
- Provide a one-sentence rationale.

---
Rules:
- Be concise. Each section should be focused and actionable.
- Use bullet points for clarity. Use tables where comparison is helpful.
- Do NOT simply repeat the original responses — synthesize and cross-reference.
- If all agents essentially say the same thing, note that clearly in Consensus and keep other sections brief.
- Write the entire report in Korean (한글).
- Do NOT include any greeting, preamble, or closing — start directly with the report header.`;
}
