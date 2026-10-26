import { createServer, type Server } from "node:http";
import { isMetricsToken } from "../../plugins/telemetry.js";

/** Options of the internal metrics listener. */
export interface MetricsServerOptions {
  port: number;
  host?: string;
  /** Renders the exposition text (aggregated cluster metrics in the primary, the registry in a single process). */
  render: () => Promise<string>;
  contentType: string;
  /** When set, scrapes must send `Authorization: Bearer <token>`. */
  token?: string | undefined;
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

/**
 * The internal metrics listener (METRICS_PORT, default 9464): `GET /metrics` answers the cluster-wide aggregate. Bind it to a private
 * network only (Kubernetes: the pod IP, scraped by Prometheus; Compose: not published). With METRICS_TOKEN set it also requires the
 * bearer token. A port that is already taken logs a warning instead of stopping the API.
 */
export function startMetricsServer(o: MetricsServerOptions): Promise<Server | null> {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method !== "GET" || (path !== "/metrics" && path !== "/")) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found\n");
      return;
    }
    if (o.token && !isMetricsToken(req.headers.authorization, o.token)) {
      res.writeHead(401, { "content-type": "text/plain", "www-authenticate": 'Bearer realm="metrics"' }).end("unauthorized\n");
      return;
    }
    o.render()
      .then((body) => res.writeHead(200, { "content-type": o.contentType, "cache-control": "no-store" }).end(body))
      .catch((err: unknown) => res.writeHead(500, { "content-type": "text/plain" }).end(`metrics unavailable: ${(err as Error).message}\n`));
  });
  server.keepAliveTimeout = 65_000;
  return new Promise((resolve) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      o.log.warn({ err: err.message, port: o.port }, "metrics listener not started");
      resolve(null);
    });
    server.listen(o.port, o.host ?? "0.0.0.0", () => {
      o.log.info({ port: o.port, auth: o.token ? "bearer" : "none" }, "metrics listener started");
      resolve(server);
    });
  });
}
