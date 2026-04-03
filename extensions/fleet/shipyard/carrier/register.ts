/**
 * fleet/carrier/register.ts — 단일 carrier 등록 공용 로직
 *
 * 개별 carrier들이 공유하는 Carrier 프레임워크 등록 로직을 제공합니다.
 * 프롬프트 원본은 각 carrier가 소유하며, CarrierConfig에 저장되어
 * carrier_sortie 도구의 프롬프트 합성에 사용됩니다.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";

import { registerCarrier, reorderRegisteredByCliType } from "./framework.js";
import { runAgentRequest } from "../../operation-runner.js";
import type { CarrierResult } from "./types.js";
import {
  CLI_DISPLAY_NAMES,
  CARRIER_COLORS,
  CARRIER_BG_COLORS,
  PANEL_EXCLUSIVE_HINT,
} from "../../constants.js";

/** carrier 프롬프트 메타데이터 (각 carrier 파일에서 전달) */
export interface CarrierToolMetadata {
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
}

export interface SingleCarrierOptions {
  /** 정렬 및 표시용 슬롯 번호 */
  slot: number;
  /** carrierId 오버라이드 (미지정 시 cliType 사용) */
  id?: string;
  /** carrier 표시 이름 오버라이드 (미지정 시 CLI 표시 이름 사용) */
  displayName?: string;
  /** 전경색 오버라이드 (미지정 시 cliType 시그니처 색상 사용) */
  color?: string;
  /** 배경색 오버라이드 (미지정 시 cliType 시그니처 색상 사용) */
  bgColor?: string;
}

// ─── 공개 API ────────────────────────────────────────────

/**
 * 단일 carrier를 등록합니다.
 *
 * - Carrier 프레임워크: 에이전트 패널 독점 뷰, 입력 인터셉트
 * - 프롬프트 메타데이터: CarrierConfig에 저장 → sortie 프롬프트 합성에 사용
 *
 * 독점 모드에서의 실행은 `runAgentRequest()`를 통해 처리됩니다.
 */
export function registerSingleCarrier(
  pi: ExtensionAPI,
  cli: CliType,
  toolMetadata: CarrierToolMetadata,
  options: SingleCarrierOptions,
): void {
  const carrierId = options.id ?? cli;
  const displayName = options.displayName ?? CLI_DISPLAY_NAMES[cli] ?? cli;
  // ── Carrier 등록 (프롬프트 메타데이터 포함) ──
  registerCarrier(pi, {
    id: carrierId,
    cliType: cli,
    slot: options.slot,
    displayName,
    color: options.color ?? CARRIER_COLORS[cli] ?? "",
    bgColor: options.bgColor ?? CARRIER_BG_COLORS[cli],
    bottomHint: PANEL_EXCLUSIVE_HINT,
    showWorkingMessage: false,
    carrierDescription: toolMetadata.description,
    carrierPromptSnippet: toolMetadata.promptSnippet,
    carrierPromptGuidelines: [...toolMetadata.promptGuidelines],

    onExecute: async (
      request: string,
      ctx: ExtensionContext,
      helpers,
    ): Promise<CarrierResult> => {
      const result = await runAgentRequest({
        cli,
        carrierId,
        request,
        ctx,
        signal: helpers.signal,
      });

      return {
        content: result.responseText || (result.status === "aborted" ? "(aborted)" : "(no output)"),
        details: {
          cli: carrierId,
          sessionId: result.sessionId,
          error: result.status !== "done" ? true : undefined,
          thinking: result.thinking,
          toolCalls: result.toolCalls?.length ? result.toolCalls : undefined,
          blocks: result.blocks?.length ? result.blocks : undefined,
        },
      };
    },
  });

  // 등록 후 CliType 우선순위(claude→codex→gemini)로 순서 재정렬
  reorderRegisteredByCliType();
}
