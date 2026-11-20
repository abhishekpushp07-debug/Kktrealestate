import { Fragment, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { inr, fmtDate } from "@/lib/format";
import { STATUS_TONE } from "@/lib/reportsV3";

export function fmtCell(c, v) {
  if (c.type === "money") return v < 0 ? `−${inr(-v / 100)}` : inr((v || 0) / 100);
  if (v == null || v === "") return "—";
  if (c.type === "date") return fmtDate(v);
  if (c.type === "pct") return `${v}%`;
  return String(v);
}

const right = (c) => ["money", "num", "pct"].includes(c.type);

// row status colours only the final-status column; other status columns colour by their own value map
const toneOf = (c, r) =>
  c.tones
    ? STATUS_TONE[c.tones[r[c.key]]]
    : ["final_status", "status_group"].includes(c.key)
      ? STATUS_TONE[r.status_kind]
      : undefined;

function Cell({ c, r, first }) {
  if (c.type === "status") {
    const [main, ...hint] = String(r[c.key] || "—").split(" · ");
    return (
      <td className="r3-status" style={{ color: toneOf(c, r) }}>
        <b>{main}</b>
        {hint.length > 0 && <small>{hint.join(" · ")}</small>}
      </td>
    );
  }
  return (
    <td className={`${right(c) ? "text-right" : ""} ${first ? "r3-stick" : ""}`}>
      {fmtCell(c, r[c.key])}
    </td>
  );
}

function Head({ cols, sort, dir, onSort }) {
  return (
    <thead>
      <tr>
        {cols.map((c, i) => (
          <th
            key={c.key}
            className={`${right(c) ? "text-right" : ""} ${i === 0 ? "r3-stick" : ""}`}
            style={c.type === "text" ? { minWidth: `${(c.width || 12) * 6}px` } : undefined}
          >
            <button
              type="button"
              onClick={() => onSort(c.key)}
              data-testid={`report-sort-${c.key}`}
            >
              {c.label}
              {sort === c.key &&
                (dir === "desc" ? (
                  <ArrowDown className="h-3 w-3" />
                ) : (
                  <ArrowUp className="h-3 w-3" />
                ))}
            </button>
          </th>
        ))}
      </tr>
    </thead>
  );
}

function TotalsRow({ cols, totals, label = "Total", testId }) {
  return (
    <tr className="r3-total" data-testid={testId}>
      {cols.map((c, i) => (
        <td key={c.key} className={`${right(c) ? "text-right" : ""} ${i === 0 ? "r3-stick" : ""}`}>
          {i === 0 ? label : c.key in totals ? fmtCell(c, totals[c.key]) : ""}
        </td>
      ))}
    </tr>
  );
}

/** REQ-266: virtualised rows (only the visible ones render), sticky header + first column, totals row. */
export function FlatTable({ cols, rows, totals, sort, dir, onSort, onRow }) {
  const ref = useRef(null);
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 41,
    overscan: 12,
  });
  const items = v.getVirtualItems();
  const top = items[0]?.start || 0;
  const bottom = v.getTotalSize() - (items[items.length - 1]?.end || 0);
  return (
    <div ref={ref} className="r3-scroll" data-testid="report-table">
      <table className="r3-table">
        <Head cols={cols} sort={sort} dir={dir} onSort={onSort} />
        <tbody>
          {top > 0 && <tr style={{ height: top }} />}
          {items.map((it) => {
            const r = rows[it.index];
            return (
              <tr
                key={r.booking_id || it.index}
                onClick={() => onRow(r)}
                className="r3-row"
                data-testid={`report-row-${it.index}`}
              >
                {cols.map((c, i) => (
                  <Cell key={c.key} c={c} r={r} first={i === 0} />
                ))}
              </tr>
            );
          })}
          {bottom > 0 && <tr style={{ height: bottom }} />}
        </tbody>
        <tfoot>
          <TotalsRow cols={cols} totals={totals} testId="report-totals" />
        </tfoot>
      </table>
    </div>
  );
}

function GroupRows({ g, cols, onRow, path, open, toggle }) {
  const id = `${path}/${g.label}`;
  const isOpen = open.has(id);
  return (
    <>
      <tr
        className="r3-group"
        onClick={() => toggle(id)}
        data-testid={`report-group-${id.replace(/[^a-z0-9]+/gi, "-")}`}
      >
        {cols.map((c, i) => (
          <td
            key={c.key}
            className={`${right(c) ? "text-right" : ""} ${i === 0 ? "r3-stick" : ""}`}
          >
            {i === 0 ? (
              <span className="flex items-center gap-1.5" style={{ paddingLeft: g.depth * 16 }}>
                <ChevronRight
                  className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
                {g.label} <em className="r3-count">{g.count}</em>
              </span>
            ) : c.key in g.totals ? (
              fmtCell(c, g.totals[c.key])
            ) : (
              ""
            )}
          </td>
        ))}
      </tr>
      {isOpen &&
        (g.children
          ? g.children.map((ch) => (
              <GroupRows
                key={ch.label}
                g={ch}
                cols={cols}
                onRow={onRow}
                path={id}
                open={open}
                toggle={toggle}
              />
            ))
          : g.rows.map((r, k) => (
              <tr key={r.booking_id || k} className="r3-row" onClick={() => onRow(r)}>
                {cols.map((c, i) => (
                  <Cell key={c.key} c={c} r={r} first={i === 0} />
                ))}
              </tr>
            )))}
    </>
  );
}

/** REQ-265: collapsible subtotals at every level + grand total. */
export function GroupTable({ cols, groups, totals, sort, dir, onSort, onRow }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  return (
    <div className="r3-scroll" data-testid="report-group-table">
      <table className="r3-table">
        <Head cols={cols} sort={sort} dir={dir} onSort={onSort} />
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.label}>
              <GroupRows g={g} cols={cols} onRow={onRow} path="" open={open} toggle={toggle} />
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <TotalsRow cols={cols} totals={totals} label="Grand total" testId="report-totals" />
        </tfoot>
      </table>
    </div>
  );
}

/** REQ-266 at 390 px: each row becomes a card — name, status, then the money lines. */
export function PhoneCards({ cols, rows, totals, onRow }) {
  const [head, ...rest] = cols;
  const status = rest.find((c) => c.type === "status");
  const lines = rest.filter((c) => c !== status);
  return (
    <div className="space-y-2" data-testid="report-cards">
      <div className="r3-card r3-total-card" data-testid="report-totals-card">
        <b>Total · {rows.length} shown</b>
        {lines
          .filter((c) => c.key in totals)
          .map((c) => (
            <p key={c.key}>
              <span>{c.label}</span>
              <span className="tabular">{fmtCell(c, totals[c.key])}</span>
            </p>
          ))}
      </div>
      {rows.map((r, i) => (
        <button
          type="button"
          key={r.booking_id || i}
          className="r3-card"
          onClick={() => onRow(r)}
          data-testid={`report-card-${i}`}
        >
          <div className="flex items-start justify-between gap-2">
            <b className="text-left">{fmtCell(head, r[head.key])}</b>
            {status && (
              <span className="shrink-0 text-xs font-semibold" style={{ color: toneOf(status, r) }}>
                {r[status.key]}
              </span>
            )}
          </div>
          {lines.map((c) => (
            <p key={c.key}>
              <span>{c.label}</span>
              <span className="tabular">{fmtCell(c, r[c.key])}</span>
            </p>
          ))}
        </button>
      ))}
    </div>
  );
}
