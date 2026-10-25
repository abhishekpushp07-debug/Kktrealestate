import type { ColumnDef } from "@tanstack/react-table";
import { Building2, CalendarRange, DoorOpen, FileText, Hammer, Landmark, Layers, LayoutGrid, LayoutTemplate, ListChecks, ReceiptText, Ruler, Sparkles, Tags, Wallet, Wrench } from "lucide-react";
import { createElement } from "react";
import {
  AmenityCreateSchema,
  AreaTypeCreateSchema,
  BankAccountCreateSchema,
  BLOCK_TYPE_CODES,
  BlockTypeCreateSchema,
  CHARGE_DEMAND_AT_LABELS,
  ChargeTypeCreateSchema,
  ConstructionStageCreateSchema,
  DOCUMENT_APPLIES_TO_LABELS,
  DocumentTypeCreateSchema,
  FlatTypeCreateSchema,
  FloorPlanTemplateCreateSchema,
  MASTER_KIND_LABELS,
  MASTER_KINDS,
  PAYMENT_MODE_CODE_LABELS,
  PaymentModeCreateSchema,
  PaymentPlanCreateSchema,
  PLAN_TYPE_LABELS,
  PLC_CALC_MODE_LABELS,
  PlcTypeCreateSchema,
  RoomTypeCreateSchema,
  SERVICE_PRIORITIES,
  SERVICE_PRIORITY_LABELS,
  ServiceCategoryCreateSchema,
  SpecCategoryCreateSchema,
  SpecItemCreateSchema,
  type AmenityRow,
  type AreaTypeRow,
  type BankAccountRow,
  type BlockTypeRow,
  type ChargeTypeRow,
  type ConstructionStageRow,
  type DocumentTypeRow,
  type FlatTypeRow,
  type FloorPlanTemplateRow,
  type MasterKind,
  type PaymentModeRow,
  type PaymentPlanRow,
  type PlcTypeRow,
  type RoomTypeRow,
  type ServiceCategoryRow,
  type SpecCategoryRow,
  type SpecItemRow,
} from "@kkt/contracts";
import { z } from "zod";
import { Badge, StatusChip } from "@/components/ui";
import { formatINR, formatNumber, formatPercent, formatSqft } from "@/lib/format";
import { ConstructionStagesPage } from "./ConstructionStagesPage";
import { kindToSlug } from "./api";
import { BankAccountForm, type BankAccountValues } from "./forms/BankAccountForm";
import { ChargeTypeForm, type ChargeTypeValues } from "./forms/ChargeTypeForm";
import { DocumentTypeForm, type DocumentTypeValues } from "./forms/DocumentTypeForm";
import { FlatTypeForm, type FlatTypeValues, type PricingMode } from "./forms/FlatTypeForm";
import { FloorPlanTemplateForm, resizePositions, type FloorPlanTemplateValues } from "./forms/FloorPlanTemplateForm";
import { PaymentModeForm, type PaymentModeValues } from "./forms/PaymentModeForm";
import { emptyInstallment, PaymentPlanForm, type PaymentPlanValues } from "./forms/PaymentPlanForm";
import { PlcTypeForm, type PlcTypeValues } from "./forms/PlcTypeForm";
import { SpecItemForm, type SpecItemValues } from "./forms/SpecItemForm";
import { defineMaster, type AnyMasterConfig, type MasterSlug } from "./types";

/* ------------------------------------------------------------------ */
/* Shared value types for the declarative kinds                         */
/* ------------------------------------------------------------------ */

interface NameCodeSortValues {
  name: string;
  code: string;
  sort_order: number;
}

interface BlockTypeValues {
  name: string;
  code: string;
  has_floors: boolean;
}

interface AmenityValues {
  name: string;
  category: string | null;
  icon: string | null;
}

interface ConstructionStageValues extends NameCodeSortValues {
  is_possession: boolean;
}

interface SpecCategoryValues {
  name: string;
  sort_order: number;
}

interface ServiceCategoryValues {
  name: string;
  sort_order: number;
  default_priority: string;
}

/* ------------------------------------------------------------------ */
/* Form-state wrappers: strip UI-only keys, then validate the contract   */
/* ------------------------------------------------------------------ */

const PricingModeSchema = z.enum(["NONE", "RATE", "LUMP_SUM"]);

const FlatTypeFormSchema = z
  .looseObject({
    pricing_mode: PricingModeSchema,
    base_rate_per_sqft_paise: z.number().nullable().optional(),
    base_price_paise: z.number().nullable().optional(),
    rooms: z.array(z.looseObject({ sqft: z.number().nullable().optional() })),
  })
  .superRefine((value, ctx) => {
    if (value.pricing_mode === "RATE" && typeof value.base_rate_per_sqft_paise !== "number") {
      ctx.addIssue({ code: "custom", path: ["base_rate_per_sqft_paise"], message: "Required" });
    }
    if (value.pricing_mode === "LUMP_SUM" && typeof value.base_price_paise !== "number") {
      ctx.addIssue({ code: "custom", path: ["base_price_paise"], message: "Required" });
    }
  })
  .transform(({ pricing_mode, rooms, ...rest }): unknown => ({
    ...rest,
    rooms: rooms.map((room) => ({ ...room, sqft: room.sqft ?? undefined })),
    base_rate_per_sqft_paise: pricing_mode === "RATE" ? rest.base_rate_per_sqft_paise : null,
    base_price_paise: pricing_mode === "LUMP_SUM" ? rest.base_price_paise : null,
  }))
  .pipe(FlatTypeCreateSchema);

