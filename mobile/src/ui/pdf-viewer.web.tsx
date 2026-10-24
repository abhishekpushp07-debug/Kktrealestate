// Web-only in-app document viewer. Fetches the file with the bearer token →
// Blob → object URL, then shows it inside a full-screen modal:
//  - PDF in an <iframe> when the browser has a built-in PDF viewer, otherwise
//    rendered page-by-page to <canvas> with pdf.js (Android Chrome, headless).
//  - images inline; other types get Download / Open buttons only.
// Download and "Open in new tab" are real <a> elements clicked by the user.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { webFetchBlob } from "@/src/api/fetch-blob";
import { errMsg } from "@/src/api/client";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { Button, IconButton } from "./primitives";
import { T } from "./text";

export type ViewerRequest = { path: string; name: string; mime?: string };

let listener: ((r: ViewerRequest) => void) | null = null;
export const pdfViewer = {
  open: (req: ViewerRequest) => listener?.(req),
};

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build";
let pdfjsPromise: Promise<any> | null = null;
function loadPdfJs(): Promise<any> {
  const w = window as any;
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  pdfjsPromise =
    pdfjsPromise ||
    new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `${PDFJS}/pdf.min.js`;
      s.async = true;
      s.onload = () => {
        w.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`;
        resolve(w.pdfjsLib);
      };
      s.onerror = () => {
        pdfjsPromise = null;
        reject(new Error("Preview engine could not load"));
      };
      document.head.appendChild(s);
    });
  return pdfjsPromise;
}

const hasNativePdfViewer = () => typeof navigator !== "undefined" && (navigator as any).pdfViewerEnabled !== false;

function PdfCanvas({ blob, onError }: { blob: Blob; onError: (m: string) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pages, setPages] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const host = ref.current;
    (async () => {
      try {
        const lib = await loadPdfJs();
        const doc = await lib.getDocument({ data: await blob.arrayBuffer() }).promise;
        if (cancelled || !host) return;
        const width = Math.min(host.clientWidth || 360, 900);
        const n = Math.min(doc.numPages, 40);
        for (let i = 1; i <= n && !cancelled; i++) {
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const dpr = window.devicePixelRatio || 1;
          const vp = page.getViewport({ scale: (width / base.width) * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.style.cssText = `width:${width}px;height:${vp.height / dpr}px;display:block;margin:0 auto 12px;background:#fff;box-shadow:0 4px 18px rgba(11,31,58,.12);border-radius:6px`;
          canvas.setAttribute("data-testid", `pdf-viewer-page-${i}`);
          host.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
          setPages(i);
        }
      } catch (e) {
        if (!cancelled) onError(errMsg(e, "Could not render this PDF"));
      }
    })();
    return () => {
      cancelled = true;
      if (host) host.innerHTML = "";
    };
  }, [blob, onError]);
  return (
    <div style={{ flex: 1, overflow: "auto", padding: 12 }} data-testid="pdf-viewer-canvas">
      {!pages ? (
        <div style={{ textAlign: "center", padding: 24, color: "#6B7280", fontFamily: fonts.medium }}>Rendering pages…</div>
      ) : null}
      <div ref={ref} />
    </div>
  );
}

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; url: string; blob: Blob };

