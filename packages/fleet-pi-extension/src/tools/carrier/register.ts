/**
 * fleet/carrier/register.ts — 단일 carrier 등록 공용 로직
 *
 * 개별 carrier들이 공유하는 Carrier 프레임워크 등록 로직을 제공합니다.
 * 프롬프트 원본은 각 carrier가 소유하며, CarrierMetadata로 저장되어
 * Tier 1(compact roster)과 Tier 2(실행 시 자동 주입)에 사용됩니다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";

import { getLogAPI } from "../../config-bridge/log/bridge.js";
import { registerCarrier, reorderRegisteredByCliType } from "./framework.js";
import type { CarrierConfig, CarrierMetadata } from "@sbluemin/fleet-core/carrier";
import {
  CLI_DISPLAY_NAMES,
  CARRIER_COLORS,
  CARRIER_BG_COLORS,
} from "@sbluemin/fleet-core/constants";

const SHIPYARD_PROMPT_CATEGORY_BOOTSTRAP_KEY = "__fleet_shipyard_prompt_category_registered__";

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
 * - Carrier 프레임워크: 에이전트 패널 칼럼 등록, 메시지 렌더러
 * - CarrierMetadata: Tier 1(compact roster) + Tier 2(request 조합 정보)
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
    carrierMetadata: metadata,
  };
  registerCarrier(pi, config);

  // 등록 후 CliType 우선순위(claude→codex→gemini)로 순서 재정렬
  reorderRegisteredByCliType();
}

export function ensureShipyardLogCategories(): void {
  if ((globalThis as any)[SHIPYARD_PROMPT_CATEGORY_BOOTSTRAP_KEY]) {
    return;
  }
  (globalThis as any)[SHIPYARD_PROMPT_CATEGORY_BOOTSTRAP_KEY] = true;
  getLogAPI().registerCategory({
    id: "prompt",
    label: "Carrier Prompt",
    description: "캐리어 프롬프트 전문 로그",
  });
}
