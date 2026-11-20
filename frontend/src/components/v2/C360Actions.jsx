import { cn } from "@/lib/utils";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, Copy, IndianRupee, Mail, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SendReminderButton } from "@/components/common/SendReminderButton";
import { BASE_PATH } from "@/lib/api";

const jump = (onTab, tab, anchor) => {
  onTab(tab);
  if (anchor)
    setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth" }), 120);
};

/** REQ-120/121: main action = Record payment (active booking) else New booking; More = Edit, Co-applicants, Statements. */
export function C360Actions({
  c,
  active,
  can,
  onPay,
  onNote,
  onTab,
  portal,
  headerOnly,
  round,
  onCopy,
  onLifecycle,
  superAdmin,
}) {
  const all = c.bookings || [];
  const nav = useNavigate();
  // root A: one action set — the round quick actions carry pay/call/whatsapp + "more"; the header keeps only New booking
  if (headerOnly)
    return !active[0] && can("sales.booking.create") ? (
      <Link
        to={`/bookings/new?customer_id=${c.id}`}
        className="btn btn-primary"
        data-testid="c360-main-new-booking"
      >
        <Plus className="h-4 w-4" /> New booking
      </Link>
    ) : null;
  return (
    <div
      className={cn("flex flex-wrap gap-1.5 print:hidden", round ? "items-start" : "items-center")}
      data-testid="customer-context-actions"
    >
      {round ? null : active[0] && can("finance.payment.create") ? (
        <Button onClick={onPay} className="btn btn-primary" data-testid="hero-post-payment">
          <IndianRupee className="h-4 w-4" strokeWidth={1.75} /> Record payment
        </Button>
      ) : (
        can("sales.booking.create") && (
          <Link
            to={`/bookings/new?customer_id=${c.id}`}
            className="btn btn-primary"
            data-testid="c360-main-new-booking"
          >
            <Plus className="h-4 w-4" /> New booking
          </Link>
        )
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {round ? (
            <button
              type="button"
              className="group flex w-[76px] flex-col items-center gap-2 text-center"
              data-testid="c360-more-btn"
            >
              <span className="e-ic !h-[52px] !w-[52px] transition-colors group-hover:border-gold-border group-hover:text-gold">
                <MoreHorizontal />
              </span>
              <span className="text-[12.5px] text-txt-secondary">more</span>
            </button>
          ) : (
            <Button variant="outline" className="btn btn-secondary" data-testid="c360-more-btn">
              More <ChevronDown className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64" data-testid="c360-more-menu">
          {onCopy && (
            <DropdownMenuItem onSelect={onCopy} data-testid="qa-copy-phone">
              <Copy className="h-4 w-4" /> Copy phone number
            </DropdownMenuItem>
          )}
          {c.email && (
            <DropdownMenuItem asChild>
              <a href={`mailto:${c.email}`} data-testid="qa-email">
                <Mail className="h-4 w-4" /> Email {c.email}
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={!can("sales.customer.edit")}
            onSelect={() => nav(`/customers/${c.id}/edit`)}
            data-testid="customer-edit-btn"
          >
            Edit customer
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => jump(onTab, "kyc", "coapplicants")}
            data-testid="c360-more-coapplicants"
          >
            Co-applicants
          </DropdownMenuItem>
          {can("sales.booking.create") && active[0] && (
            <DropdownMenuItem
              onSelect={() => nav(`/bookings/new?customer_id=${c.id}`)}
              data-testid="c360-more-new-booking"
            >
              New booking
            </DropdownMenuItem>
          )}
          {can("documents.document.generate") && active[0] && (
            <DropdownMenuItem
              onSelect={() =>
                nav(
                  `/documents?booking_id=${active[0].id}&project_id=${active[0].project_id}&block_id=${active[0].block_id}`,
                )
              }
              data-testid="qa-generate-doc"
            >
              Generate document
            </DropdownMenuItem>
          )}
          {can("sales.customer.edit") && (
            <DropdownMenuItem onSelect={onNote} data-testid="qa-add-note">
              Add note
            </DropdownMenuItem>
          )}
          {can("service.ticket.create") && (
            <DropdownMenuItem
              onSelect={() => nav(`/service-requests?new=1&customer_id=${c.id}`)}
              data-testid="qa-new-ticket"
            >
              New ticket
            </DropdownMenuItem>
          )}
          {can("sales.visit.create") && (
            <DropdownMenuItem
              onSelect={() => nav(`/site-visits?new=1&customer_id=${c.id}`)}
              data-testid="qa-schedule-visit"
            >
              Schedule visit
            </DropdownMenuItem>
          )}
          {portal && (
            <DropdownMenuItem
              onSelect={() => jump(onTab, "kyc", "c360-portal")}
              data-testid="c360-more-portal"
            >
              Customer portal access
            </DropdownMenuItem>
          )}
          {onLifecycle && can("sales.customer.edit") && !c.merged_into && (
            <>
              <DropdownMenuSeparator />
              {c.is_active === false ? (
                <DropdownMenuItem
                  onSelect={() => onLifecycle("reactivate")}
                  data-testid="c360-reactivate"
                >
                  Reactivate customer
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  disabled={active.length > 0}
                  onSelect={() => onLifecycle("deactivate")}
                  className="flex-col items-start gap-0.5 data-[disabled]:opacity-100"
                  data-testid="c360-deactivate"
                >
                  <span className={active.length ? "text-txt-muted" : ""}>Deactivate customer</span>
                  {active.length > 0 && (
                    <span
                      className="text-xs text-txt-secondary"
                      data-testid="c360-deactivate-reason"
                    >
                      Has a live booking ({active[0].booking_number})
                    </span>
                  )}
                </DropdownMenuItem>
              )}
              {superAdmin && (
                <DropdownMenuItem onSelect={() => onLifecycle("merge")} data-testid="c360-merge">
                  Merge a duplicate into this customer
                </DropdownMenuItem>
              )}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-txt-muted">Statements</DropdownMenuLabel>
          {all.length === 0 && <DropdownMenuItem disabled>No bookings yet</DropdownMenuItem>}
          {all.map((b) => (
            <DropdownMenuItem
              key={b.id}
              onSelect={() => window.open(`${BASE_PATH}/print/statement/${b.id}`, "_blank")}
              data-testid={`c360-more-statement-${b.booking_number}`}
            >
              {b.booking_number} · {b.flat_number || b.flat_snapshot?.flat_number || b.status}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function MoneyToolbar({ active, can }) {
  const b = active[0];
  return (
    <div className="mb-4 flex flex-wrap justify-end gap-2" data-testid="c360-money-toolbar">
      {can("demands.register.create") && b && (
        <Link
          to={`/demands?new=manual&project_id=${b.project_id}&block_id=${b.block_id}&booking_id=${b.id}`}
          className="btn btn-secondary btn-sm"
          data-testid="c360-raise-demand"
        >
          Raise manual bill
        </Link>
      )}
      {can("messaging.message.send") && b && (
        <SendReminderButton
          bookingId={b.id}
          testId="ca-send-reminder-btn"
          className="btn btn-secondary btn-sm"
        />
      )}
    </div>
  );
}

export function DocsToolbar({ c, active, can }) {
  const b = active[0];
  if (!can("documents.document.generate")) return null;
  return (
    <div className="mb-4 flex justify-end" data-testid="c360-docs-toolbar">
      <Link
        to={
          `/documents?mode=generate&customer_id=${c.id}` +
          (b ? `&project_id=${b.project_id}&block_id=${b.block_id}&booking_id=${b.id}` : "")
        }
        className="btn btn-secondary btn-sm"
        data-testid="c360-generate-document"
      >
        Generate document
      </Link>
    </div>
  );
}
