/** Types of scripts/bundle-budget.mjs (used by src/lib/__tests__/bundle-budget.test.ts). */
export interface ManifestChunk {
  file: string;
  name?: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}
export type Manifest = Record<string, ManifestChunk>;
export interface Budgets {
  firstLoadJsGzipKb: number;
  firstLoadCssGzipKb: number;
  chunkGzipKb: number;
}
export interface BudgetReport {
  firstLoad: {
    js: Array<{ key: string; file: string; gzip: number }>;
    jsGzipKb: number;
    cssGzipKb: number;
    css: string[];
  };
  largest: Array<{ file: string; gzipKb: number; lazy: boolean }>;
  totalJsGzipKb: number;
  chunkCount: number;
  failures: string[];
}
export const BUDGETS: Budgets;
export const MUST_BE_LAZY: readonly string[];
export function analyse(manifest: Manifest, sizeOf: (file: string) => number, budgets?: Budgets): BudgetReport;