const FloorPlanTemplateFormSchema = z
  .looseObject({ flats_per_floor: z.number().optional() })
  .transform(({ flats_per_floor: _count, ...rest }): unknown => rest)
  .pipe(FloorPlanTemplateCreateSchema);

function digitsOnly(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, "");
}

const BankAccountCreateFormSchema = z
  .looseObject({ account_number: z.string(), account_number_confirm: z.string(), change_account_number: z.boolean().optional() })
  .superRefine((value, ctx) => {
    if (digitsOnly(value.account_number) !== digitsOnly(value.account_number_confirm)) {
      ctx.addIssue({ code: "custom", path: ["account_number_confirm"], message: "Account numbers do not match" });
    }
  })
  .transform(({ account_number_confirm: _confirm, change_account_number: _change, ...rest }): unknown => rest)
  .pipe(BankAccountCreateSchema);

const BankAccountEditFormSchema = z
  .looseObject({ change_account_number: z.boolean(), account_number: z.string().optional(), account_number_confirm: z.string().optional() })
  .superRefine((value, ctx) => {
    if (!value.change_account_number) return;
    if (!digitsOnly(value.account_number)) {
      ctx.addIssue({ code: "custom", path: ["account_number"], message: "Required" });
    } else if (digitsOnly(value.account_number) !== digitsOnly(value.account_number_confirm)) {
      ctx.addIssue({ code: "custom", path: ["account_number_confirm"], message: "Account numbers do not match" });
    }
  })
  .transform(({ change_account_number, account_number, account_number_confirm: _confirm, ...rest }): unknown => (change_account_number ? { ...rest, account_number } : rest))
  .pipe(BankAccountCreateSchema.partial());

/* ------------------------------------------------------------------ */
/* Column helpers                                                       */
/* ------------------------------------------------------------------ */

function code(value: string) {
  return createElement("code", { className: "rounded-xs bg-navy-50 px-1 py-0.5 font-mono text-xs text-navy-950" }, value);
}

function yesNo(value: boolean) {
  return createElement(StatusChip, { status: value ? "ENABLED" : "DISABLED", label: value ? "Yes" : "No", size: "sm", dot: false });
}

function muted(value: string | null | undefined) {
  return createElement("span", { className: value ? undefined : "text-ink-subtle" }, value || "—");
}

/* ------------------------------------------------------------------ */
/* Registry                                                             */
/* ------------------------------------------------------------------ */

const ROOM_TYPE_COLUMNS: ColumnDef<RoomTypeRow, unknown>[] = [
  { accessorKey: "name", header: "Name", meta: { locked: true } },
  { accessorKey: "code", header: "Code", cell: ({ row }) => code(row.original.code) },
  { accessorKey: "sort_order", header: "Order", meta: { align: "right", width: 90 } },
];

const AREA_TYPE_COLUMNS: ColumnDef<AreaTypeRow, unknown>[] = [
  { accessorKey: "name", header: "Name", meta: { locked: true } },
  { accessorKey: "code", header: "Code", cell: ({ row }) => code(row.original.code) },
  { accessorKey: "sort_order", header: "Order", meta: { align: "right", width: 90 } },
];

const FLAT_TYPE_COLUMNS: ColumnDef<FlatTypeRow, unknown>[] = [
  { accessorKey: "name", header: "Name", meta: { locked: true } },
  { accessorKey: "code", header: "Code", cell: ({ row }) => code(row.original.code) },
  { accessorKey: "bhk", header: "BHK", meta: { align: "right", width: 80 }, cell: ({ row }) => formatNumber(row.original.bhk, Number.isInteger(row.original.bhk) ? 0 : 1) },
  { accessorKey: "facing", header: "Facing", cell: ({ row }) => muted(row.original.facing) },
  { id: "rooms", header: "Rooms", meta: { align: "right", sortKey: false, width: 80 }, cell: ({ row }) => formatNumber(row.original.rooms.length) },
  { accessorKey: "carpet_sqft", header: "Carpet", meta: { align: "right" }, cell: ({ row }) => formatSqft(row.original.carpet_sqft) },
  { accessorKey: "super_builtup_sqft", header: "Super built-up", meta: { align: "right" }, cell: ({ row }) => formatSqft(row.original.super_builtup_sqft) },
  {
    id: "base_price",
    header: "Base price",
    meta: { align: "right", sortKey: false },
    cell: ({ row }) =>
      row.original.base_price_paise !== null
        ? formatINR(row.original.base_price_paise)
        : row.original.base_rate_per_sqft_paise !== null
          ? `${formatINR(row.original.base_rate_per_sqft_paise)}/sq ft`
          : muted(null),
  },
];

const BLOCK_TYPE_COLUMNS: ColumnDef<BlockTypeRow, unknown>[] = [
  { accessorKey: "name", header: "Name", meta: { locked: true } },
  { accessorKey: "code", header: "Code", cell: ({ row }) => code(row.original.code) },
  { accessorKey: "has_floors", header: "Has floors", meta: { align: "center", width: 110 }, cell: ({ row }) => yesNo(row.original.has_floors) },
];

