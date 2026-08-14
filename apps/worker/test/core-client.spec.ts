import { createServer, type RequestListener, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseAnalyseSessionResponse,
  RecognitionCoreClient,
  RecognitionCoreUnavailableError,
} from "../src/recognition/core-client";

const servers: Server[] = [];

const startServer = async (handler: RequestListener): Promise<string> => {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected the fake recognition-core server to be listening.");
  }
  return `http://127.0.0.1:${String(address.port)}`;
};

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server === undefined) continue;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
});

const VALID_ANALYSE_RESPONSE = {
  requestId: "req-1",
  modelManifestVersion: "unset",
  photoResults: [
    {
      imageOrdinal: 1,
      barcodeOutcome: "Succeeded",
      barcodes: [{ value: "5012345678900", symbology: "EAN-13" }],
      ocrOutcome: "Unavailable",
      ocrLines: [],
      identifiers: {
        manufacturerTokens: [],
        nameFragments: [],
        partNumberCandidates: [],
        barcodeLikeCandidates: [],
        variantAttributes: [],
        labelledPackQuantity: null,
      },
      embeddingOutcome: "Unavailable",
      embedding: null,
      categoryOutcome: "NotApplicable",
      categories: [],
      quality: { blurScore: 0.6, foregroundAreaRatio: 0.4 },
    },
  ],
};

describe("RecognitionCoreClient.analyseSession", () => {
  it("parses a well-formed camelCase response", async () => {
    const baseUrl = await startServer((request, response) => {
      expect(request.url).toBe("/v1/analyse-session");
      expect(request.method).toBe("POST");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(VALID_ANALYSE_RESPONSE));
    });

    const client = new RecognitionCoreClient({ baseUrl, timeoutMilliseconds: 2_000 });
    const result = await client.analyseSession("req-1", [
      { ordinal: 1, bytes: Buffer.from("fake-jpeg-bytes"), mediaType: "image/jpeg" },
    ]);

    expect(result.requestId).toBe("req-1");
    expect(result.photoResults).toHaveLength(1);
    expect(result.photoResults[0]?.barcodeOutcome).toBe("Succeeded");
    expect(result.photoResults[0]?.barcodes[0]?.value).toBe("5012345678900");
  });

  it("throws RecognitionCoreUnavailableError on a non-2xx status", async () => {
    const baseUrl = await startServer((_request, response) => {
      response.writeHead(422, { "content-type": "application/json" });
      response.end(JSON.stringify({ detail: "recognition.image_undecodable" }));
    });

    const client = new RecognitionCoreClient({ baseUrl, timeoutMilliseconds: 2_000 });

    await expect(
      client.analyseSession("req-1", [
        { ordinal: 1, bytes: Buffer.from("bad"), mediaType: "image/jpeg" },
      ]),
    ).rejects.toBeInstanceOf(RecognitionCoreUnavailableError);
  });

  it("throws on a malformed JSON body", async () => {
    const baseUrl = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("not json");
    });

    const client = new RecognitionCoreClient({ baseUrl, timeoutMilliseconds: 2_000 });

    await expect(
      client.analyseSession("req-1", [
        { ordinal: 1, bytes: Buffer.from("x"), mediaType: "image/jpeg" },
      ]),
    ).rejects.toBeInstanceOf(RecognitionCoreUnavailableError);
  });

  it("throws when a required field is missing from an otherwise-valid response", async () => {
    const baseUrl = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ requestId: "req-1", photoResults: [] }));
    });

    const client = new RecognitionCoreClient({ baseUrl, timeoutMilliseconds: 2_000 });

    await expect(
      client.analyseSession("req-1", [
        { ordinal: 1, bytes: Buffer.from("x"), mediaType: "image/jpeg" },
      ]),
    ).rejects.toBeInstanceOf(RecognitionCoreUnavailableError);
  });

  it("aborts and rejects once the timeout elapses", async () => {
    const baseUrl = await startServer(() => {
      /* Never responds. */
    });

    const client = new RecognitionCoreClient({ baseUrl, timeoutMilliseconds: 50 });

    await expect(
      client.analyseSession("req-1", [
        { ordinal: 1, bytes: Buffer.from("x"), mediaType: "image/jpeg" },
      ]),
    ).rejects.toBeInstanceOf(RecognitionCoreUnavailableError);
  });
});

