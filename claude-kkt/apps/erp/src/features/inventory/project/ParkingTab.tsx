import type { ColumnDef } from "@tanstack/react-table";
import { CarFront, MoreHorizontal, Plus, Rows3 } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  PARKING_STATUSES,
  PARKING_STATUS_LABELS,
  PARKING_TYPES,
  PARKING_TYPE_LABELS,
  ParkingBulkGenerateSchema,
  ParkingSlotCreateSchema,
  type ParkingBulkGenerateResponse,
  type ParkingSlotRow,
  type ProjectRow,
} from "@kkt/contracts";
import { z } from "zod";
import {
  applyServerErrors,
  Button,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FormError,
  FormField,
  FormRow,
  IconButton,
  Input,
  MoneyInput,
  NumberInput,
  Select,
  SimpleDialog,
  StatusChip,
  Toolbar,
} from "@/components/ui";
import { api, type ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatINR, formatNumber } from "@/lib/format";
import { useList, useListParams, useMutationWithToast } from "@/lib/queries";
import { contractResolver } from "@/features/shared/contractResolver";
import { PROJECTS_PATH } from "../api";
import { controlOf } from "../components";

export interface ParkingTabProps {
  project: ProjectRow;
}

const PARKING_FILTERS = ["slot_type", "status", "level"] as const;

