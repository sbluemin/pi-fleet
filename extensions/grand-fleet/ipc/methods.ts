/**
 * ipc/methods.ts — JSON-RPC 메서드 핸들러 일괄 등록 유틸리티
 *
 * Admiralty 측과 Fleet의 Admiral (제독) 측 메서드 핸들러를 각각 등록한다.
 * 실제 비즈니스 로직은 admiralty/, fleet/ 모듈에서 구현하며
 * 여기서는 라우팅 테이블만 구성한다.
 */
import type { AdmiraltyServer } from "./server.js";
import type { FleetClient } from "./client.js";

export interface AdmiraltyMethodHandlers {
  /** fleet.register — 함대 등록 */
  onFleetRegister: (
    params: Record<string, unknown>,
    fleetSocket: import("node:net").Socket,
  ) => Promise<unknown>;
  /** fleet.deregister — 함대 해제 (Notification) */
  onFleetDeregister: (
    params: Record<string, unknown>,
    fleetSocket: import("node:net").Socket,
  ) => void;
  /** fleet.heartbeat — 생존 신호 (Notification) */
  onFleetHeartbeat: (
    params: Record<string, unknown>,
    fleetSocket: import("node:net").Socket,
  ) => void;
  /** fleet.status — Carrier 상태 변경 (Notification) */
  onFleetStatus: (
    params: Record<string, unknown>,
    fleetSocket: import("node:net").Socket,
  ) => void;
  /** mission.report — 작전 보고 (Notification) */
  onMissionReport: (
    params: Record<string, unknown>,
    fleetSocket: import("node:net").Socket,
  ) => void;
}

export interface FleetMethodHandlers {
  /** mission.assign — 작전 수령 */
  onMissionAssign: (params: Record<string, unknown>) => Promise<unknown>;
  /** mission.abort — 작전 중단 */
  onMissionAbort: (params: Record<string, unknown>) => Promise<unknown>;
  /** session.new — 세션 초기화 */
  onSessionNew: (params: Record<string, unknown>) => Promise<unknown>;
  /** session.resume — 세션 복원 */
  onSessionResume: (params: Record<string, unknown>) => Promise<unknown>;
  /** session.suspend — 세션 정지 */
  onSessionSuspend: (params: Record<string, unknown>) => Promise<unknown>;
  /** fleet.ping — 상태 확인 */
  onFleetPing: (params: Record<string, unknown>) => Promise<unknown>;
}

export function registerAdmiraltyHandlers(
  server: AdmiraltyServer,
  handlers: AdmiraltyMethodHandlers,
): void {
  server.onRequest("fleet.register", handlers.onFleetRegister);
  server.onNotification("fleet.deregister", handlers.onFleetDeregister);
  server.onNotification("fleet.heartbeat", handlers.onFleetHeartbeat);
  server.onNotification("fleet.status", handlers.onFleetStatus);
  server.onNotification("mission.report", handlers.onMissionReport);
}

export function registerFleetHandlers(
  client: FleetClient,
  handlers: FleetMethodHandlers,
): void {
  client.onRequest("mission.assign", handlers.onMissionAssign);
  client.onRequest("mission.abort", handlers.onMissionAbort);
  client.onRequest("session.new", handlers.onSessionNew);
  client.onRequest("session.resume", handlers.onSessionResume);
  client.onRequest("session.suspend", handlers.onSessionSuspend);
  client.onRequest("fleet.ping", handlers.onFleetPing);
}