function Viewer({ req, onClose }: { req: ViewerRequest; onClose: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    webFetchBlob(req.path)
      .then((b) => {
        const typed = req.mime && b.type !== req.mime && (!b.type || b.type === "application/octet-stream") ? new Blob([b], { type: req.mime }) : b;
        url = URL.createObjectURL(typed);
        if (alive) setState({ status: "ready", url, blob: typed });
      })
      .catch((e) => alive && setState({ status: "error", message: errMsg(e, "Could not load the document") }));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [req, attempt]);

  const retry = () => {
    setRenderError(null);
    setState({ status: "loading" });
    setAttempt((a) => a + 1);
  };
  const onRenderError = useCallback((m: string) => setRenderError(m), []);

  const type = state.status === "ready" ? state.blob.type || req.mime || "" : req.mime || "";
  const isPdf = type.includes("pdf") || /\.pdf$/i.test(req.name);
  const isImage = type.startsWith("image/");

  return (
    <View style={s.root} testID="pdf-viewer-modal">
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <View style={{ flex: 1 }}>
          <T v="label" tone="inverseMuted">
            Document
          </T>
          <T v="title" tone="inverse" numberOfLines={1} testID="pdf-viewer-title">
            {req.name}
          </T>
        </View>
        <IconButton icon="x" label="Close" tone="navy" onPress={onClose} testID="pdf-viewer-close" />
      </View>

      {state.status === "ready" ? (
        <View style={s.toolbar}>
          <a href={state.url} download={req.name} data-testid="pdf-viewer-download" style={anchor(colors.gold, colors.onBrandSecondary)}>
            ⤓ Download
          </a>
          <a href={state.url} target="_blank" rel="noopener noreferrer" data-testid="pdf-viewer-open-tab" style={anchor("transparent", colors.onSurfaceInverse, colors.mutedInverse)}>
            ↗ Open in new tab
          </a>
        </View>
      ) : null}

      <View style={s.body}>
        {state.status === "loading" ? (
          <View style={s.center} testID="pdf-viewer-loading">
            <ActivityIndicator size="large" color={colors.gold} />
            <T tone="muted" style={{ marginTop: 12 }}>
              Preparing your document…
            </T>
          </View>
        ) : state.status === "error" || renderError ? (
          <View style={s.center} testID="pdf-viewer-error">
            <Feather name="alert-circle" size={28} color={colors.error} />
            <T v="title" style={{ marginTop: 10, textAlign: "center" }}>
              {state.status === "error" ? "Couldn't load this document" : "Preview unavailable"}
            </T>
            <T tone="muted" style={{ marginTop: 4, textAlign: "center", maxWidth: 360 }}>
              {state.status === "error" ? state.message : `${renderError}. Use Download or Open in new tab above.`}
            </T>
            {state.status === "error" ? <Button small kind="gold" icon="refresh-cw" label="Retry" onPress={retry} testID="pdf-viewer-retry" style={{ marginTop: 16 }} /> : null}
          </View>
        ) : isPdf && hasNativePdfViewer() ? (
          <iframe src={state.url} title={req.name} data-testid="pdf-viewer-frame" style={{ flex: 1, width: "100%", height: "100%", border: 0, background: "#fff" }} />
        ) : isPdf ? (
          <PdfCanvas blob={state.blob} onError={onRenderError} />
        ) : isImage ? (
          <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
            <img src={state.url} alt={req.name} data-testid="pdf-viewer-image" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          </div>
        ) : (
          <View style={s.center} testID="pdf-viewer-no-preview">
            <Feather name="file" size={28} color={colors.muted} />
            <T v="title" style={{ marginTop: 10 }}>
              No preview for this file type
            </T>
            <T tone="muted" style={{ marginTop: 4 }}>
              Use Download or Open in new tab above.
            </T>
          </View>
        )}
      </View>
    </View>
  );
}

const anchor = (bg: string, fg: string, border?: string): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 44,
  padding: "0 18px",
  borderRadius: 999,
  background: bg,
  color: fg,
  border: border ? `1px solid ${border}` : "none",
  fontFamily: fonts.bold,
  fontSize: 14,
  textDecoration: "none",
  cursor: "pointer",
});

export function PdfViewerHost() {
  const [req, setReq] = useState<ViewerRequest | null>(null);
  useEffect(() => {
    listener = (r) => setReq({ ...r });
    return () => {
      listener = null;
    };
  }, []);
  return (
    <Modal visible={!!req} animationType="fade" onRequestClose={() => setReq(null)} transparent={false}>
      {req ? <Viewer req={req} onClose={() => setReq(null)} /> : null}
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: c.surfaceInverse },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: c.surfaceInverse },
  body: { flex: 1, backgroundColor: c.surfaceTertiary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
}));
