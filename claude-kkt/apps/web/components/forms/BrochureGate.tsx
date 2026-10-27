"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";

import { useSiteConfig } from "@/components/SiteConfigProvider";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, FormStatus, Honeypot, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { DownloadIcon } from "@/components/ui/icons";
import { absoluteApiUrl, friendlyErrorMessage, isApiError, publicClient } from "@/lib/api";
import { canonicalPhone } from "@/lib/format";
import type { BrochureRepeatRequest, BrochureRequest } from "@/lib/types";

const STORAGE_KEY = "kkt:brochure-visitor";

/**
 * What the device remembers: ONLY the opaque visitor token (a signed reference the API resolves to the visitor; it carries no name,
 * phone or e-mail). Entries written by older releases also held the visitor's details: they are rewritten without them on first read.
 */
interface RememberedVisitor {
  visitor_token: string;
}

function readVisitor(): RememberedVisitor | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedVisitor> & Record<string, unknown>;
    if (typeof parsed.visitor_token === "string" && parsed.visitor_token.length >= 16) {
      const visitor = { visitor_token: parsed.visitor_token };
      if (Object.keys(parsed).length > 1) writeVisitor(visitor); // drop personal details stored by older releases
      return visitor;
    }
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable
  }
  return null;
}

function writeVisitor(visitor: RememberedVisitor | null) {
  try {
    if (visitor) window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ visitor_token: visitor.visitor_token }));
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
 * Brochure lead gate. First download asks for name/phone/consent; the returned opaque visitor_token (no personal data) is
 * remembered on the device so later downloads skip the form (the activity is still logged server-side).
 */
export function BrochureGate({ open, onClose, projectSlug, projectName }: BrochureGateProps) {
  const { apiUrl, companySlug, brandName } = useSiteConfig();
  const id = useId();
  // The gate is mounted when it opens (see BrochureButton), so each opening starts fresh and the device's remembered
  // visitor is read once, in the browser.
  const [remembered, setRemembered] = useState<RememberedVisitor | null>(readVisitor);
  const [state, setState] = useState<GateState>(() => (remembered ? { kind: "requesting" } : { kind: "form" }));
  const [values, setValues] = useState({ name: "", phone: "", email: "", consent: false, website: "" });
  const [errors, setErrors] = useState<{ name?: string; phone?: string; email?: string; consent?: string }>({});

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  /** Requests the signed link; every state change happens when the response (or failure) arrives. */
  const send = useCallback(
    (body: BrochureRequest | BrochureRepeatRequest, viaToken: boolean): Promise<void> =>
      publicClient(apiUrl, companySlug)
        .requestBrochure(body)
        .then(
          (result) => {
            const url = absoluteApiUrl(apiUrl, result.download_url);
            writeVisitor({ visitor_token: result.visitor_token });
            setState({ kind: "ready", downloadUrl: url, expiresAt: result.expires_at });
            window.location.assign(url);
          },
          (error: unknown) => {
            if (
              viaToken &&
              isApiError(error) &&
              error.status >= 400 &&
              error.status < 500 &&
              error.code !== "RATE_LIMITED"
            ) {
              // Token no longer honoured: forget it and ask again.
              writeVisitor(null);
              setRemembered(null);
              setState({ kind: "form" });
              return;
            }
            setState({ kind: "error", message: friendlyErrorMessage(error) });
          },
        ),
    [apiUrl, companySlug],
  );

  // A remembered device skips the form: ask for the link straight away (`remembered` only ever changes to null).
  useEffect(() => {
    if (!remembered) return;
    void send({ project_slug: projectSlug, website: "", visitor_token: remembered.visitor_token }, true);
  }, [remembered, projectSlug, send]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: typeof errors = {};
    if (values.name.trim().length < 2) next.name = "Please enter your full name.";
    if (!canonicalPhone(values.phone)) next.phone = "Enter a valid 10-digit Indian mobile number.";
    if (values.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email.trim()))
      next.email = "Enter a valid email address.";
    if (!values.consent) next.consent = "Please agree so we can share the brochure.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setState({ kind: "requesting" });
    void send(
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
    <Modal
      open={open}
      onClose={onClose}
      title={`${projectName} brochure`}
      description="Floor plans, specifications and pricing on request."
      size="sm"
    >
      {state.kind === "ready" ? (
        <div className="text-center" role="status" aria-live="polite">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gold-500 text-navy-950">
            <DownloadIcon size={26} />
          </span>
          <p className="mt-5 font-display text-2xl text-navy-900">Your download is starting</p>
          <p className="mt-2 text-sm text-ink-muted">
            If it does not begin automatically, use the button below. The link is valid for 15 minutes.
          </p>
          <Button href={state.downloadUrl} external className="mt-6" rel="noopener">
            <DownloadIcon size={18} /> Download brochure
          </Button>
        </div>
      ) : remembered && state.kind === "requesting" ? (
        <div className="py-6 text-center" role="status" aria-live="polite">
          <p className="font-display text-2xl text-navy-900">Welcome back.</p>
          <p className="mt-2 text-sm text-ink-muted">Preparing your brochure…</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate aria-busy={busy} className="grid gap-5">
          <Honeypot value={values.website} onChange={(v) => set("website", v)} />
          <Field label="Full name" htmlFor={`${id}-name`} error={errors.name} required>
            <Input
              id={`${id}-name`}
              name="name"
              autoComplete="name"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              invalid={!!errors.name}
              maxLength={80}
              data-autofocus
            />
          </Field>
          <Field label="Mobile number" htmlFor={`${id}-phone`} error={errors.phone} required>
            <Input
              id={`${id}-phone`}
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
              invalid={!!errors.phone}
              maxLength={14}
            />
          </Field>
          <Field label="Email" htmlFor={`${id}-email`} error={errors.email} hint="Optional — we will email you a copy">
            <Input
              id={`${id}-email`}
              name="email"
              type="email"
              autoComplete="email"
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
              invalid={!!errors.email}
              maxLength={120}
            />
          </Field>
          <Checkbox
            id={`${id}-consent`}
            name="consent"
            checked={values.consent}
            onChange={(e) => set("consent", e.target.checked)}
            error={errors.consent}
            label={`I agree to receive the brochure and be contacted by ${brandName}.`}
          />
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
export function BrochureButton({
  projectSlug,
  projectName,
  variant = "primary",
  className = "",
  label = "Download brochure",
}: {
  projectSlug: string;
  projectName: string;
  variant?: "primary" | "secondary" | "outline" | "outline-light";
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <DownloadIcon size={18} /> {label}
      </Button>
      {open && <BrochureGate open onClose={() => setOpen(false)} projectSlug={projectSlug} projectName={projectName} />}
    </>
  );
}
