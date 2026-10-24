import { PageHeader } from "@/components/common/Bits";
import FlatsTable from "@/components/common/FlatsTable";

export default function Flats() {
  return (
    <div data-testid="flats-page">
      <PageHeader title="Inventory" subtitle="All flats across projects. Filter by block, type and status." />
      <FlatsTable />
    </div>
  );
}
