import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Input, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useReportCatalog } from "./api";
import { REPORT_GROUP_ICON, REPORT_GROUP_LABELS, REPORT_GROUP_ORDER, REPORTS, reportsFor, SPECIAL_REPORTS, type ReportGroup } from "./reports";

interface CatalogCard {
  key: string;
  slug: string;
  label: string;
  description: string;
  group: ReportGroup;
  icon: typeof REPORTS[number]["icon"];
  formats: readonly string[];
}

/** `/reports` — catalogue cards grouped Money / Sales / Inventory / Operations. */
export default function ReportsPage() {
  const catalog = useReportCatalog();
  const { can } = useAuth();
  const [query, setQuery] = useState("");

  const serverKeys = useMemo(() => new Set<string>((catalog.data?.reports ?? []).map((entry) => entry.key)), [catalog.data]);
  const cards = useMemo<CatalogCard[]>(() => {
    const generic = reportsFor(can).map<CatalogCard>((report) => ({ key: report.key, slug: report.slug, label: report.label, description: report.description, group: report.group, icon: report.icon, formats: report.formats }));
    const special = SPECIAL_REPORTS.map<CatalogCard>((report) => ({ key: report.key, slug: report.slug, label: report.label, description: report.description, group: report.group, icon: report.icon, formats: ["pdf"] }));
    const all = [...generic, ...special];
    const needle = query.trim().toLowerCase();
    return needle ? all.filter((card) => `${card.label} ${card.description}`.toLowerCase().includes(needle)) : all;
  }, [query, can]);

  return (
    <>
      <PageHeader title="Reports" description="Every report takes strict filters, shows totals, exports to CSV and branded PDF, and remembers your presets." breadcrumbs={[{ label: "Home", to: "/" }, { label: "Reports" }]}>
        <div className="relative w-full sm:w-80">
          <Input type="search" role="searchbox" aria-label="Search reports" placeholder="Search reports…" leftIcon={Search} value={query} onChange={(event) => setQuery(event.target.value)} data-testid="reports-search" />
        </div>
      </PageHeader>

      {REPORT_GROUP_ORDER.map((group) => {
        const items = cards.filter((card) => card.group === group);
        if (items.length === 0) return null;
        const GroupIcon = REPORT_GROUP_ICON[group];
        return (
          <section key={group} className="mb-6" aria-labelledby={`reports-${group}`}>
            <h2 id={`reports-${group}`} className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-navy-950">
              <GroupIcon className="size-4 text-gold-text" aria-hidden="true" /> {REPORT_GROUP_LABELS[group]}
              <span className="money text-xs font-normal text-ink-subtle">{items.length}</span>
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((card) => {
                const offered = catalog.data ? serverKeys.has(card.key) || card.key === "ALLOTMENT_LETTER" || card.key === "CUSTOMER_STATEMENT" : true;
                return (
                  <li key={card.key}>
                    <Link
                      to={`/reports/${card.slug}`}
                      className={cn("group flex h-full min-w-0 items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-card transition-colors hover:border-navy-300 focus-ring", !offered && "opacity-75")}
                      data-testid={`report-card-${card.slug}`}
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-navy-50 text-navy-700 group-hover:bg-gold-light group-hover:text-gold-text">
                        <card.icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1 text-sm font-semibold text-navy-950">
                          <span className="truncate">{card.label}</span>
                          <ChevronRight className="size-3.5 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-ink-muted">{card.description}</span>
                        <span className="mt-2 flex flex-wrap gap-1">
                          {card.formats.map((format) => (
                            <Badge key={format} variant="outline" className="uppercase">
                              {format}
                            </Badge>
                          ))}
                          {!offered && <Badge variant="warning">Not on this server</Badge>}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {cards.length === 0 && <p className="text-sm text-ink-subtle">No report matches “{query}”.</p>}
    </>
  );
}
