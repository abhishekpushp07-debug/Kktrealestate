import { useWindowDimensions, View } from "react-native";

import { fmtDate, inr } from "@/src/format";
import { makeStyles } from "@/src/theme";
import { Card, Chip } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";

export type LedgerRow = {
  seq: number;
  date: string;
  description: string;
  bucket?: string | null;
  amount: number;
  type: string;
  ref?: string | null;
  cash_paid_cum: number;
  account_paid_cum: number;
  cash_due: number;
  account_due: number;
  total_due: number;
  other_charges_due?: number;
};

// `bucket` comes from the API ("Cash" | "Account" | "Other charges" | null).
// DEMAND rows raise both buckets: label them "Demand" and show the cash/account
// split (row fields if the API sends them, else the change in cash_due/account_due).
function withBuckets(rows: LedgerRow[]) {
  return rows.map((r, i) => {
    const prev = rows[i - 1];
    let split: { cash: number; account: number } | null = null;
    if (r.type === "DEMAND") {
      const x = r as any;
      const cash = x.cash_amount ?? x.cash_demand;
      const account = x.account_amount ?? x.account_demand;
      if (cash != null || account != null) split = { cash: cash || 0, account: account || 0 };
      else {
        const dc = r.cash_due - (prev?.cash_due ?? 0);
        const da = r.account_due - (prev?.account_due ?? 0);
        if (Math.abs(dc + da - r.amount) < 1) split = { cash: dc, account: da };
      }
    }
    const label = r.type === "DEMAND" ? "Demand" : r.bucket || null;
    return { ...r, label, split, credit: r.type.includes("PAYMENT") };
  });
}

function BucketCell({ label, split, align }: { label: string | null; split: { cash: number; account: number } | null; align?: "flex-start" | "flex-end" }) {
  if (!label) return <T tone="muted">—</T>;
  return (
    <View style={{ gap: 4, alignItems: align || "flex-start" }}>
      <Chip label={label} tone={label === "Demand" ? "neutral" : label === "Cash" ? "gold" : label === "Account" ? "info" : "neutral"} />
      {split ? (
        <T v="small" tone="muted">
          Cash {inr(split.cash)} · Account {inr(split.account)}
        </T>
      ) : null}
    </View>
  );
}

function DueCell({ v, charges }: { v: number; charges?: number }) {
  return (
    <>
      {v < 0 ? (
        <T v="small" tone="success" style={{ textAlign: "right" }}>
          {inr(-v)} (advance)
        </T>
      ) : (
        <T v="small" tone={v > 0 ? "error" : "muted"} style={{ textAlign: "right" }}>
          {inr(v)} due
        </T>
      )}
      {charges && charges > 0 ? (
        <T v="small" tone="muted" style={{ textAlign: "right" }}>
          + charges {inr(charges)} due
        </T>
      ) : null}
    </>
  );
}

export function Ledger({ items }: { items: LedgerRow[] }) {
  const s = useStyles();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const rows = withBuckets(items);
  return (
    <Card testID="ledger-table" style={{ paddingVertical: 4, paddingHorizontal: wide ? 18 : 14 }}>
      {wide ? (
        <View style={[s.row, s.head]}>
          <T v="label" tone="muted" style={s.cDate}>Date</T>
          <T v="label" tone="muted" style={s.cDesc}>Description</T>
          <T v="label" tone="muted" style={s.cBucket}>Bucket</T>
          <T v="label" tone="muted" style={s.cNum}>Amount</T>
          <T v="label" tone="muted" style={s.cNum}>Paid to date</T>
          <T v="label" tone="muted" style={[s.cDue, { textAlign: "right" }]}>Due / advance</T>
        </View>
      ) : null}
      {rows.map((e, i) => {
        const paid = e.cash_paid_cum + e.account_paid_cum;
        const last = i === rows.length - 1;
        const amt = (
          <T v="money" tone={e.credit ? "success" : undefined} style={{ textAlign: "right" }}>
            {e.credit ? "− " : ""}
            {inr(Math.abs(e.amount))}
          </T>
        );
        return wide ? (
          <View key={e.seq} style={[s.row, last && s.noBorder]} testID={`ledger-row-${e.seq}`}>
            <T v="small" tone="muted" style={s.cDate}>{fmtDate(e.date)}</T>
            <View style={s.cDesc}>
              <T v="bodyStrong">{e.description}</T>
              {e.ref ? <T v="small" tone="muted">{e.ref}</T> : null}
            </View>
            <View style={s.cBucket}><BucketCell label={e.label} split={e.split} /></View>
            <View style={s.cNum}>{amt}</View>
            <T v="small" style={[s.cNum, { textAlign: "right" }]}>{inr(paid)}</T>
            <View style={s.cDue}>
              <DueCell v={e.total_due} charges={e.other_charges_due} />
            </View>
          </View>
        ) : (
          <View key={e.seq} style={[s.mRow, last && s.noBorder]} testID={`ledger-row-${e.seq}`}>
            <View style={s.mTop}>
              <View style={{ flex: 1 }}>
                <T v="bodyStrong">{e.description}</T>
                <T v="small" tone="muted">
                  {fmtDate(e.date)}
                  {e.ref ? ` · ${e.ref}` : ""}
                </T>
                {e.split ? (
                  <T v="small" tone="muted" testID={`ledger-split-${e.seq}`}>
                    Cash {inr(e.split.cash)} · Account {inr(e.split.account)}
                  </T>
                ) : null}
              </View>
              {amt}
            </View>
            <View style={s.mBottom}>
              {e.label ? <BucketCell label={e.label} split={null} /> : <View />}
              <View style={{ alignItems: "flex-end" }}>
                <T v="small" tone="muted">Paid to date {inr(paid)}</T>
                <DueCell v={e.total_due} charges={e.other_charges_due} />
              </View>
            </View>
          </View>
        );
      })}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.divider },
  head: { paddingVertical: 10 },
  noBorder: { borderBottomWidth: 0 },
  cDate: { width: 96 },
  cDesc: { flex: 1 },
  cBucket: { width: 170 },
  cNum: { width: 120, alignItems: "flex-end" },
  cDue: { width: 200, alignItems: "flex-end" },
  mRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.divider, gap: 8 },
  mTop: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  mBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
}));