describe("RecognitionCoreClient.renderExemplar", () => {
  it("parses the binary body and header dimensions", async () => {
    const webpBytes = Buffer.from([0x52, 0x49, 0x46, 0x46]);
    const baseUrl = await startServer((request, response) => {
      expect(request.url).toBe("/v1/render-exemplar");
      response.writeHead(200, {
        "content-type": "image/webp",
        "x-recognition-width": "128",
        "x-recognition-height": "96",
      });
      response.end(webpBytes);
    });

    const client = new RecognitionCoreClient({ baseUrl, timeoutMilliseconds: 2_000 });
    const result = await client.renderExemplar(
      { ordinal: 1, bytes: Buffer.from("fake-jpeg-bytes"), mediaType: "image/jpeg" },
      { x: 0, y: 0, width: 1, height: 1 },
    );

    expect(result.width).toBe(128);
    expect(result.height).toBe(96);
    expect(result.bytes.equals(webpBytes)).toBe(true);
  });

  it("throws when the dimension headers are missing", async () => {
    const baseUrl = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "image/webp" });
      response.end(Buffer.from([1, 2, 3]));
    });

    const client = new RecognitionCoreClient({ baseUrl, timeoutMilliseconds: 2_000 });

    await expect(
      client.renderExemplar(
        { ordinal: 1, bytes: Buffer.from("x"), mediaType: "image/jpeg" },
        { x: 0, y: 0, width: 1, height: 1 },
      ),
    ).rejects.toBeInstanceOf(RecognitionCoreUnavailableError);
  });

  it("defaults the media type when the response has no content-type header", async () => {
    const baseUrl = await startServer((_request, response) => {
      response.writeHead(200, { "x-recognition-width": "10", "x-recognition-height": "10" });
      response.end(Buffer.from([1, 2, 3]));
    });

    const client = new RecognitionCoreClient({ baseUrl, timeoutMilliseconds: 2_000 });
    const result = await client.renderExemplar(
      { ordinal: 1, bytes: Buffer.from("x"), mediaType: "image/jpeg" },
      { x: 0, y: 0, width: 1, height: 1 },
    );

    expect(result.mediaType).toBe("application/octet-stream");
  });

  it("wraps a non-Error thrown by the underlying fetch implementation", async () => {
    const client = new RecognitionCoreClient(
      { baseUrl: "https://example.invalid", timeoutMilliseconds: 2_000 },
      /* eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately non-Error, to prove the non-Error branch is wrapped */
      () => Promise.reject("boom"),
    );

    const error = await client
      .analyseSession("req-1", [
        { ordinal: 1, bytes: Buffer.from("x"), mediaType: "image/jpeg" },
      ])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RecognitionCoreUnavailableError);
    expect((error as Error).message).toContain("non-Error value");
  });

  it("preserves the underlying fetch error in its diagnostic message", async () => {
    const client = new RecognitionCoreClient(
      { baseUrl: "https://example.invalid", timeoutMilliseconds: 2_000 },
      () => Promise.reject(new TypeError("connect failed")),
    );

    const error = await client
      .analyseSession("req-1", [
        { ordinal: 1, bytes: Buffer.from("x"), mediaType: "image/jpeg" },
      ])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RecognitionCoreUnavailableError);
    expect((error as Error).message).toContain("TypeError: connect failed");
  });
});

