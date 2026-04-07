/**
 * request_directive — Fleet Admiral에게 지시(directive)를 요청하는 도구
 *
 * claude-code의 AskUserQuestion을 pi 플랫폼의 ctx.ui.custom() API 기반으로 재구현.
 * questionnaire.ts 패턴을 따른다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// ─────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────

interface DirectiveOption {
  label: string;
  description: string;
  preview?: string;
}

interface DirectiveQuestion {
  question: string;
  header: string;
  options: DirectiveOption[];
  multiSelect?: boolean;
}

/** 선택지 + "직접 입력" 옵션을 합친 렌더용 타입 */
type RenderOption = DirectiveOption & { isOther?: boolean; selected?: boolean };

interface DirectiveAnswer {
  question: string;
  header: string;
  values: string[];
  wasCustom: boolean;
}

interface DirectiveResult {
  questions: DirectiveQuestion[];
  answers: DirectiveAnswer[];
  cancelled: boolean;
}

// ─────────────────────────────────────────────────────────
// 스키마 (TypeBox)
// ─────────────────────────────────────────────────────────

const HEADER_MAX_LENGTH = 12;

const DirectiveOptionSchema = Type.Object({
  label: Type.String({
    minLength: 1,
    description: "선택지 표시 텍스트. 간결하게 1-5단어.",
  }),
  description: Type.String({
    minLength: 1,
    description: "선택지 설명. 트레이드오프나 영향을 설명.",
  }),
  preview: Type.Optional(
    Type.String({
      description:
        "포커스 시 하단에 표시되는 프리뷰 텍스트. ASCII 목업, 코드 스니펫, 설정 예시 등에 사용. 단일 선택 질문에서만 지원.",
    }),
  ),
});

const DirectiveQuestionSchema = Type.Object({
  question: Type.String({
    minLength: 1,
    description:
      'Fleet Admiral에게 제시할 질문. 명확하고 구체적으로, 물음표로 끝낼 것. 예: "어떤 인증 방식을 사용할까요?"',
  }),
  header: Type.String({
    minLength: 1,
    maxLength: HEADER_MAX_LENGTH,
    description: `탭 바에 표시되는 짧은 라벨 (최대 ${HEADER_MAX_LENGTH}자). 예: "인증 방식", "Library", "Scope"`,
  }),
  options: Type.Array(DirectiveOptionSchema, {
    minItems: 2,
    maxItems: 4,
    description:
      "선택지 목록 (2-4개). 각각 명확히 구별되는 선택이어야 함. 'Other' 옵션은 자동 제공되므로 포함하지 말 것.",
  }),
  multiSelect: Type.Optional(Type.Boolean({
    default: false,
    description: "복수 선택 허용 여부. 상호 배타적이지 않은 선택지에 사용.",
  })),
});

const RequestDirectiveParams = Type.Object({
  questions: Type.Array(DirectiveQuestionSchema, {
    minItems: 1,
    maxItems: 4,
    description: "Fleet Admiral에게 요청할 질문 목록 (1-4개)",
  }),
});

// ─────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────

function errorResult(
  message: string,
  questions: DirectiveQuestion[] = [],
): { content: { type: "text"; text: string }[]; details: DirectiveResult } {
  return {
    content: [{ type: "text", text: message }],
    details: { questions, answers: [], cancelled: true },
  };
}

/** header 길이를 HEADER_MAX_LENGTH로 제한 */
function clampHeader(header: string): string {
  if (header.length <= HEADER_MAX_LENGTH) return header;
  return header.slice(0, HEADER_MAX_LENGTH - 1) + "…";
}

/** 프리뷰가 있는 질문인지 확인 */
function hasPreview(q: DirectiveQuestion): boolean {
  return !q.multiSelect && q.options.some((o) => o.preview);
}