export function ParkingTab({ project }: ParkingTabProps) {
  const { can } = useAuth();
  const canWrite = can("parking.write");
  const path = `${PROJECTS_PATH}/${project.id}/parking`;
  const list = useListParams({ filterKeys: PARKING_FILTERS, defaultSort: "number", prefix: "pk_" });
  const query = useList<ParkingSlotRow>(path, list.params);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [singleOpen, setSingleOpen] = useState(false);

  const setStatus = useMutationWithToast<ParkingSlotRow, { slot: ParkingSlotRow; status: "AVAILABLE" | "BLOCKED" }>({
    mutationFn: ({ slot, status }) => api.patch<ParkingSlotRow>(`${path}/${slot.id}`, { status, version: slot.version }, { version: slot.version }),
    successMessage: (_data, { slot, status }) => `Slot ${slot.number} is now ${PARKING_STATUS_LABELS[status].toLowerCase()}`,
    invalidate: [[path]],
    entityLabel: "This parking slot",
  });

  const columns = useMemo<ColumnDef<ParkingSlotRow, unknown>[]>(
    () => [
      { accessorKey: "number", header: "Slot", meta: { locked: true, width: 120 }, cell: ({ row }) => <span className="font-mono font-semibold text-navy-950">{row.original.number}</span> },
      { accessorKey: "slot_type", header: "Type", cell: ({ row }) => PARKING_TYPE_LABELS[row.original.slot_type] },
      { accessorKey: "level", header: "Level", cell: ({ row }) => row.original.level ?? "—" },
      { accessorKey: "price_paise", header: "Price", meta: { align: "right" }, cell: ({ row }) => formatINR(row.original.price_paise) },
      { accessorKey: "status", header: "Status", meta: { width: 120 }, cell: ({ row }) => <StatusChip status={row.original.status} label={PARKING_STATUS_LABELS[row.original.status]} size="sm" /> },
      {
        id: "allotted",
        header: "Allotted to",
        meta: { sortKey: false },
        cell: ({ row }) => (row.original.booking_number ? `${row.original.booking_number}${row.original.flat_number ? ` · Flat ${row.original.flat_number}` : ""}` : <span className="text-ink-subtle">—</span>),
      },
      ...(canWrite
        ? [
            {
              id: "actions",
              header: "",
              meta: { sortKey: false, width: 56, align: "right", locked: true, label: "Actions" },
              cell: ({ row }) => {
                const slot = row.original;
                if (slot.status === "ALLOTTED") return null;
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton icon={MoreHorizontal} label={`Actions for slot ${slot.number}`} size="sm" data-testid={`parking-actions-${slot.id}`} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {slot.status !== "BLOCKED" && (
                        <DropdownMenuItem destructive onSelect={() => setStatus.mutate({ slot, status: "BLOCKED" })}>
                          Block slot
                        </DropdownMenuItem>
                      )}
                      {slot.status !== "AVAILABLE" && <DropdownMenuItem onSelect={() => setStatus.mutate({ slot, status: "AVAILABLE" })}>Make available</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              },
            } satisfies ColumnDef<ParkingSlotRow, unknown>,
          ]
        : []),
    ],
    [canWrite, setStatus],
  );

  const total = query.data?.total ?? 0;

  return (
    <>
      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search slot number…"
        filters={
          <>
            <Select aria-label="Type" size="sm" className="w-full sm:w-36" value={list.filters.slot_type ?? null} onValueChange={(value) => list.setFilter("slot_type", value)} options={PARKING_TYPES.map((value) => ({ value, label: PARKING_TYPE_LABELS[value] }))} placeholder="Any type" allowClear />
            <Select aria-label="Status" size="sm" className="w-full sm:w-36" value={list.filters.status ?? null} onValueChange={(value) => list.setFilter("status", value)} options={PARKING_STATUSES.map((value) => ({ value, label: PARKING_STATUS_LABELS[value] }))} placeholder="Any status" allowClear />
          </>
        }
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        exportSource={{ path: path, params: list.params, filename: `${project.code}-parking.csv` }}
        exportTotal={query.data?.total}
        summary={query.data ? `${formatNumber(total)} ${total === 1 ? "slot" : "slots"}` : undefined}
        actions={
          canWrite ? (
            <>
              <Button variant="outline" size="md" leftIcon={Rows3} onClick={() => setBulkOpen(true)} data-testid="parking-bulk-btn">
                Bulk generate
              </Button>
              <Button leftIcon={Plus} onClick={() => setSingleOpen(true)} data-testid="parking-add-btn">
                Add slot
              </Button>
            </>
          ) : undefined
        }
      />
      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        pagination={{ page: list.page, pageSize: list.pageSize, total, onPageChange: list.setPage, onPageSizeChange: list.setPageSize }}
        emptyState={{ icon: CarFront, title: list.hasActiveFilters ? "No slots match" : "No parking slots yet", description: canWrite ? "Generate a numbered batch or add slots one by one." : "Parking inventory has not been created." }}
        data-testid="parking-table"
      />
      <BulkGenerateDialog project={project} open={bulkOpen} onOpenChange={setBulkOpen} path={path} />
      <AddSlotDialog project={project} open={singleOpen} onOpenChange={setSingleOpen} path={path} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Bulk generate                                                        */
/* ------------------------------------------------------------------ */

interface BulkValues {
  prefix: string;
  from_number: number | null;
  to_number: number | null;
  pad: number;
  slot_type: string | null;
  level: string;
  price_paise: number | null;
}

interface DialogProps {
  project: ProjectRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  path: string;
}

function BulkGenerateDialog({ project, open, onOpenChange, path }: DialogProps) {
  const schema = useMemo(
    () =>
      z
        .looseObject({})
        .transform((raw): unknown => {
          const values = raw as unknown as BulkValues;
          return { project_id: project.id, prefix: values.prefix, from_number: values.from_number, to_number: values.to_number, pad: values.pad, slot_type: values.slot_type, level: values.level.trim() || null, price_paise: values.price_paise ?? 0 };
        })
        .pipe(ParkingBulkGenerateSchema),
    [project.id],
  );
  const resolver = useMemo(() => contractResolver<BulkValues, unknown>(schema), [schema]);
  const form = useForm<BulkValues, unknown, unknown>({ resolver, defaultValues: { prefix: "P-", from_number: 1, to_number: 50, pad: 3, slot_type: "COVERED", level: "", price_paise: null }, mode: "onTouched" });
  const control = controlOf(form);
  const [serverError, setServerError] = useState<unknown>(null);
  const mutation = useMutationWithToast<ParkingBulkGenerateResponse, unknown>({
    mutationFn: (body) => api.post<ParkingBulkGenerateResponse>(`${path}/bulk-generate`, body),
    successMessage: (result) => `${formatNumber(result.created)} slots created${result.skipped_existing.length ? ` · ${result.skipped_existing.length} already existed` : ""}`,
    invalidate: [[path]],
    errorMessage: false,
    onSuccess: () => {
      onOpenChange(false);
      form.reset();
    },
    onError: (error: ApiClientError) => {
      if (!applyServerErrors(error, form.setError)) setServerError(error);
    },
  });
  const [from, to, prefix, pad] = form.watch(["from_number", "to_number", "prefix", "pad"]);
  const count = from !== null && to !== null && to >= from ? to - from + 1 : 0;
  const sample = (n: number | null) => `${prefix}${String(n ?? 0).padStart(pad, "0")}`;

  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}
      title="Bulk generate parking slots"
      description="Numbered slots prefix + from…to. Existing numbers are skipped."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="parking-bulk-form" loading={mutation.isPending} data-testid="parking-bulk-submit">
            Generate {count > 0 ? formatNumber(count) : ""} slots
          </Button>
        </>
      }
    >
      <form
        id="parking-bulk-form"
        noValidate
        onSubmit={form.handleSubmit((output) => {
          setServerError(null);
          mutation.mutate(output);
        })}
        className="space-y-4"
      >
        {serverError !== null && <FormError error={serverError} />}
        <FormRow columns={3}>
          <FormField control={control} name="prefix" label="Prefix" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value.toUpperCase())} maxLength={10} className="font-mono" />} />
          <FormField control={control} name="from_number" label="From" required render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} decimals={0} min={1} max={9999} />} />
          <FormField control={control} name="to_number" label="To" required render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} decimals={0} min={1} max={9999} />} />
          <FormField control={control} name="pad" label="Zero padding" render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={(value) => field.onChange(value ?? 0)} onBlur={field.onBlur} decimals={0} min={0} max={4} />} />
          <FormField control={control} name="slot_type" label="Type" required render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={PARKING_TYPES.map((value) => ({ value, label: PARKING_TYPE_LABELS[value] }))} invalid={field.invalid} />} />
          <FormField control={control} name="level" label="Level" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} placeholder="B1" maxLength={20} />} />
          <FormField control={control} name="price_paise" label="Price per slot" className="sm:col-span-3" render={({ field }) => <MoneyInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} placeholder="0" />} />
        </FormRow>
        <p className="rounded-md bg-surface px-3 py-2 text-xs text-ink-muted">
          Preview: <span className="font-mono text-navy-950">{sample(from)}</span> … <span className="font-mono text-navy-950">{sample(to)}</span> · {formatNumber(count)} slots (max 1000 per batch)
        </p>
      </form>
    </SimpleDialog>
  );
}

