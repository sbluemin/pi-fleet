/**
 * admiral — Admiral 프롬프트 정책 및 세계관 확장
 *
 * 시스템 프롬프트 주입(before_agent_start), 세계관 토글 커맨드,
 * 설정 팝업 섹션을 담당한다.
 *
 * fleet/carriers와 직접 의존 관계 없이 독립적으로 동작한다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { appendAdmiralSystemPrompt, isWorldviewEnabled, setWorldviewEnabled, REQUEST_DIRECTIVE_PROMPT } from "./prompts.js";
import { getSettingsAPI } from "../core/settings/bridge.js";
import registerRequestDirective from "./request-directive.js";

const ADMIRAL_EXTENSION_LOADED_KEY = "__pi_admiral_extension_loaded__";

export default function admiralExtension(pi: ExtensionAPI) {
  (globalThis as any)[ADMIRAL_EXTENSION_LOADED_KEY] = true;
  registerAdmiralSettingsSection();
  registerRequestDirective(pi);

  // ── 시스템 프롬프트 주입 ──

  pi.on("before_agent_start", (event, _ctx) => {
    let prompt = appendAdmiralSystemPrompt(event.systemPrompt);
    // request_directive 가이드라인 추가 (prompts.ts 비수정)
    const directiveGuide = REQUEST_DIRECTIVE_PROMPT.trim();
    if (!prompt.includes(directiveGuide)) {
      prompt = prompt + "\n\n" + directiveGuide;
    }
    return { systemPrompt: prompt };
  });

  // ── 세계관 프롬프트 토글 커맨드 ──

  pi.registerCommand("fleet:admiral:worldview", {
    description: "세계관(fleet metaphor) 프롬프트 토글 (on/off)",
    handler: async (_args, ctx) => {
      const current = isWorldviewEnabled();
      const next = !current;
      setWorldviewEnabled(next);
      ctx.ui.notify(
        `Fleet Worldview → ${next ? "ON" : "OFF"} (다음 턴부터 적용)`,
        "info",
      );
    },
  });

  // ── 설정 팝업(Alt+/) 섹션 등록 ──

  pi.on("session_start", () => {
    registerAdmiralSettingsSection();
  });
  pi.on("session_tree", () => {
    registerAdmiralSettingsSection();
  });
  pi.on("session_shutdown", () => {
    delete (globalThis as any)[ADMIRAL_EXTENSION_LOADED_KEY];
  });
}

function registerAdmiralSettingsSection(): void {
  const settingsApi = getSettingsAPI();
  settingsApi?.registerSection({
    key: "admiral",
    displayName: "Admiral",
    getDisplayFields() {
      const enabled = isWorldviewEnabled();
      return [
        { label: "Worldview", value: enabled ? "ON" : "OFF", color: enabled ? "accent" : "dim" },
      ];
    },
  });
}
