/**
 * core-provider-guard/settings.ts — 설정 파일 관리
 *
 * core-settings API를 통해 ~/.pi/fleet/settings.json의 "core-provider-guard" 섹션에서 읽고 쓴다.
 */

import { getSettingsAPI } from "../settings/bridge.js";
import type { CoreSettingsAPI } from "../settings/types.js";

/** 설정 파일 구조 */
export interface ProviderGuardSettings {
	/** guard 활성화 여부 (true = 필터링 적용) */
	enabled?: boolean;
}

const SECTION_KEY = "core-provider-guard";

/** 설정 로드 */
export function loadSettings(): ProviderGuardSettings {
	try {
		return getAPI().load<ProviderGuardSettings>(SECTION_KEY);
	} catch {
		return {};
	}
}

/** 설정 저장 */
export function saveSettings(settings: ProviderGuardSettings): void {
	getAPI().save(SECTION_KEY, settings);
}

function getAPI(): CoreSettingsAPI {
	const api = getSettingsAPI();
	if (!api) throw new Error("core-settings API not available");
	return api;
}
