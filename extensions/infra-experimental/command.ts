/**
 * infra-experimental/command.ts — /fleet:system:experimental 커맨드 핸들러
 *
 * 커맨드 로직 담당: enable, disable, status 처리 및 인자 자동완성.
 */

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import {
  isExperimentalEnabled,
  enableExperimental,
  disableExperimental,
  countExperimentalExtensions,
  experimentalDirExists,
} from "./store.js";
import { INFRA_SETTINGS_KEY } from "../infra-settings/types.js";
import type { InfraSettingsAPI } from "../infra-settings/types.js";

// infra-settings에 저장되는 섹션 키
const SETTINGS_SECTION_KEY = "infra-experimental";

/** infra-settings에 활성 상태 저장 */
function saveEnabledState(enabled: boolean): void {
  const infraApi = (globalThis as any)[INFRA_SETTINGS_KEY] as InfraSettingsAPI | undefined;
  infraApi?.save(SETTINGS_SECTION_KEY, { enabled });
}

// ── 자동완성 ──

const COMPLETIONS = [
  { value: "on", label: "on" },
  { value: "off", label: "off" },
  { value: "status", label: "status" },
];

/** /fleet:system:experimental 인자 자동완성 */
export function getArgumentCompletions(prefix: string) {
  if (!prefix) return COMPLETIONS;
  const filtered = COMPLETIONS.filter((i) => i.value.startsWith(prefix));
  return filtered.length > 0 ? filtered : null;
}

// ── 커맨드 진입점 ──

/** /fleet:system:experimental 핸들러 — 인자 파싱 후 분기 */
export async function handleCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
  let action = args.trim().toLowerCase();

  // 인자 없으면 선택 팝업
  if (!action) {
    const enabled = isExperimentalEnabled();
    const options = enabled
      ? ["Disable", "Status"]
      : ["Enable", "Status"];
    const choice = await ctx.ui.select("Experimental 기능", options);
    if (choice === undefined) return;
    action = choice.toLowerCase();
    if (action === "enable") action = "on";
    if (action === "disable") action = "off";
  }

  switch (action) {
    case "on":
      await handleEnable(ctx);
      break;
    case "off":
      await handleDisable(ctx);
      break;
    case "status":
      handleStatus(ctx);
      break;
    default:
      ctx.ui.notify("사용법: /fleet:system:experimental [on|off|status]", "warning");
  }
}

// ── 개별 핸들러 ──

async function handleEnable(ctx: ExtensionCommandContext): Promise<void> {
  try {
    if (isExperimentalEnabled()) {
      ctx.ui.notify("이미 활성화 상태입니다.", "info");
      return;
    }
    if (!experimentalDirExists()) {
      ctx.ui.notify("experimental/ 디렉토리가 없습니다.", "warning");
      return;
    }

    enableExperimental();
    saveEnabledState(true);
    const n = countExperimentalExtensions();

    if (n === 0) {
      ctx.ui.notify("활성화됨 (로드 가능한 확장 0개). 재로드합니다.", "warning");
    } else {
      ctx.ui.notify(`Experimental 활성화됨 (${n}개 확장). 재로드합니다.`, "info");
    }

    await ctx.reload();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Experimental 활성화 실패";
    ctx.ui.notify(message, "error");
  }
}

async function handleDisable(ctx: ExtensionCommandContext): Promise<void> {
  try {
    if (!isExperimentalEnabled()) {
      ctx.ui.notify("이미 비활성화 상태입니다.", "info");
      return;
    }

    disableExperimental();
    saveEnabledState(false);
    ctx.ui.notify("Experimental 비활성화됨. 재로드합니다.", "info");
    await ctx.reload();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Experimental 비활성화 실패";
    ctx.ui.notify(message, "error");
  }
}

function handleStatus(ctx: ExtensionCommandContext): void {
  try {
    const enabled = isExperimentalEnabled();
    const n = countExperimentalExtensions();
    const dirExists = experimentalDirExists();

    if (enabled && dirExists) {
      ctx.ui.notify(`Experimental: enabled (${n}개 확장)`, "info");
    } else if (enabled && !dirExists) {
      ctx.ui.notify("상태 불일치: enabled이나 experimental/ 디렉토리 없음", "warning");
    } else {
      ctx.ui.notify("Experimental: disabled", "info");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "상태 조회 실패";
    ctx.ui.notify(message, "error");
  }
}
