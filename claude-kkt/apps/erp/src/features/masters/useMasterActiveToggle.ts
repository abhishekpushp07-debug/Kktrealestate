import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { MasterRow } from "@kkt/contracts";
import { describeError } from "@/lib/api";
import { useMutationWithToast } from "@/lib/queries";
import { isInUseError, usageFromDetails, type UsageBreakdown } from "@/features/shared/errors";
import { activateMaster, deactivateMaster, masterPath } from "./api";
import type { AnyMasterConfig } from "./types";

export interface InUseState {
  row: MasterRow;
  usage: UsageBreakdown;
}

/** Deactivate / restore mutations for a master kind; a 409 IN_USE lands in `inUse` for the usage dialog. */
export function useMasterActiveToggle(config: AnyMasterConfig) {
  const path = masterPath(config.slug);
  const [inUse, setInUse] = useState<InUseState | null>(null);

  const deactivate = useMutationWithToast<MasterRow, MasterRow>({
    mutationFn: (row) => deactivateMaster(config.slug, row.id, row.version),
    successMessage: (_data, row) => `${config.displayName(row)} deactivated`,
    invalidate: [[path]],
    entityLabel: config.singular,
    errorMessage: false,
    onError: (error, row) => {
      if (error.isVersionConflict) return;
      if (isInUseError(error)) {
        setInUse({ row, usage: usageFromDetails(error.details) ?? { usage_count: 0, used_by: [] } });
        return;
      }
      toast.error(describeError(error));
    },
  });

  const activate = useMutationWithToast<MasterRow, MasterRow>({
    mutationFn: (row) => activateMaster(config.slug, row.id, row.version),
    successMessage: (_data, row) => `${config.displayName(row)} restored`,
    invalidate: [[path]],
    entityLabel: config.singular,
  });

  const clearInUse = useCallback(() => setInUse(null), []);

  return { deactivate, activate, inUse, clearInUse };
}
