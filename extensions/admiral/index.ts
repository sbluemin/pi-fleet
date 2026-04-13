/**
 * admiral — Admiral 프롬프트 정책 및 세계관 확장
 *
 * 시스템 프롬프트 주입(before_agent_start), 세계관 토글 커맨드,
 * 프로토콜 전환 키바인드, 위젯 등록, 설정 팝업 섹션을 담당한다.
 *
 * fleet/carriers와 직접 의존 관계 없이 독립적으로 동작한다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { appendAdmiralSystemPrompt, buildAcpSystemPrompt, buildAcpRuntimeContext, isWorldviewEnabled, setWorldviewEnabled } from "./prompts.js";
import { setCliSystemPrompt, setCliRuntimeContext } from "../core/agentclientprotocol/provider-types.js";
import { PROVIDER_ID } from "../core/agentclientprotocol/provider-types.js";
import { getSettingsAPI } from "../core/settings/bridge.js";
import { getKeybindAPI } from "../core/keybind/bridge.js";
import { getAllProtocols, getActiveProtocol, setActiveProtocol } from "./protocols/index.js";
import { registerProtocolWidget, updateProtocolWidget } from "./widget.js";
import registerRequestDirective from "./request-directive.js";
import { setEditorBorderColor, setEditorRightLabel } from "../core/hud/border-bridge.js"; // [Fix-Low2] setter API 사용

const ADMIRAL_EXTENSION_LOADED_KEY = "__pi_admiral_extension_loaded__";

export default function admiralExtension(pi: ExtensionAPI) {
  (globalThis as any)[ADMIRAL_EXTENSION_LOADED_KEY] = true;

  // ── 부팅 시 에디터 테두리 색상 초기화 ──
  const bootProtocol = getActiveProtocol();
  syncProtocolToHud(bootProtocol); // [Fix-Low2] setter 경유

  registerAdmiralSettingsSection();
  registerRequestDirective(pi);
  registerProtocolKeybinds(pi);

  // ── 시스템 프롬프트 주입 ──

  pi.on("before_agent_start", (event, _ctx) => {
    // ACP 런타임 컨텍스트 갱신 — 매 턴 현재 프로토콜 상태 반영
    syncAcpRuntimeContext();
    return { systemPrompt: appendAdmiralSystemPrompt(event.systemPrompt) };
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
    // [Fix-Medium] settings API가 보장된 시점에 프로토콜 상태 재동기화
    const sessionProtocol = getActiveProtocol();
    syncProtocolToHud(sessionProtocol);
    registerAdmiralSettingsSection();
    registerProtocolWidget(ctx);

    // ACP 프로바이더 사용 시 CLI 전용 시스템 지침 설정
    syncAcpSystemPrompt(ctx);
  });
  pi.on("session_tree", () => {
    registerAdmiralSettingsSection();
  });
  pi.on("session_shutdown", () => {
    setCliSystemPrompt(null);
    setCliRuntimeContext(null);
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
        syncProtocolToHud(protocol); // [Fix-Low2] setter 경유
        syncAcpRuntimeContext(); // ACP 런타임 컨텍스트 즉시 갱신
        ctx.ui.notify(`Protocol → ${protocol.name}`, "info");
        updateProtocolWidget(ctx);
      },
    });
  }
}

// ── 프로토콜 HUD 동기화 헬퍼 ──

/** border color + right label을 일괄 갱신하는 내부 헬퍼 [Fix-Low2] */
function syncProtocolToHud(protocol: { color: string; shortLabel: string }): void {
  setEditorBorderColor(protocol.color);
  setEditorRightLabel(`${protocol.color}⚓ ${protocol.shortLabel}\x1b[0m`);
}

// ── 설정 섹션 등록 ──

/** ACP 프로바이더 사용 시 CLI 전용 시스템 지침을 합성·설정한다. */
function syncAcpSystemPrompt(ctx: any): void {
  const isAcp = ctx.model?.provider === PROVIDER_ID;
  if (isAcp) {
    setCliSystemPrompt(buildAcpSystemPrompt());
    syncAcpRuntimeContext();
  } else {
    setCliSystemPrompt(null);
    setCliRuntimeContext(null);
  }
}

/** ACP 런타임 컨텍스트를 현재 활성 프로토콜 기준으로 갱신한다. */
function syncAcpRuntimeContext(): void {
  setCliRuntimeContext(buildAcpRuntimeContext());
}

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
