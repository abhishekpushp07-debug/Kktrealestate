import {
  Building2,
  Database,
  FileSignature,
  Home,
  Layers,
  Receipt,
  UserRound,
  Users,
} from "lucide-react";

export const ICON = {
  customers: UserRound,
  bookings: FileSignature,
  flats: Home,
  receipts: Receipt,
  projects: Building2,
  blocks: Layers,
  users: Users,
  flat_types: Database,
};
export const LABEL = {
  customers: "Customers",
  bookings: "Bookings",
  flats: "Flats",
  receipts: "Receipts",
  projects: "Projects",
  blocks: "Towers",
  users: "Users",
  flat_types: "Flat types",
};
// order the record groups the way people look for them
export const ORDER = [
  "customers",
  "bookings",
  "flats",
  "receipts",
  "projects",
  "blocks",
  "users",
  "flat_types",
];

export const title = (type, x) =>
  ({
    customers: x.full_name,
    bookings: `${x.booking_number} · ${x.customer_name || ""}`,
    receipts: `${x.receipt_number} · ${x.customer_name || ""}`,
  })[type] ||
  x.name ||
  x.flat_number ||
  x.email;

export const sub = (type, x) =>
  ({
    customers: [x.customer_code, x.phone].filter(Boolean).join(" · "),
    bookings: [x.flat_snapshot?.flat_number, x.block_name, x.status].filter(Boolean).join(" · "),
    receipts: [x.booking_number, x.flat_number, x.status].filter(Boolean).join(" · "),
  })[type] ?? [x.code || x.project_code || x.email, x.status].filter(Boolean).join(" · ");

export const href = (type, x) =>
  ({
    customers: `/customers/${x.id}`,
    bookings: `/bookings/${x.id}`,
    receipts: `/payments?receipt=${encodeURIComponent(x.receipt_number)}`,
    projects: `/projects/${x.id}`,
    blocks: `/blocks/${x.id}`,
    flats: `/blocks/${x.block_id}?flat=${x.id}`,
    users: "/users",
  })[type] || "/master/flat-types";
