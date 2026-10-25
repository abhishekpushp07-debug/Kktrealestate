/** Minimal typings for autocannon (no @types package bundled). */
declare module "autocannon" {
  interface Histogram { p50: number; p90: number; p97_5: number; p99: number; average: number; max: number; min: number; stddev: number }
  export interface Result {
    title?: string;
    requests: { total: number; average: number; sent: number };
    throughput: { total: number; average: number };
    latency: Histogram;
    non2xx: number;
    errors: number;
    timeouts: number;
    duration: number;
    /** Count of responses per status class / code (e.g. `"2xx"`, `"4xx"`, `"5xx"`, `"429"`). */
    statusCodeStats?: Record<string, { count: number }>;
  }
  export interface Client { setBody(body: string): void; setHeaders(headers: Record<string, string>): void }
  export interface RequestData { method?: string; path?: string; headers?: Record<string, string>; body?: string | Buffer }
  export interface RequestSpec extends RequestData {
    /** Called before every request (the request is rebuilt each time when this is set), so headers/bodies can be unique per request. */
    setupRequest?: (req: RequestData, context: Record<string, unknown>) => RequestData;
  }
  export interface Options {
    url: string;
    connections?: number;
    duration?: number;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    setupClient?: (client: Client) => void;
    requests?: RequestSpec[];
    timeout?: number;
    title?: string;
    expectBody?: string;
  }
  /** The running benchmark: a promise of the result that also emits `response` (client, statusCode, resBytes, responseTimeMs). */
  export interface Instance extends PromiseLike<Result> {
    on(event: "response", listener: (client: unknown, statusCode: number, resBytes: number, responseTime: number) => void): this;
    on(event: "reqError", listener: (err: Error) => void): this;
    on(event: "done", listener: (result: Result) => void): this;
  }
  function autocannon(opts: Options): Instance;
  export default autocannon;
}
