/**
 * Provider Guard — 빌트인 프로바이더 비활성화 코어 확장
 *
 * 차단 대상 프로바이더를 더미 모델 하나로 교체하여
 * 기존 빌트인 모델을 전부 제거한다.
 * applyProviderConfig()는 models.length > 0일 때만 교체를 수행하므로
 * 빈 배열이 아닌 사용 불가능한 placeholder 모델을 등록한다.
 *
 * placeholder 모델이 활성 모델로 선택되는 것을 방지하기 위해
 * session_start / model_select 이벤트에서 자동 폴백을 수행한다.
 * 사용자 명령이나 토글 없이 항상 활성화된다.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// 차단 대상 프로바이더와 해당 API 타입 매핑
const BLOCKED_PROVIDERS = [
	{ name: "anthropic", api: "anthropic-messages" },
	{ name: "google-antigravity", api: "google-gemini-cli" },
	{ name: "google-gemini-cli", api: "google-gemini-cli" },
] as const;

// 차단된 모델 ID 집합 (빠른 조회용)
const BLOCKED_MODEL_IDS = new Set(
	BLOCKED_PROVIDERS.map(({ name }) => `${name}-blocked`),
);

// 선택 불가를 표시하는 placeholder 모델 공통 속성
const PLACEHOLDER_MODEL_BASE = {
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 0,
	maxTokens: 0,
} as const;

export default function providerGuard(pi: ExtensionAPI) {
	// 차단 프로바이더 등록 — 더미 모델 1개로 교체
	for (const { name, api } of BLOCKED_PROVIDERS) {
		pi.registerProvider(name, {
			baseUrl: "https://blocked.invalid",
			apiKey: "PROVIDER_GUARD_BLOCKED",
			api,
			models: [
				{
					id: `${name}-blocked`,
					name: `[Blocked] ${name}`,
					...PLACEHOLDER_MODEL_BASE,
				},
			],
		});
	}

	// 세션 시작 시 차단 모델이 활성 상태이면 폴백
	pi.on("session_start", (_event, ctx) => {
		enforceNonBlockedModel(pi, ctx);
	});

	// 모델 선택 시 차단 모델로 전환되면 즉시 폴백
	pi.on("model_select", (_event, ctx) => {
		enforceNonBlockedModel(pi, ctx);
	});
}

// --- 헬퍼 ---

/** 현재 모델이 차단 목록에 있는지 확인 */
function isBlockedModel(modelId: string | undefined): boolean {
	return modelId !== undefined && BLOCKED_MODEL_IDS.has(modelId);
}

/** 차단되지 않은 첫 번째 사용 가능한 모델 반환 */
function findAllowedFallback(ctx: ExtensionContext) {
	return ctx.modelRegistry.getAvailable().find(
		(m) => !BLOCKED_MODEL_IDS.has(m.id),
	);
}

/** 활성 모델이 차단 모델이면 허용된 모델로 자동 전환 */
function enforceNonBlockedModel(pi: ExtensionAPI, ctx: ExtensionContext) {
	if (!isBlockedModel(ctx.model?.id)) return;

	const fallback = findAllowedFallback(ctx);
	if (fallback) {
		pi.setModel(fallback);
	}
	// 폴백 모델이 없으면 현재 상태 유지 (안전한 실패)
}
