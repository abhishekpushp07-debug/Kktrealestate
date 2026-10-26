import { useQuery } from "@tanstack/react-query";
import { PERMISSION_GROUPS, type PermissionGroupResponse } from "@kkt/contracts";
import { Checkbox } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { normalisePermissionCatalog } from "./adminApi";

/** A permission group as served by the API or shipped in the contracts. */
export interface PermissionGroupLike {
  key: string;
  label: string;
  permissions: ReadonlyArray<{ code: string; label: string }>;
}

/** `GET /permissions` with the contracts' PERMISSION_GROUPS as the offline fallback. */
export function usePermissionCatalog(enabled = true): { groups: readonly PermissionGroupLike[]; loading: boolean } {
  const query = useQuery<unknown, Error, PermissionGroupResponse[] | null>({
    queryKey: ["/permissions"],
    queryFn: ({ signal }) => api.get<unknown>("/permissions", { signal }),
    select: normalisePermissionCatalog,
    staleTime: 10 * 60_000,
    retry: false,
    enabled,
  });
  return { groups: query.data ?? PERMISSION_GROUPS, loading: query.isPending && enabled };
}

export interface PermissionMatrixProps {
  groups: readonly PermissionGroupLike[];
  value: readonly string[];
  onChange?: (codes: string[]) => void;
  readOnly?: boolean;
  invalid?: boolean;
  id?: string;
}

/** Grouped permission checkboxes with per-group select-all and counts. */
export function PermissionMatrix({
  groups,
  value,
  onChange,
  readOnly = false,
  invalid = false,
  id,
}: PermissionMatrixProps) {
  const selected = new Set(value);
  const total = groups.reduce((sum, group) => sum + group.permissions.length, 0);

  const set = (codes: readonly string[], checked: boolean) => {
    if (!onChange || readOnly) return;
    const next = new Set(selected);
    for (const code of codes) {
      if (checked) next.add(code);
      else next.delete(code);
    }
    onChange([...next]);
  };

  return (
    <div
      id={id}
      className={cn("overflow-hidden rounded-md border", invalid ? "border-danger" : "border-border")}
      role="group"
      aria-label="Permissions"
      data-testid="permission-matrix"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2 text-xs">
        <span className="label-caps">Permissions</span>
        <span className="money font-semibold text-navy-950">
          {selected.size} / {total}
        </span>
      </div>
      <div className="divide-y divide-border">
        {groups.map((group) => {
          const codes = group.permissions.map((permission) => permission.code);
          const count = codes.filter((code) => selected.has(code)).length;
          const all = count === codes.length && codes.length > 0;
          const some = count > 0 && !all;
          return (
            <section key={group.key} className="px-3 py-2" data-testid={`permission-group-${group.key}`}>
              <header className="flex items-center justify-between gap-2">
                <Checkbox
                  checked={all ? true : some ? "indeterminate" : false}
                  onCheckedChange={(checked) => set(codes, checked === true)}
                  disabled={readOnly}
                  label={<span className="font-display text-sm font-bold text-navy-950">{group.label}</span>}
                  data-testid={`permission-group-${group.key}-all`}
                />
                <span className={cn("money text-xs", count > 0 ? "font-semibold text-navy-950" : "text-ink-subtle")}>
                  {count}/{codes.length}
                </span>
              </header>
              <ul className="mt-1.5 grid gap-1 pl-6 sm:grid-cols-2">
                {group.permissions.map((permission) => (
                  <li key={permission.code} className="min-w-0">
                    <Checkbox
                      checked={selected.has(permission.code)}
                      onCheckedChange={(checked) => set([permission.code], checked === true)}
                      disabled={readOnly}
                      label={<span className="text-sm font-normal">{permission.label}</span>}
                      description={<code className="font-mono text-[10px]">{permission.code}</code>}
                      data-testid={`permission-${permission.code}`}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
