/*
 * Stage 6, specification section 7.9, hardened per section 16.3. The model
 * proposes; this client is what makes that proposal safe to read at all:
 *
 * - the JSON schema sent as `response_format` enumerates the exact supplied
 *   candidate IDs, so constrained decoding cannot emit an id nobody gave it,
 *   not merely "should not";
 * - every response is re-validated defensively regardless — a remote model
 *   is a network boundary like any other, not a component this client
 *   trusts to have honoured the schema it was asked for;
 * - untrusted OCR/web text is delimited as JSON string values, never
 *   concatenated into the instruction text, and stripped of control
 *   characters first; and
 * - the model's own confidence, if it emits one, is never read into the
 *   result type below — there is no field for it to land in.
 */

// recognition-fusion runs with a 4,096-token context and a 256-token output
// cap (spec 7.9/9.2). These bounds keep the request well inside that budget
// without this client needing to count tokens itself.
const MAX_IMAGES = 5;
const MAX_OBSERVATIONS_PER_IMAGE = 8;
const MAX_OBSERVATION_LENGTH = 200;
const MAX_CANDIDATES = 5;
const MAX_CANDIDATE_SUMMARY_LENGTH = 200;
const MAX_WEB_RESULTS = 3;
const MAX_WEB_FIELD_LENGTH = 300;
const MAX_CATEGORIES = 5;
const MAX_FIELD_LENGTH = 120;
const MAX_VARIANT_ATTRIBUTES = 8;
const MAX_OUTPUT_TOKENS = 256;

// ---- Sanitisation ---------------------------------------------------------

// eslint-disable-next-line no-control-regex -- deliberately matching control characters to strip them
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;

/** Strips control characters and bounds length before untrusted text is
 * embedded as a JSON string value in the prompt (section 16.3). */
export const sanitiseForPrompt = (text: string, maxLength: number): string =>
  text.replace(CONTROL_CHARACTERS, "").trim().slice(0, maxLength);

// ---- Request shapes ---------------------------------------------------

export interface VlmImageInput {
  readonly ordinal: number;
  readonly base64: string;
  readonly mediaType: string;
}

export interface VlmObservation {
  readonly imageOrdinal: number;
  readonly text: string;
}

export interface VlmCandidateAllowlistEntry {
  readonly candidateId: string;
  /** A brief, plain description shown to the model — never the raw OCR text
   * or a photograph, just what the catalogue already knows. */
  readonly summary: string;
}

export interface VlmWebEvidenceInput {
  readonly title: string;
  readonly snippet: string;
}

export interface VlmRequest {
  readonly images: readonly VlmImageInput[];
  readonly observations: readonly VlmObservation[];
  readonly candidates: readonly VlmCandidateAllowlistEntry[];
  readonly categories: readonly string[];
  readonly webEvidence: readonly VlmWebEvidenceInput[];
}

// ---- Result shapes ------------------------------------------------------

export interface VlmVariantAttribute {
  readonly label: string;
  readonly value: string;
}

export type VlmProposal =
  | {
      readonly kind: "InternalCandidate";
      readonly candidateId: string;
      readonly evidenceImageOrdinals: readonly number[];
    }
  | {
      readonly kind: "ExternalIdentity";
      readonly manufacturer: string | null;
      readonly name: string;
      readonly partNumber: string | null;
      readonly barcode: string | null;
      readonly variantAttributes: readonly VlmVariantAttribute[];
      readonly evidenceImageOrdinals: readonly number[];
    }
  | { readonly kind: "Unknown" };

export type FusionResponseFailure =
  | "MalformedEnvelope"
  | "NonStringContent"
  | "InvalidJson"
  | "InvalidProposal";

export interface FusionAttemptDiagnostic {
  readonly attempt: 1 | 2;
  readonly failure: FusionResponseFailure;
  readonly finishReason: string | null;
}

export class FusionUnavailableError extends Error {
  public readonly code = "recognition.fusion_unavailable";
  public readonly reason: "InvalidResponse" | "TimedOut" | "Unavailable";
  /** Safe metadata only: never contains OCR, model output, credentials or image data. */
  public readonly diagnostics: readonly FusionAttemptDiagnostic[];

