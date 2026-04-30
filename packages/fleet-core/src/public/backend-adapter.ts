export interface BackendConnectOptions {
  readonly cwd: string;
  readonly model?: string;
  readonly signal?: AbortSignal;
  readonly metadata?: Record<string, unknown>;
}

export interface BackendRequest {
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly signal?: AbortSignal;
  readonly metadata?: Record<string, unknown>;
}

export interface BackendResponse {
  readonly text: string;
  readonly raw?: unknown;
}

export interface BackendSession {
  request(request: BackendRequest): AsyncIterable<BackendResponse> | Promise<BackendResponse>;
  close(): Promise<void>;
}

export interface BackendAdapter {
  connect(options: BackendConnectOptions): Promise<BackendSession>;
}
