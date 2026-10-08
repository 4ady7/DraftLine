export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class LostRaceError extends AppError {
  constructor() {
    super("The run changed while this action was in flight.", "CONFLICT", 409);
    this.name = "LostRaceError";
  }
}

export class MalformedModelOutputError extends AppError {
  constructor(detail: string) {
    super(`The model returned output that did not match the stage schema. ${detail}`.slice(0, 500), "MALFORMED_OUTPUT", 422);
    this.name = "MalformedModelOutputError";
  }
}

export class AITimeoutError extends AppError {
  constructor() {
    super("The model provider timed out.", "AI_TIMEOUT", 504);
    this.name = "AITimeoutError";
  }
}

export class AIProviderError extends AppError {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message, "AI_PROVIDER", retryable ? 503 : 502);
    this.name = "AIProviderError";
    this.retryable = retryable;
  }
}

export class SearchTimeoutError extends AppError {
  constructor() {
    super("The search provider timed out.", "SEARCH_TIMEOUT", 504);
    this.name = "SearchTimeoutError";
  }
}

export class ToolFailedError extends AppError {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message, "TOOL_FAILED", retryable ? 503 : 422);
    this.name = "ToolFailedError";
    this.retryable = retryable;
  }
}

export class DatabaseFaultError extends AppError {
  constructor() {
    super("The database write failed before the stage result could be saved.", "DATABASE", 503);
    this.name = "DatabaseFaultError";
  }
}

export function failureOf(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof MalformedModelOutputError) {
    return { message: "The model returned output that did not match the stage schema.", retryable: true };
  }
  if (error instanceof AITimeoutError) return { message: error.message, retryable: true };
  if (error instanceof SearchTimeoutError) return { message: error.message, retryable: true };
  if (error instanceof DatabaseFaultError) return { message: error.message, retryable: true };
  if (error instanceof AIProviderError) return { message: error.message, retryable: error.retryable };
  if (error instanceof ToolFailedError) return { message: error.message, retryable: error.retryable };
  if (error instanceof LostRaceError) return { message: error.message, retryable: false };
  if (error instanceof AppError) return { message: error.message, retryable: false };
  return { message: "The stage failed before it could save a result.", retryable: false };
}
