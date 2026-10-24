/** Minimal typings for autocannon (no @types package bundled). */
declare module "autocannon" {
  interface Histogram { p50: number; p97_5: number; p99: number; average: number; max: number; min: number }
  export interface Result { title?: string; requests: { total: number; average: number }; latency: Histogram; non2xx: number; errors: number; timeouts: number }
  export interface Client { setBody(body: string): void; setHeaders(headers: Record<string, string>): void }
  export interface Options { url: string; connections?: number; duration?: number; method?: string; headers?: Record<string, string>; body?: string; setupClient?: (client: Client) => void; title?: string }
  function autocannon(opts: Options): Promise<Result>;
  export default autocannon;
}
