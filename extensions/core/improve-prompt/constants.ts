/**
 * core-improve-prompt/constants.ts — 타입, 상수, 검증
 */

// ── Reasoning 레벨 ──

export type ReasoningLevel = "off" | "low" | "medium" | "high";

export const REASONING_LEVELS: ReasoningLevel[] = ["off", "low", "medium", "high"];

export const REASONING_LABELS: Record<ReasoningLevel, string> = {
  off: "Off",
  low: "›  Low",
  medium: "»  Medium",
  high: "⋙  High",
};

/** 상태바 셰브론 색상 매핑 */
export const REASONING_COLORS: Record<ReasoningLevel, string> = {
  off: "dim",
  low: "success",
  medium: "warning",
  high: "error",
};

export function isValidReasoning(val: string): val is ReasoningLevel {
  return REASONING_LEVELS.includes(val as ReasoningLevel);
}

// ── 시스템 프롬프트 (prompts.ts에서 관리) ──

export { SYSTEM_INSTRUCTION } from "./prompts.js";
