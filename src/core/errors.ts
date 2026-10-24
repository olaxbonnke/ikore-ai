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

export class SimulationError extends Error {
  readonly reason?: string;
  readonly n?: number;

  constructor(message: string, options?: { reason?: string; n?: number; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "SimulationError";
    this.reason = options?.reason;
    this.n = options?.n;
  }
}

export type ErrorComponent = "zetaris" | "nightshift" | "hmem" | "internal";

/**
 * Classifies an error into its originating system component.
 * Thrown errors are strictly attributed to zetaris, nightshift, or hmem
 * only when they actually originate from those components, otherwise internal.
 */
export function classifyErrorComponent(err: unknown): ErrorComponent {
  if (!err) return "internal";

  const name = (err as any).name || "";
  const msg = (err as any).message || "";
  const str = `${name}: ${msg}`;

  if (
    err instanceof ZetarisError ||
    /zetaris/i.test(name) ||
    /zetaris|oko_pg|rain_daily|priceSeasonality|nimet_onset|Snapshot file not found/i.test(msg)
  ) {
    return "zetaris";
  }

  if (
    err instanceof LLMError ||
    /LLMError/i.test(name) ||
    /nightshift|nemotron|meterless/i.test(str)
  ) {
    return "nightshift";
  }

  if (
    /hmem/i.test(name) ||
    /\bhmem\b|h-mem|ledger\.jsonl|store\.json|Cannot find farm associated with memoryId/i.test(msg)
  ) {
    return "hmem";
  }

  return "internal";
}
