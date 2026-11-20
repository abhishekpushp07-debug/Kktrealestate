import { Link } from "react-router-dom";
import { Card } from "@/components/v2";
import { fmtDate } from "@/lib/format";

const REPORTS = [
  ["Project Statement", "/reports/project-statement", "reports.project_statement.view"],
  ["Bills raised", "/demands", null],
  ["Outstanding", "/reports/outstanding", null],
  ["Collections", "/reports/collections", null],
  ["Inventory", "/reports/inventory", null],
];

export function ProjectReportLinks({ id, can }) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="project-reports">
      {REPORTS.filter(([, , perm]) => !perm || can(perm)).map(([l, to]) => (
        <Link key={l} to={`${to}?project_id=${id}`} className="btn btn-secondary btn-sm">
          {l}
        </Link>
      ))}
      <Link to="/website/settings" className="btn btn-ghost btn-sm">
        Website
      </Link>
      {can("sales.lead.create") && (
        <Link
          to={`/leads?new=1&project_id=${id}`}
          className="btn btn-ghost btn-sm"
          data-testid="project-new-lead"
        >
          New lead
        </Link>
      )}
    </div>
  );
}

/** REQ-123: construction progress per tower, with the construction update screen one click away. */
export function ConstructionTab({ towers, pid, can }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2" data-testid="project-construction">
      {towers.map((t) => {
        const c = t.construction;
        const last = [...c.stages].reverse().find((x) => x.status === "Completed");
        return (
          <Card key={t.id} testId={`construction-tower-${t.code}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="e-caps-blue">{t.name}</h3>
                <p className="text-xs text-txt-secondary">
                  {c.completed} of {c.total} stages done
                  {last
                    ? ` · last ${last.name} on ${fmtDate(last.completed_on || last.completed_at)}`
                    : ""}
                </p>
              </div>
              <span className="font-display text-2xl text-ink-950">{c.percent}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-warm-100">
              <div className="h-full rounded-full bg-gold" style={{ width: `${c.percent}%` }} />
            </div>
            <p className="mt-3 text-sm text-txt-secondary">
              {c.next ? (
                <>
                  Next stage <b className="text-ink-950">{c.next}</b>
                </>
              ) : (
                "All stages complete"
              )}
            </p>
            {can("construction.stage.update") && (
              <Link
                to={`/construction?project=${pid}&tower=${t.id}`}
                className="btn btn-secondary btn-sm mt-4"
                data-testid={`construction-open-${t.code}`}
              >
                Open construction update
              </Link>
            )}
          </Card>
        );
      })}
    </div>
  );
}
