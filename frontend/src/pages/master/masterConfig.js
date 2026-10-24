export const MASTERS = [
  { kind: "floor-plan-templates", label: "Floor Plans", custom: "floorPlan", columns: [
    { key: "name", label: "Name", sortable: true }, { key: "code", label: "Code" }, { key: "flats_per_floor", label: "Flats / floor", className: "tabular" },
    { key: "positions", label: "Positions", render: (r) => r.positions?.map((p) => `${p.position}${p.is_corner ? "◆" : ""}`).join(" ") }] },
  { kind: "plc-types", label: "PLC Types", fields: [
    { name: "name", label: "Name", type: "text", required: true }, { name: "code", label: "Code", type: "text", required: true, upper: true },
    { name: "calc", label: "Calculation", type: "select", required: true, options: ["per_sqft", "fixed", "percent"] }, { name: "description", label: "Description", type: "textarea" }, { name: "sort_order", label: "Sort order", type: "number" }],
    columns: [{ key: "sort_order", label: "#", className: "tabular w-12" }, { key: "name", label: "Name", sortable: true }, { key: "code", label: "Code" }, { key: "calc", label: "Calc" }] },
  { kind: "spec-categories", label: "Spec Categories", fields: [
    { name: "name", label: "Name", type: "text", required: true }, { name: "code", label: "Code", type: "text", required: true, upper: true }, { name: "sort_order", label: "Sort order", type: "number" }],
    columns: [{ key: "sort_order", label: "#", className: "tabular w-12" }, { key: "name", label: "Name", sortable: true }, { key: "code", label: "Code" }] },
  { kind: "spec-items", label: "Spec Items", fields: [
    { name: "name", label: "Name", type: "text", required: true }, { name: "spec_category_id", label: "Category", type: "master", master: "spec-categories", required: true },
    { name: "brand", label: "Brand", type: "text" }, { name: "description", label: "Description", type: "textarea" }],
    columns: [{ key: "name", label: "Name", sortable: true }, { key: "brand", label: "Brand", sortable: true }, { key: "description", label: "Description" }] },
  { kind: "flat-types", label: "Flat Types", custom: "flatType", columns: [
    { key: "name", label: "Name", sortable: true }, { key: "code", label: "Code" }, { key: "bhk", label: "BHK", className: "tabular" }, { key: "facing", label: "Facing" },
    { key: "rooms", label: "Rooms", render: (r) => r.rooms?.length }, { key: "areas", label: "Areas", render: (r) => r.areas?.length },
    { key: "base_rate_per_sqft", label: "Base rate", className: "tabular", render: (r) => r.base_rate_per_sqft ? `₹${r.base_rate_per_sqft}/sq.ft` : "—" },
    { key: "base_price", label: "Base price", className: "tabular", render: (r) => r.base_price ? `₹${new Intl.NumberFormat("en-IN").format(r.base_price)}` : "—" },
  ] },
  { kind: "room-types", label: "Room Types", fields: [
    { name: "name", label: "Name", type: "text", required: true }, { name: "code", label: "Code", type: "text", required: true, upper: true },
    { name: "icon", label: "Icon (lucide name)", type: "text" }, { name: "sort_order", label: "Sort order", type: "number" }],
    columns: [{ key: "sort_order", label: "#", className: "tabular w-12" }, { key: "name", label: "Name", sortable: true }, { key: "code", label: "Code", sortable: true }, { key: "icon", label: "Icon" }] },
  { kind: "area-types", label: "Area Types", fields: [
    { name: "name", label: "Name", type: "text", required: true }, { name: "code", label: "Code", type: "text", required: true, upper: true, hint: "CARPET, BUILTUP, SUPER_BUILTUP drive flat area hierarchy" }, { name: "sort_order", label: "Sort order", type: "number" }],
    columns: [{ key: "sort_order", label: "#", className: "tabular w-12" }, { key: "name", label: "Name", sortable: true }, { key: "code", label: "Code", sortable: true }] },
  { kind: "block-types", label: "Block Types", fields: [
    { name: "name", label: "Name", type: "text", required: true }, { name: "code", label: "Code", type: "text", required: true, upper: true }, { name: "has_floors", label: "Has floors", type: "switch", default: true }],
    columns: [{ key: "name", label: "Name", sortable: true }, { key: "code", label: "Code" }, { key: "has_floors", label: "Floors", render: (r) => r.has_floors ? "Multi-floor" : "Single" }] },
  { kind: "amenities", label: "Amenities", fields: [
    { name: "name", label: "Name", type: "text", required: true }, { name: "category", label: "Category", type: "select", required: true, options: ["Lifestyle", "Sports", "Safety", "Convenience", "Green"] },
    { name: "icon", label: "Icon (lucide name)", type: "text" }, { name: "description", label: "Description", type: "textarea" }],
    columns: [{ key: "name", label: "Name", sortable: true }, { key: "category", label: "Category", sortable: true }, { key: "icon", label: "Icon" }, { key: "description", label: "Description" }] },
  { kind: "milestone-templates", label: "Milestone Templates", custom: "milestone", columns: [
    { key: "name", label: "Name", sortable: true }, { key: "milestones", label: "Milestones", render: (r) => r.milestones?.length }, { key: "schedule", label: "Schedule", render: (r) => r.milestones?.map((m) => `${m.cumulative_percent}%`).join(" → ") }] },
  { kind: "charge-types", label: "Charge Types", fields: [
    { name: "name", label: "Name", type: "text", required: true }, { name: "code", label: "Code", type: "text", required: true, upper: true }, { name: "default_amount", label: "Default amount ₹", type: "number" },
    { name: "is_taxable", label: "Taxable", type: "switch" }, { name: "sort_order", label: "Sort order", type: "number" }],
    columns: [{ key: "sort_order", label: "#", className: "tabular w-12" }, { key: "name", label: "Name", sortable: true }, { key: "code", label: "Code" }, { key: "default_amount", label: "Default ₹", className: "tabular", render: (r) => r.default_amount ? new Intl.NumberFormat("en-IN").format(r.default_amount) : "—" }, { key: "is_taxable", label: "Taxable", render: (r) => r.is_taxable ? "Yes" : "No" }] },
  { kind: "payment-modes", label: "Payment Modes", fields: [
    { name: "name", label: "Name", type: "text", required: true }, { name: "code", label: "Code", type: "text", required: true, upper: true }, { name: "requires_reference", label: "Requires reference no.", type: "switch" }],
    columns: [{ key: "name", label: "Name", sortable: true }, { key: "code", label: "Code" }, { key: "requires_reference", label: "Reference", render: (r) => r.requires_reference ? "Required" : "Optional" }] },
  { kind: "bank-accounts", label: "Bank Accounts", fields: [
    { name: "bank_name", label: "Bank", type: "text", required: true }, { name: "account_name", label: "Account name", type: "text", required: true },
    { name: "account_number", label: "Account number", type: "text", required: true, hint: "Encrypted at rest; shown masked", createOnly: false }, { name: "ifsc", label: "IFSC", type: "text", required: true, upper: true },
    { name: "branch", label: "Branch", type: "text" }, { name: "is_default", label: "Default account", type: "switch" }],
    columns: [{ key: "bank_name", label: "Bank", sortable: true }, { key: "account_name", label: "Account name", sortable: true }, { key: "account_number_masked", label: "Account no.", className: "mono" }, { key: "ifsc", label: "IFSC" }, { key: "branch", label: "Branch" }, { key: "is_default", label: "Default", render: (r) => r.is_default ? "★" : "" }] },
  { kind: "document-types", label: "Document Types", fields: [
    { name: "name", label: "Name", type: "text", required: true }, { name: "code", label: "Code", type: "text", required: true, upper: true }, { name: "applies_to", label: "Applies to", type: "select", required: true, options: ["customer", "booking", "project"] }],
    columns: [{ key: "name", label: "Name", sortable: true }, { key: "code", label: "Code" }, { key: "applies_to", label: "Applies to" }] },
];