const FLOOR_PLAN_COLUMNS: ColumnDef<FloorPlanTemplateRow, unknown>[] = [
  { accessorKey: "name", header: "Name", meta: { locked: true } },
  { accessorKey: "code", header: "Code", cell: ({ row }) => code(row.original.code) },
  { accessorKey: "flats_per_floor", header: "Flats / floor", meta: { align: "right", width: 110 } },
  {
    id: "mix",
    header: "Mix",
    meta: { sortKey: false },
    cell: ({ row }) => {
      const counts = new Map<string, number>();
      for (const position of row.original.positions) counts.set(position.flat_type_code, (counts.get(position.flat_type_code) ?? 0) + 1);
      return [...counts.entries()].map(([typeCode, count]) => `${typeCode}×${count}`).join(", ");
    },
  },
  { id: "corners", header: "Corners", meta: { align: "right", sortKey: false, width: 90 }, cell: ({ row }) => formatNumber(row.original.positions.filter((position) => position.is_corner).length) },
];

const AMENITY_COLUMNS: ColumnDef<AmenityRow, unknown>[] = [
  { accessorKey: "name", header: "Name", meta: { locked: true } },
  { accessorKey: "category", header: "Category", cell: ({ row }) => muted(row.original.category) },
  { accessorKey: "icon", header: "Icon", cell: ({ row }) => (row.original.icon ? code(row.original.icon) : muted(null)) },
];

const CONSTRUCTION_STAGE_COLUMNS: ColumnDef<ConstructionStageRow, unknown>[] = [
  { accessorKey: "sort_order", header: "#", meta: { align: "right", width: 60, locked: true } },
  { accessorKey: "name", header: "Stage" },
  { accessorKey: "code", header: "Code", cell: ({ row }) => code(row.original.code) },
  { accessorKey: "is_possession", header: "Possession", meta: { align: "center", width: 110 }, cell: ({ row }) => (row.original.is_possession ? createElement(Badge, { variant: "gold" }, "Possession") : null) },
];

const PAYMENT_PLAN_COLUMNS: ColumnDef<PaymentPlanRow, unknown>[] = [
  { accessorKey: "name", header: "Plan", meta: { locked: true } },
  { accessorKey: "code", header: "Code", cell: ({ row }) => code(row.original.code) },
  { accessorKey: "plan_type", header: "Type", cell: ({ row }) => PLAN_TYPE_LABELS[row.original.plan_type] },
  { id: "installments", header: "Installments", meta: { align: "right", sortKey: false, width: 110 }, cell: ({ row }) => formatNumber(row.original.installments.length) },
  { accessorKey: "grace_days", header: "Grace", meta: { align: "right", width: 90 }, cell: ({ row }) => `${row.original.grace_days} d` },
  { accessorKey: "assignment_count", header: "Towers", meta: { align: "right", width: 90 } },
  { accessorKey: "booking_count", header: "Bookings", meta: { align: "right", width: 100 } },
];

const CHARGE_TYPE_COLUMNS: ColumnDef<ChargeTypeRow, unknown>[] = [
  { accessorKey: "name", header: "Charge", meta: { locked: true } },
  { accessorKey: "code", header: "Code", cell: ({ row }) => code(row.original.code) },
  { accessorKey: "default_amount_paise", header: "Default amount", meta: { align: "right" }, cell: ({ row }) => formatINR(row.original.default_amount_paise) },
  { accessorKey: "is_taxable", header: "Taxable", meta: { align: "center", width: 90 }, cell: ({ row }) => yesNo(row.original.is_taxable) },
  { accessorKey: "default_gst_percent", header: "GST", meta: { align: "right", width: 80 }, cell: ({ row }) => (row.original.is_taxable ? formatPercent(row.original.default_gst_percent) : muted(null)) },
  { accessorKey: "demand_at", header: "Demand at", cell: ({ row }) => CHARGE_DEMAND_AT_LABELS[row.original.demand_at] },
];

const PAYMENT_MODE_COLUMNS: ColumnDef<PaymentModeRow, unknown>[] = [
  { accessorKey: "name", header: "Mode", meta: { locked: true } },
  { accessorKey: "code", header: "Code", cell: ({ row }) => code(row.original.code) },
  { accessorKey: "requires_instrument", header: "Instrument ref.", meta: { align: "center" }, cell: ({ row }) => yesNo(row.original.requires_instrument) },
  { accessorKey: "clears_immediately", header: "Clears at once", meta: { align: "center" }, cell: ({ row }) => yesNo(row.original.clears_immediately) },
  { accessorKey: "is_cash", header: "Cash", meta: { align: "center", width: 80 }, cell: ({ row }) => yesNo(row.original.is_cash) },
  { accessorKey: "sort_order", header: "Order", meta: { align: "right", width: 80 } },
];

const BANK_ACCOUNT_COLUMNS: ColumnDef<BankAccountRow, unknown>[] = [
  { accessorKey: "bank_name", header: "Bank", meta: { locked: true } },
  { accessorKey: "account_name", header: "Account name" },
  { accessorKey: "account_number_masked", header: "Account no.", meta: { sortKey: false }, cell: ({ row }) => createElement("span", { className: "money font-mono text-xs" }, row.original.account_number_masked) },
  { accessorKey: "ifsc", header: "IFSC", cell: ({ row }) => code(row.original.ifsc) },
  { accessorKey: "branch", header: "Branch", cell: ({ row }) => muted(row.original.branch) },
  {
    id: "flags",
    header: "Flags",
    meta: { sortKey: false },
    cell: ({ row }) =>
      createElement(
        "span",
        { className: "flex gap-1" },
        row.original.is_default ? createElement(Badge, { key: "default", variant: "gold" }, "Default") : null,
        row.original.is_escrow ? createElement(Badge, { key: "escrow", variant: "navy" }, "Escrow") : null,
      ),
  },
];

