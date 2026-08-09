/**
 * Call OpenRouter (Claude) to extract rate-list rows from a PDF + text.
 */
import { normalizeLlmRows } from './normalize';
import type { RatePdfSuggestion } from '../../models/RatePdfImportJob';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-sonnet-5';

const SYSTEM_PROMPT = `You extract unit rates from construction price-list / rate-databank PDFs.
Return ONLY a JSON array (no markdown fences) of objects with keys:
category, name, unit, unitCost, confidence.

Rules:
- category MUST be one of: Materials, Labour, Equipment
- name: short resource description
- unit: e.g. m³, m², kg, bag, day, hr, item
- unitCost: numeric unit price only (no currency symbols)
- confidence: 0..1 how sure you are the number was read correctly
- Skip headers, totals, notes, and non-price lines
- If a price is illegible or ambiguous, omit the row or set low confidence
- Do not invent items that are not in the document`;

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('Model response was not valid JSON');
  }
}

export async function extractRatesFromPdf(opts: {
  fileName: string;
  pdfBuffer: Buffer;
  extractedText: string;
}): Promise<RatePdfSuggestion[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const textSnippet = (opts.extractedText || '').slice(0, 60000);
  const pdfBase64 = opts.pdfBuffer.toString('base64');
  const userText =
    `File: ${opts.fileName}\n\n` +
    `Extracted text (may be incomplete OCR):\n---\n${textSnippet || '(no text layer)'}\n---\n` +
    `Also inspect the attached PDF pages. Return the JSON array only.`;

  const body = {
    model: MODEL,
    temperature: 0.1,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          {
            type: 'file',
            file: {
              filename: opts.fileName,
              file_data: `data:application/pdf;base64,${pdfBase64}`,
            },
          },
        ],
      },
    ],
  };

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
      'X-Title': 'Takeoff Engine Rate Import',
    },
    body: JSON.stringify(body),
  });

  const payload = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  };

  if (!res.ok) {
    throw new Error(
      payload.error?.message || `OpenRouter request failed (${res.status})`,
    );
  }

  const content = payload.choices?.[0]?.message?.content;
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((c) => (c.type === 'text' ? c.text || '' : ''))
      .join('\n');
  }
  if (!text) throw new Error('Empty model response');

  const parsed = extractJsonArray(text);
  return normalizeLlmRows(parsed);
}
