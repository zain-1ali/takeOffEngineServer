import { promises as fs } from "node:fs";
import { z } from "zod";
import { parseDimensionPair } from "../utils/parseDimension";

export {
  parseDimensionPair,
  parseDimensionToken,
  sanitizeRoomDimensions,
} from "../utils/parseDimension";
export type { SanitizedRoomDimensions } from "../utils/parseDimension";

const MAX_ANALYSIS_ATTEMPTS = 3;
const AI_REQUEST_TIMEOUT_MS = 120000;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-5";

// 1. Simplified Prompt (No bounding box or coordinate instructions)
const ANALYSIS_PROMPT = `Analyze every page of this construction document to produce structured room takeoff data.

PAGE CLASSIFICATION AND ROOM TAKEOFF
- Identify page_number, page_title, and is_floor_plan.
- On floor-plan pages, perform a dedicated room-by-room scan and extract every distinct labeled space, including small bathrooms, closets, balconies, porches, yards, halls, and utility areas.
- Treat each complete multi-word room label as one room_name. For example, "MASTER BEDROOM", "FAMILY ROOM", and "WALK IN CLOSET" must each be returned as one room and must never be split into separate room records.
- Extract each room's dimensions, calculated_area, and perimeter.
- On non-floor-plan pages, return an empty rooms array.

ROOM IDENTITY RULE: Only create ONE entry per distinct named room space (e.g. one BEDROOM label = one entry, even if multiple numbers appear near it). Do NOT create separate entries for door widths, window dimensions, sill heights, or any other secondary dimension annotations that are not the room's own overall length/width. A room entry's dimension_a and dimension_b must be the two dimensions that describe that room's own overall floor space — typically the largest, most central dimension pair near that room's printed name label — not smaller dimensions describing openings, fixtures, or sills within it.

Before finalizing your response, review your own room list and merge or discard any entries that:
- Share the same or near-identical dimension_a/dimension_b as another entry already in your list for this page
- Do not have a clear, distinct room name label directly associated with them (a standalone dimension number with no room name nearby is NOT a room)

If you are not confident that a number belongs to a specific room's own dimensions (versus a door/window/sill), leave dimension_a/dimension_b as null for that room rather than guessing, and lower its confidence to 'low'.

In JSON, express dimension_a and dimension_b as the two values in the required dimensions field (e.g. "3765x2851"). If both dimensions are unknown, use an empty dimensions string and set calculated_area and perimeter to 0.

For each room on a floor plan, also return label_x and label_y as the approximate center point of this room's text label, normalized to a 0-1000 scale relative to image width and height (0,0 is top-left of the page image; 1000,1000 is bottom-right).

Dimension numbers on this drawing use commas as thousands separators, not decimal points. For example, a printed value of '3,765' means the number three thousand seven hundred sixty-five (3765), NOT 3.765. When extracting dimension_a and dimension_b, always return the full integer value with any comma removed (e.g. 3765), never interpret the comma as a decimal separator.

In the dimensions string, write values without thousands separators (e.g. "3765x2851"), and compute calculated_area and perimeter from those full integer values in the same unit as the printed dimensions.

Return STRICTLY a JSON array with no markdown, commentary, or backticks. Exact format example:
[{"page_number":1,"page_title":"Ground Floor","is_floor_plan":true,"rooms":[{"room_name":"KITCHEN","dimensions":"3765x2851","calculated_area":10734015,"perimeter":13232,"label_x":420,"label_y":310}]}]`;

// 2. Simplified Zod Validation Schema
const RoomSchema = z.object({
  room_name: z.string().trim().min(1),
  dimensions: z.string(),
  calculated_area: z.number(),
  perimeter: z.number(),
  label_x: z.number().min(0).max(1000),
  label_y: z.number().min(0).max(1000),
});

const PageSchema = z.object({
  page_number: z.number(),
  page_title: z.string(),
  is_floor_plan: z.boolean(),
  rooms: z.array(RoomSchema),
});

const BlueprintSchema = z.array(PageSchema);

// 3. Simplified OpenRouter JSON Schema Payload
const BLUEPRINT_JSON_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      page_number: { type: "number" },
      page_title: { type: "string" },
      is_floor_plan: { type: "boolean" },
      rooms: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            room_name: { type: "string" },
            dimensions: { type: "string" },
            calculated_area: { type: "number" },
            perimeter: { type: "number" },
            label_x: { type: "number" },
            label_y: { type: "number" },
          },
          required: [
            "room_name",
            "dimensions",
            "calculated_area",
            "perimeter",
            "label_x",
            "label_y",
          ],
        },
      },
    },
    required: ["page_number", "page_title", "is_floor_plan", "rooms"],
  },
};

export interface AiExtractedRoom {
  room_name: string;
  dimensions: string;
  calculated_area: number;
  perimeter: number;
  label_x: number;
  label_y: number;
}

export interface AiPageExtractionResult {
  page_number: number;
  page_title: string;
  is_floor_plan: boolean;
  rooms: AiExtractedRoom[];
}

export class AiExtractionError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = "AiExtractionError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Analyze one page PDF (base64) via OpenRouter.
 * Core prompt / API call / parsing kept from the working extraction service.
 */