const DOCUMENT_TYPE_COLUMNS: ColumnDef<DocumentTypeRow, unknown>[] = [
  { accessorKey: "name", header: "Document", meta: { locked: true } },
  { accessorKey: "code", header: "Code", cell: ({ row }) => code(row.original.code) },
  { id: "applies_to", header: "Applies to", meta: { sortKey: false }, cell: ({ row }) => row.original.applies_to.map((entity) => DOCUMENT_APPLIES_TO_LABELS[entity]).join(", ") },
  { accessorKey: "is_kyc", header: "KYC", meta: { align: "center", width: 80 }, cell: ({ row }) => yesNo(row.original.is_kyc) },
];

const PLC_TYPE_COLUMNS: ColumnDef<PlcTypeRow, unknown>[] = [
  { accessorKey: "name", header: "PLC", meta: { locked: true } },
  { accessorKey: "code", header: "Code", cell: ({ row }) => code(row.original.code) },
  { accessorKey: "calc_mode", header: "Calculation", cell: ({ row }) => PLC_CALC_MODE_LABELS[row.original.calc_mode] },
];

const SPEC_CATEGORY_COLUMNS: ColumnDef<SpecCategoryRow, unknown>[] = [
  { accessorKey: "name", header: "Category", meta: { locked: true } },
  { accessorKey: "sort_order", header: "Order", meta: { align: "right", width: 90 } },
];

const SPEC_ITEM_COLUMNS: ColumnDef<SpecItemRow, unknown>[] = [
  { accessorKey: "name", header: "Item", meta: { locked: true } },
  { accessorKey: "category_name", header: "Category", meta: { sortKey: false } },
  { accessorKey: "description", header: "Description", cell: ({ row }) => createElement("span", { className: "block max-w-sm truncate text-ink-muted", title: row.original.description ?? undefined }, row.original.description || "—") },
  { accessorKey: "sort_order", header: "Order", meta: { align: "right", width: 90 } },
];

const SERVICE_CATEGORY_COLUMNS: ColumnDef<ServiceCategoryRow, unknown>[] = [
  { accessorKey: "name", header: "Category", meta: { locked: true } },
  { accessorKey: "default_priority", header: "Default priority", cell: ({ row }) => createElement(StatusChip, { status: row.original.default_priority, label: SERVICE_PRIORITY_LABELS[row.original.default_priority], size: "sm" }) },
  { accessorKey: "sort_order", header: "Order", meta: { align: "right", width: 90 } },
];

function pricingModeOf(row: FlatTypeRow): PricingMode {
  if (row.base_price_paise !== null) return "LUMP_SUM";
  if (row.base_rate_per_sqft_paise !== null) return "RATE";
  return "NONE";
}

