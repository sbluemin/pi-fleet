/**
 * ipc/methods.ts — JSON-RPC 메서드 핸들러 일괄 등록 유틸리티
 *
 * Admiralty 측과 Fleet의 Admiral (제독) 측 메서드 핸들러를 각각 등록한다.
 * 실제 비즈니스 로직은 admiralty/, fleet/ 모듈에서 구현하며
 * 여기서는 라우팅 테이블만 구성한다.
 */
export {
  registerAdmiraltyHandlers,
  registerFleetHandlers,
  type AdmiraltyMethodHandlers,
  type FleetMethodHandlers,
} from "../admiralty/methods.js";
