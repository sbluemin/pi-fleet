/**
 * admiral — Admiral 프롬프트 정책 및 세계관 확장
 *
 * 시스템 프롬프트 주입(before_agent_start), 세계관 토글 커맨드,
 * 프로토콜 전환 키바인드, 위젯 등록, 설정 팝업 섹션을 담당한다.
 *
 * fleet/carriers와 직접 의존 관계 없이 독립적으로 동작한다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { appendAdmiralSystemPrompt, isWorldviewEnabled, setWorldviewEnabled, REQUEST_DIRECTIVE_PROMPT } from "./prompts.js";
import { getSettingsAPI } from "../core/settings/bridge.js";
import { getKeybindAPI } from "../core/keybind/bridge.js";
import { getAllProtocols, getActiveProtocol, setActiveProtocol } from "./protocols/index.js";
import { registerProtocolWidget, updateProtocolWidget } from "./widget.js";
import registerRequestDirective from "./request-directive.js";

const ADMIRAL_EXTENSION_LOADED_KEY = "__pi_admiral_extension_loaded__";

export default function admiralExtension(pi: ExtensionAPI) {
  (globalThis as any)[ADMIRAL_EXTENSION_LOADED_KEY] = true;

  // ── 부팅 시 에디터 테두리 색상 초기화 ──
  const bootProtocol = getActiveProtocol();
  (globalThis as any)["__pi_hud_editor_border_color__"] = bootProtocol.color;

  registerAdmiralSettingsSection();
  registerRequestDirective(pi);
  registerProtocolKeybinds(pi);

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

  // ── 설정 팝업(Alt+/) 섹션 등록 + 위젯 등록 ──

  pi.on("session_start", (_event, ctx) => {
    registerAdmiralSettingsSection();
    registerProtocolWidget(ctx);
  });
  pi.on("session_tree", () => {
    registerAdmiralSettingsSection();
  });
  pi.on("session_shutdown", () => {
    delete (globalThis as any)[ADMIRAL_EXTENSION_LOADED_KEY];
  });
}

// ── 프로토콜 전환 키바인드 등록 ──

function registerProtocolKeybinds(_pi: ExtensionAPI): void {
  const keybind = getKeybindAPI();

  for (const protocol of getAllProtocols()) {
    keybind.register({
      extension: "admiral",
      action: `protocol:${protocol.id}`,
      defaultKey: `alt+${protocol.slot}`,
      description: `프로토콜 전환: ${protocol.name}`,
      category: "Admiral Protocol",
      handler: (ctx: any) => {
        const current = getActiveProtocol();
        if (current.id === protocol.id) {
          // 이미 활성 — 변경 없음
          return;
        }
        setActiveProtocol(protocol.id);
        (globalThis as any)["__pi_hud_editor_border_color__"] = protocol.color;
        ctx.ui.notify(`Protocol → ${protocol.name}`, "info");
        updateProtocolWidget(ctx);
      },
    });
  }
}

// ── 설정 섹션 등록 ──

function registerAdmiralSettingsSection(): void {
  const settingsApi = getSettingsAPI();
  settingsApi?.registerSection({
    key: "admiral",
    displayName: "Admiral",
    getDisplayFields() {
      const enabled = isWorldviewEnabled();
      const activeProtocol = getActiveProtocol();
      return [
        { label: "Worldview", value: enabled ? "ON" : "OFF", color: enabled ? "accent" : "dim" },
        { label: "Protocol", value: activeProtocol.shortLabel, color: "accent" },
      ];
    },
  });
}
