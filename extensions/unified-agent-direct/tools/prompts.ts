/**
 * unified-agent-direct/tools/prompts.ts — 에이전트 도구 등록용 AI 프롬프트
 *
 * claude, codex, gemini 도구의 description / promptSnippet / promptGuidelines를
 * 한 곳에서 관리합니다.
 */

/** 도구 설명 (description) */
export function toolDescription(displayName: string): string {
  return (
    `Delegate a task to the ${displayName} coding agent. ` +
    "The agent processes the request independently and returns the result."
  );
}

/** 도구 요약 (promptSnippet) */
export function toolPromptSnippet(displayName: string): string {
  return `Delegate task to ${displayName} — independent agent execution with live streaming`;
}

/** 도구 사용 가이드라인 (promptGuidelines) */
export function toolPromptGuidelines(displayName: string): string[] {
  return [
    `Use this tool to delegate a coding task to ${displayName}.`,
    "The agent has full access to the codebase and can read, write, and execute commands.",
    "Provide a clear, self-contained request — the agent does not share your conversation context.",
  ];
}
