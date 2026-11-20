import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useList, useMasterOptions } from "@/hooks/useList";
import { inr, sqft } from "@/lib/format";
import { DataTable } from "@/components/common/DataTable";
import { StatusChip } from "@/components/common/StatusChip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FlatDrawer } from "@/components/common/FlatDrawer";

const STATUSES = ["Available", "Hold", "Booked", "Sold", "Blocked"];

// Filters a Home figure put in the URL (only on the stand-alone Inventory page).
function useUrlFilters(fixed) {
  const [sp] = useSearchParams();
  const own = !fixed.block_id && !fixed.project_id;
  const get = (k) => (own ? sp.get(k) : null);
  const hold = get("hold_expiring") === "1";
  return {
    status: get("status") || "all",
    blockId: get("block_id") || "all",
    extra: {
      ...(hold ? { hold_expiring: true } : {}),
      ...(get("project_id") ? { project_id: get("project_id") } : {}),
    },
  };
}

export default function FlatsTable({ fixed = {}, blocks }) {
  const url = useUrlFilters(fixed);
  const [status, setStatus] = useState(url.status);
  const [blockId, setBlockId] = useState(url.blockId);
  const [flatType, setFlatType] = useState("all");
  const [selected, setSelected] = useState(null);
  const { options: ftOptions } = useMasterOptions("flat-types");
  const list = useList(
    "/flats",
    {
      ...fixed,
      ...url.extra,
      status: status === "all" ? undefined : status,
      block_id: blockId === "all" ? undefined : blockId,
      flat_type_id: flatType === "all" ? undefined : flatType,
    },
    { pageSize: 200, sort: "floor" },
  );
  const columns = [
    {
      key: "flat_number",
      label: "Flat",
      sortable: true,
      render: (f) => <span className="font-bold text-ink-950">{f.flat_number}</span>,
    },
    ...(fixed.project_id
      ? []
      : [
          {
            key: "project_name",
            label: "Project",
            render: (f) => (
              <Link
                to={`/projects/${f.project_id}`}
                className="hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {f.project_code}
              </Link>
            ),
          },
        ]),
    {
      key: "block_name",
      label: "Block",
      render: (f) => (
        <Link
          to={`/blocks/${f.block_id}`}
          className="hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {f.block_name}
        </Link>
      ),
    },
    { key: "floor", label: "Floor", sortable: true, className: "tabular" },
    { key: "flat_type_code", label: "Type" },
    { key: "facing", label: "Facing" },
    {
      key: "saleable_sqft",
      label: "Saleable area",
      sortable: true,
      className: "tabular",
      render: (f) =>
        f.saleable_sqft ? sqft(f.saleable_sqft) : <span className="text-brick">Not set</span>,
    },
    {
      key: "price",
      label: "Price",
      sortable: true,
      className: "tabular text-right",
      render: (f) => <span className="font-semibold">{inr(f.price)}</span>,
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (f) => <StatusChip status={f.status} />,
    },
  ];
  const toolbar = (
    <>
      {blocks && (
        <Select value={blockId} onValueChange={setBlockId}>
          <SelectTrigger className="h-9 w-40" data-testid="flats-block-filter">
            <SelectValue placeholder="Block" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All blocks</SelectItem>
            {blocks.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select value={flatType} onValueChange={setFlatType}>
        <SelectTrigger className="h-9 w-40" data-testid="flats-type-filter">
          <SelectValue placeholder="Flat type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          {ftOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="h-9 w-36" data-testid="flats-status-filter">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
  return (
    <>
      <DataTable
        {...list}
        columns={columns}
        toolbar={toolbar}
        testId="flats-table"
        exportPath="/flats"
        searchPlaceholder="Flat number or type…"
        onRowClick={(f) => setSelected(f.id)}
      />
      <FlatDrawer
        flatId={selected}
        onClose={() => setSelected(null)}
        onChanged={() => list.reload()}
      />
    </>
  );
}
