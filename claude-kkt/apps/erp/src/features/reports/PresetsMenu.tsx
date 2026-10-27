import { Bookmark, BookmarkPlus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ReportKey, ReportPresetRow } from "@kkt/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FieldWrapper,
  IconButton,
  Input,
  SimpleDialog,
} from "@/components/ui";
import { useMutationWithToast } from "@/lib/queries";
import { createPreset, deletePreset, reportKeys, usePresets } from "./api";

export interface PresetsMenuProps {
  reportKey: ReportKey;
  /** Current filter values (what a new preset saves). */
  params: Readonly<Record<string, string>>;
  onApply: (preset: ReportPresetRow) => void;
}

/** Saved filter sets for one report: list / apply / delete, plus "save current filters". */
export function PresetsMenu({ reportKey, params, onApply }: PresetsMenuProps) {
  const presets = usePresets(reportKey);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const invalidate = [reportKeys.presets(reportKey)];

  const save = useMutationWithToast<ReportPresetRow, void>({
    mutationFn: () => createPreset({ report_key: reportKey, name: name.trim(), params: { ...params } }),
    successMessage: (saved) => `Preset “${saved.name}” saved`,
    invalidate,
    onSuccess: () => {
      setSaveOpen(false);
      setName("");
    },
  });

  const remove = useMutationWithToast<void, ReportPresetRow>({
    mutationFn: (preset) => deletePreset(preset.id, preset.version),
    successMessage: "Preset deleted",
    invalidate,
  });

  const rows = presets.data ?? [];
  const canSave = Object.keys(params).length > 0;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" leftIcon={Bookmark} data-testid="report-presets-btn">
            Presets
            {rows.length > 0 && (
              <span className="money ml-1 rounded-full bg-navy-50 px-1.5 text-2xs text-ink-muted">{rows.length}</span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Saved filters</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {presets.isPending && <p className="px-2 py-2 text-xs text-ink-subtle">Loading…</p>}
          {presets.isError && <p className="px-2 py-2 text-xs text-ink-subtle">Presets are unavailable right now.</p>}
          {presets.data && rows.length === 0 && (
            <p className="px-2 py-2 text-xs text-ink-subtle">
              No presets yet. Set the filters you want, then save them here.
            </p>
          )}
          {rows.map((preset) => (
            <div key={preset.id} className="flex items-center gap-1 pr-1">
              <DropdownMenuItem
                className="min-w-0 flex-1"
                onSelect={() => onApply(preset)}
                data-testid={`report-preset-apply-${preset.id}`}
              >
                <Bookmark />
                <span className="truncate">{preset.name}</span>
              </DropdownMenuItem>
              <IconButton
                icon={Trash2}
                label={`Delete preset ${preset.name}`}
                size="xs"
                variant="ghost"
                className="text-ink-subtle hover:text-danger-fg"
                loading={remove.isPending && remove.variables?.id === preset.id}
                onClick={(event) => {
                  event.preventDefault();
                  remove.mutate(preset);
                }}
              />
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaveOpen(true)} disabled={!canSave} data-testid="report-preset-save">
            <BookmarkPlus /> Save current filters…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SimpleDialog
        open={saveOpen}
        onOpenChange={(open) => !save.isPending && setSaveOpen(open)}
        title="Save filter preset"
        description="Only you see your presets. Applying one replaces the current filters."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setSaveOpen(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={name.trim().length === 0}
              data-testid="report-preset-save-confirm"
            >
              Save preset
            </Button>
          </>
        }
      >
        <FieldWrapper label="Name" required>
          {(control) => (
            <Input
              id={control.id}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              placeholder="e.g. Tower A — this FY"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter" && name.trim()) save.mutate();
              }}
            />
          )}
        </FieldWrapper>
        <dl className="mt-3 flex flex-wrap gap-1.5 text-2xs text-ink-muted">
          {Object.entries(params).map(([key, value]) => (
            <div key={key} className="rounded-full border border-border bg-surface px-2 py-0.5">
              <dt className="inline font-semibold">{key}</dt>
              <dd className="money inline"> = {value}</dd>
            </div>
          ))}
        </dl>
      </SimpleDialog>
    </>
  );
}
