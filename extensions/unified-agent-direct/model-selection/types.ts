/**
 * model-selection/types.ts — 모델 선택 관련 타입
 */

// ─── 모델 선택 설정 ──────────────────────────────────────

/** 각 CLI별 모델 선택 설정 */
export interface ModelSelection {
  /** 선택된 모델 ID */
  model: string;
  /** Direct 모드 사용 여부 (codex 전용, ACP 우회) */
  direct?: boolean;
  /** Reasoning effort (codex, claude — SDK의 reasoningEffort.levels 기반) */
  effort?: string;
  /** Claude thinking budget_tokens (effort가 none이 아닐 때 사용) */
  budgetTokens?: number;
}

/** selected-models.json 전체 구조 */
export type SelectedModelsConfig = Record<string, ModelSelection>;

// ─── 프로바이더 정보 ─────────────────────────────────────

/** 프로바이더 모델 정보 */
export interface ProviderInfo {
  name: string;
  defaultModel: string;
  models: Array<{ modelId: string; name: string }>;
  reasoningEffort: { supported: boolean; levels?: string[]; default?: string };
}
