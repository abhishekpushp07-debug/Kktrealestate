"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { SiteConfig } from "@/lib/env";

export interface SiteConfigValue extends SiteConfig {
  brandName: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
}

const SiteConfigContext = createContext<SiteConfigValue | null>(null);

export function SiteConfigProvider({ value, children }: { value: SiteConfigValue; children: ReactNode }) {
  return <SiteConfigContext.Provider value={value}>{children}</SiteConfigContext.Provider>;
}

export function useSiteConfig(): SiteConfigValue {
  const ctx = useContext(SiteConfigContext);
  if (!ctx) throw new Error("useSiteConfig must be used within <SiteConfigProvider>");
  return ctx;
}
