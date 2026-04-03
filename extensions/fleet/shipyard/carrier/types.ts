/**
 * fleet/carrier/types.ts — Carrier 프레임워크 타입 정의
 *
 * 외부 확장이 커스텀 Carrier를 등록할 때 사용하는
 * 공개 타입 및 내부 상태 타입을 정의합니다.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";

// ─── Carrier 메타데이터 (2-Tier) ────────────────────────

/** 구조화 요청 블록 정의 */
export interface RequestBlock {
  /** 태그 이름 (e.g., "objective", "scope") */
  tag: string;
  /** 1줄 설명 */
  hint: string;
  /** 필수 여부 */
  required: boolean;
}

/**
 * Carrier 메타데이터 — 2-Tier 구조
 *
 * - Tier 1 (Routing): 시스템 프롬프트에 carrier당 ~4줄의 compact roster로 상주
 * - Tier 2 (Composition): 실행 시점에만 request에 자동 주입
 */
export interface CarrierMetadata {
  // ── Tier 1: Routing (→ promptGuidelines compact roster) ──
  /** 직함 (e.g., "Chief Engineer") */
  title: string;
  /** 한줄 역할+특징 요약 */
  summary: string;
  /** 긍정 호출 조건 (N개, 짧은 구문) */
  whenToUse: string[];
  /** 부정 조건 한줄 (e.g., "architecture decisions (→oracle), bug hunting (→sentinel)") */
  whenNotToUse: string;

  // ── Tier 2: Composition (→ 실행 시 request에 자동 주입) ──
  /** 권한/제약 (여러 줄) */
  permissions: string[];
  /** 구조화 요청 블록 */
  requestBlocks: RequestBlock[];
  /** <output_format> 전체 블록 — framework가 request 끝에 자동 append */
  outputFormat: string;
  /** 일반 원칙 (carrier 고유 행동 지침, 2-3줄) */
  principles?: string[];
}

// ─── 공개 타입 ───────────────────────────────────────────

/** Carrier 프레임워크 globalThis 공유 키 */
export const CARRIER_FRAMEWORK_KEY = "__pi_direct_mode_framework__";

export interface CarrierConfig {
  /** 고유 식별자 (carrierId) → 메시지 `{id}-user/{id}-response`, 풀/세션 키 */
  id: string;
  /** 사용할 CLI 바이너리 타입 */
  cliType: CliType;
  /** 정렬 및 표시용 슬롯 번호 (키바인딩에는 사용되지 않음) */
  slot: number;
  /** 표시 이름 */
  displayName: string;
  /** 에이전트 패널 프레임 색상 (ANSI) */
  color: string;
  /** 응답 배경색 (ANSI, 선택) */
  bgColor?: string;
  /**
   * 실행 핸들러 — 사용자 입력 시 호출
   * 반환 결과가 `{id}-response` 메시지로 자동 출력됨
   */
  onExecute: (
    request: string,
    ctx: ExtensionContext,
    helpers: CarrierHelpers,
  ) => Promise<CarrierResult>;
  /** 커스텀 응답 렌더러 (없으면 기본 렌더러) */
  renderResponse?: (...args: any[]) => any;
  /** 커스텀 사용자 입력 렌더러 (없으면 기본 렌더러) */
  renderUser?: (...args: any[]) => any;
  /** 에이전트 패널 하단 힌트 커스터마이즈 */
  bottomHint?: string;
  /** PI 기본 Working 메시지 사용 여부 (기본: false, 에이전트 패널이 스트리밍 UI를 담당) */
  showWorkingMessage?: boolean;
  /** 사용자 정의 패널 칼럼 리스트 — Carrier 활성화 시 패널 칼럼을 이 리스트로 초기화 */
  clis?: readonly string[];
  /** carrier 메타데이터 (2-Tier: Routing + Composition) */
  carrierMetadata?: CarrierMetadata;
}

export interface CarrierHelpers {
  /** 메시지 전송 (pi.sendMessage 래핑) */
  sendMessage: (msg: any, opts?: any) => void;
  /** 현재 carrier 실행 취소 시그널 */
  signal: AbortSignal;
}

export interface CarrierResult {
  /** 응답 본문 */
  content: string;
  /** 추가 메타데이터 (렌더러에 전달) */
  details?: Record<string, unknown>;
}

// ─── 내부 상태 타입 ──────────────────────────────────────

export interface CarrierState {
  config: CarrierConfig;
  active: boolean;
  busy: boolean;
  abortController: AbortController | null;
  /** 이 carrier를 등록한 pi 인스턴스 (메시지 전송에 사용) */
  pi: ExtensionAPI;
  /** 현재 carrier가 PI 기본 Working 메시지를 소유하는지 여부 */
  ownsWorkingMessage: boolean;
}

export interface CarrierFrameworkState {
  /** 등록된 모든 carrier */
  modes: Map<string, CarrierState>;
  /** slot 순으로 정렬된 carrierId 목록 */
  registeredOrder: string[];
  /** 현재 활성 carrier ID (null = 기본 모드) */
  activeModeId: string | null;
  /** 입력 핸들러 등록 여부 (글로벌에서 1회만) */
  inputRegistered: boolean;
  /** carrier 취소 단축키 등록 여부 */
  cancelShortcutRegistered: boolean;
  /** 상태바 갱신 콜백 */
  statusUpdateCallbacks: Array<() => void>;
  /** sortie 비활성화된 carrier ID 집합 (독점 모드는 영향 없음) */
  sortieDisabledCarriers: Set<string>;
  /** sortie 가용 상태 변경 시 호출되는 콜백 */
  sortieStateChangeCallbacks: Array<() => void>;
  /**
   * carrier 등록 시 sortie 도구 재등록용 debounce 타이머
   * (복수 carrier 동시 등록 시 콜백이 N번 발화되는 것을 방지)
   */
  sortieRegisterTimer: ReturnType<typeof setTimeout> | null;
  /** Task Force 설정 변경 시 호출되는 콜백 */
  taskforceConfigChangeCallbacks: Array<() => void>;
}