/* ------------------------------------------------------------------ */
/* Single slot                                                          */
/* ------------------------------------------------------------------ */

interface SlotValues {
  number: string;
  slot_type: string | null;
  level: string;
  price_paise: number | null;
}

function AddSlotDialog({ project, open, onOpenChange, path }: DialogProps) {
  const schema = useMemo(
    () =>
      z
        .looseObject({})
        .transform((raw): unknown => {
          const values = raw as unknown as SlotValues;
          return { project_id: project.id, number: values.number, slot_type: values.slot_type, level: values.level.trim() || null, price_paise: values.price_paise ?? 0 };
        })
        .pipe(ParkingSlotCreateSchema),
    [project.id],
  );
  const resolver = useMemo(() => contractResolver<SlotValues, unknown>(schema), [schema]);
  const form = useForm<SlotValues, unknown, unknown>({ resolver, defaultValues: { number: "", slot_type: "COVERED", level: "", price_paise: null }, mode: "onTouched" });
  const control = controlOf(form);
  const [serverError, setServerError] = useState<unknown>(null);
  const mutation = useMutationWithToast<ParkingSlotRow, unknown>({
    mutationFn: (body) => api.post<ParkingSlotRow>(path, body),
    successMessage: (slot) => `Slot ${slot.number} added`,
    invalidate: [[path]],
    errorMessage: false,
    onSuccess: () => {
      onOpenChange(false);
      form.reset();
    },
    onError: (error: ApiClientError) => {
      if (!applyServerErrors(error, form.setError)) setServerError(error);
    },
  });
  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}
      title="Add parking slot"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="parking-single-form" loading={mutation.isPending} data-testid="parking-add-submit">
            Add slot
          </Button>
        </>
      }
    >
      <form
        id="parking-single-form"
        noValidate
        onSubmit={form.handleSubmit((output) => {
          setServerError(null);
          mutation.mutate(output);
        })}
        className="space-y-4"
      >
        {serverError !== null && <FormError error={serverError} />}
        <FormRow columns={2}>
          <FormField control={control} name="number" label="Slot number" required render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value.toUpperCase())} maxLength={20} className="font-mono" />} />
          <FormField control={control} name="slot_type" label="Type" required render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={PARKING_TYPES.map((value) => ({ value, label: PARKING_TYPE_LABELS[value] }))} invalid={field.invalid} />} />
          <FormField control={control} name="level" label="Level" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} placeholder="B1" maxLength={20} />} />
          <FormField control={control} name="price_paise" label="Price" render={({ field }) => <MoneyInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} placeholder="0" />} />
        </FormRow>
      </form>
    </SimpleDialog>
  );
}
