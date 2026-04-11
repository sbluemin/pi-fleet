/**
 * core/acp-provider/schema-adapter — TypeBox JSON Schema → MCP 호환 스키마 변환
 *
 * pi의 Tool.parameters는 @sinclair/typebox 기반 JSON Schema 호환 출력이지만
 * $id, Kind, [Symbol] 등 TypeBox 전용 필드를 포함한다.
 * MCP(ACP)는 표준 JSON Schema (type: "object", properties, required)만 기대.
 *
 * imports → types/interfaces → constants → functions 순서 준수.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** TypeBox 전용 키 — MCP 스키마에서 제거 */
const TYPEBOX_KEYS = new Set([
  "$id",
  "Kind",
  "Hint",
  "$schema",
]);

// ═══════════════════════════════════════════════════════════════════════════
// Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * TypeBox JSON Schema 객체에서 MCP 호환 표준 JSON Schema를 추출.
 * TypeBox 전용 필드, Symbol 키를 제거하고 type/properties/required만 정제.
 *
 * @param schema - pi Tool.parameters (TypeBox 스키마 또는 JSON Schema 호환 객체)
 * @returns MCP inputSchema 호환 JSON Schema 객체
 */
export function convertToolSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }

  return cleanSchema(schema as Record<string, unknown>);
}

/** 재귀적으로 TypeBox 전용 키와 Symbol 키를 제거 */
function cleanSchema(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    // TypeBox 전용 키 제거
    if (TYPEBOX_KEYS.has(key)) continue;

    const value = obj[key];

    if (value === null || value === undefined) {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? cleanSchema(item as Record<string, unknown>)
          : item,
      );
    } else if (typeof value === "object") {
      result[key] = cleanSchema(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  // type이 없으면 "object"로 기본값 설정
  if (!result.type && result.properties) {
    result.type = "object";
  }

  return result;
}