export async function analyzeSinglePage(
  base64Pdf: string,
  pageNumber: number,
  onAttempt: (attempt: number) => void = () => undefined
): Promise<AiPageExtractionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new AiExtractionError("OPENROUTER_API_KEY is not set", 500);
  }

  let retryPrompt: string | null = null;
  let lastValidationDetails: unknown = null;

  for (let attempt = 1; attempt <= MAX_ANALYSIS_ATTEMPTS; attempt += 1) {
    onAttempt(attempt);
    const pagePrompt = `${ANALYSIS_PROMPT}\n\nThe attached PDF contains only page ${pageNumber} from the original document. Return exactly one array item and set page_number to ${pageNumber}.`;

    const content = [
      {
        type: "text",
        text:
          attempt === 1 ? pagePrompt : `${pagePrompt}\n\n${retryPrompt}`,
      },
      {
        type: "file",
        file: {
          filename: `blueprint-page-${pageNumber}.pdf`,
          file_data: `data:application/pdf;base64,${base64Pdf}`,
        },
      },
    ];

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      AI_REQUEST_TIMEOUT_MS
    );

    let openRouterResponse: Response;
    try {
      openRouterResponse = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          provider: { require_parameters: true },
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "blueprint_analysis",
              strict: true,
              schema: BLUEPRINT_JSON_SCHEMA,
            },
          },
          messages: [{ role: "user", content }],
        }),
      });
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        (error as { name?: string }).name === "AbortError"
      ) {
        throw new AiExtractionError(
          `AI analysis timed out while processing page ${pageNumber}.`,
          504
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!openRouterResponse.ok) {
      const responseBody = await openRouterResponse.text();
      console.error(
        `OpenRouter failed for page ${pageNumber}, attempt ${attempt} (${openRouterResponse.status}):`,
        responseBody.slice(0, 500)
      );
      throw new AiExtractionError(
        `The AI provider could not analyze page ${pageNumber}.`,
        502
      );
    }

    const openRouterData = (await openRouterResponse.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      error?: unknown;
    };
    const aiText = openRouterData?.choices?.[0]?.message?.content;

    if (openRouterData?.error) {
      console.error(
        `OpenRouter returned an error for page ${pageNumber}:`,
        openRouterData.error
      );
      throw new AiExtractionError(
        `The AI provider rejected page ${pageNumber}.`,
        502
      );
    }

    if (typeof aiText !== "string" || aiText.trim() === "") {
      throw new AiExtractionError(
        `The AI provider returned no analysis for page ${pageNumber}.`,
        502
      );
    }

    try {
      // 4. Clean Validation (Removed Coordinate Normalization Functions entirely)
      const parsedAnalysis: unknown = JSON.parse(aiText);
      const validatedAnalysis = BlueprintSchema.length(1).parse(parsedAnalysis);

      const pageResult = {
        ...validatedAnalysis[0],
        page_number: pageNumber,
      };
      warnIfDuplicateRoomDimensionPairs(pageResult.rooms, pageNumber);

      return pageResult;
    } catch (validationError: unknown) {
      const errorMessage =
        validationError instanceof Error
          ? validationError.message
          : String(validationError);
      lastValidationDetails =
        validationError instanceof z.ZodError
          ? validationError.issues
          : [{ code: "invalid_json", message: errorMessage }];

      console.error(
        `AI response failed validation for page ${pageNumber}, attempt ${attempt}:`,
        {
          details: lastValidationDetails,
          responsePreview: aiText.slice(0, 500),
        }
      );

      if (attempt < MAX_ANALYSIS_ATTEMPTS) {
        retryPrompt = `Your previous response failed validation with this error: ${errorMessage}. Reinspect the attached page and return a corrected complete result.\n\nPrevious failed JSON string:\n${aiText}`;
      }
    }
  }

  throw new AiExtractionError(
    `The AI response for page ${pageNumber} failed validation after ${MAX_ANALYSIS_ATTEMPTS} attempts.`,
    422,
    lastValidationDetails
  );
}

/** Read a single-page PDF from disk and run analysis. */
export async function extractRoomsFromPage(
  pagePdfPath: string,
  pageNumber: number
): Promise<AiPageExtractionResult> {
  const bytes = await fs.readFile(pagePdfPath);
  const base64Pdf = bytes.toString("base64");
  return analyzeSinglePage(base64Pdf, pageNumber);
}

/** Log when two rooms share the same parsed dimension pair (possible duplicate). */
export function warnIfDuplicateRoomDimensionPairs(
  rooms: AiExtractedRoom[],
  pageNumber: number
): void {
  const byPair = new Map<
    string,
    Array<{ room_name: string; dimensions: string }>
  >();

  for (const room of rooms) {
    const { a, b } = parseDimensionPair(room.dimensions);
    if (a == null || b == null) {
      continue;
    }
    const key = `${a}\0${b}`;
    const bucket = byPair.get(key) ?? [];
    bucket.push({ room_name: room.room_name, dimensions: room.dimensions });
    byPair.set(key, bucket);
  }

  for (const [key, entries] of byPair) {
    if (entries.length < 2) {
      continue;
    }
    const [dimensionA, dimensionB] = key.split("\0");
    console.warn(
      `[aiExtraction] Page ${pageNumber}: possible duplicate rooms — identical dimension_a/dimension_b (${dimensionA} x ${dimensionB}):`,
      entries.map((entry) => ({
        room_name: entry.room_name,
        dimensions: entry.dimensions,
      }))
    );
  }
}

/** Clamp AI label center to 0–1000 normalized image coordinates. */
export function normalizeLabelPoint(
  labelX: number,
  labelY: number
): { approxX: number; approxY: number } {
  const clamp = (value: number): number =>
    Math.min(1000, Math.max(0, value));
  return {
    approxX: clamp(labelX),
    approxY: clamp(labelY),
  };
}
