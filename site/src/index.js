import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@/index.css";
import SiteApp from "@/SiteApp";

// /erp and /portal are served by the router-loader in index.html (see frontend/scripts/package-build.js); never boot the site there.
const foreign = /^\/(erp|portal)(\/|$)/.test(window.location.pathname) || window.__KKT_SURFACE;
if (!foreign) {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <BrowserRouter basename="/">
        <SiteApp />
      </BrowserRouter>
    </React.StrictMode>,
  );
}
