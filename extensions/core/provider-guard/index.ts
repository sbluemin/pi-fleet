/**
 * Provider Guard — 허용 목록 외 프로바이더를 /model 목록에서 제거하는 코어 확장
 *
 * pi-coding-agent의 ModelRegistry는 빌트인 프로바이더 제거 API를 제공하지 않으므로
 * refresh() 메서드를 monkeypatch하여 매 호출 후 허용되지 않은 프로바이더의 모델을 필터링한다.
 *
 * session_start 이벤트 시점에 ctx.modelRegistry 인스턴스에 패치를 적용하며,
 * 차단된 모델이 활성 모델로 선택되는 것을 방지하기 위한 폴백도 수행한다.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// /model 목록에 표시할 프로바이더 화이트리스트
const ALLOWED_PROVIDERS = new Set([
	"github-copilot",
	"openai",
	"Fleet ACP",
]);

export default function providerGuard(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		patchModelRegistry(ctx);
		enforceAllowedModel(pi, ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		enforceAllowedModel(pi, ctx);
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
		filterModels(registry);
	};

	// 최초 1회 즉시 필터링
	filterModels(registry);
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
