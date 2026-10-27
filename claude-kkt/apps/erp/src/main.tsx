import { StrictMode } from "react";
import { z } from "zod";
import { createRoot } from "react-dom/client";
import { App } from "@/app";
import { installChunkReload } from "@/lib/chunkReload";
import { applyPreloadedFonts } from "@/lib/fonts";
import { installGlobalErrorReporting } from "@/lib/errorReporting";
import "@/styles/index.css";

// Zod's JIT probes `new Function("")`, which the ERP's Content-Security-Policy (no 'unsafe-eval') reports; parse without it.
z.config({ jitless: true });

// Uncaught errors and rejections go to POST /client-errors; a lazy chunk that vanished with a deploy reloads the page once.
installGlobalErrorReporting();
installChunkReload();
// The web fonts are preloaded by index.html and applied here, after the shell's first paint is no longer blocked on them.
applyPreloadedFonts();

const container = document.getElementById("root");
if (!container) throw new Error("#root element missing in index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
