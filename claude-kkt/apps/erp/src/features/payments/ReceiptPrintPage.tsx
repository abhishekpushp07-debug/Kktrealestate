import { useParams } from "react-router-dom";
import { PrintFrame } from "./print";
import { ReceiptView } from "./ReceiptView";
import { useReceipt } from "./api";

/** `/print/receipt/:id` — the receipt on its own page (outside the shell), auto-prints with `?autoprint=1`. */
export default function ReceiptPrintPage() {
  const { id } = useParams<{ id: string }>();
  const receipt = useReceipt(id);
  const title = receipt.data ? `Receipt ${receipt.data.receipt_number}` : "Receipt";
  return (
    <PrintFrame
      title={title}
      loading={receipt.isPending}
      error={receipt.error}
      onRetry={() => void receipt.refetch()}
      pdfPath={id ? `/payments/${id}/receipt.pdf` : undefined}
      pdfFileName={`${title.replace(/[\\/]/g, "-")}.pdf`}
      backTo="/payments"
      backLabel="Payments"
      autoPrintReady={Boolean(receipt.data)}
    >
      {receipt.data && <ReceiptView receipt={receipt.data} />}
    </PrintFrame>
  );
}
