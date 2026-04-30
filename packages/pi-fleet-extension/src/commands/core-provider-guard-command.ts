/**
 * Provider Guard — 허용 목록 외 프로바이더를 /model 목록에서 제거하는 토글 커맨드
 *
 * pi-coding-agent의 ModelRegistry는 빌트인 프로바이더 제거 API를 제공하지 않으므로
 * refresh() 메서드를 monkeypatch하여 매 호출 후 허용되지 않은 프로바이더의 모델을 필터링한다.
 *
 * session_start 패치와 상태 관리는 provider bucket의 provider-guard 모듈이 맡고,
 * 이 파일은 fleet:guard:toggle 커맨드 등록만 담당한다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import {
  enforceProviderGuardAllowedModel,
  filterProviderGuardModels,
  getGuardState,
  saveProviderGuardSettings,
} from "../provider/provider-guard.js";

export default function registerProviderGuardCommand(pi: ExtensionAPI) {
	pi.registerCommand("fleet:guard:toggle", {
		description: "프로바이더 가드 on/off 토글",
		handler: async (_args, ctx) => {
			const state = getGuardState();
			state.enabled = !state.enabled;

			// 영속 저장
			saveProviderGuardSettings({ enabled: state.enabled });

			const registry = ctx.modelRegistry as any;

			if (state.enabled) {
				// 가드 활성화 — 즉시 필터링 적용 + 현재 모델 검증
				filterProviderGuardModels(registry);
				enforceProviderGuardAllowedModel(pi, ctx);
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
