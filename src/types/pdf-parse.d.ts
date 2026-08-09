declare module 'pdf-parse' {
  interface PdfData {
    text?: string;
    numpages?: number;
  }
  function pdfParse(data: Buffer): Promise<PdfData>;
  export = pdfParse;
}
