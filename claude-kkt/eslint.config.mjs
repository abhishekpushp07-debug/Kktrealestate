// Root ESLint flat config for every package (run per package with `pnpm --filter <pkg> lint`, or `pnpm lint` for all).
// Type checking stays in `pnpm typecheck` (tsc); these rules are the fast, syntax-level layer on top.
import path from "node:path";
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * kkt/module-boundaries: a file in apps/api/src/modules/<A>/ may import another business module <B> only through its public entry
 * (modules/<B>/index.ts). Reaching into modules/<B>/service.ts couples A to B's internals and defeats the module loader's isolation.
 * Shared code belongs in apps/api/src/lib or packages/*.
 */
const moduleBoundaries = {
  meta: {
    type: "problem",
    docs: { description: "Cross-module imports in apps/api/src/modules must go through the other module's index.ts" },
    schema: [],
    messages: {
      crossModule: "Module '{{from}}' imports '{{target}}' from module '{{to}}'; import it from '{{to}}/index.js' (or move it to lib/).",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    const match = /^(.*[\\/]apps[\\/]api[\\/]src[\\/]modules)[\\/]([^\\/]+)[\\/]/.exec(filename);
    if (!match) return {};
    const modulesRoot = match[1];
    const from = match[2];
    const check = (node, source) => {
      if (!source || source.type !== "Literal" || typeof source.value !== "string" || !source.value.startsWith(".")) return;
      const resolved = path.resolve(path.dirname(filename), source.value);
      const rel = path.relative(modulesRoot, resolved);
      if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return; // outside modules/ (lib, plugins, …) or modules/ itself
      const [to, ...rest] = rel.split(path.sep);
      if (to === from || rest.length === 0) return; // same module, or the module folder (its index)
      if (rest.length === 1 && /^index(\.(ts|js))?$/.test(rest[0])) return;
      context.report({ node, messageId: "crossModule", data: { from, to, target: rest.join("/") } });
    };
    return {
      ImportDeclaration: (node) => check(node, node.source),
      ExportNamedDeclaration: (node) => check(node, node.source),
      ExportAllDeclaration: (node) => check(node, node.source),
      ImportExpression: (node) => check(node, node.source),
    };
  },
};

const kkt = { meta: { name: "kkt" }, rules: { "module-boundaries": moduleBoundaries } };

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/.expo/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/storage/**",
      "docs/qa/**",
      "apps/portal/scripts/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.node } },
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/erp/**/*.{ts,tsx,js,jsx}", "apps/web/**/*.{ts,tsx,js,jsx}", "apps/portal/**/*.{ts,tsx,js,jsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ["**/*.cjs", "apps/portal/metro.config.js"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["apps/api/src/modules/**/*.ts"],
    plugins: { kkt },
    // warn while the existing cross-module imports are moved behind index.ts; the verify stage flips this to "error"
    rules: { "kkt/module-boundaries": "warn" },
  },
  prettier,
);
