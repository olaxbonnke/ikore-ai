export interface ZetarisErrorOptions {
  status?: number;
  requestId?: string;
  queryName?: string;
  cause?: unknown;
}

export class ZetarisError extends Error {
  readonly status?: number;
  readonly requestId?: string;
  readonly queryName?: string;

  constructor(
    messageOrQueryName: string | ({ message: string } & ZetarisErrorOptions),
    messageOrOptions?: string | ZetarisErrorOptions,
    options?: ZetarisErrorOptions
  ) {
    if (typeof messageOrQueryName === "object") {
      super(messageOrQueryName.message, { cause: messageOrQueryName.cause });
      this.name = "ZetarisError";
      this.status = messageOrQueryName.status;
      this.requestId = messageOrQueryName.requestId;
      this.queryName = messageOrQueryName.queryName;
    } else if (typeof messageOrOptions === "string") {
      super(messageOrOptions, { cause: options?.cause });
      this.name = "ZetarisError";
      this.queryName = messageOrQueryName;
      this.status = options?.status;
      this.requestId = options?.requestId;
    } else {
      super(messageOrQueryName, { cause: messageOrOptions?.cause });
      this.name = "ZetarisError";
      this.status = messageOrOptions?.status;
      this.requestId = messageOrOptions?.requestId;
      this.queryName = messageOrOptions?.queryName;
    }
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
