import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/v2";
import { Select } from "@/components/v2/Select";
import { usePeople } from "@/components/v2/CustomerBits";
import { WhyDisabled } from "@/components/common/WhyDisabled";
import { showNextStep } from "@/components/common/NextStep";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const PRIORITIES = ["High", "Medium", "Low"].map((p) => ({ value: p, label: p }));

/** REQ-224: front desk raises a service request for a customer's booking (category, priority, assignee). */
export function NewServiceRequest({ open, onOpenChange, onSaved, customerId }) {
  const nav = useNavigate();
  const people = usePeople();
  const [q, setQ] = useState("");
  const [customers, setCustomers] = useState([]);
  const [cats, setCats] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [f, setF] = useState({ priority: "Medium", customer_id: customerId || null });
  const [pre, setPre] = useState(null);
  useEffect(() => {
    if (customerId) api.get(`/customers/${customerId}`).then((r) => setPre(r.data));
  }, [customerId]);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    api.get("/service-requests/categories").then((r) => setCats(r.data.items));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .get("/customers", { params: { search: q || undefined, page_size: 20 } })
        .then((r) => setCustomers(r.data.items));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    setBookings([]);
    if (!f.customer_id) return;
    api.get("/bookings", { params: { customer_id: f.customer_id, page_size: 50 } }).then((r) => {
      setBookings(r.data.items);
      if (r.data.items.length === 1) set("booking_id", r.data.items[0].id);
    });
  }, [f.customer_id]);
  const custOpts = useMemo(
    () =>
      [...(pre ? [pre] : []), ...customers.filter((c) => c.id !== pre?.id)].map((c) => ({
        value: c.id,
        label: c.full_name,
        sub: `${c.customer_code} · ${c.phone}`,
      })),
    [customers, pre],
  );
  const why = !f.customer_id
    ? "Pick the customer"
    : !f.booking_id
      ? bookings.length
        ? "Pick the booking"
        : "This customer has no booking"
      : !f.category
        ? "Pick the category"
        : (f.subject || "").trim().length < 3
          ? "Type a subject (at least 3 characters)"
          : (f.description || "").trim().length < 3
            ? "Describe the request"
            : null;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post("/service-requests", {
        ...f,
        subject: f.subject.trim(),
        description: f.description.trim(),
      });
      toast.success(`${r.data.ticket_number} created`);
      showNextStep({
        title: `${r.data.ticket_number} saved`,
        actions: [{ label: "Open the request", to: `/service-requests/${r.data.id}` }],
      });
      onSaved?.();
      onOpenChange(false);
      nav(`/service-requests/${r.data.id}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="v2 w-full overflow-y-auto bg-warm-50 sm:max-w-md"
        data-testid="sr-new-sheet"
      >
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">New service request</SheetTitle>
          <SheetDescription>
            Raised by the front desk for a customer&apos;s booking.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-5 space-y-4">
          <section className="space-y-3 rounded-2xl border border-warm-200 p-4">
            <h3 className="e-caps-blue">Customer</h3>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, phone or code"
              data-testid="sr-new-search"
            />
            <Select
              options={custOpts}
              value={f.customer_id}
              onChange={(v) => setF((p) => ({ ...p, customer_id: v, booking_id: null }))}
              allowAdd={false}
              testId="sr-new-customer"
            />
            <Field label="Booking" required>
              <Select
                options={bookings.map((b) => ({
                  value: b.id,
                  label: b.booking_number,
                  sub: `${b.project_name || ""} · ${b.flat_number || ""}`,
                }))}
                value={f.booking_id}
                onChange={(v) => set("booking_id", v)}
                allowAdd={false}
                disabled={!bookings.length}
                testId="sr-new-booking"
              />
            </Field>
          </section>
          <section className="space-y-3 rounded-2xl border border-warm-200 p-4">
            <h3 className="e-caps-blue">Request</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category" required>
                <Select
                  options={cats.map((c) => ({ value: c.name, label: c.name }))}
                  value={f.category}
                  onChange={(v) => set("category", v)}
                  allowAdd={false}
                  testId="sr-new-category"
                />
              </Field>
              <Field label="Priority" required>
                <Select
                  options={PRIORITIES}
                  value={f.priority}
                  onChange={(v) => set("priority", v || "Medium")}
                  allowAdd={false}
                  clearable={false}
                  testId="sr-new-priority"
                />
              </Field>
            </div>
            <Field label="Assign to">
              <Select
                options={people}
                value={f.assigned_to}
                onChange={(v) => set("assigned_to", v)}
                allowAdd={false}
                testId="sr-new-assignee"
              />
            </Field>
            <Field label="Subject" required>
              <Input
                value={f.subject || ""}
                onChange={(e) => set("subject", e.target.value)}
                data-testid="sr-new-subject"
              />
            </Field>
            <Field label="Details" required>
              <Textarea
                rows={4}
                value={f.description || ""}
                onChange={(e) => set("description", e.target.value)}
                data-testid="sr-new-description"
              />
            </Field>
          </section>
          <WhyDisabled reason={why} className="block" testId="sr-new-why">
            <Button
              variant="primary"
              className="w-full"
              disabled={!!why || busy}
              onClick={save}
              data-testid="sr-new-save"
            >
              {busy ? "Saving…" : "Create request"}
            </Button>
          </WhyDisabled>
        </div>
      </SheetContent>
    </Sheet>
  );
}
