/**
 * Codex JSONL 출력 파서
 * codex exec --json의 JSONL stdout을 ParsedDirectEvent로 변환합니다.
 */

import type { CodexJsonlEvent, ParsedDirectEvent } from '../../types/direct.js';

/**
 * Codex JSONL 이벤트를 ParsedDirectEvent로 변환합니다.
 *
 * @param event - 파싱된 Codex JSONL 이벤트
 * @returns 변환된 이벤트 (무시할 이벤트인 경우 null)
 */
export function parseCodexJsonlEvent(event: CodexJsonlEvent): ParsedDirectEvent | null {
  switch (event.type) {
    case 'thread.started':
      return {
        type: 'threadStarted',
        threadId: event.thread_id ?? undefined,
      };

    case 'item.started':
      if (event.item?.type === 'command_execution') {
        return {
          type: 'toolCall',
          title: event.item.command ?? '(command)',
        };
      }
      return null;

    case 'item.completed':
      if (event.item?.type === 'agent_message' && event.item.text) {
        return {
          type: 'messageChunk',
          text: event.item.text,
        };
      }
      return null;

    case 'turn.completed':
      return { type: 'turnCompleted' };

    default:
      return null;
  }
}

/**
 * Codex JSONL 라인을 파싱하여 ParsedDirectEvent로 변환합니다.
 *
 * @param line - JSONL 라인 문자열
 * @returns 변환된 이벤트 (파싱 실패 또는 무시할 이벤트인 경우 null)
 */
export function parseCodexLine(line: string): ParsedDirectEvent | null {
  try {
    const event = JSON.parse(line) as CodexJsonlEvent;
    return parseCodexJsonlEvent(event);
  } catch {
    return null;
  }
}
