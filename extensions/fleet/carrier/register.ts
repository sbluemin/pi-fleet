/**
 * fleet/carrier/register.ts — 단일 carrier 등록 공용 로직
 *
 * 개별 carrier들이 공유하는
 * Carrier + PI 도구 등록 로직을 제공합니다.
 *
 * 브리지 실행 책임은 carrier/ 아래 중앙화되며,
 * 프롬프트 원본은 각 carrier가 소유합니다.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";
import { Type } from "@sinclair/typebox";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import { registerCarrier } from "./framework.js";
import {
  refineSingleCarrierToolMetadata,
  type SingleCarrierToolMetadata,
} from "./prompts.js";
import { runAgentRequest } from "../operation-runner.js";
import { createToolResultRenderer } from "../internal/render/message-renderers.js";
import type { CarrierResult } from "./types.js";
import type { UnifiedAgentResult } from "../types.js";
import {
  CLI_DISPLAY_NAMES,
  CARRIER_COLORS,
  CARRIER_BG_COLORS,
} from "../constants.js";

const MAX_REQUEST_PREVIEW_LINES = 8;
const REQUEST_OVERFLOW_PREFIX = "··· ";
const SUMMARY_PREFIX = "Operation: ";

export interface SingleCarrierOptions {
  /** Alt+{slot} 키를 결정하는 슬롯 번호 */
  slot: number;
  /** carrierId 오버라이드 (미지정 시 cliType 사용) */
  id?: string;
  /** captain 표시 이름 오버라이드 (미지정 시 CLI 표시 이름 사용) */
  displayName?: string;
  /** 전경색 오버라이드 (미지정 시 cliType 시그니처 색상 사용) */
  color?: string;
  /** 배경색 오버라이드 (미지정 시 cliType 시그니처 색상 사용) */
  bgColor?: string;
}

// ─── 내부 헬퍼 ───────────────────────────────────────────

/** 에이전트 실행 결과를 PI 도구 반환 형식으로 변환 */
function toToolResult(carrierId: string, result: UnifiedAgentResult) {
  return {
    content: [{ type: "text" as const, text: result.responseText || "(no output)" }],
    details: {
      cli: carrierId,
      sessionId: result.sessionId ?? undefined,
      error: result.status !== "done" ? true : undefined,
      thinking: result.thinking || undefined,
      toolCalls: result.toolCalls && result.toolCalls.length > 0 ? result.toolCalls : undefined,
      blocks: result.blocks && result.blocks.length > 0 ? result.blocks : undefined,
    },
  };
}

/** 요청 원문에서 제독 시점의 한 줄 작전명을 추출합니다. */
function summarizeOperationName(request: string): string {
  const normalized = request
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[•·▪◦▶▸→⇒-]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "Awaiting orders";

  const noLead = normalized
    .replace(/^(please|kindly|can you|could you|would you|let'?s|pls)\s+/i, "")
    .replace(/^(분석해줘|분석해주세요|구현해줘|구현해주세요|수정해줘|수정해주세요|검토해줘|검토해주세요|정리해줘|정리해주세요)\s*/u, "")
    .trim();

  const summary = (noLead || normalized)
    .replace(/[.?!。！？]+$/u, "")
    .trim();

  return summary || "Awaiting orders";
}

/** 요청 원문을 하단 프리뷰 라인으로 정리합니다. */
function buildRequestPreviewLines(request: string, width: number, theme: any): string[] {
  const lines = request.split(/\r?\n/);
  const visibleLines = lines.slice(0, MAX_REQUEST_PREVIEW_LINES);
  const rendered = visibleLines.map((line) => theme.fg("dim", truncateToWidth(line, Math.max(0, width))));
  const hiddenCount = Math.max(0, lines.length - visibleLines.length);

  if (hiddenCount > 0) {
    rendered.push(theme.fg("dim", `${REQUEST_OVERFLOW_PREFIX}${hiddenCount} more lines`));
  }

  return rendered;
}

// ─── 공개 API ────────────────────────────────────────────

/**
 * 단일 carrier를 등록합니다 (Carrier + PI 도구).
 *
 * - Carrier: 단축키 토글, 에이전트 패널 독점 뷰, 입력 인터셉트
 * - PI 도구: PI가 도구 호출로 해당 에이전트에 작업 위임
 *
 * Carrier별 프롬프트 원본은 caller가 직접 전달하며,
 * 두 경로 모두 `runAgentRequest()`를 통해 실행됩니다.
 */
export function registerSingleCarrier(
  pi: ExtensionAPI,
  cli: CliType,
  toolMetadata: SingleCarrierToolMetadata,
  options: SingleCarrierOptions,
): void {
  const carrierId = options.id ?? cli;
  const displayName = options.displayName ?? CLI_DISPLAY_NAMES[cli] ?? cli;
  const slotKey = `alt+${options.slot}`;

  const refinedToolMetadata = refineSingleCarrierToolMetadata({
    displayName,
    metadata: toolMetadata,
  });

  // ── Carrier 등록 ──
  registerCarrier(pi, {
    id: carrierId,
    cliType: cli,
    slot: options.slot,
    displayName,
    color: options.color ?? CARRIER_COLORS[cli] ?? "",
    bgColor: options.bgColor ?? CARRIER_BG_COLORS[cli],
    bottomHint: ` ${slotKey} exit · alt+x cancel · alt+shift+m model `,
    showWorkingMessage: false,

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

  // ── PI 도구 등록 ──
  pi.registerTool({
    name: carrierId,
    label: displayName,
    description: refinedToolMetadata.description,
    promptSnippet: refinedToolMetadata.promptSnippet,
    promptGuidelines: refinedToolMetadata.promptGuidelines,
    parameters: Type.Object({
      request: Type.String({
        description: "The prompt/request to send to the agent",
      }),
    }),

    renderCall(args: { request?: string }, theme: any) {
      const raw = args.request?.trim() ?? "";
      const titleLabel = `Captain ${displayName}`;
      const title = theme.fg("toolTitle", theme.bold(titleLabel));
      const titleWidth = visibleWidth(title);
      const operationName = summarizeOperationName(raw);
      return {
        render(width: number): string[] {
          const summaryPrefixWidth = visibleWidth(SUMMARY_PREFIX);
          const summaryBudget = Math.max(0, width - titleWidth - 3 - summaryPrefixWidth);
          const summary = truncateToWidth(operationName, summaryBudget);
          const header = summaryBudget > 0
            ? `${title} ${theme.fg("dim", `· ${SUMMARY_PREFIX}${summary}`)}`
            : title;
          if (!raw) return [header];
          return [header, ...buildRequestPreviewLines(raw, width, theme)];
        },
        invalidate() {},
      };
    },

    renderResult: createToolResultRenderer({
      displayName,
      color: CARRIER_COLORS[cli] ?? undefined,
      bgColor: CARRIER_BG_COLORS[cli] ?? undefined,
    }),

    async execute(
      _id: string,
      params: { request: string },
      signal: AbortSignal | undefined,
      _onUpdate: any,
      ctx: ExtensionContext,
    ) {
      const request = params?.request?.trim();
      if (!request) throw new Error("`request` 파라미터가 비어있습니다.");
      const result = await runAgentRequest({
        cli,
        carrierId,
        request,
        ctx,
        signal,
      });
      return toToolResult(carrierId, result);
    },
  });
}
