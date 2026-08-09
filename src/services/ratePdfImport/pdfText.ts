/** Extract a text layer from a PDF buffer (best-effort). */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    // pdf-parse v1 default export is the parse function
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (
      data: Buffer,
    ) => Promise<{ text?: string }>;
    const result = await pdfParse(buffer);
    return String(result.text || '').trim();
  } catch (err) {
    console.warn('pdf-parse failed; continuing with PDF bytes only', err);
    return '';
  }
}