/** One config per MASTER_KIND, keyed by kind. */
export const MASTER_CONFIGS: Readonly<Record<MasterKind, AnyMasterConfig>> = {
  ROOM_TYPES: defineMaster<RoomTypeRow, NameCodeSortValues, z.output<typeof RoomTypeCreateSchema>>({
    kind: "ROOM_TYPES",
    slug: "room-types",
    label: MASTER_KIND_LABELS.ROOM_TYPES,
    singular: "Room type",
    description: "Bedroom, Kitchen, Living, Toilet, Balcony… picked when defining the rooms of a flat type.",
    icon: DoorOpen,
    group: "structure",
    columns: ROOM_TYPE_COLUMNS,
    defaultSort: "sort_order",
    searchPlaceholder: "Search room types…",
    csv: { columns: ["name", "code", "sort_order"], example: "Master Bedroom,MBR,1" },
    createSchema: RoomTypeCreateSchema,
    defaults: () => ({ name: "", code: "", sort_order: 0 }),
    toValues: (row) => ({ name: row.name, code: row.code, sort_order: row.sort_order }),
    displayName: (row) => row.name,
    fields: [
      { name: "name", label: "Name", type: "text", required: true, placeholder: "Bedroom" },
      { name: "code", label: "Code", type: "code", required: true, placeholder: "BED" },
      { name: "sort_order", label: "Sort order", type: "number", fallback: 0, min: 0, max: 10_000 },
    ],
  }),
  AREA_TYPES: defineMaster<AreaTypeRow, NameCodeSortValues, z.output<typeof AreaTypeCreateSchema>>({
    kind: "AREA_TYPES",
    slug: "area-types",
    label: MASTER_KIND_LABELS.AREA_TYPES,
    singular: "Area type",
    description: "Carpet, Built-up, Super Built-up, Balcony, Terrace, Parking. The three structural codes drive the super ≥ built-up ≥ carpet rule.",
    icon: Ruler,
    group: "structure",
    columns: AREA_TYPE_COLUMNS,
    defaultSort: "sort_order",
    searchPlaceholder: "Search area types…",
    csv: { columns: ["name", "code", "sort_order"], example: "Carpet,CARPET,1" },
    createSchema: AreaTypeCreateSchema,
    defaults: () => ({ name: "", code: "", sort_order: 0 }),
    toValues: (row) => ({ name: row.name, code: row.code, sort_order: row.sort_order }),
    displayName: (row) => row.name,
    fields: [
      { name: "name", label: "Name", type: "text", required: true, placeholder: "Super Built-up" },
      { name: "code", label: "Code", type: "code", required: true, placeholder: "SUPER_BUILT_UP", hint: "Use CARPET / BUILT_UP / SUPER_BUILT_UP for the structural areas" },
      { name: "sort_order", label: "Sort order", type: "number", fallback: 0, min: 0, max: 10_000 },
    ],
  }),
  FLAT_TYPES: defineMaster<FlatTypeRow, FlatTypeValues, z.output<typeof FlatTypeFormSchema>>({
    kind: "FLAT_TYPES",
    slug: "flat-types",
    label: MASTER_KIND_LABELS.FLAT_TYPES,
    singular: "Flat type",
    description: "Configurations (3BHK-A…) with rooms, areas, optional base price and specification items. Flats snapshot these when a block is generated.",
    icon: LayoutGrid,
    group: "structure",
    columns: FLAT_TYPE_COLUMNS,
    defaultSort: "name",
    searchPlaceholder: "Search flat types…",
    csv: { columns: ["name", "code", "bhk", "facing", "description", "base_rate_per_sqft", "base_price"], example: "3BHK-A,3BHK_A,3,East,Corner unit,4500," },
    createSchema: FlatTypeFormSchema,
    defaults: () => ({
      name: "",
      code: "",
      bhk: null,
      facing: null,
      description: null,
      rooms: [{ room_type_id: null, label: "", length_ft: null, width_ft: null, sqft: null }],
      areas: [{ area_type_id: null, sqft: null }],
      pricing_mode: "NONE",
      base_rate_per_sqft_paise: null,
      base_price_paise: null,
      spec_item_ids: [],
    }),
    toValues: (row) => ({
      name: row.name,
      code: row.code,
      bhk: row.bhk,
      facing: row.facing,
      description: row.description,
      rooms: row.rooms.map((room) => ({ room_type_id: room.room_type_id, label: room.label, length_ft: room.length_ft, width_ft: room.width_ft, sqft: room.sqft })),
      areas: row.areas.map((area) => ({ area_type_id: area.area_type_id, sqft: area.sqft })),
      pricing_mode: pricingModeOf(row),
      base_rate_per_sqft_paise: row.base_rate_per_sqft_paise,
      base_price_paise: row.base_price_paise,
      spec_item_ids: row.spec_item_ids,
    }),
    displayName: (row) => `${row.name} (${row.code})`,
    Form: FlatTypeForm,
    sheetSize: "lg",
  }),
  BLOCK_TYPES: defineMaster<BlockTypeRow, BlockTypeValues, z.output<typeof BlockTypeCreateSchema>>({
    kind: "BLOCK_TYPES",
    slug: "block-types",
    label: MASTER_KIND_LABELS.BLOCK_TYPES,
    singular: "Block type",
    description: "Tower, Villa, Row House, Duplex, Commercial. Types without floors generate flats as a flat sequence.",
    icon: Building2,
    group: "structure",
    columns: BLOCK_TYPE_COLUMNS,
    defaultSort: "name",
    searchPlaceholder: "Search block types…",
    csv: { columns: ["name", "code", "has_floors"], example: "Tower,TOWER,true" },
    createSchema: BlockTypeCreateSchema,
    defaults: () => ({ name: "", code: "", has_floors: true }),
    toValues: (row) => ({ name: row.name, code: row.code, has_floors: row.has_floors }),
    displayName: (row) => row.name,
    fields: [
      { name: "name", label: "Name", type: "text", required: true, placeholder: "Tower" },
      { name: "code", label: "Code", type: "code", required: true, placeholder: "TOWER", hint: `Standard codes: ${BLOCK_TYPE_CODES.join(", ")}` },
      { name: "has_floors", label: "Has floors", type: "switch", description: "Off for villas and row houses: flats are numbered in one sequence" },
    ],
  }),
  FLOOR_PLAN_TEMPLATES: defineMaster<FloorPlanTemplateRow, FloorPlanTemplateValues, z.output<typeof FloorPlanTemplateFormSchema>>({
    kind: "FLOOR_PLAN_TEMPLATES",
    slug: "floor-plan-templates",
    label: MASTER_KIND_LABELS.FLOOR_PLAN_TEMPLATES,
    singular: "Floor plan template",
    description: "Flats per floor with the flat type, facing and corner flag of every position. Blocks apply templates to floor ranges.",
    icon: LayoutTemplate,
    group: "structure",
    columns: FLOOR_PLAN_COLUMNS,
    defaultSort: "name",
    searchPlaceholder: "Search templates…",
    csv: { columns: ["name", "code", "position", "flat_type_code", "facing", "is_corner"], example: "Plan A,PLAN_A,1,3BHK_A,East,true" },
    createSchema: FloorPlanTemplateFormSchema,
    defaults: () => ({ name: "", code: "", flats_per_floor: 4, positions: resizePositions([], 4) }),
    toValues: (row) => ({
      name: row.name,
      code: row.code,
      flats_per_floor: row.positions.length,
      positions: [...row.positions].sort((a, b) => a.position - b.position).map((position) => ({ position: position.position, flat_type_id: position.flat_type_id, facing: position.facing, is_corner: position.is_corner })),
    }),
    displayName: (row) => `${row.name} (${row.code})`,
    Form: FloorPlanTemplateForm,
    sheetSize: "lg",
  }),
  AMENITIES: defineMaster<AmenityRow, AmenityValues, z.output<typeof AmenityCreateSchema>>({
    kind: "AMENITIES",
    slug: "amenities",
    label: MASTER_KIND_LABELS.AMENITIES,
    singular: "Amenity",
    description: "Clubhouse, pool, gym… assigned to projects and shown on the website.",
    icon: Sparkles,
    group: "structure",
    columns: AMENITY_COLUMNS,
    defaultSort: "name",
    searchPlaceholder: "Search amenities…",
    csv: { columns: ["name", "category", "icon"], example: "Swimming Pool,Leisure,waves" },
    createSchema: AmenityCreateSchema,
    defaults: () => ({ name: "", category: null, icon: null }),
    toValues: (row) => ({ name: row.name, category: row.category, icon: row.icon }),
    displayName: (row) => row.name,
    fields: [
      { name: "name", label: "Name", type: "text", required: true, placeholder: "Swimming Pool" },
      { name: "category", label: "Category", type: "text", nullable: true, placeholder: "Leisure", maxLength: 60 },
      { name: "icon", label: "Icon", type: "text", nullable: true, placeholder: "waves", hint: "Lucide icon name used by the website", maxLength: 60 },
    ],
  }),
  CONSTRUCTION_STAGES: defineMaster<ConstructionStageRow, ConstructionStageValues, z.output<typeof ConstructionStageCreateSchema>>({
    kind: "CONSTRUCTION_STAGES",
    slug: "construction-stages",
    label: MASTER_KIND_LABELS.CONSTRUCTION_STAGES,
    singular: "Construction stage",
    description: "The ordered list of physical stages every tower snapshots. Exactly one stage is the possession stage.",
    icon: Hammer,
    group: "structure",
    columns: CONSTRUCTION_STAGE_COLUMNS,
    defaultSort: "sort_order",
    searchPlaceholder: "Search stages…",
    csv: { columns: ["name", "code", "sort_order", "is_possession"], example: "Foundation,FOUNDATION,2,false" },
    createSchema: ConstructionStageCreateSchema,
    defaults: () => ({ name: "", code: "", sort_order: 0, is_possession: false }),
    toValues: (row) => ({ name: row.name, code: row.code, sort_order: row.sort_order, is_possession: row.is_possession }),
    displayName: (row) => row.name,
    fields: [
      { name: "name", label: "Stage", type: "text", required: true, placeholder: "1st Slab" },
      { name: "code", label: "Code", type: "code", required: true, placeholder: "SLAB_1" },
      { name: "sort_order", label: "Order", type: "number", fallback: 0, min: 0, max: 10_000, hint: "Position in the sequence; drag on the list to reorder" },
      { name: "is_possession", label: "Possession stage", type: "switch", description: "Completing it triggers ON_POSSESSION installments and charges" },
    ],
    Page: ConstructionStagesPage,
  }),
  PAYMENT_PLANS: defineMaster<PaymentPlanRow, PaymentPlanValues, z.output<typeof PaymentPlanCreateSchema>>({
    kind: "PAYMENT_PLANS",
    slug: "payment-plans",
    label: MASTER_KIND_LABELS.PAYMENT_PLANS,
    singular: "Payment plan",
    description: "Installment schedules (CLP, down payment, time-linked, flexi) whose percents sum to exactly 100.",
    icon: CalendarRange,
    group: "money",
    columns: PAYMENT_PLAN_COLUMNS,
    defaultSort: "name",
    searchPlaceholder: "Search plans…",
    csv: { columns: ["name", "code", "plan_type", "grace_days", "seq", "installment_name", "percent", "trigger_type", "trigger_days", "trigger_stage_code", "trigger_date", "due_days"], example: "Standard CLP,CLP_STD,CONSTRUCTION_LINKED,7,1,On booking,10,ON_BOOKING,,,,0" },
    createSchema: PaymentPlanCreateSchema,
    defaults: () => ({ name: "", code: "", plan_type: null, description: null, grace_days: 0, installments: [{ ...emptyInstallment(1), name: "On booking", trigger_type: "ON_BOOKING", due_days: 0 }] }),
    toValues: (row) => ({
      name: row.name,
      code: row.code,
      plan_type: row.plan_type,
      description: row.description,
      grace_days: row.grace_days,
      installments: [...row.installments]
        .sort((a, b) => a.seq - b.seq)
        .map((installment) => ({
          seq: installment.seq,
          name: installment.name,
          percent: installment.percent,
          trigger_type: installment.trigger_type,
          trigger_days: installment.trigger_days,
          trigger_stage_id: installment.trigger_stage_id,
          trigger_date: installment.trigger_date,
          due_days: installment.due_days,
          notes: installment.notes,
        })),
    }),
    displayName: (row) => `${row.name} (${row.code})`,
    Form: PaymentPlanForm,
    sheetSize: "xl",
  }),
  CHARGE_TYPES: defineMaster<ChargeTypeRow, ChargeTypeValues, z.output<typeof ChargeTypeCreateSchema>>({
    kind: "CHARGE_TYPES",
    slug: "charge-types",
    label: MASTER_KIND_LABELS.CHARGE_TYPES,
    singular: "Charge type",
    description: "Registry, maintenance deposit, parking, club membership… with default amount, GST and when the demand is raised.",
    icon: ReceiptText,
    group: "money",
    columns: CHARGE_TYPE_COLUMNS,
    defaultSort: "name",
    searchPlaceholder: "Search charges…",
    csv: { columns: ["name", "code", "default_amount", "is_taxable", "default_gst_percent", "demand_at"], example: "Maintenance Deposit,MAINT_DEP,50000,true,18,ON_POSSESSION" },
    createSchema: ChargeTypeCreateSchema,
    defaults: () => ({ name: "", code: "", default_amount_paise: 0, is_taxable: false, default_gst_percent: 0, demand_at: "MANUAL" }),
    toValues: (row) => ({ name: row.name, code: row.code, default_amount_paise: row.default_amount_paise, is_taxable: row.is_taxable, default_gst_percent: row.default_gst_percent, demand_at: row.demand_at }),
    displayName: (row) => row.name,
    Form: ChargeTypeForm,
  }),
  PAYMENT_MODES: defineMaster<PaymentModeRow, PaymentModeValues, z.output<typeof PaymentModeCreateSchema>>({
    kind: "PAYMENT_MODES",
    slug: "payment-modes",
    label: MASTER_KIND_LABELS.PAYMENT_MODES,
    singular: "Payment mode",
    description: "Cash, Cheque, NEFT/RTGS, UPI, DD, Loan disbursement — with instrument and clearing behaviour.",
    icon: Wallet,
    group: "money",
    columns: PAYMENT_MODE_COLUMNS,
    defaultSort: "sort_order",
    searchPlaceholder: "Search modes…",
    csv: { columns: ["name", "code", "requires_instrument", "clears_immediately", "is_cash", "sort_order"], example: "Cheque,CHEQUE,true,false,false,2" },
    createSchema: PaymentModeCreateSchema,
    defaults: () => ({ name: "", code: null, requires_instrument: false, clears_immediately: true, is_cash: false, sort_order: 0 }),
    toValues: (row) => ({ name: row.name, code: row.code, requires_instrument: row.requires_instrument, clears_immediately: row.clears_immediately, is_cash: row.is_cash, sort_order: row.sort_order }),
    displayName: (row) => `${row.name} (${PAYMENT_MODE_CODE_LABELS[row.code]})`,
    Form: PaymentModeForm,
  }),
  BANK_ACCOUNTS: defineMaster<BankAccountRow, BankAccountValues, z.output<typeof BankAccountCreateFormSchema>>({
    kind: "BANK_ACCOUNTS",
    slug: "bank-accounts",
    label: MASTER_KIND_LABELS.BANK_ACCOUNTS,
    singular: "Bank account",
    description: "Where collections land. Account numbers are encrypted at rest and only ever shown masked.",
    icon: Landmark,
    group: "money",
    columns: BANK_ACCOUNT_COLUMNS,
    defaultSort: "bank_name",
    searchPlaceholder: "Search bank or account name…",
    csv: { columns: ["bank_name", "branch", "account_name", "account_number", "ifsc", "is_default", "is_escrow"], example: "HDFC Bank,MG Road,Shree Ganesh Builders,50100123456789,HDFC0001234,true,false" },
    createSchema: BankAccountCreateFormSchema,
    editSchema: BankAccountEditFormSchema,
    defaults: () => ({ bank_name: "", branch: null, account_name: "", change_account_number: true, account_number: "", account_number_confirm: "", ifsc: "", is_default: false, is_escrow: false }),
    toValues: (row) => ({ bank_name: row.bank_name, branch: row.branch, account_name: row.account_name, change_account_number: false, account_number: "", account_number_confirm: "", ifsc: row.ifsc, is_default: row.is_default, is_escrow: row.is_escrow }),
    displayName: (row) => `${row.bank_name} ${row.account_number_masked}`,
    Form: BankAccountForm,
  }),
  DOCUMENT_TYPES: defineMaster<DocumentTypeRow, DocumentTypeValues, z.output<typeof DocumentTypeCreateSchema>>({
    kind: "DOCUMENT_TYPES",
    slug: "document-types",
    label: MASTER_KIND_LABELS.DOCUMENT_TYPES,
    singular: "Document type",
    description: "PAN, Aadhaar, Agreement, Allotment Letter, Receipt… and which entities they attach to.",
    icon: FileText,
    group: "documents",
    columns: DOCUMENT_TYPE_COLUMNS,
    defaultSort: "name",
    searchPlaceholder: "Search document types…",
    csv: { columns: ["name", "code", "applies_to", "is_kyc"], example: "PAN Card,PAN,CUSTOMER,true" },
    createSchema: DocumentTypeCreateSchema,
    defaults: () => ({ name: "", code: "", applies_to: [], is_kyc: false }),
    toValues: (row) => ({ name: row.name, code: row.code, applies_to: [...row.applies_to], is_kyc: row.is_kyc }),
    displayName: (row) => row.name,
    Form: DocumentTypeForm,
  }),
  PLC_TYPES: defineMaster<PlcTypeRow, PlcTypeValues, z.output<typeof PlcTypeCreateSchema>>({
    kind: "PLC_TYPES",
    slug: "plc-types",
    label: MASTER_KIND_LABELS.PLC_TYPES,
    singular: "PLC type",
    description: "Preferential location charges — floor rise, corner, park facing, Vastu… each with a calculation mode used by rate cards.",
    icon: Tags,
    group: "money",
    columns: PLC_TYPE_COLUMNS,
    defaultSort: "name",
    searchPlaceholder: "Search PLC types…",
    csv: { columns: ["name", "code", "calc_mode"], example: "Park Facing,PARK_FACING,PER_SQFT" },
    createSchema: PlcTypeCreateSchema,
    defaults: () => ({ name: "", code: "", calc_mode: null }),
    toValues: (row) => ({ name: row.name, code: row.code, calc_mode: row.calc_mode }),
    displayName: (row) => row.name,
    Form: PlcTypeForm,
  }),
  SPEC_CATEGORIES: defineMaster<SpecCategoryRow, SpecCategoryValues, z.output<typeof SpecCategoryCreateSchema>>({
    kind: "SPEC_CATEGORIES",
    slug: "spec-categories",
    label: MASTER_KIND_LABELS.SPEC_CATEGORIES,
    singular: "Specification category",
    description: "Flooring, Kitchen, Doors & Windows, Electrical, Bathroom, Paint… group the specification items.",
    icon: Layers,
    group: "structure",
    columns: SPEC_CATEGORY_COLUMNS,
    defaultSort: "sort_order",
    searchPlaceholder: "Search categories…",
    csv: { columns: ["name", "sort_order"], example: "Flooring,1" },
    createSchema: SpecCategoryCreateSchema,
    defaults: () => ({ name: "", sort_order: 0 }),
    toValues: (row) => ({ name: row.name, sort_order: row.sort_order }),
    displayName: (row) => row.name,
    fields: [
      { name: "name", label: "Category", type: "text", required: true, placeholder: "Flooring" },
      { name: "sort_order", label: "Sort order", type: "number", fallback: 0, min: 0, max: 10_000 },
    ],
  }),
  SPEC_ITEMS: defineMaster<SpecItemRow, SpecItemValues, z.output<typeof SpecItemCreateSchema>>({
    kind: "SPEC_ITEMS",
    slug: "spec-items",
    label: MASTER_KIND_LABELS.SPEC_ITEMS,
    singular: "Specification item",
    description: "The individual specification lines (vitrified tiles, modular kitchen…) attached to flat types.",
    icon: ListChecks,
    group: "structure",
    columns: SPEC_ITEM_COLUMNS,
    defaultSort: "sort_order",
    searchPlaceholder: "Search items…",
    csv: { columns: ["category_name", "name", "description", "sort_order"], example: "Flooring,Vitrified tiles 600×600,Kajaria or equivalent,1" },
    createSchema: SpecItemCreateSchema,
    defaults: () => ({ category_id: null, name: "", description: null, sort_order: 0 }),
    toValues: (row) => ({ category_id: row.category_id, name: row.name, description: row.description, sort_order: row.sort_order }),
    displayName: (row) => `${row.category_name} · ${row.name}`,
    Form: SpecItemForm,
  }),
  SERVICE_CATEGORIES: defineMaster<ServiceCategoryRow, ServiceCategoryValues, z.output<typeof ServiceCategoryCreateSchema>>({
    kind: "SERVICE_CATEGORIES",
    slug: "service-categories",
    label: MASTER_KIND_LABELS.SERVICE_CATEGORIES,
    singular: "Service category",
    description: "Plumbing, electrical, documentation… with the default priority (and therefore SLA) of new tickets.",
    icon: Wrench,
    group: "documents",
    columns: SERVICE_CATEGORY_COLUMNS,
    defaultSort: "sort_order",
    searchPlaceholder: "Search categories…",
    csv: { columns: ["name", "sort_order", "default_priority"], example: "Plumbing,1,HIGH" },
    createSchema: ServiceCategoryCreateSchema,
    defaults: () => ({ name: "", sort_order: 0, default_priority: "MEDIUM" }),
    toValues: (row) => ({ name: row.name, sort_order: row.sort_order, default_priority: row.default_priority }),
    displayName: (row) => row.name,
    fields: [
      { name: "name", label: "Category", type: "text", required: true, placeholder: "Plumbing" },
      { name: "default_priority", label: "Default priority", type: "select", required: true, options: SERVICE_PRIORITIES.map((value) => ({ value, label: SERVICE_PRIORITY_LABELS[value] })) },
      { name: "sort_order", label: "Sort order", type: "number", fallback: 0, min: 0, max: 10_000 },
    ],
  }),
};

/** Configs in MASTER_KINDS order (sidebar, tests). */
export const MASTER_CONFIG_LIST: readonly AnyMasterConfig[] = MASTER_KINDS.map((kind) => MASTER_CONFIGS[kind]);

const BY_SLUG = new Map<string, AnyMasterConfig>(MASTER_CONFIG_LIST.map((config) => [config.slug, config]));

/** Config for a URL segment (`/masters/:slug`), or undefined for an unknown slug. */
export function getMasterConfig(slug: string | undefined): AnyMasterConfig | undefined {
  return slug ? BY_SLUG.get(slug) : undefined;
}

/** `kindToSlug` re-exported next to the registry for convenience. */
export { kindToSlug };
export type { MasterSlug };