  public constructor(
    detail: string,
    options?: ErrorOptions & {
      readonly reason?: "InvalidResponse" | "TimedOut" | "Unavailable";
      readonly diagnostics?: readonly FusionAttemptDiagnostic[];
    },
  ) {
    super(detail, options);
    this.name = "FusionUnavailableError";
    this.reason = options?.reason ?? "Unavailable";
    this.diagnostics = options?.diagnostics ?? [];
  }
}

// ---- Prompt construction ------------------------------------------------

const SYSTEM_PROMPT = [
  "You identify a physical stock item from photographs and structured evidence.",
  "Respond with JSON matching the supplied schema only.",
  "Always emit every field in the schema; use null, an empty string, or an empty array for fields that do not apply.",
  'If you recognise the item as one of the supplied candidates, use "InternalCandidate" with its exact id.',
  'Otherwise, if the photographs show a clear product identity, use "ExternalIdentity".',
  'If you cannot tell, respond "Unknown".',
  "Never invent an id that was not supplied. Do not call a tool or ask a question.",
].join(" ");

const clampImages = (images: readonly VlmImageInput[]): readonly VlmImageInput[] =>
  images.slice(0, MAX_IMAGES);

const buildUserContent = (request: VlmRequest): readonly unknown[] => {
  const observationsByImage = new Map<number, string[]>();
  for (const observation of request.observations) {
    const bucket = observationsByImage.get(observation.imageOrdinal) ?? [];
    if (bucket.length < MAX_OBSERVATIONS_PER_IMAGE) {
      bucket.push(sanitiseForPrompt(observation.text, MAX_OBSERVATION_LENGTH));
    }
    observationsByImage.set(observation.imageOrdinal, bucket);
  }

  const evidence = {
    candidates: request.candidates.slice(0, MAX_CANDIDATES).map((candidate) => ({
      id: candidate.candidateId,
      summary: sanitiseForPrompt(candidate.summary, MAX_CANDIDATE_SUMMARY_LENGTH),
    })),
    categories: request.categories
      .slice(0, MAX_CATEGORIES)
      .map((category) => sanitiseForPrompt(category, MAX_FIELD_LENGTH)),
    observations: [...observationsByImage.entries()].map(([imageOrdinal, lines]) => ({
      imageOrdinal,
      lines,
    })),
    // Untrusted, delimited as data: this object is JSON-encoded below, never
    // concatenated into instruction text.
    webEvidence: request.webEvidence.slice(0, MAX_WEB_RESULTS).map((result) => ({
      title: sanitiseForPrompt(result.title, MAX_WEB_FIELD_LENGTH),
      snippet: sanitiseForPrompt(result.snippet, MAX_WEB_FIELD_LENGTH),
    })),
  };

  const images = clampImages(request.images);
  const content: unknown[] = [{ type: "text", text: `Evidence: ${JSON.stringify(evidence)}` }];
  for (const image of images) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
    });
  }
  return content;
};

const candidateIdSchema = (candidates: readonly VlmCandidateAllowlistEntry[]): unknown =>
  candidates.length > 0
    ? {
        type: ["string", "null"],
        enum: [...candidates.map((candidate) => candidate.candidateId), null],
      }
    : { type: "null", enum: [null] };

const REQUIRED_PROPOSAL_FIELDS = [
  "kind",
  "candidateId",
  "manufacturer",
  "name",
  "partNumber",
  "barcode",
  "variantAttributes",
  "evidenceImageOrdinals",
] as const;

const variantAttributesSchema = {
  type: "array",
  maxItems: MAX_VARIANT_ATTRIBUTES,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["label", "value"],
    properties: {
      label: { type: "string", maxLength: 40 },
      value: { type: "string", maxLength: 80 },
    },
  },
};

const evidenceImageOrdinalsSchema = {
  type: "array",
  maxItems: MAX_IMAGES,
  items: { type: "integer", minimum: 1, maximum: MAX_IMAGES },
};

/** The conditional branches are the load-bearing defence: every output that
 * satisfies the grammar also satisfies parseVlmResponse. In particular, an
 * InternalCandidate is impossible when the allowlist is empty and a real
 * allowlisted id is mandatory when that branch is selected. */
