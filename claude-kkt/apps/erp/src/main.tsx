import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app";
import "@/styles/index.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root element missing in index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
