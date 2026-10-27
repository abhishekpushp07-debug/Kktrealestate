"use client";

import { useId, useState, type FormEvent } from "react";

import { useSiteConfig } from "@/components/SiteConfigProvider";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, FormStatus, Honeypot, Input, Select, Textarea } from "@/components/ui/Field";
import { useUtmParams } from "@/components/ui/hooks";
import { CheckIcon, WhatsAppIcon } from "@/components/ui/icons";
import { friendlyErrorMessage, isApiError, publicClient } from "@/lib/api";
import { canonicalPhone, whatsappHref } from "@/lib/format";
import type { EnquiryRequest, UtmParams } from "@/lib/types";

export interface ProjectOption {
  slug: string;
  name: string;
}

export interface FlatTypeOption {
  /** Master flat-type code; when absent the preference is folded into the message. */
  code: string | null;
  label: string;
}

interface EnquiryFormProps {
  projects: ProjectOption[];
  flatTypes?: FlatTypeOption[];
  defaultProjectSlug?: string;
  /** Visual tone: on a navy section use "dark". */
  tone?: "light" | "dark";
  heading?: string;
  compact?: boolean;
}

interface FormValues {
  name: string;
  phone: string;
  email: string;
  project: string;
  flatType: string;
  message: string;
  consent: boolean;
  website: string;
}

type Errors = Partial<Record<keyof FormValues, string>>;

const DEFAULT_FLAT_TYPES: FlatTypeOption[] = [1, 2, 3, 4].map((bhk) => ({ code: null, label: `${bhk} BHK` }));

function validate(values: FormValues): Errors {
  const errors: Errors = {};
  if (values.name.trim().length < 2) errors.name = "Please enter your full name.";
  if (!canonicalPhone(values.phone)) errors.phone = "Enter a valid 10-digit Indian mobile number.";
  if (values.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email.trim()))
    errors.email = "Enter a valid email address.";
  if (values.message.length > 1000) errors.message = "Please keep your message under 1,000 characters.";
  if (!values.consent) errors.consent = "Please agree so we can contact you.";
  return errors;
}