const buildResponseSchema = (candidates: readonly VlmCandidateAllowlistEntry[]): unknown => {
  const candidateIds = candidates.map((candidate) => candidate.candidateId);
  const kinds =
    candidateIds.length > 0
      ? ["InternalCandidate", "ExternalIdentity", "Unknown"]
      : ["ExternalIdentity", "Unknown"];
  const branches: unknown[] = [
    ...(candidateIds.length === 0
      ? []
      : [
          {
            required: ["kind", "candidateId"],
            properties: {
              kind: { type: "string", const: "InternalCandidate" },
              candidateId: { type: "string", enum: candidateIds },
            },
          },
        ]),
    {
      required: ["kind", "candidateId", "name"],
      properties: {
        kind: { type: "string", const: "ExternalIdentity" },
        candidateId: { type: "null" },
        name: { type: "string", minLength: 1, maxLength: MAX_FIELD_LENGTH },
      },
    },
    {
      required: ["kind", "candidateId"],
      properties: {
        kind: { type: "string", const: "Unknown" },
        candidateId: { type: "null" },
      },
    },
  ];

  return {
    type: "object",
    additionalProperties: false,
    required: REQUIRED_PROPOSAL_FIELDS,
    properties: {
      kind: { type: "string", enum: kinds },
      candidateId: candidateIdSchema(candidates),
      manufacturer: { type: ["string", "null"], maxLength: MAX_FIELD_LENGTH },
      name: { type: "string", maxLength: MAX_FIELD_LENGTH },
      partNumber: { type: ["string", "null"], maxLength: MAX_FIELD_LENGTH },
      barcode: { type: ["string", "null"], maxLength: 40 },
      variantAttributes: variantAttributesSchema,
      evidenceImageOrdinals: evidenceImageOrdinalsSchema,
    },
    oneOf: branches,
  };
};

// ---- Response parsing ---------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readOrdinals = (value: unknown): readonly number[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is number => typeof entry === "number" && Number.isInteger(entry),
  );
};

const readVariantAttributes = (value: unknown): readonly VlmVariantAttribute[] => {
  if (!Array.isArray(value)) return [];
  const attributes: VlmVariantAttribute[] = [];
  for (const entry of value.slice(0, MAX_VARIANT_ATTRIBUTES)) {
    if (!isRecord(entry)) continue;
    const { label, value: attributeValue } = entry;
    if (typeof label !== "string" || typeof attributeValue !== "string") continue;
    attributes.push({ label: label.slice(0, 40), value: attributeValue.slice(0, 80) });
  }
  return attributes;
};

/**
 * Parses and validates the model's JSON body against the same allowlist the
 * schema was built from. A response the schema should have prevented — an
 * unsupplied id, in particular — is treated exactly like invalid JSON: it
 * earns the one constrained retry, never a silent pass-through.
 */
export const parseVlmResponse = (
  raw: unknown,
  candidates: readonly VlmCandidateAllowlistEntry[],
): VlmProposal | null => {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;

  if (kind === "Unknown") return { kind: "Unknown" };

  if (kind === "InternalCandidate") {
    const candidateId = raw.candidateId;
    if (typeof candidateId !== "string") return null;
    const allowed = candidates.some((candidate) => candidate.candidateId === candidateId);
    if (!allowed) return null;
    return {
      kind: "InternalCandidate",
      candidateId,
      evidenceImageOrdinals: readOrdinals(raw.evidenceImageOrdinals),
    };
  }

  if (kind === "ExternalIdentity") {
    const manufacturer = raw.manufacturer;
    const partNumber = raw.partNumber;
    const barcode = raw.barcode;
    const rawName = typeof raw.name === "string" ? raw.name.trim() : "";
    const fallbackName = [manufacturer, partNumber]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ")
      .trim();
    const name = rawName || fallbackName || (typeof barcode === "string" ? barcode.trim() : "");
    if (name.length === 0) return null;
    return {
      kind: "ExternalIdentity",
      manufacturer:
        typeof manufacturer === "string" ? manufacturer.slice(0, MAX_FIELD_LENGTH) : null,
      name: name.slice(0, MAX_FIELD_LENGTH),
      partNumber: typeof partNumber === "string" ? partNumber.slice(0, MAX_FIELD_LENGTH) : null,
      barcode: typeof barcode === "string" ? barcode.slice(0, 40) : null,
      variantAttributes: readVariantAttributes(raw.variantAttributes),
      evidenceImageOrdinals: readOrdinals(raw.evidenceImageOrdinals),
    };
  }

  return null;
};

