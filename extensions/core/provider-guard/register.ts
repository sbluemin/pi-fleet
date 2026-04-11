/**
 * Provider Guard — 허용 목록 외 프로바이더를 /model 목록에서 제거하는 코어 확장
 *
 * pi-coding-agent의 ModelRegistry는 빌트인 프로바이더 제거 API를 제공하지 않으므로
 * refresh() 메서드를 monkeypatch하여 매 호출 후 허용되지 않은 프로바이더의 모델을 필터링한다.
 *
 * session_start 이벤트 시점에 ctx.modelRegistry 인스턴스에 패치를 적용하며,
 * 차단된 모델이 활성 모델로 선택되는 것을 방지하기 위한 폴백도 수행한다.
 *
 * fleet:guard:toggle 커맨드로 필터링을 On/Off 할 수 있다.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { getGuardState } from "./types.js";
import { saveSettings } from "./settings.js";
import { getSettingsAPI } from "../settings/bridge.js";

// /model 목록에 표시할 프로바이더 화이트리스트
const ALLOWED_PROVIDERS = new Set([
	"openai-codex",
	"Fleet ACP",
]);

export default function providerGuard(pi: ExtensionAPI) {
	// ── 팝업 섹션 등록 ──

	const settingsApi = getSettingsAPI();
	settingsApi?.registerSection({
		key: "core-provider-guard",
		displayName: "Provider Guard",
		getDisplayFields() {
			const state = getGuardState();
			return [
				{
					label: "Status",
					value: state.enabled ? "ON" : "OFF",
					color: state.enabled ? "accent" : "dim",
				},
			];
		},
	});

	pi.on("session_start", (_event, ctx) => {
		patchModelRegistry(ctx);
		if (getGuardState().enabled) {
			enforceAllowedModel(pi, ctx);
		}
	});

	pi.on("model_select", (_event, ctx) => {
		if (getGuardState().enabled) {
			enforceAllowedModel(pi, ctx);
		}
	});

	// ── 슬래시 커맨드 등록 ──

	pi.registerCommand("fleet:guard:toggle", {
		description: "프로바이더 가드 on/off 토글",
		handler: async (_args, ctx) => {
			const state = getGuardState();
			state.enabled = !state.enabled;

			// 영속 저장
			saveSettings({ enabled: state.enabled });

			const registry = ctx.modelRegistry as any;

			if (state.enabled) {
				// 가드 활성화 — 즉시 필터링 적용 + 현재 모델 검증
				filterModels(registry);
				enforceAllowedModel(pi, ctx);
			} else {
				// 가드 비활성화 — 전체 프로바이더 복원
				registry.refresh();
			}

			ctx.ui.notify(
				`Provider Guard: ${state.enabled ? "ON" : "OFF"}`,
				"info",
			);
		},
	});
}

// --- 핵심 패치 ---

/** ModelRegistry.refresh()를 래핑하여 호출 후 차단 프로바이더 모델을 제거 */
function patchModelRegistry(ctx: ExtensionContext) {
	const registry = ctx.modelRegistry as any;

	// 이중 패치 방지
	if (registry.__providerGuardPatched) return;
	registry.__providerGuardPatched = true;

	const originalRefresh = registry.refresh.bind(registry);

	registry.refresh = () => {
		originalRefresh();
		if (getGuardState().enabled) {
			filterModels(registry);
		}
	};

	// 최초 1회 — 가드 활성 시 즉시 필터링
	if (getGuardState().enabled) {
		filterModels(registry);
	}
}

/** 허용되지 않은 프로바이더의 모델을 models 배열에서 제거 */
function filterModels(registry: any) {
	registry.models = registry.models.filter(
		(m: any) => ALLOWED_PROVIDERS.has(m.provider),
	);
}

// --- 폴백 ---

/** 현재 모델이 허용 목록 외이면 허용된 모델로 자동 전환 */
function enforceAllowedModel(pi: ExtensionAPI, ctx: ExtensionContext) {
	const current = ctx.model;
	if (!current || ALLOWED_PROVIDERS.has(current.provider)) return;

	const fallback = ctx.modelRegistry
		.getAvailable()
		.find((m) => ALLOWED_PROVIDERS.has(m.provider));

	if (fallback) {
		pi.setModel(fallback);
	}
}