export function EnquiryForm({
  projects,
  flatTypes,
  defaultProjectSlug = "",
  tone = "light",
  heading,
  compact = false,
}: EnquiryFormProps) {
  const { apiUrl, companySlug, whatsapp, phone: sitePhone, brandName } = useSiteConfig();
  const utm = useUtmParams();
  const id = useId();
  const options = flatTypes && flatTypes.length ? flatTypes : DEFAULT_FLAT_TYPES;

  const [values, setValues] = useState<FormValues>({
    name: "",
    phone: "",
    email: "",
    project: defaultProjectSlug,
    flatType: "",
    message: "",
    consent: false,
    website: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<
    { kind: "idle" | "submitting" } | { kind: "error"; message: string } | { kind: "success"; reference: string }
  >({ kind: "idle" });

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const field = (name: string) => `${id}-${name}`;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const first = Object.keys(nextErrors)[0];
      document.getElementById(field(first ?? "name"))?.focus();
      return;
    }
    setStatus({ kind: "submitting" });

    const chosen = options.find((o) => (o.code ?? o.label) === values.flatType);
    const preference = chosen && !chosen.code ? `Interested in: ${chosen.label}` : null;
    const message = [values.message.trim(), preference].filter(Boolean).join("\n") || undefined;
    const utmBody: UtmParams | undefined = Object.keys(utm).length ? (utm as UtmParams) : undefined;

    const body: EnquiryRequest = {
      name: values.name.trim(),
      phone: canonicalPhone(values.phone) ?? values.phone,
      ...(values.email.trim() ? { email: values.email.trim() } : {}),
      ...(values.project ? { project_slug: values.project } : {}),
      ...(chosen?.code ? { flat_type_code: chosen.code } : {}),
      ...(message ? { message } : {}),
      consent: true,
      website: values.website as "",
      ...(utmBody ? { utm: utmBody } : {}),
    };

    try {
      const result = await publicClient(apiUrl, companySlug).createEnquiry(body);
      setStatus({ kind: "success", reference: result.reference_number });
    } catch (error) {
      if (
        isApiError(error) &&
        error.code === "VALIDATION_ERROR" &&
        error.details &&
        typeof error.details === "object"
      ) {
        const fields = (error.details as { fields?: Record<string, string> }).fields;
        if (fields)
          setErrors(
            Object.fromEntries(
              Object.entries(fields).map(([k, v]) => [k === "project_slug" ? "project" : k, v]),
            ) as Errors,
          );
      }
      setStatus({ kind: "error", message: friendlyErrorMessage(error) });
    }
  }

  const dark = tone === "dark";
  const labelTone = dark ? "[&_label]:text-ivory-100 [&_p]:text-ivory-100/70" : "";

  if (status.kind === "success") {
    const wa = whatsappHref(whatsapp ?? sitePhone, `Hello ${brandName}, I just sent enquiry ${status.reference}.`);
    return (
      <div
        className={`rounded-card border p-8 text-center ${dark ? "border-ivory-100/15 bg-ivory-100/5 text-ivory-100" : "border-line bg-white text-ink"}`}
        role="status"
        aria-live="polite"
      >
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gold-500 text-navy-950">
          <CheckIcon size={28} />
        </span>
        <h3 className="mt-5 font-display text-display-sm">Thank you, {values.name.split(" ")[0]}.</h3>
        <p className={`mt-3 ${dark ? "text-ivory-100/75" : "text-ink-muted"}`}>
          Your enquiry has been received. Our relationship manager will call you shortly.
        </p>
        <p className="mt-5 text-sm uppercase tracking-widest opacity-70">Reference number</p>
        <p className={`mt-1 font-display text-3xl ${dark ? "text-gold-300" : "text-gold-700"}`}>{status.reference}</p>
        {wa ? (
          <Button
            href={wa}
            variant={dark ? "outline-light" : "outline"}
            className="mt-8"
            external
            rel="noopener noreferrer"
            target="_blank"
          >
            <WhatsAppIcon size={18} /> Continue on WhatsApp
          </Button>
        ) : null}
      </div>
    );
  }

  const busy = status.kind === "submitting";

  return (
    <form onSubmit={onSubmit} noValidate className={`relative ${labelTone}`} aria-busy={busy}>
      {heading ? (
        <h3 className={`mb-6 font-display text-display-sm ${dark ? "text-ivory-100" : "text-navy-900"}`}>{heading}</h3>
      ) : null}
      <Honeypot value={values.website} onChange={(v) => set("website", v)} />
      <div className={`grid gap-5 ${compact ? "" : "sm:grid-cols-2"}`}>
        <Field label="Full name" htmlFor={field("name")} error={errors.name} required>
          <Input
            id={field("name")}
            name="name"
            autoComplete="name"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            invalid={!!errors.name}
            aria-describedby={errors.name ? `${field("name")}-error` : undefined}
            maxLength={80}
            required
          />
        </Field>
        <Field
          label="Mobile number"
          htmlFor={field("phone")}
          error={errors.phone}
          hint="10-digit Indian mobile"
          required
        >
          <Input
            id={field("phone")}
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
            invalid={!!errors.phone}
            aria-describedby={`${field("phone")}-${errors.phone ? "error" : "hint"}`}
            maxLength={14}
            required
          />
        </Field>
        <Field label="Email" htmlFor={field("email")} error={errors.email} hint="Optional">
          <Input
            id={field("email")}
            name="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
            invalid={!!errors.email}
            aria-describedby={`${field("email")}-${errors.email ? "error" : "hint"}`}
            maxLength={120}
          />
        </Field>
        <Field label="Project" htmlFor={field("project")} error={errors.project}>
          <Select
            id={field("project")}
            name="project_slug"
            value={values.project}
            onChange={(e) => set("project", e.target.value)}
          >
            <option value="">Any project</option>
            {projects.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Configuration" htmlFor={field("flat")}>
          <Select
            id={field("flat")}
            name="flat_type"
            value={values.flatType}
            onChange={(e) => set("flatType", e.target.value)}
          >
            <option value="">Not sure yet</option>
            {options.map((o) => (
              <option key={o.code ?? o.label} value={o.code ?? o.label}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Message"
          htmlFor={field("message")}
          error={errors.message}
          className={compact ? "" : "sm:col-span-2"}
        >
          <Textarea
            id={field("message")}
            name="message"
            value={values.message}
            onChange={(e) => set("message", e.target.value)}
            invalid={!!errors.message}
            maxLength={1000}
            rows={3}
            placeholder="Tell us what you are looking for"
          />
        </Field>
        <div className={compact ? "" : "sm:col-span-2"}>
          <Checkbox
            id={field("consent")}
            name="consent"
            checked={values.consent}
            onChange={(e) => set("consent", e.target.checked)}
            error={errors.consent}
            label={
              <span className={dark ? "text-ivory-100/75" : ""}>
                I agree to be contacted by {brandName} about my enquiry by call, SMS, email or WhatsApp.
              </span>
            }
          />
        </div>
      </div>
      {status.kind === "error" ? (
        <div className="mt-5">
          <FormStatus tone="error">{status.message}</FormStatus>
        </div>
      ) : null}
      <Button type="submit" size="lg" className="mt-6 w-full sm:w-auto" disabled={busy}>
        {busy ? "Sending…" : "Request a call back"}
      </Button>
    </form>
  );
}
