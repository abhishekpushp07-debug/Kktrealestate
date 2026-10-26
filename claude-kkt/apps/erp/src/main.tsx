import { StrictMode } from "react";
import { z } from "zod";
import { createRoot } from "react-dom/client";
import { App } from "@/app";
import "@/styles/index.css";

// Zod's JIT probes `new Function("")`, which the ERP's Content-Security-Policy (no 'unsafe-eval') reports; parse without it.
z.config({ jitless: true });

const container = document.getElementById("root");
if (!container) throw new Error("#root element missing in index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
