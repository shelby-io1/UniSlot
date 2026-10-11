declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export type PdfTextItem = {
    str: string;
    transform: number[];
    width: number;
    height: number;
    fontName: string;
  };
  export type PdfTextContent = { items: unknown[] };
  export type PdfPage = {
    getViewport(params: { scale: number }): { width: number; height: number };
    getTextContent(): Promise<PdfTextContent>;
  };
  export type PdfDocument = {
    numPages: number;
    getPage(pageNumber: number): Promise<PdfPage>;
  };
  export function getDocument(params: {
    data: Uint8Array;
    useSystemFonts?: boolean;
    isEvalSupported?: boolean;
    useWorkerFetch?: boolean;
  }): { promise: Promise<PdfDocument> };
}
