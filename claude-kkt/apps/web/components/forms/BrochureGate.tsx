"use client";

import { useEffect, useId, useState, type FormEvent } from "react";

import { useSiteConfig } from "@/components/SiteConfigProvider";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, FormStatus, Honeypot, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { DownloadIcon } from "@/components/ui/icons";
import { absoluteApiUrl, friendlyErrorMessage, isApiError, publicClient } from "@/lib/api";
import { canonicalPhone } from "@/lib/format";
import type { BrochureRequest } from "@/lib/types";

const STORAGE_KEY = "kkt:brochure-visitor";

interface RememberedVisitor {
  visitor_token: string;
  name: string;
  phone: string;
  email?: string;
}

function readVisitor(): RememberedVisitor | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedVisitor>;
    if (typeof parsed.visitor_token === "string" && typeof parsed.name === "string" && typeof parsed.phone === "string") {
      return { visitor_token: parsed.visitor_token, name: parsed.name, phone: parsed.phone, ...(parsed.email ? { email: parsed.email } : {}) };
    }
  } catch {
    // storage unavailable
  }
  return null;
}

function writeVisitor(visitor: RememberedVisitor | null) {
  try {
    if (visitor) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(visitor));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable
  }
}

interface BrochureGateProps {
  open: boolean;
  onClose: () => void;
  projectSlug: string;
  projectName: string;
}

type GateState =
  | { kind: "form" }
  | { kind: "requesting" }
  | { kind: "error"; message: string }
  | { kind: "ready"; downloadUrl: string; expiresAt: string };

/**
 * Brochure lead gate. First download asks for name/phone/consent; the returned visitor_token is
 * remembered on the device so later downloads skip the form (the activity is still logged server-side).
 */
export function BrochureGate({ open, onClose, projectSlug, projectName }: BrochureGateProps) {
  const { apiUrl, brandName } = useSiteConfig();
  const id = useId();
  const [state, setState] = useState<GateState>({ kind: "form" });
  const [values, setValues] = useState({ name: "", phone: "", email: "", consent: false, website: "" });
  const [errors, setErrors] = useState<{ name?: string; phone?: string; email?: string; consent?: string }>({});
  const [remembered, setRemembered] = useState<RememberedVisitor | null>(null);

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function request(body: BrochureRequest, viaToken: boolean) {
    setState({ kind: "requesting" });
    try {
      const result = await publicClient(apiUrl).requestBrochure(body);
      const url = absoluteApiUrl(apiUrl, result.download_url);
      writeVisitor({ visitor_token: result.visitor_token, name: body.name, phone: body.phone, ...(body.email ? { email: body.email } : {}) });
      setState({ kind: "ready", downloadUrl: url, expiresAt: result.expires_at });
      window.location.assign(url);
    } catch (error) {
      if (viaToken && isApiError(error) && error.status >= 400 && error.status < 500 && error.code !== "RATE_LIMITED") {
        // Token no longer honoured: forget it and ask again.
        writeVisitor(null);
        setRemembered(null);
        setState({ kind: "form" });
        return;
      }
      setState({ kind: "error", message: friendlyErrorMessage(error) });
    }
  }

  // When the gate opens and the device is remembered, skip the form.
  useEffect(() => {
    if (!open) return;
    setState({ kind: "form" });
    const visitor = readVisitor();
    setRemembered(visitor);
    if (visitor) {
      void request(
        { project_slug: projectSlug, name: visitor.name, phone: visitor.phone, ...(visitor.email ? { email: visitor.email } : {}), consent: true, website: "", visitor_token: visitor.visitor_token },
        true,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectSlug]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: typeof errors = {};
    if (values.name.trim().length < 2) next.name = "Please enter your full name.";
    if (!canonicalPhone(values.phone)) next.phone = "Enter a valid 10-digit Indian mobile number.";
    if (values.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email.trim())) next.email = "Enter a valid email address.";
    if (!values.consent) next.consent = "Please agree so we can share the brochure.";
    setErrors(next);
    if (Object.keys(next).length) return;
    void request(
      {
        project_slug: projectSlug,
        name: values.name.trim(),
        phone: canonicalPhone(values.phone) ?? values.phone,
        ...(values.email.trim() ? { email: values.email.trim() } : {}),
        consent: true,
        website: values.website as "",
      },
      false,
    );
  }

  const busy = state.kind === "requesting";

  return (
    <Modal open={open} onClose={onClose} title={`${projectName} brochure`} description="Floor plans, specifications and pricing on request." size="sm">
      {state.kind === "ready" ? (
        <div className="text-center" role="status" aria-live="polite">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gold-500 text-navy-950">
            <DownloadIcon size={26} />
          </span>
          <p className="mt-5 font-display text-2xl text-navy-900">Your download is starting</p>
          <p className="mt-2 text-sm text-ink-muted">If it does not begin automatically, use the button below. The link is valid for 15 minutes.</p>
          <Button href={state.downloadUrl} external className="mt-6" rel="noopener">
            <DownloadIcon size={18} /> Download brochure
          </Button>
        </div>
      ) : remembered && state.kind === "requesting" ? (
        <div className="py-6 text-center" role="status" aria-live="polite">
          <p className="font-display text-2xl text-navy-900">Welcome back, {remembered.name.split(" ")[0]}.</p>
          <p className="mt-2 text-sm text-ink-muted">Preparing your brochure…</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate aria-busy={busy} className="grid gap-5">
          <Honeypot value={values.website} onChange={(v) => set("website", v)} />
          <Field label="Full name" htmlFor={`${id}-name`} error={errors.name} required>
            <Input id={`${id}-name`} name="name" autoComplete="name" value={values.name} onChange={(e) => set("name", e.target.value)} invalid={!!errors.name} maxLength={80} data-autofocus />
          </Field>
          <Field label="Mobile number" htmlFor={`${id}-phone`} error={errors.phone} required>
            <Input id={`${id}-phone`} name="phone" type="tel" inputMode="numeric" autoComplete="tel-national" value={values.phone} onChange={(e) => set("phone", e.target.value)} invalid={!!errors.phone} maxLength={14} />
          </Field>
          <Field label="Email" htmlFor={`${id}-email`} error={errors.email} hint="Optional — we will email you a copy">
            <Input id={`${id}-email`} name="email" type="email" autoComplete="email" value={values.email} onChange={(e) => set("email", e.target.value)} invalid={!!errors.email} maxLength={120} />
          </Field>
          <Checkbox id={`${id}-consent`} name="consent" checked={values.consent} onChange={(e) => set("consent", e.target.checked)} error={errors.consent} label={`I agree to receive the brochure and be contacted by ${brandName}.`} />
          {state.kind === "error" ? <FormStatus tone="error">{state.message}</FormStatus> : null}
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? "Preparing…" : "Get the brochure"}
          </Button>
        </form>
      )}
    </Modal>
  );
}

/** Button + gate, for use anywhere on a project page. */
export function BrochureButton({ projectSlug, projectName, variant = "primary", className = "", label = "Download brochure" }: { projectSlug: string; projectName: string; variant?: "primary" | "secondary" | "outline" | "outline-light"; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <DownloadIcon size={18} /> {label}
      </Button>
      <BrochureGate open={open} onClose={() => setOpen(false)} projectSlug={projectSlug} projectName={projectName} />
    </>
  );
}
