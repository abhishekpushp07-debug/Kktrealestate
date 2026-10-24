import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { PROJECT_STATUS_LABELS } from "@/lib/format";
import type { ProjectListFilters } from "@/lib/types";

interface ProjectFiltersProps {
  filters: ProjectListFilters;
  cities: string[];
  bhks: number[];
}

/** Plain GET form: works without JavaScript and keeps filters shareable in the URL. */
export function ProjectFilters({ filters, cities, bhks }: ProjectFiltersProps) {
  const hasFilters = Boolean(filters.city || filters.status || filters.bhk || filters.q);
  return (
    <form method="get" action="/projects" className="grid gap-3 rounded-card border border-line bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto] lg:items-end" aria-label="Filter projects">
      <div>
        <label htmlFor="filter-q" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
          Search
        </label>
        <Input id="filter-q" name="q" type="search" placeholder="Project or locality" defaultValue={filters.q ?? ""} maxLength={80} />
      </div>
      <div>
        <label htmlFor="filter-city" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
          City
        </label>
        <Select id="filter-city" name="city" defaultValue={filters.city ?? ""}>
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="filter-status" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
          Status
        </label>
        <Select id="filter-status" name="status" defaultValue={filters.status ?? ""}>
          <option value="">Any status</option>
          {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="filter-bhk" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
          Configuration
        </label>
        <Select id="filter-bhk" name="bhk" defaultValue={filters.bhk ?? ""}>
          <option value="">Any BHK</option>
          {bhks.map((b) => (
            <option key={b} value={String(b)}>
              {b} BHK
            </option>
          ))}
        </Select>
      </div>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
        <Button type="submit" variant="secondary" className="flex-1 lg:flex-none">
          Apply
        </Button>
        {hasFilters ? (
          <Button href="/projects" variant="ghost">
            Clear
          </Button>
        ) : null}
      </div>
    </form>
  );
}
