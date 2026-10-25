import { Eye, EyeOff, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { KYC_STATUSES, KYC_STATUS_LABELS, type CustomerRevealed, type CustomerRow, type KycStatus } from "@kkt/contracts";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, FieldWrapper, KeyValueList, Select, SimpleDialog, StatusChip, Textarea } from "@/components/ui";
import { api, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
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
  const { can } = useAuth();
  const canReveal = can("customer.kyc_view");
  const canWrite = can("customer.write");
  const [revealed, setRevealed] = useState<CustomerRevealed | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);

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
            {canWrite && (
              <Button size="sm" leftIcon={ShieldCheck} onClick={() => setStatusOpen(true)} data-testid="kyc-status-btn">
                Verify / reject
              </Button>
            )}
          </>
        }
      >
        <CardTitle className="flex items-center gap-2">
          KYC <StatusChip status={customer.kyc_status} label={KYC_STATUS_LABELS[customer.kyc_status]} size="sm" />
        </CardTitle>
        <p className="text-xs text-ink-subtle">
          {customer.kyc_verified_by_name ? `${customer.kyc_status === "REJECTED" ? "Rejected" : "Verified"} by ${customer.kyc_verified_by_name} · ${formatDateTime(customer.kyc_verified_at)}` : "Not yet verified"}
          {customer.kyc_remarks ? ` · ${customer.kyc_remarks}` : ""}
        </p>
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
      <KycStatusDialog customer={customer} open={statusOpen} onOpenChange={setStatusOpen} />
    </Card>
  );
}

function KycStatusDialog({ customer, open, onOpenChange }: { customer: CustomerRow; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [status, setStatus] = useState<KycStatus>(customer.kyc_status === "VERIFIED" ? "VERIFIED" : "VERIFIED");
  const [remarks, setRemarks] = useState("");
  useEffect(() => {
    if (open) {
      setStatus(customer.kyc_status === "REJECTED" ? "SUBMITTED" : "VERIFIED");
      setRemarks(customer.kyc_remarks ?? "");
    }
  }, [open, customer.kyc_status, customer.kyc_remarks]);
  const update = useMutationWithToast<CustomerRow, void>({
    mutationFn: () => api.post<CustomerRow>(`${CUSTOMERS_PATH}/${customer.id}/kyc`, { version: customer.version, kyc_status: status, kyc_remarks: remarks.trim() || null }, { version: customer.version }),
    successMessage: () => `KYC marked ${KYC_STATUS_LABELS[status].toLowerCase()}`,
    invalidate: [[CUSTOMERS_PATH], crmKeys.customer360(customer.id)],
    entityLabel: "This customer",
    onSuccess: () => onOpenChange(false),
  });
  const needsRemarks = status === "REJECTED" && remarks.trim().length < 3;
  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => !update.isPending && onOpenChange(next)}
      title="Update KYC status"
      description="The verifier and time are recorded. Rejections need remarks the customer's RM can act on."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button loading={update.isPending} disabled={needsRemarks} onClick={() => update.mutate()} data-testid="kyc-status-submit">
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FieldWrapper label="Status" required>
          {(control) => <Select id={control.id} value={status} onValueChange={(value) => value && setStatus(value)} options={KYC_STATUSES.map((value) => ({ value, label: KYC_STATUS_LABELS[value] }))} />}
        </FieldWrapper>
        <FieldWrapper label="Remarks" required={status === "REJECTED"} hint={status === "REJECTED" ? "At least 3 characters" : undefined}>
          {(control) => <Textarea id={control.id} value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={3} maxLength={1000} />}
        </FieldWrapper>
        {customer.kyc_status === "VERIFIED" && status !== "VERIFIED" && <Badge variant="warning">This removes the current verification.</Badge>}
      </div>
    </SimpleDialog>
  );
}
