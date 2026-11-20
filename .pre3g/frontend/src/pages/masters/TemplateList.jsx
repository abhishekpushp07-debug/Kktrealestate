import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { RowMenu } from "@/components/common/RowMenu";
import { toast } from "sonner";
import { errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import { MasterEditNote } from "@/components/common/MasterEditNote";

/** Shared list + inline form shell for the four S1 template masters. */
export function TemplateList({
  title,
  subtitle,
  items,
  testId,
  perm,
  onDelete,
  onRestore,
  reload,
  Form,
  render,
  formProps = {},
}) {
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState("");
  const setActive = async (t, on) => {
    if (
      !on &&
      !window.confirm(`Make "${t.name}" inactive? Towers already built from it are not changed.`)
    )
      return;
    try {
      await (on ? onRestore(t) : onDelete(t));
      toast.success(on ? "Active again" : "Made inactive");
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const shown = (items || []).filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-4" data-testid={`${testId}-page`}>
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="font-display text-xl text-ink-950">{title}</h1>
          <p className="text-xs text-txt-secondary">{subtitle}</p>
        </div>
        <Input
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="ml-auto h-9 w-56"
          data-testid={`${testId}-search`}
        />
        {perm.create && (
          <Button
            className="bg-ink-950 hover:bg-ink-800"
            onClick={() => setEditing({})}
            data-testid={`${testId}-new-btn`}
          >
            <Plus className="mr-1 h-4 w-4" />
            New
          </Button>
        )}
      </div>
      {editing && (
        <MasterEditNote item={editing} keeps="Towers already built from it keep their own copy." />
      )}
      {editing && (
        <Form
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
          {...formProps}
        />
      )}
      {items === null ? (
        <div className="card h-40 animate-pulse" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2" data-testid={`${testId}-list`}>
          {shown.map((t) => (
            <div
              key={t.id}
              className={`card !p-4 ${t.is_active === false ? "opacity-60" : ""}`}
              data-testid={`${testId}-item-${t.id}`}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink-950">{t.name}</p>
                  {render(t)}
                  {t.usage_count != null && (
                    <p
                      className="mt-1 text-[11px] text-txt-muted"
                      data-testid={`${testId}-used-${t.id}`}
                    >
                      Used in {t.usage_count} {t.usage_label}
                    </p>
                  )}
                </div>
                <HistoryButton
                  entityType={testId.replace(/-/g, "_").replace(/s$/, "")}
                  entityId={t.id}
                />
                {perm.del && (
                  <label className="flex items-center gap-1.5 text-[11px] text-txt-secondary">
                    <Switch
                      checked={t.is_active !== false}
                      onCheckedChange={(on) => setActive(t, on)}
                      aria-label="Active"
                      data-testid={`${testId}-active-${t.id}`}
                    />
                    {t.is_active !== false ? "Active" : "Inactive"}
                  </label>
                )}
                <RowMenu
                  testId={`${testId}-menu-${t.id}`}
                  items={[
                    {
                      label: "Edit",
                      icon: Pencil,
                      onClick: () => setEditing(t),
                      testId: `${testId}-edit-${t.id}`,
                      show: !!perm.edit,
                    },
                  ]}
                />
              </div>
            </div>
          ))}
          {shown.length === 0 && (
            <p className="text-sm text-txt-secondary" data-testid={`${testId}-empty`}>
              Nothing here yet — create the first one.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
