import { getOperationNameSystemPrompt } from "./prompts.js";

export interface OperationNameComposeRequest {
  readonly worldviewEnabled: boolean;
  readonly preparedPrompt: string;
}

export interface OperationNameComposeResult {
  readonly systemPrompt: string;
  readonly messages: readonly [{ readonly role: "user"; readonly content: string }];
}

export function composeOperationNameRequest(request: OperationNameComposeRequest): OperationNameComposeResult {
  return {
    systemPrompt: getOperationNameSystemPrompt(request.worldviewEnabled),
    messages: [{ role: "user", content: request.preparedPrompt }],
  };
}
