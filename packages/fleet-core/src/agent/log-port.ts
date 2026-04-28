import type { FleetLogPort } from "../public/host-ports.js";

let agentLogPort: FleetLogPort = () => {};

export function setAgentLogPort(port: FleetLogPort | null): void {
  agentLogPort = port ?? (() => {});
}

export function agentLog(level: "debug" | "info" | "warn" | "error", message: string, details?: unknown): void {
  agentLogPort(level, message, details);
}
