/* Preview only: anything that is not ERP (/erp*), the temporary React portal (/portal*) or the API (/api*) is the marketing site served by /app/site on 3002.
   The site dev server runs with PUBLIC_URL=/site-assets and WDS_SOCKET_PATH=/site-ws so its bundle/HMR never collide with the ERP dev server's /static and /ws. */
const { createProxyMiddleware } = require("http-proxy-middleware");

const SITE = process.env.SITE_DEV_URL || "http://localhost:3002";
const isErp = (p) => /^\/(erp|portal|api)(\/|$)/.test(p) || p.startsWith("/static/") || p.startsWith("/sockjs-node") || p === "/ws" || p === "/manifest.json" || p === "/favicon.ico" || p.startsWith("/__") || p.startsWith("/emergent") || p.endsWith(".hot-update.json") || p.endsWith(".hot-update.js");
const isSite = (pathname) => !isErp(pathname);

module.exports = function (app) {
  app.use(createProxyMiddleware(isSite, {
    target: SITE,
    changeOrigin: true,
    ws: true,
    logLevel: "warn",
    onError: (err, req, res) => { if (res.writeHead && !res.headersSent) { res.writeHead(503, { "Content-Type": "text/html" }); res.end("<!doctype html><title>Site starting</title><meta http-equiv='refresh' content='3'><body style='font-family:sans-serif;padding:40px'>Marketing site dev server is starting… retrying.</body>"); } },
  }));
};
