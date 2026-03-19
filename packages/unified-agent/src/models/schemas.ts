/**
 * 모델 레지스트리 Zod 스키마 및 타입 정의
 * models.json의 구조를 검증하고 타입을 추론합니다.
 */

import { z } from 'zod';

/** 개별 모델 항목 스키마 */
export const ModelEntrySchema = z.object({
  /** 모델 고유 식별자 (session/set_model에 전달되는 값) */
  modelId: z.string(),
  /** 사람이 읽을 수 있는 모델 이름 */
  name: z.string(),
  /** 모델 설명 (선택) */
  description: z.string().optional(),
});

/** reasoning effort 지원 스키마 (discriminated union) */
export const ReasoningEffortSchema = z.union([
  z.object({
    supported: z.literal(true),
    levels: z.array(z.string()).min(1),
    default: z.string(),
  }),
  z.object({
    supported: z.literal(false),
  }),
]);

/** 프로바이더 스키마 (교차 필드 검증 포함) */
export const ProviderSchema = z.object({
  /** 프로바이더 표시 이름 */
  name: z.string(),
  /** 기본 모델 ID */
  defaultModel: z.string(),
  /** 사용 가능한 모델 목록 */
  models: z.array(ModelEntrySchema).min(1),
  /** reasoning effort 설정 */
  reasoningEffort: ReasoningEffortSchema,
}).check((ctx) => {
  const ids = new Set(ctx.value.models.map((m) => m.modelId));

  if (!ids.has(ctx.value.defaultModel)) {
    ctx.issues.push({
      code: 'custom',
      input: ctx.value.defaultModel,
      message: `defaultModel "${ctx.value.defaultModel}"은(는) models 목록에 존재해야 합니다`,
      path: ['defaultModel'],
    });
  }

  const effort = ctx.value.reasoningEffort;
  if (effort.supported && !effort.levels.includes(effort.default)) {
    ctx.issues.push({
      code: 'custom',
      input: effort.default,
      message: `reasoningEffort.default "${effort.default}"은(는) levels 목록에 존재해야 합니다`,
      path: ['reasoningEffort', 'default'],
    });
  }
});

/** 모델 레지스트리 전체 스키마 */
export const ModelsRegistrySchema = z.object({
  /** 스키마 버전 */
  version: z.number().int().positive(),
  /** 최종 업데이트 시각 */
  updatedAt: z.string(),
  /** 프로바이더별 모델 정보 */
  providers: z.record(z.string(), ProviderSchema),
});

// ─── 타입 추론 ─────────────────────────────────────────

/** 개별 모델 항목 */
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

/** reasoning effort 설정 */
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

/** 프로바이더 모델 정보 */
export type ProviderModelInfo = z.infer<typeof ProviderSchema>;

/** 모델 레지스트리 전체 */
export type ModelsRegistry = z.infer<typeof ModelsRegistrySchema>;
