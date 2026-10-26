import { Eye, EyeOff, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useState } from "react";
import { KYC_STATUS_LABELS, type CustomerRevealed, type CustomerRow, type KycStatus } from "@kkt/contracts";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, FieldWrapper, KeyValueList, SimpleDialog, StatusChip, Textarea } from "@/components/ui";
import { api, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { kycMissingLabels } from "@/lib/errorMessages";
import { formatDateTime } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { Notice } from "@/features/inventory/components";
import { CUSTOMERS_PATH, crmKeys } from "../api";
import { formatAadhaar } from "../verhoeff";

const REVEAL_SECONDS = 60;

export interface KycPanelProps {
  customer: CustomerRow;
}

/** Masked KYC with an audited 60-second reveal (customer.kyc_view) and verify / reject actions. */
export function KycPanel({ customer }: KycPanelProps) {
  const { can, user } = useAuth();
  const canReveal = can("customer.kyc_view");
  const canWrite = can("customer.write") && !customer.erased_at;
  const isSubmitter = Boolean(user && customer.kyc_submitted_by && customer.kyc_submitted_by === user.id);
  const actions = kycActions({ status: customer.kyc_status, canWrite, canVerify: canReveal, canReopen: can("settings.manage"), isSubmitter });
  const [revealed, setRevealed] = useState<CustomerRevealed | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [target, setTarget] = useState<KycStatus | null>(null);

  useEffect(() => {
    if (!revealed) return;
    setSecondsLeft(REVEAL_SECONDS);
    const started = Date.now();
    const handle = window.setInterval(() => {
      const left = REVEAL_SECONDS - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) {
        setRevealed(null);
        setSecondsLeft(0);
        window.clearInterval(handle);
      } else {
        setSecondsLeft(left);
      }
    }, 500);
    return () => window.clearInterval(handle);
  }, [revealed]);

  // A newer version of the row hides any revealed values.
  useEffect(() => {
    setRevealed(null);
  }, [customer.version]);

  const reveal = async () => {
    setRevealing(true);
    setRevealError(null);
    try {
      const row = await api.get<CustomerRevealed>(`${CUSTOMERS_PATH}/${customer.id}`, { query: { reveal: true } });
      setRevealed(row);
    } catch (error) {
      setRevealError(describeError(error));
    } finally {
      setRevealing(false);
    }
  };

  const pan = revealed?.pan ?? customer.pan_masked;
  const aadhaar = revealed?.aadhaar ?? customer.aadhaar_masked;
  const account = revealed?.bank_account_number ?? customer.bank?.bank_account_masked ?? customer.bank_account_masked;

  return (
    <Card data-testid="kyc-panel">
      <CardHeader
        actions={
          <>
            {canReveal && !revealed && (
              <Button size="sm" variant="outline" leftIcon={Eye} loading={revealing} onClick={() => void reveal()} data-testid="kyc-reveal-btn">
                Reveal
              </Button>
            )}
            {revealed && (
              <Button size="sm" variant="ghost" leftIcon={EyeOff} onClick={() => setRevealed(null)}>
                Hide
              </Button>
            )}
            {actions.map((action) => (
              <Button key={action} size="sm" variant={action === "REJECTED" ? "danger-outline" : customer.kyc_status === "VERIFIED" ? "outline" : "primary"} leftIcon={action === "REJECTED" ? ShieldX : ShieldCheck} onClick={() => setTarget(action)} data-testid={`kyc-action-${action.toLowerCase()}`}>
                {customer.kyc_status === "VERIFIED" ? (action === "SUBMITTED" ? "Reopen" : "Reject") : action === "SUBMITTED" && customer.kyc_status === "REJECTED" ? "Resubmit" : ACTION_LABELS[action]}
              </Button>
            ))}
          </>
        }
      >
        <CardTitle className="flex items-center gap-2">
          KYC <StatusChip status={customer.kyc_status} label={KYC_STATUS_LABELS[customer.kyc_status]} size="sm" />
        </CardTitle>
        <p className="text-xs text-ink-subtle" data-testid="kyc-trail">
          {customer.kyc_submitted_by_name ? `Submitted by ${customer.kyc_submitted_by_name}${customer.kyc_submitted_at ? ` · ${formatDateTime(customer.kyc_submitted_at)}` : ""}` : "Not submitted yet"}
          {customer.kyc_verified_by_name && customer.kyc_status !== "SUBMITTED" ? ` · ${customer.kyc_status === "REJECTED" ? "rejected" : "verified"} by ${customer.kyc_verified_by_name} · ${formatDateTime(customer.kyc_verified_at)}` : ""}
          {customer.kyc_remarks ? ` · ${customer.kyc_remarks}` : ""}
        </p>
        {customer.kyc_status === "SUBMITTED" && isSubmitter && canWrite && (
          <p className="mt-1 text-xs text-warning-fg" data-testid="kyc-maker-checker">You submitted this file, so someone else with KYC access must verify or reject it.</p>
        )}
        {customer.kyc_status === "SUBMITTED" && !isSubmitter && canWrite && !canReveal && (
          <p className="mt-1 text-xs text-ink-subtle">Verifying needs the “View KYC” permission.</p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {revealed && (
          <Notice tone="warning">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5">
                <ShieldAlert className="size-4" aria-hidden="true" /> Unmasked values shown — this reveal was recorded in the audit log.
              </span>
              <span className="money font-semibold">Hides in {secondsLeft}s</span>
            </span>
          </Notice>
        )}
        {revealError && <Notice tone="danger">{revealError}</Notice>}
        <KeyValueList
          columns={2}
          items={[
            { label: "PAN", value: pan ? <span className="font-mono">{pan}</span> : null },
            { label: "Aadhaar", value: aadhaar ? <span className="money font-mono">{revealed?.aadhaar ? formatAadhaar(revealed.aadhaar) : aadhaar}</span> : null },
            { label: "Bank", value: customer.bank ? `${customer.bank.bank_name} · ${customer.bank.ifsc}` : null },
            { label: "Account", value: account ? <span className="money font-mono">{account}</span> : null, numeric: false },
            { label: "Account holder", value: customer.bank?.holder_name ?? null },
            { label: "Nominee", value: customer.nominee ? `${customer.nominee.name} (${customer.nominee.relation})` : null },
          ]}
        />
        {!canReveal && (
          <p className="flex items-center gap-1.5 text-2xs text-ink-subtle">
            <EyeOff className="size-3" aria-hidden="true" /> Values are masked for your role.
          </p>
        )}
        {revealed && revealed.co_applicants_revealed.length > 0 && (
          <div>
            <p className="label-caps mb-1">Co-applicants (revealed)</p>
            <ul className="space-y-1 text-sm">
              {revealed.co_applicants_revealed.map((person) => (
                <li key={person.id} className="flex flex-wrap items-center gap-x-3">
                  <span className="font-medium">{person.full_name}</span>
                  {person.pan && <span className="font-mono text-xs">{person.pan}</span>}
                  {person.aadhaar && <span className="money font-mono text-xs">{formatAadhaar(person.aadhaar)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      <KycStatusDialog customer={customer} target={target} onOpenChange={(open) => !open && setTarget(null)} />
    </Card>
  );
}

/** KYC workflow (maker-checker, SPEC §8): which moves this user may offer from the current status. */
export function kycActions(input: { status: KycStatus; canWrite: boolean; canVerify: boolean; canReopen: boolean; isSubmitter: boolean }): KycStatus[] {
  const { status, canWrite, canVerify, canReopen, isSubmitter } = input;
  if (!canWrite) return [];
  if (status === "PENDING" || status === "REJECTED") return ["SUBMITTED"];
  if (status === "SUBMITTED") return canVerify && !isSubmitter ? ["VERIFIED", "REJECTED"] : [];
  if (status === "VERIFIED") return canReopen ? ["SUBMITTED", "REJECTED"] : [];
  return [];
}

const ACTION_LABELS: Readonly<Record<KycStatus, string>> = { PENDING: "Pending", SUBMITTED: "Submit for verification", VERIFIED: "Verify", REJECTED: "Reject" };

function KycStatusDialog({ customer, target, onOpenChange }: { customer: CustomerRow; target: KycStatus | null; onOpenChange: (open: boolean) => void }) {
  const open = target !== null;
  const status: KycStatus = target ?? "SUBMITTED";
  const reopening = customer.kyc_status === "VERIFIED";
  const [remarks, setRemarks] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<{ message: string; missing: string[] } | null>(null);
  useEffect(() => {
    if (open) {
      setRemarks(status === "REJECTED" ? "" : (customer.kyc_remarks ?? ""));
      setReason("");
      setProblem(null);
    }
  }, [open, status, customer.kyc_remarks]);
  const update = useMutationWithToast<CustomerRow, void>({
    mutationFn: () =>
      api.post<CustomerRow>(
        `${CUSTOMERS_PATH}/${customer.id}/kyc`,
        { version: customer.version, kyc_status: status, kyc_remarks: remarks.trim() || null, ...(reopening ? { reason: reason.trim() } : {}) },
        { version: customer.version },
      ),
    successMessage: () => (status === "SUBMITTED" ? "KYC submitted for verification" : `KYC marked ${KYC_STATUS_LABELS[status].toLowerCase()}`),
    invalidate: [[CUSTOMERS_PATH], crmKeys.customer360(customer.id)],
    entityLabel: "This customer",
    errorMessage: false,
    onSuccess: () => onOpenChange(false),
    onError: (error) => {
      if (error.isVersionConflict) return;
      const missing = error.code === "KYC_INCOMPLETE" ? kycMissingLabels(error.details) : [];
      setProblem({ message: missing.length ? "KYC can't be submitted yet. Add these first:" : describeError(error), missing });
    },
  });
  const needsRemarks = status === "REJECTED" && remarks.trim().length < 3;
  const needsReason = reopening && reason.trim().length < 3;
  const title = reopening ? "Change a verified KYC" : status === "SUBMITTED" ? "Submit KYC for verification" : status === "VERIFIED" ? "Verify KYC" : "Reject KYC";
  const description = reopening
    ? "Only an administrator may change a verified KYC. The reason is recorded in the audit log."
    : status === "SUBMITTED"
      ? "Submission needs PAN, Aadhaar and a KYC document (PAN / Aadhaar copy) on file. Someone else with KYC access then verifies it."
      : `You are the checker: ${customer.kyc_submitted_by_name ?? "a colleague"} submitted this file. Your name and the time are recorded.`;
  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => !update.isPending && onOpenChange(next)}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button variant={status === "REJECTED" ? "danger" : "primary"} loading={update.isPending} disabled={needsRemarks || needsReason} onClick={() => update.mutate()} data-testid="kyc-status-submit">
            {reopening ? `Move to ${KYC_STATUS_LABELS[status]}` : ACTION_LABELS[status]}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {problem && (
          <Notice tone="danger" data-testid="kyc-status-problem">
            <p>{problem.message}</p>
            {problem.missing.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs">
                {problem.missing.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </Notice>
        )}
        <FieldWrapper label="Remarks" required={status === "REJECTED"} hint={status === "REJECTED" ? "What the relationship manager must fix (at least 3 characters)" : undefined}>
          {(control) => <Textarea id={control.id} value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={3} maxLength={1000} data-testid="kyc-remarks" />}
        </FieldWrapper>
        {reopening && (
          <FieldWrapper label="Reason for changing a verified KYC" required hint="At least 3 characters; recorded in the audit log">
            {(control) => <Textarea id={control.id} value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} data-testid="kyc-reason" />}
          </FieldWrapper>
        )}
        {reopening && <Badge variant="warning">This removes the current verification.</Badge>}
      </div>
    </SimpleDialog>
  );
}
