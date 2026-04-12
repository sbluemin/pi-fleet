/**
 * protocols/types — Admiral Protocol 타입 정의
 *
 * Protocol은 상호 배타적으로 전환되는 워크플로우 지침이다.
 * 한 번에 하나의 Protocol만 활성화되며, Alt+N 키바인드로 전환한다.
 */

// ─────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────

/** 제어 모드 — 파이프라인 런타임 분기 근거 */
export type ControlMode = "autonomous" | "manual";

/** Admiral Protocol — 상호 배타적으로 전환되는 워크플로우 프롬프트 */
export interface AdmiralProtocol {
  /** 고유 식별자 (예: "fleet-action") */
  id: string;
  /** 표시 이름 (예: "Fleet Action Protocol") */
  name: string;
  /** 위젯 표시용 라벨 (예: "Fleet Action Protocol") */
  shortLabel: string;
  /** Alt+N 키바인드 슬롯 번호 (1부터 시작) */
  slot: number;
  /** ANSI 전경색 코드 — 위젯 + 에디터 테두리 색상 */
  color: string;
  /** 제어 모드 (기본: "autonomous") */
  controlMode: ControlMode;
  /** Standing Orders 주입 여부 (기본: true) */
  injectStandingOrders: boolean;
  /** 프로토콜 고유 Preamble — 미지정 시 기본 PROTOCOL_PREAMBLE 사용 */
  preamble?: string;
  /** 프로토콜 프롬프트 본문 */
  prompt: string;
}
