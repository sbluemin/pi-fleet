/**
 * grand-fleet 확장의 공통 타입, 전역 상태 키, 프로토콜 상수를 정의한다.
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id: number | string;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: JsonRpcError;
  id: number | string;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcResponse
  | JsonRpcNotification;

export type FleetId = string;
export type MissionId = string;
export type SessionId = string;
export type Priority = "critical" | "high" | "normal" | "low";
export type FleetStatus = "idle" | "active" | "error";
export type CarrierStatus =
  | "idle"
  | "standby"
  | "active"
  | "done"
  | "error"
  | "unavailable";
export type CliBackend = "claude" | "codex" | "gemini";
export type ReportType = "progress" | "complete" | "failed" | "blocked";
export type DeregisterReason = "shutdown" | "user_request" | "error";
export type GrandFleetRole = "admiralty" | "fleet";

export interface CarrierInfo {
  status: CarrierStatus;
  cli?: CliBackend;
  task?: string;
  /** Task Force 구성 완료 여부 */
  tfConfigured?: boolean;
}

export type CarrierMap = Record<string, CarrierInfo>;

export interface ReportingPolicy {
  progressReports: boolean;
  intervalMinutes: number | null;
}

export interface PhaseRecord {
  executed: number[];
  skipped: Record<string, string>;
}

export interface FileStats {
  modified: number;
  created: number;
  deleted: number;
}

export interface ConnectedFleet {
  id: FleetId;
  operationalZone: string;
  sessionId: SessionId;
  protocolVersion: string;
  carriers: CarrierMap;
  status: FleetStatus;
  activeMissionId: MissionId | null;
  activeMissionObjective: string | null;
  cost: number;
  lastHeartbeat: number;
}

export interface FormationConfig {
  strategy: "auto-subdirs" | "manual-dirs" | "config-file";
  excludePatterns: string[];
}

export interface FleetEntry {
  id: FleetId;
  directory: string;
  status: "active" | "stopped" | "error";
  pid?: number;
  sessionId?: SessionId;
  lastHeartbeat?: string;
  cost?: { totalTokens: number; totalUsd: number };
}

export interface AdmiraltyConfig {
  sessionId?: SessionId;
  socketPath?: string;
}

export interface GrandFleetConfig {
  version: number;
  formation: FormationConfig;
  fleets: FleetEntry[];
  admiralty: AdmiraltyConfig;
}

export interface GrandFleetState {
  role: GrandFleetRole | null;
  fleetId: FleetId | null;
  socketPath: string | null;
  connectedFleets: Map<FleetId, ConnectedFleet>;
  totalCost: number;
  activeMissionId: MissionId | null;
  activeMissionObjective: string | null;
}

export const GRAND_FLEET_STATE_KEY = "__grand_fleet_state__";

export const GRAND_FLEET_ERRORS = {
  FLEET_ALREADY_REGISTERED: {
    code: -32001,
    message: "Fleet ID already registered",
  },
  FLEET_NOT_REGISTERED: {
    code: -32002,
    message: "Fleet not registered",
  },
  PROTOCOL_VERSION_MISMATCH: {
    code: -32003,
    message: "Protocol version mismatch",
  },
  MISSION_ALREADY_IN_PROGRESS: {
    code: -32010,
    message: "Mission already in progress",
  },
  MISSION_NOT_FOUND: {
    code: -32011,
    message: "Mission not found",
  },
  SESSION_NOT_FOUND: {
    code: -32020,
    message: "Session not found",
  },
  SESSION_OPERATION_FAILED: {
    code: -32021,
    message: "Session operation failed",
  },
} as const;

export const PROTOCOL_VERSION = "0.1";
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 90_000;
export const MAX_MESSAGE_SIZE = 1_048_576;
export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

export const DEFAULT_EXCLUDE_PATTERNS = [
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".grand-fleet",
  ".pi",
  "__pycache__",
  ".venv",
  "venv",
  "vendor",
  "target",
];
