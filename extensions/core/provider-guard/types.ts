/**
 * provider-guard/types.ts — globalThis 키 및 상태 인터페이스
 *
 * 초기 상태를 core-settings에서 로드하여 프로세스 재시작에도 On/Off 상태를 유지한다.
 * settings 로드 실패 시 기본값 enabled=true로 폴백한다.
 */

import { loadSettings } from "./settings.js";

// ── 타입/인터페이스 ──

export interface ProviderGuardState {
	/** guard 활성화 여부 (true = 필터링 적용) */
	enabled: boolean;
}

// ── 상수 ──

export const GUARD_GLOBAL_KEY = "__pi_provider_guard__";

// ── globalThis 초기화 ──

// 지연 초기화 — 이미 존재하면 유지 (세션 전환 시 상태 보존)
if (!(globalThis as any)[GUARD_GLOBAL_KEY]) {
	const saved = loadSettings();
	(globalThis as any)[GUARD_GLOBAL_KEY] = {
		enabled: saved.enabled ?? true,
	} satisfies ProviderGuardState;
}

// ── 함수 ──

export function getGuardState(): ProviderGuardState {
	return (globalThis as any)[GUARD_GLOBAL_KEY] as ProviderGuardState;
}
