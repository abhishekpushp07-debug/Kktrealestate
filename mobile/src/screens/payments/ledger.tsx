import { useState } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";

import { fmtDate, inr } from "@/src/format";
import { BREAKPOINT, makeStyles } from "@/src/theme";
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

type Split = { cash: number; account: number } | null;
type Row = LedgerRow & { label: string | null; split: Split; credit: boolean };

// `bucket` comes from the API ("Cash" | "Account" | "Other charges" | null).
// DEMAND rows raise both buckets: label them "Demand" and show the cash/account
// split (row fields if the API sends them, else the change in cash_due/account_due).
function withBuckets(rows: LedgerRow[]): Row[] {
  return rows.map((r, i) => {
    const prev = rows[i - 1];
    let split: Split = null;
    if (r.type === "DEMAND") {
      const x = r as any;
      const cash = x.cash_amount ?? x.cash_demand;
      const account = x.account_amount ?? x.account_demand;
      if (cash != null || account != null)
        split = { cash: cash || 0, account: account || 0 };
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

const tone = (l: string) =>
  l === "Cash" ? "gold" : l === "Account" ? "info" : "neutral";

function Chips({ e }: { e: Row }) {
  const s = useStyles();
  if (!e.label) return null;
  return (
    <View style={s.chips}>
      {e.split ? (
        <>
          <Chip label={`Cash ${inr(e.split.cash)}`} tone="gold" />
          <Chip label={`Account ${inr(e.split.account)}`} tone="info" />
        </>
      ) : (
        <Chip label={e.label} tone={tone(e.label)} />
      )}
    </View>
  );
}

function Due({ e, align = "right" }: { e: Row; align?: "left" | "right" }) {
  const v = e.total_due;
  return (
    <View style={{ alignItems: align === "right" ? "flex-end" : "flex-start" }}>
      <T
        v="small"
        tone={v < 0 ? "success" : v > 0 ? "error" : "secondary"}
        style={{ fontFamily: "Manrope_700Bold", textAlign: align }}
      >
        {v < 0 ? `${inr(-v)} advance` : `${inr(v)} due`}
      </T>
      {e.other_charges_due && e.other_charges_due > 0 ? (
        <T v="small" tone="secondary" style={{ textAlign: align }}>
          + charges {inr(e.other_charges_due)}
        </T>
      ) : null}
    </View>
  );
}

function Amount({ e }: { e: Row }) {
  return (
    <T
      v="money"
      tone={e.credit ? "success" : undefined}
      style={{ textAlign: "right" }}
    >
      {e.credit ? "− " : ""}
      {inr(Math.abs(e.amount))}
    </T>
  );
}

function CardRow({ e, last }: { e: Row; last: boolean }) {
  const s = useStyles();
  return (
    <View style={[s.mRow, last && s.noBorder]} testID={`ledger-row-${e.seq}`}>
      <View style={s.mTop}>
        <View style={{ flex: 1, gap: 2 }}>
          <T v="small" tone="secondary">
            {fmtDate(e.date)}
            {e.ref ? ` · ${e.ref}` : ""}
          </T>
          <T v="bodyStrong">{e.description}</T>
        </View>
        <Amount e={e} />
      </View>
      <Chips e={e} />
      <View style={s.mBottom}>
        <T v="small" tone="secondary">
          Paid to date {inr(e.cash_paid_cum + e.account_paid_cum)}
        </T>
        <Due e={e} />
      </View>
    </View>
  );
}

const COLS = {
  date: 108,
  desc: 200,
  bucket: 210,
  amt: 122,
  paid: 118,
  due: 164,
};
const TABLE_MIN = Object.values(COLS).reduce((a, b) => a + b, 0) + 5 * 14;

function Table({ rows }: { rows: Row[] }) {
  const s = useStyles();
  const [w, setW] = useState(0);
  const scrolls = w > 0 && w < TABLE_MIN;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {scrolls ? (
        <T
          v="small"
          tone="secondary"
          style={{ textAlign: "right", paddingTop: 8 }}
          testID="ledger-scroll-hint"
        >
          Scroll sideways for all columns →
        </T>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        contentContainerStyle={{ minWidth: "100%" }}
        testID="ledger-table-scroll"
      >
        {/* Explicit width: fills the card when it fits, else scrolls at TABLE_MIN. */}
        <View style={{ width: Math.max(w, TABLE_MIN) }}>
          <View style={[s.row, s.head]}>
            <T v="label" tone="secondary" style={{ width: COLS.date }}>
              Date
            </T>
            <T
              v="label"
              tone="secondary"
              style={{ flex: 1, minWidth: COLS.desc }}
            >
              Description
            </T>
            <T v="label" tone="secondary" style={{ width: COLS.bucket }}>
              Bucket
            </T>
            <T
              v="label"
              tone="secondary"
              style={{ width: COLS.amt, textAlign: "right" }}
            >
              Amount
            </T>
            <T
              v="label"
              tone="secondary"
              style={{ width: COLS.paid, textAlign: "right" }}
            >
              Paid to date
            </T>
            <T
              v="label"
              tone="secondary"
              style={{ width: COLS.due, textAlign: "right" }}
            >
              Due / advance
            </T>
          </View>
          {rows.map((e, i) => (
            <View
              key={e.seq}
              style={[s.row, i === rows.length - 1 && s.noBorder]}
              testID={`ledger-row-${e.seq}`}
            >
              <T v="small" tone="secondary" style={{ width: COLS.date }}>
                {fmtDate(e.date)}
              </T>
              <View style={{ flex: 1, minWidth: COLS.desc }}>
                <T v="bodyStrong">{e.description}</T>
                {e.ref ? (
                  <T v="small" tone="secondary">
                    {e.ref}
                  </T>
                ) : null}
              </View>
              <View style={{ width: COLS.bucket }}>
                {e.label ? <Chips e={e} /> : <T tone="muted">—</T>}
              </View>
              <View style={{ width: COLS.amt }}>
                <Amount e={e} />
              </View>
              <T
                v="small"
                style={{
                  width: COLS.paid,
                  textAlign: "right",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {inr(e.cash_paid_cum + e.account_paid_cum)}
              </T>
              <View style={{ width: COLS.due }}>
                <Due e={e} />
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

export function Ledger({ items }: { items: LedgerRow[] }) {
  const { width } = useWindowDimensions();
  const rows = withBuckets(items);
  const table = width >= BREAKPOINT.table;
  return (
    <Card
      testID="ledger-table"
      style={{ paddingVertical: 6, paddingHorizontal: table ? 20 : 16 }}
    >
      {table ? (
        <Table rows={rows} />
      ) : (
        rows.map((e, i) => (
          <CardRow key={e.seq} e={e} last={i === rows.length - 1} />
        ))
      )}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  head: { paddingVertical: 12 },
  noBorder: { borderBottomWidth: 0 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  mRow: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
    gap: 10,
  },
  mTop: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  mBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: c.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
}));
