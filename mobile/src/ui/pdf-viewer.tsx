// Native: PDFs/documents are downloaded and handed to the share sheet (see api/pdf.ts),
// so there is no in-app viewer. The web build uses pdf-viewer.web.tsx.
export type ViewerRequest = { path: string; name: string; mime?: string };

export const pdfViewer = {
  open: (_req: ViewerRequest) => {},
};

export function PdfViewerHost(_props: { inline?: boolean }) {
  return null;
}
