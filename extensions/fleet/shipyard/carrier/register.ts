/**
 * fleet/carrier/register.ts — 단일 carrier 등록 공용 로직
 *
 * 개별 carrier들이 공유하는 Carrier 프레임워크 등록 로직을 제공합니다.
 * 프롬프트 원본은 각 carrier가 소유하며, CarrierMetadata로 저장되어
 * Tier 1(compact roster)과 Tier 2(실행 시 자동 주입)에 사용됩니다.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";

import { registerCarrier, reorderRegisteredByCliType } from "./framework.js";
import { runAgentRequest } from "../../operation-runner.js";
import type { CarrierConfig, CarrierMetadata, CarrierResult } from "./types.js";
import { composeTier2Request } from "./prompts.js";
import {
  CLI_DISPLAY_NAMES,
  CARRIER_COLORS,
  CARRIER_BG_COLORS,
  PANEL_EXCLUSIVE_HINT,
} from "../../constants.js";

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
 * - CarrierMetadata: Tier 1(compact roster) + Tier 2(실행 시 request 자동 주입)
 *
 * 독점 모드에서의 실행은 `runAgentRequest()`를 통해 처리됩니다.
 */
export function registerSingleCarrier(
  pi: ExtensionAPI,
  cli: CliType,
  metadata: CarrierMetadata,
  options: SingleCarrierOptions,
): void {
  const carrierId = options.id ?? cli;
  const displayName = options.displayName ?? CLI_DISPLAY_NAMES[cli] ?? cli;
  // ── Carrier 등록 (메타데이터 포함) ──
  const config: CarrierConfig = {
    id: carrierId,
    cliType: cli,
    defaultCliType: cli,
    slot: options.slot,
    displayName,
    color: options.color ?? CARRIER_COLORS[cli] ?? "",
    bgColor: options.bgColor ?? CARRIER_BG_COLORS[cli],
    bottomHint: PANEL_EXCLUSIVE_HINT,
    showWorkingMessage: false,
    carrierMetadata: metadata,

    onExecute: async (
      request: string,
      ctx: ExtensionContext,
      helpers,
    ): Promise<CarrierResult> => {
      // ── Tier 2: permissions + principles를 request 앞에, outputFormat을 끝에 자동 주입 ──
      const composedRequest = composeTier2Request(metadata, request);

      const result = await runAgentRequest({
        cli: config.cliType,
        carrierId,
        request: composedRequest,
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
  };
  registerCarrier(pi, config);

  // 등록 후 CliType 우선순위(claude→codex→gemini)로 순서 재정렬
  reorderRegisteredByCliType();
}

// composeTier2Request는 prompts.ts의 Tier 2 섹션에 위치합니다.
export { composeTier2Request } from "./prompts.js";
