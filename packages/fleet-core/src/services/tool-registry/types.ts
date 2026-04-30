export interface ToolPromptManifest {
  id: string;
  tag: string;
  title: string;
  description: string;
  promptSnippet: string;
  whenToUse: string[];
  whenNotToUse: string[];
  usageGuidelines: string[];
  guardrails?: string[];
}
