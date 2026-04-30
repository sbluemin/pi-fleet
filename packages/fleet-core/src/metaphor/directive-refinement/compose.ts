import { getDirectiveRefinementSystemPrompt } from "./prompts.js";

export interface DirectiveRefinementComposeRequest {
  readonly worldviewEnabled: boolean;
  readonly userDirective: string;
}

export interface DirectiveRefinementComposeResult {
  readonly systemPrompt: string;
  readonly messages: readonly [{ readonly role: "user"; readonly content: string }];
}

export function composeDirectiveRefinementRequest(
  request: DirectiveRefinementComposeRequest,
): DirectiveRefinementComposeResult {
  return {
    systemPrompt: getDirectiveRefinementSystemPrompt(request.worldviewEnabled),
    messages: [{ role: "user", content: request.userDirective }],
  };
}
