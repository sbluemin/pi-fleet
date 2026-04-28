/**
 * diagnostics-dummy-arith — 장기 지연 산술 도구 정의
 *
 * MCP 10분 타임아웃 차이를 재현하기 위한 더미 도구다.
 * 정확히 10분 30초 대기 후 산술 결과를 텍스트로 반환한다.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { getLogAPI } from "../../config-bridge/log/bridge.js";

type DummyArithOp = "add" | "sub" | "mul" | "div";

interface DummyArithParams {
  a: number;
  b: number;
  op: DummyArithOp;
}

const DUMMY_ARITH_DELAY_MS = 630_000;
const DUMMY_ARITH_LOG_CATEGORY = "dummy-arith";

export function buildDummyArithToolConfig() {
  return {
    name: "dummy_arith_delayed",
    label: "Dummy Arithmetic (Delayed)",
    description: "10분 30초 지연 후 산술 결과를 반환하는 MCP 타임아웃 검증용 더미 도구",
    parameters: Type.Object({
      a: Type.Number({
        description: "첫 번째 피연산자",
      }),
      b: Type.Number({
        description: "두 번째 피연산자",
      }),
      op: Type.Union([
        Type.Literal("add"),
        Type.Literal("sub"),
        Type.Literal("mul"),
        Type.Literal("div"),
      ], {
        description: "수행할 산술 연산",
      }),
    }),
    async execute(
      id: string,
      params: DummyArithParams,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ) {
      const log = getLogAPI();
      log.info(
        DUMMY_ARITH_LOG_CATEGORY,
        `start id=${id} op=${params.op} a=${params.a} b=${params.b} delayMs=${DUMMY_ARITH_DELAY_MS}`,
      );

      await waitForDelay(signal);

      const result = computeDummyArithResult(params);
      const opSymbol = getOpSymbol(params.op);
      const text = `${params.a} ${opSymbol} ${params.b} = ${result} (waited 10m30s)`;

      log.info(
        DUMMY_ARITH_LOG_CATEGORY,
        `finish id=${id} op=${params.op} result=${result}`,
      );

      return {
        content: [{ type: "text" as const, text }],
        details: {},
      };
    },
  };
}

function waitForDelay(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, DUMMY_ARITH_DELAY_MS);

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function computeDummyArithResult(params: DummyArithParams): number | string {
  switch (params.op) {
    case "add":
      return params.a + params.b;
    case "sub":
      return params.a - params.b;
    case "mul":
      return params.a * params.b;
    case "div":
      return params.b === 0 ? "Error: division by zero" : params.a / params.b;
  }
}

function getOpSymbol(op: DummyArithOp): string {
  switch (op) {
    case "add":
      return "+";
    case "sub":
      return "-";
    case "mul":
      return "*";
    case "div":
      return "/";
  }
}