describe("parseAnalyseSessionResponse", () => {
  it("rejects a non-object payload", () => {
    expect(() => parseAnalyseSessionResponse("not an object")).toThrow(
      RecognitionCoreUnavailableError,
    );
  });

  it("rejects a payload with an invalid stage outcome", () => {
    const malformed = {
      requestId: "req-1",
      modelManifestVersion: "unset",
      photoResults: [{ ...VALID_ANALYSE_RESPONSE.photoResults[0], barcodeOutcome: "Maybe" }],
    };

    expect(() => parseAnalyseSessionResponse(malformed)).toThrow(RecognitionCoreUnavailableError);
  });

  it("rejects a response missing photoResults entirely", () => {
    expect(() =>
      parseAnalyseSessionResponse({ requestId: "req-1", modelManifestVersion: "unset" }),
    ).toThrow(RecognitionCoreUnavailableError);
  });

  it("treats a null embedding as no embedding", () => {
    const result = parseAnalyseSessionResponse({
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [{ ...VALID_ANALYSE_RESPONSE.photoResults[0], embedding: null }],
    });
    expect(result.photoResults[0]?.embedding).toBeNull();
  });

  it("rejects a malformed embedding object", () => {
    const malformed = {
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [
        { ...VALID_ANALYSE_RESPONSE.photoResults[0], embedding: { modelRevision: "v1" } },
      ],
    };
    expect(() => parseAnalyseSessionResponse(malformed)).toThrow(RecognitionCoreUnavailableError);
  });

  it("rejects an embedding whose vector is not all numbers", () => {
    const malformed = {
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [
        {
          ...VALID_ANALYSE_RESPONSE.photoResults[0],
          embedding: { modelRevision: "v1", vector: [1, "two", 3] },
        },
      ],
    };
    expect(() => parseAnalyseSessionResponse(malformed)).toThrow(RecognitionCoreUnavailableError);
  });

  it("accepts a well-formed embedding", () => {
    const result = parseAnalyseSessionResponse({
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [
        {
          ...VALID_ANALYSE_RESPONSE.photoResults[0],
          embeddingOutcome: "Succeeded",
          embedding: { modelRevision: "nomic-embed-vision-v1.5", vector: [0.1, 0.2] },
        },
      ],
    });
    expect(result.photoResults[0]?.embedding).toEqual({
      modelRevision: "nomic-embed-vision-v1.5",
      vector: [0.1, 0.2],
    });
  });

  it("rejects a malformed category label", () => {
    const malformed = {
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [
        {
          ...VALID_ANALYSE_RESPONSE.photoResults[0],
          categoryOutcome: "Succeeded",
          categories: ["not an object"],
        },
      ],
    };
    expect(() => parseAnalyseSessionResponse(malformed)).toThrow(RecognitionCoreUnavailableError);
  });

  it("accepts well-formed category labels", () => {
    const result = parseAnalyseSessionResponse({
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [
        {
          ...VALID_ANALYSE_RESPONSE.photoResults[0],
          categoryOutcome: "Succeeded",
          categories: [{ label: "Hand tool", score: 0.7 }],
        },
      ],
    });
    expect(result.photoResults[0]?.categories).toEqual([{ label: "Hand tool", score: 0.7 }]);
  });

  it("parses image quality", () => {
    const result = parseAnalyseSessionResponse(VALID_ANALYSE_RESPONSE);
    expect(result.photoResults[0]?.quality).toEqual({ blurScore: 0.6, foregroundAreaRatio: 0.4 });
  });

  it("rejects a photo result missing image quality", () => {
    const { quality, ...withoutQuality } = VALID_ANALYSE_RESPONSE.photoResults[0] ?? {};
    void quality;
    expect(() =>
      parseAnalyseSessionResponse({ ...VALID_ANALYSE_RESPONSE, photoResults: [withoutQuality] }),
    ).toThrow(RecognitionCoreUnavailableError);
  });

  it("defaults crops to an empty list when absent", () => {
    const result = parseAnalyseSessionResponse(VALID_ANALYSE_RESPONSE);
    expect(result.photoResults[0]?.crops).toEqual([]);
  });

  it("accepts well-formed crop boxes", () => {
    const result = parseAnalyseSessionResponse({
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [
        {
          ...VALID_ANALYSE_RESPONSE.photoResults[0],
          crops: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.6, label: "product" }],
        },
      ],
    });
    expect(result.photoResults[0]?.crops).toEqual([
      { x: 0.1, y: 0.2, width: 0.5, height: 0.6, label: "product" },
    ]);
  });

  it("rejects a malformed crop box", () => {
    const malformed = {
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [
        {
          ...VALID_ANALYSE_RESPONSE.photoResults[0],
          crops: [{ x: 0.1, y: 0.2, width: 0.5 }],
        },
      ],
    };
    expect(() => parseAnalyseSessionResponse(malformed)).toThrow(RecognitionCoreUnavailableError);
  });

  it("rejects a crop box that is not an object", () => {
    const malformed = {
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [{ ...VALID_ANALYSE_RESPONSE.photoResults[0], crops: ["not an object"] }],
    };
    expect(() => parseAnalyseSessionResponse(malformed)).toThrow(RecognitionCoreUnavailableError);
  });

  it("rejects a photo result missing a required numeric field", () => {
    const { imageOrdinal, ...withoutOrdinal } = VALID_ANALYSE_RESPONSE.photoResults[0] ?? {};
    void imageOrdinal;
    expect(() =>
      parseAnalyseSessionResponse({ ...VALID_ANALYSE_RESPONSE, photoResults: [withoutOrdinal] }),
    ).toThrow(RecognitionCoreUnavailableError);
  });

  it("rejects a malformed identifiers object", () => {
    const malformed = {
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [{ ...VALID_ANALYSE_RESPONSE.photoResults[0], identifiers: "not an object" }],
    };
    expect(() => parseAnalyseSessionResponse(malformed)).toThrow(RecognitionCoreUnavailableError);
  });

  it("rejects a malformed OCR line", () => {
    const malformed = {
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [
        {
          ...VALID_ANALYSE_RESPONSE.photoResults[0],
          ocrOutcome: "Succeeded",
          ocrLines: ["not an object"],
        },
      ],
    };
    expect(() => parseAnalyseSessionResponse(malformed)).toThrow(RecognitionCoreUnavailableError);
  });

  it("accepts well-formed OCR lines", () => {
    const result = parseAnalyseSessionResponse({
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [
        {
          ...VALID_ANALYSE_RESPONSE.photoResults[0],
          ocrOutcome: "Succeeded",
          ocrLines: [{ text: "Acme Tools Ltd", score: 0.95 }],
        },
      ],
    });
    expect(result.photoResults[0]?.ocrLines).toEqual([{ text: "Acme Tools Ltd", score: 0.95 }]);
  });

  it("rejects a malformed variant attribute in identifiers", () => {
    const malformed = {
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [
        {
          ...VALID_ANALYSE_RESPONSE.photoResults[0],
          identifiers: {
            ...VALID_ANALYSE_RESPONSE.photoResults[0]?.identifiers,
            variantAttributes: ["bad"],
          },
        },
      ],
    };
    expect(() => parseAnalyseSessionResponse(malformed)).toThrow(RecognitionCoreUnavailableError);
  });

  it("accepts well-formed variant attributes in identifiers", () => {
    const result = parseAnalyseSessionResponse({
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [
        {
          ...VALID_ANALYSE_RESPONSE.photoResults[0],
          identifiers: {
            ...VALID_ANALYSE_RESPONSE.photoResults[0]?.identifiers,
            variantAttributes: [{ label: "colour", value: "Black" }],
          },
        },
      ],
    });
    expect(result.photoResults[0]?.identifiers.variantAttributes).toEqual([
      { label: "colour", value: "Black" },
    ]);
  });

  it("rejects identifiers whose string-array fields are not arrays of strings", () => {
    const malformed = {
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [
        {
          ...VALID_ANALYSE_RESPONSE.photoResults[0],
          identifiers: {
            ...VALID_ANALYSE_RESPONSE.photoResults[0]?.identifiers,
            manufacturerTokens: [1, 2, 3],
          },
        },
      ],
    };
    expect(() => parseAnalyseSessionResponse(malformed)).toThrow(RecognitionCoreUnavailableError);
  });

  it("rejects a barcode observation that is not an object", () => {
    const malformed = {
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [{ ...VALID_ANALYSE_RESPONSE.photoResults[0], barcodes: ["not an object"] }],
    };
    expect(() => parseAnalyseSessionResponse(malformed)).toThrow(RecognitionCoreUnavailableError);
  });

  it("rejects a photo result that is not an object", () => {
    expect(() =>
      parseAnalyseSessionResponse({ ...VALID_ANALYSE_RESPONSE, photoResults: ["not an object"] }),
    ).toThrow(RecognitionCoreUnavailableError);
  });

  it("rejects an embedding value that is present but not an object", () => {
    const malformed = {
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [{ ...VALID_ANALYSE_RESPONSE.photoResults[0], embedding: "not an object" }],
    };
    expect(() => parseAnalyseSessionResponse(malformed)).toThrow(RecognitionCoreUnavailableError);
  });

  it("defaults optional identifier fields when the fields are shaped differently", () => {
    const identifiers = VALID_ANALYSE_RESPONSE.photoResults[0]?.identifiers;
    const result = parseAnalyseSessionResponse({
      ...VALID_ANALYSE_RESPONSE,
      photoResults: [
        {
          ...VALID_ANALYSE_RESPONSE.photoResults[0],
          identifiers: {
            ...identifiers,
            variantAttributes: undefined,
            labelledPackQuantity: "6-pack",
          },
        },
      ],
    });

    expect(result.photoResults[0]?.identifiers.variantAttributes).toEqual([]);
    expect(result.photoResults[0]?.identifiers.labelledPackQuantity).toBe("6-pack");
  });

  it("defaults barcodes, OCR lines and categories to empty lists when the fields are absent", () => {
    const { barcodes, ocrLines, categories, ...rest } =
      VALID_ANALYSE_RESPONSE.photoResults[0] ?? {};
    void barcodes;
    void ocrLines;
    void categories;

    const result = parseAnalyseSessionResponse({ ...VALID_ANALYSE_RESPONSE, photoResults: [rest] });

    expect(result.photoResults[0]?.barcodes).toEqual([]);
    expect(result.photoResults[0]?.ocrLines).toEqual([]);
    expect(result.photoResults[0]?.categories).toEqual([]);
  });
});
