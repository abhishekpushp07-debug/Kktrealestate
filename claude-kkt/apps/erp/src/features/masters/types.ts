import type { ColumnDef } from "@tanstack/react-table";
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import type { FieldPath, FieldValues } from "react-hook-form";
import type { MasterKind, MasterRow } from "@kkt/contracts";
import type { z } from "zod";
import type { SelectOption, SheetSize } from "@/components/ui";

type Hyphenate<S extends string> = S extends `${infer Head}_${infer Tail}` ? `${Head}-${Hyphenate<Tail>}` : S;

/** URL segment for a master kind: `FLOOR_PLAN_TEMPLATES` → `floor-plan-templates`. */
export type MasterSlug = Lowercase<Hyphenate<MasterKind>>;

export type MasterGroup = "structure" | "money" | "documents";

export const MASTER_GROUP_LABELS: Readonly<Record<MasterGroup, string>> = {
  structure: "Structure & specification",
  money: "Money & plans",
  documents: "Documents & service",
};

/* ------------------------------------------------------------------ */
/* Generic field definitions (simple kinds render from these)            */
/* ------------------------------------------------------------------ */

interface FieldBase<Values extends FieldValues> {
  name: FieldPath<Values>;
  label: string;
  hint?: string;
  required?: boolean;
  /** Span both columns of the form grid. */
  full?: boolean;
}

export interface TextFieldDef<Values extends FieldValues> extends FieldBase<Values> {
  type: "text" | "code" | "textarea";
  placeholder?: string;
  /** Empty input is stored as `null` instead of "". */
  nullable?: boolean;
  maxLength?: number;
}

export interface NumberFieldDef<Values extends FieldValues> extends FieldBase<Values> {
  type: "number";
  decimals?: number;
  min?: number;
  max?: number;
  suffix?: string;
  /** Value used when the input is cleared (default null). */
  fallback?: number | null;
}

export interface SwitchFieldDef<Values extends FieldValues> extends FieldBase<Values> {
  type: "switch";
  description?: string;
}

export interface SelectFieldDef<Values extends FieldValues> extends FieldBase<Values> {
  type: "select";
  options: readonly SelectOption[];
  placeholder?: string;
  allowClear?: boolean;
}

export type FieldDef<Values extends FieldValues> =
  TextFieldDef<Values> | NumberFieldDef<Values> | SwitchFieldDef<Values> | SelectFieldDef<Values>;

/* ------------------------------------------------------------------ */
/* Per-kind configuration                                               */
/* ------------------------------------------------------------------ */

export type MasterFormMode = "create" | "edit";

export interface MasterFormProps {
  mode: MasterFormMode;
  /** The record being edited (null when creating). */
  row: MasterRow | null;
}

export interface MasterPageProps {
  config: AnyMasterConfig;
}

export interface MasterConfig<Row extends MasterRow, Values extends FieldValues, Output> {
  kind: MasterKind;
  slug: MasterSlug;
  label: string;
  singular: string;
  description: string;
  icon: LucideIcon;
  group: MasterGroup;
  columns: ColumnDef<Row, unknown>[];
  defaultSort: string;
  searchPlaceholder: string;
  /** Validates the form state and yields the create payload. */
  createSchema: z.ZodType<Output>;
  /** Validates an edit (defaults to `createSchema`); the output is sent with `version`. */
  editSchema?: z.ZodType<Partial<Output> | Output>;
  defaults: () => Values;
  toValues: (row: Row) => Values;
  displayName: (row: Row) => string;
  /** Declarative fields for simple kinds. */
  fields?: readonly FieldDef<Values>[];
  /** Kind-specific form body (reads the form via `useFormContext`). */
  Form?: ComponentType<MasterFormProps>;
  /** Replaces the generic list page entirely (construction stages). */
  Page?: ComponentType<MasterPageProps>;
  sheetSize?: SheetSize;
}

/** The registry's erased shape: the list page is written once against this. */
export type AnyMasterConfig = MasterConfig<MasterRow, FieldValues, unknown>;

/** Erases the per-kind generics so configs can live in one registry (the only cast in the framework). */
export function defineMaster<Row extends MasterRow, Values extends FieldValues, Output>(
  config: MasterConfig<Row, Values, Output>,
): AnyMasterConfig {
  return config as unknown as AnyMasterConfig;
}
