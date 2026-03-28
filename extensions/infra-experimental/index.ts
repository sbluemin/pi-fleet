/**
 * infra-experimental — 실험적 확장 기능 관리
 *
 * 배선(wiring)만 담당:
 *   - globalThis API 등록
 *   - Settings 오버레이 섹션 등록
 *   - /fleet:system:experimental 커맨드 등록
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";


import { INFRA_EXPERIMENTAL_KEY } from "./types.js";
import type { InfraExperimentalAPI } from "./types.js";
import { INFRA_SETTINGS_KEY } from "../infra-settings/types.js";
import type { InfraSettingsAPI } from "../infra-settings/types.js";
import { getStatus } from "./store.js";
import { handleCommand, getArgumentCompletions } from "./command.js";

// ── globalThis API 즉시 등록 ──

const api: InfraExperimentalAPI = { getStatus };

// 다른 확장의 모듈 초기화 시점에도 접근 가능하도록
(globalThis as any)[INFRA_EXPERIMENTAL_KEY] = api;

// ── 확장 진입점 ──

export default function (pi: ExtensionAPI) {
  // ── Settings 오버레이 섹션 등록 ──
  // session_start에서 등록: 알파벳 순 로드로 인해 export default 실행 시점에
  // infra-settings(s)가 아직 globalThis에 등록되지 않았을 수 있으므로,
  // 모든 확장 로드가 완료된 session_start 이후에 호출한다.
  pi.on("session_start", async () => {
    const infraApi = (globalThis as any)[INFRA_SETTINGS_KEY] as InfraSettingsAPI | undefined;
    infraApi?.registerSection({
      key: "infra-experimental",
      displayName: "Experimental",
      getDisplayFields() {
        const status = getStatus();
        const enabledLabel = status.enabled ? "enabled" : "disabled";
        const enabledColor = status.mismatch ? "warning" : status.enabled ? "accent" : "dim";
        return [
          { label: "Status", value: enabledLabel, color: enabledColor },
          { label: "Extensions", value: `${status.extensionCount} found`, color: status.extensionCount > 0 ? "accent" : "dim" },
        ];
      },
    });
  });

  // ── /fleet:system:experimental 커맨드 등록 ──

  pi.registerCommand("fleet:system:experimental", {
    description: "실험 기능 활성/비활성 (on|off|status)",
    getArgumentCompletions,
    handler: handleCommand,
  });
}
