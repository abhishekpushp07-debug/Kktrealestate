/**
 * Audit v3 H3: the ERP runs on a data router (createBrowserRouter + RouterProvider) so useBlocker works for the unsaved-changes
 * guard. These checks pin the wiring; the blocking itself is exercised in the browser (docs/qa/erp/browser-qa.cjs, section
 * "phase7": dirty settings + sidebar link, dirty sheet + Esc / outside click / close button).
 */
import fs from "node:fs";
import path from "node:path";
import { createRoutesFromElements, Route } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { RootLayout, RouteErrorPage } from "@/components/layout/RootLayout";
import { appRouteTree } from "@/routes";

const SRC = path.resolve(__dirname, "../..");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : files(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function paths(routes: ReturnType<typeof createRoutesFromElements>, prefix = ""): string[] {
  return routes.flatMap((route) => {
    const own = route.path ? (route.path.startsWith("/") ? route.path : `${prefix}/${route.path}`) : prefix;
    return [...(route.path ? [own] : []), ...paths(route.children ?? [], own)];
  });
}

describe("data router", () => {
  it("builds the whole route tree under one pathless root with an errorElement", () => {
    const routes = createRoutesFromElements(
      <Route element={<RootLayout />} errorElement={<RouteErrorPage />}>
        {appRouteTree()}
      </Route>,
    );
    expect(routes).toHaveLength(1);
    expect(routes[0]?.errorElement).toBeTruthy();
    const all = paths(routes);
    for (const p of [
      "/login",
      "/bookings",
      "/bookings/new",
      "/bookings/:id",
      "/admin/settings/*",
      "/print/receipt/:id",
    ]) {
      expect(all).toContain(p);
    }
  });

  it("no component falls back to <BrowserRouter> or a nested <Routes> (useBlocker needs the data router)", () => {
    const offenders = files(SRC).filter((file) =>
      /<BrowserRouter\b|<Routes\b|<HashRouter\b/.test(fs.readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
    const app = fs.readFileSync(path.join(SRC, "app.tsx"), "utf8");
    expect(app).toMatch(/<RouterProvider router=\{router\} \/>/);
  });

  it("the guard is used by the settings pages, the wizards and every sheet / dialog", () => {
    const usesGuard = (rel: string) => /useUnsavedChangesGuard\(/.test(fs.readFileSync(path.join(SRC, rel), "utf8"));
    for (const rel of [
      "features/admin/SettingsPage.tsx",
      "features/cms/SiteSettingsPage.tsx",
      "features/cms/PostEditorPage.tsx",
      "features/inventory/project/VisitSettingsTab.tsx",
      "features/inventory/project/WebsiteTab.tsx",
      "features/bookings/wizard/BookingWizard.tsx",
      "features/inventory/BlockWizard.tsx",
      "components/ui/dirty-close.tsx",
    ]) {
      expect(usesGuard(rel), rel).toBe(true);
    }
    for (const rel of ["components/ui/sheet.tsx", "components/ui/dialog.tsx"]) {
      const src = fs.readFileSync(path.join(SRC, rel), "utf8");
      expect(src).toMatch(/useDirtyClose\(/);
      expect(src).toMatch(/onEscapeKeyDown=\{/);
      expect(src).toMatch(/onInteractOutside=\{/);
      expect(src).toMatch(/onClick=\{guard\.intercept\}/);
    }
    // the old per-wizard beforeunload handlers are gone (the host owns beforeunload)
    const beforeunload = files(SRC).filter((file) =>
      /addEventListener\("beforeunload"/.test(fs.readFileSync(file, "utf8")),
    );
    expect(beforeunload.map((file) => path.relative(SRC, file))).toEqual(["components/NavigationGuard.tsx"]);
  });
});