// ---- HTTP client --------------------------------------------------------

export interface FusionClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMilliseconds: number;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface CompletionAttempt {
  readonly value: unknown | null;
  readonly failure: Exclude<FusionResponseFailure, "InvalidProposal"> | null;
  readonly finishReason: string | null;
}

const correctiveInstruction = (
  failure: FusionResponseFailure,
  hasInternalCandidates: boolean,
): string =>
  [
    `Correction: the previous answer was rejected as ${failure}.`,
    "Return exactly one JSON object matching the supplied schema.",
    hasInternalCandidates
      ? "Use InternalCandidate only with one of the supplied candidate ids."
      : "No internal candidates were supplied, so use ExternalIdentity or Unknown.",
    "ExternalIdentity requires a non-empty name; if the evidence is insufficient, use Unknown.",
  ].join(" ");

export class FusionClient {
  public constructor(
    private readonly options: FusionClientOptions,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  /** One item-level call, plus one corrective constrained retry when the
   * response is syntactically or semantically invalid. The retry deliberately
   * changes the prompt: repeating an identical temperature-zero request only
   * reproduces the same invalid output. */
  public async proposeIdentity(request: VlmRequest): Promise<VlmProposal> {
    const schema = buildResponseSchema(request.candidates);
    const body = {
      model: "qwen3.5-0.8b",
      temperature: 0,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserContent(request) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "vlm_proposal", schema } },
    };

    const first = await this.complete(body);
    const firstProposal =
      first.value === null ? null : parseVlmResponse(first.value, request.candidates);
    if (firstProposal !== null) return firstProposal;
    const firstFailure: FusionResponseFailure = first.failure ?? "InvalidProposal";

    const retryBody = {
      ...body,
      messages: [
        ...body.messages,
        {
          role: "user",
          content: correctiveInstruction(firstFailure, request.candidates.length > 0),
        },
      ],
    };
    const retry = await this.complete(retryBody);
    const retryProposal =
      retry.value === null ? null : parseVlmResponse(retry.value, request.candidates);
    if (retryProposal !== null) return retryProposal;
    const retryFailure: FusionResponseFailure = retry.failure ?? "InvalidProposal";

    throw new FusionUnavailableError("recognition-fusion did not return a valid proposal.", {
      reason: "InvalidResponse",
      diagnostics: [
        { attempt: 1, failure: firstFailure, finishReason: first.finishReason },
        { attempt: 2, failure: retryFailure, finishReason: retry.finishReason },
      ],
    });
  }

  private async complete(body: unknown): Promise<CompletionAttempt> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.options.timeoutMilliseconds);

    try {
      const response = await this.fetchImpl(`${this.options.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new FusionUnavailableError(
          `recognition-fusion responded with status ${String(response.status)}.`,
        );
      }

      let json: unknown;
      try {
        json = (await response.json()) as unknown;
      } catch {
        return { value: null, failure: "MalformedEnvelope", finishReason: null };
      }
      if (!isRecord(json) || !Array.isArray(json.choices)) {
        return { value: null, failure: "MalformedEnvelope", finishReason: null };
      }
      const choice = json.choices[0] as unknown;
      if (!isRecord(choice)) {
        return { value: null, failure: "MalformedEnvelope", finishReason: null };
      }
      const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : null;
      if (!isRecord(choice.message)) {
        return { value: null, failure: "MalformedEnvelope", finishReason };
      }
      const content = choice.message.content;
      if (typeof content !== "string") {
        return { value: null, failure: "NonStringContent", finishReason };
      }

      try {
        return { value: JSON.parse(content) as unknown, failure: null, finishReason };
      } catch {
        return { value: null, failure: "InvalidJson", finishReason };
      }
    } catch (error: unknown) {
      if (error instanceof FusionUnavailableError) throw error;
      if (controller.signal.aborted) {
        throw new FusionUnavailableError(
          `recognition-fusion exceeded its ${String(this.options.timeoutMilliseconds)} ms deadline.`,
          { cause: error, reason: "TimedOut" },
        );
      }
      throw new FusionUnavailableError(
        error instanceof Error
          ? `recognition-fusion request failed: ${error.name}: ${error.message}`
          : "recognition-fusion request failed with a non-Error value.",
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
