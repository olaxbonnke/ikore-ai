export class ZetarisError extends Error {
  readonly queryName: string;

  constructor(queryName: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ZetarisError";
    this.queryName = queryName;
  }
}

export class LLMError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LLMError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