function validateQuestions(questions: DirectiveQuestion[]): string | null {
  const seenQuestions = new Set<string>();

  for (const q of questions) {
    const normalizedQuestion = q.question.trim();
    if (!normalizedQuestion) {
      return "Error: 빈 질문은 허용되지 않습니다";
    }

    if (seenQuestions.has(normalizedQuestion)) {
      return `Error: 중복 질문이 있습니다: "${normalizedQuestion}"`;
    }
    seenQuestions.add(normalizedQuestion);

    const normalizedHeader = q.header.trim();
    if (!normalizedHeader) {
      return "Error: 빈 header는 허용되지 않습니다";
    }

    if (q.options.length < 2 || q.options.length > 4) {
      return `Error: "${normalizedHeader}" 질문의 선택지는 2-4개여야 합니다`;
    }

    const seenLabels = new Set<string>();
    for (const option of q.options) {
      const normalizedLabel = option.label.trim();
      if (!normalizedLabel) {
        return `Error: "${normalizedHeader}" 질문에 빈 선택지 라벨이 있습니다`;
      }
      if (seenLabels.has(normalizedLabel)) {
        return `Error: "${normalizedHeader}" 질문에 중복 선택지 라벨이 있습니다: "${normalizedLabel}"`;
      }
      seenLabels.add(normalizedLabel);
    }

    if (q.multiSelect && q.options.some((option) => option.preview)) {
      return `Error: "${normalizedHeader}" 질문은 multiSelect=true 이므로 preview를 사용할 수 없습니다`;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────
// 도구 등록
// ─────────────────────────────────────────────────────────

export default function registerRequestDirective(pi: ExtensionAPI) {
  pi.registerTool({
    name: "request_directive",
    label: "Request Directive",
    description:
      "Fleet Admiral(사용자)에게 전략적 지시를 요청한다. 모호성 해소, 요구사항 확인, 구현 방향 결정 등에 사용. 일상적 확인이 아닌 판단이 필요한 상황에서 호출할 것.",
    parameters: RequestDirectiveParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return errorResult("Error: UI 미지원 (비대화형 모드에서 실행 중)");
      }
      if (params.questions.length === 0) {
        return errorResult("Error: 질문이 제공되지 않았습니다");
      }

      // 질문 정규화
      const questions: DirectiveQuestion[] = params.questions.map((q) => ({
        ...q,
        header: clampHeader(q.header),
        multiSelect: q.multiSelect === true,
      }));
      const validationError = validateQuestions(questions);
      if (validationError) {
        return errorResult(validationError, questions);
      }

      const isMulti = questions.length > 1;
      const totalTabs = questions.length + (isMulti ? 1 : 0); // 멀티일 때만 Submit 탭 추가

      const result = await ctx.ui.custom<DirectiveResult>((tui, theme, _kb, done) => {
        // ── 상태 ──
        let currentTab = 0;
        let optionIndex = 0;
        let inputMode = false;
        let inputQuestionIdx = -1;
        let cachedWidth = -1;
        let cachedLines: string[] | undefined;
        const answers = new Map<number, DirectiveAnswer>(); // key: question index
        // multiSelect용 선택 상태 (question index → Set<option index>)
        const multiSelections = new Map<number, Set<number>>();

        // ── 에디터 (직접 입력용) ──
        const editorTheme: EditorTheme = {
          borderColor: (s) => theme.fg("accent", s),
          selectList: {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText: (t) => theme.fg("accent", t),
            description: (t) => theme.fg("muted", t),
            scrollInfo: (t) => theme.fg("dim", t),
            noMatch: (t) => theme.fg("warning", t),
          },
        };
        const editor = new Editor(tui, editorTheme);

        // ── 유틸 ──
        function refresh() {
          cachedWidth = -1;
          cachedLines = undefined;
          tui.requestRender();
        }

        function submit(cancelled: boolean) {
          done({
            questions,
            answers: Array.from(answers.values()),
            cancelled,
          });
        }

        function currentQuestion(): DirectiveQuestion | undefined {
          return questions[currentTab];
        }

        function currentOptions(): RenderOption[] {
          const q = currentQuestion();
          if (!q) return [];
          const selectedSet = multiSelections.get(currentTab);
          const opts: RenderOption[] = q.options.map((o, i) => ({
            ...o,
            selected: selectedSet?.has(i) ?? false,
          }));
          opts.push({ label: "직접 입력", description: "Fleet Admiral이 직접 지시를 작성합니다.", isOther: true });
          return opts;
        }

        function allAnswered(): boolean {
          return questions.every((_, i) => answers.has(i));
        }

        function advanceAfterAnswer() {
          if (!isMulti) {
            submit(false);
            return;
          }
          if (currentTab < questions.length - 1) {
            currentTab++;
          } else {
            currentTab = questions.length; // Submit 탭
          }
          optionIndex = 0;
          refresh();
        }

        function saveAnswer(qIdx: number, values: string[], wasCustom: boolean) {
          const q = questions[qIdx];
          answers.set(qIdx, {
            question: q.question,
            header: q.header,
            values,
            wasCustom,
          });
        }

        function getSelectedValues(qIdx: number): string[] {
          const q = questions[qIdx];
          const selected = multiSelections.get(qIdx);
          if (!q || !selected || selected.size === 0) return [];

          return Array.from(selected)
            .sort((a, b) => a - b)
            .map((i) => q.options[i])
            .filter((option): option is DirectiveOption => option !== undefined)
            .map((option) => option.label);
        }

        function syncMultiSelectionAnswer(qIdx: number): void {
          const values = getSelectedValues(qIdx);
          if (values.length === 0) {
            answers.delete(qIdx);
            return;
          }
          saveAnswer(qIdx, values, false);
        }

        /** multiSelect: 현재 선택 상태를 답변으로 저장 */
        function commitMultiSelect(qIdx: number) {
          const values = getSelectedValues(qIdx);
          if (values.length === 0) {
            answers.delete(qIdx);
            refresh();
            return;
          }
          saveAnswer(qIdx, values, false);
          advanceAfterAnswer();
        }

        // ── 에디터 제출 콜백 ──
        editor.onSubmit = (value) => {
          if (inputQuestionIdx < 0) return;
          const trimmed = value.trim() || "(지시 없음)";
          if (questions[inputQuestionIdx]?.multiSelect) {
            multiSelections.delete(inputQuestionIdx);
          }
          saveAnswer(inputQuestionIdx, [trimmed], true);
          inputMode = false;
          inputQuestionIdx = -1;
          editor.setText("");
          advanceAfterAnswer();
        };

        // ── 입력 처리 ──
        function handleInput(data: string) {
          // 직접 입력 모드
          if (inputMode) {
            if (matchesKey(data, Key.escape)) {
              inputMode = false;
              inputQuestionIdx = -1;
              editor.setText("");
              refresh();
              return;
            }
            editor.handleInput(data);
            refresh();
            return;
          }

          const q = currentQuestion();
          const opts = currentOptions();

          // 탭 네비게이션 (멀티 질문)
          if (isMulti) {
            if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
              currentTab = (currentTab + 1) % totalTabs;
              optionIndex = 0;
              refresh();
              return;
            }
            if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
              currentTab = (currentTab - 1 + totalTabs) % totalTabs;
              optionIndex = 0;
              refresh();
              return;
            }
          }

          // Submit 탭
          if (isMulti && currentTab === questions.length) {
            if (matchesKey(data, Key.enter) && allAnswered()) {
              submit(false);
            } else if (matchesKey(data, Key.escape)) {
              submit(true);
            }
            return;
          }

          // 옵션 네비게이션
          if (matchesKey(data, Key.up)) {
            optionIndex = Math.max(0, optionIndex - 1);
            refresh();
            return;
          }
          if (matchesKey(data, Key.down)) {
            optionIndex = Math.min(opts.length - 1, optionIndex + 1);
            refresh();
            return;
          }

          // 선택/토글
          if (matchesKey(data, Key.enter) && q) {
            const opt = opts[optionIndex];

            // "직접 입력" 옵션
            if (opt.isOther) {
              inputMode = true;
              inputQuestionIdx = currentTab;
              editor.setText("");
              refresh();
              return;
            }

            if (q.multiSelect) {
              // multiSelect: 선택된 항목이 있으면 확정, 없으면 현재 커서 항목을 선택 후 확정
              const sel = multiSelections.get(currentTab);
              if (!sel || sel.size === 0) {
                // 아무것도 토글하지 않은 상태 → 현재 커서 항목을 단일 선택처럼 처리
                saveAnswer(currentTab, [opt.label], false);
                advanceAfterAnswer();
              } else {
                commitMultiSelect(currentTab);
              }
              return;
            }

            // 단일 선택
            saveAnswer(currentTab, [opt.label], false);
            advanceAfterAnswer();
            return;
          }

          // multiSelect: Space로 토글
          if (matchesKey(data, Key.space) && q?.multiSelect) {
            const opt = opts[optionIndex];
            if (opt.isOther) {
              inputMode = true;
              inputQuestionIdx = currentTab;
              editor.setText("");
              refresh();
              return;
            }
            let selected = multiSelections.get(currentTab);
            if (!selected) {
              selected = new Set();
              multiSelections.set(currentTab, selected);
            }
            if (selected.has(optionIndex)) {
              selected.delete(optionIndex);
            } else {
              selected.add(optionIndex);
            }
            syncMultiSelectionAnswer(currentTab);
            refresh();
            return;
          }

          // 취소
          if (matchesKey(data, Key.escape)) {
            submit(true);
          }
        }

        // ── 렌더링 ──
        function render(width: number): string[] {
          if (cachedLines && cachedWidth === width) return cachedLines;
          cachedWidth = width;

          const lines: string[] = [];
          const q = currentQuestion();
          const opts = currentOptions();

          const add = (s: string) => lines.push(truncateToWidth(s, width));

          add(theme.fg("accent", "─".repeat(width)));
          add(theme.fg("accent", theme.bold(" ⚓ Directive Requested")));

          // 탭 바 (멀티 질문)
          if (isMulti) {
            lines.push("");
            const tabs: string[] = ["← "];
            for (let i = 0; i < questions.length; i++) {
              const isActive = i === currentTab;
              const isAnswered = answers.has(i);
              const lbl = questions[i].header;
              const box = isAnswered ? "■" : "□";
              const color = isAnswered ? "success" : "muted";
              const text = ` ${box} ${lbl} `;
              const styled = isActive
                ? theme.bg("selectedBg", theme.fg("text", text))
                : theme.fg(color, text);
              tabs.push(`${styled} `);
            }
            const canSubmit = allAnswered();
            const isSubmitTab = currentTab === questions.length;
            const submitText = " ✓ Submit ";
            const submitStyled = isSubmitTab
              ? theme.bg("selectedBg", theme.fg("text", submitText))
              : theme.fg(canSubmit ? "success" : "dim", submitText);
            tabs.push(`${submitStyled} →`);
            add(` ${tabs.join("")}`);
          }

          lines.push("");

          // 콘텐츠
          if (inputMode && q) {
            // 직접 입력 모드
            add(theme.fg("text", ` ${q.question}`));
            lines.push("");
            add(theme.fg("muted", " Fleet Admiral's response:"));
            for (const line of editor.render(width - 2)) {
              add(` ${line}`);
            }
            lines.push("");
            add(theme.fg("dim", " Enter → 제출 • Esc → 돌아가기"));
          } else if (isMulti && currentTab === questions.length) {
            // Submit 탭
            add(theme.fg("accent", theme.bold(" Directive Summary")));
            lines.push("");
            for (let i = 0; i < questions.length; i++) {
              const answer = answers.get(i);
              if (answer) {
                const prefix = answer.wasCustom ? "(직접 작성) " : "";
                const valStr = answer.values.join(", ");
                add(
                  `${theme.fg("muted", ` ${answer.header}: `)}${theme.fg("text", prefix + valStr)}`,
                );
              }
            }
            lines.push("");
            if (allAnswered()) {
              add(theme.fg("success", " Enter → 지시 제출"));
            } else {
              const missing = questions
                .filter((_, i) => !answers.has(i))
                .map((q) => q.header)
                .join(", ");
              add(theme.fg("warning", ` 미응답: ${missing}`));
            }
          } else if (q) {
            // 질문 + 선택지
            add(theme.fg("text", ` ${q.question}`));
            if (q.multiSelect) {
              add(theme.fg("dim", "   (Space: 토글 • Enter: 확정)"));
            }
            lines.push("");

            // 프리뷰 모드 여부 판단
            const showPreview = hasPreview(q);
            let previewContent: string | undefined;

            for (let i = 0; i < opts.length; i++) {
              const opt = opts[i];
              const isCursor = i === optionIndex;
              const isOther = opt.isOther === true;
              const isSelected = opt.selected === true;

              // 접두사
              let prefix: string;
              if (q.multiSelect && !isOther) {
                const check = isSelected ? "☑" : "☐";
                prefix = isCursor ? theme.fg("accent", `> ${check} `) : `  ${check} `;
              } else {
                prefix = isCursor ? theme.fg("accent", "> ") : "  ";
              }

              const color = isCursor ? "accent" : "text";
              const num = isOther ? "·" : `${i + 1}`;
              add(prefix + theme.fg(color, `${num}. ${opt.label}`));

              if (opt.description && !isOther) {
                add(`     ${theme.fg("muted", opt.description)}`);
              }

              // 프리뷰 수집 (현재 커서 위치)
              if (isCursor && showPreview && opt.preview) {
                previewContent = opt.preview;
              }
            }

            // 프리뷰 영역
            if (showPreview && previewContent) {
              lines.push("");
              add(theme.fg("accent", "── Preview ──"));
              const previewLines = previewContent.split("\n");
              for (const pl of previewLines) {
                add(` ${theme.fg("muted", pl)}`);
              }
            }
          }

          lines.push("");
          if (!inputMode) {
            const help = isMulti
              ? " Tab/←→ 탭 이동 • ↑↓ 선택 • Enter 확정 • Esc 취소"
              : q?.multiSelect
                ? " ↑↓ 이동 • Space 토글 • Enter 확정 • Esc 취소"
                : " ↑↓ 이동 • Enter 선택 • Esc 취소";
            add(theme.fg("dim", help));
          }
          add(theme.fg("accent", "─".repeat(width)));

          cachedLines = lines;
          return lines;
        }

        return {
          render,
          invalidate: () => {
            cachedWidth = -1;
            cachedLines = undefined;
          },
          handleInput,
        };
      });

      // ── 결과 처리 ──

      if (result.cancelled) {
        return {
          content: [{ type: "text", text: "Fleet Admiral이 지시 요청을 취소했습니다." }],
          details: result,
        };
      }

      const answerLines = result.answers.map((a) => {
        if (a.wasCustom) {
          return `${a.header}: Fleet Admiral's directive: ${a.values[0]}`;
        }
        const valStr = a.values.join(", ");
        return `${a.header}: Fleet Admiral selected: ${valStr}`;
      });

      return {
        content: [{ type: "text", text: answerLines.join("\n") }],
        details: result,
      };
    },

    renderCall(args, theme, _context) {
      const qs = (args.questions as DirectiveQuestion[]) || [];
      const count = qs.length;
      const headers = qs.map((q) => q.header || "?").join(", ");
      let text = theme.fg("toolTitle", theme.bold("request_directive "));
      text += theme.fg("muted", `${count}개 질문`);
      if (headers) {
        text += theme.fg("dim", ` (${truncateToWidth(headers, 40)})`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme, _context) {
      const details = result.details as DirectiveResult | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      if (details.cancelled) {
        return new Text(theme.fg("warning", "⚓ Directive cancelled"), 0, 0);
      }
      const lines = details.answers.map((a) => {
        const valStr = a.values.join(", ");
        if (a.wasCustom) {
          return `${theme.fg("success", "⚓ ")}${theme.fg("accent", a.header)}: ${theme.fg("muted", "(직접 작성) ")}${valStr}`;
        }
        return `${theme.fg("success", "⚓ ")}${theme.fg("accent", a.header)}: ${valStr}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
