import { Link } from "react-router-dom";
import { FileText, IndianRupee, MessageCircle, Phone, ScrollText } from "lucide-react";

/** Round outlined quick actions with lowercase labels (REQ-175). */
export function QuickActions({ c, can, onPay, more }) {
  const wa = (c.whatsapp_phone || c.phone || "").replace(/\D/g, "");
  const items = [
    can("finance.payment.create") && {
      key: "pay",
      label: "record payment",
      icon: IndianRupee,
      onClick: onPay,
    },
    c.phone && { key: "call", label: "call", icon: Phone, href: `tel:${c.phone}` },
    wa && { key: "wa", label: "whatsapp", icon: MessageCircle, href: `https://wa.me/${wa}` },
    { key: "statement", label: "statement", icon: ScrollText, to: `?tab=money` },
    { key: "docs", label: "documents", icon: FileText, to: `?tab=kyc` },
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap gap-5 pt-1" data-testid="quick-actions">
      {items.map((a) => {
        const inner = (
          <>
            <span className="e-ic !h-[52px] !w-[52px] transition-colors group-hover:border-gold-border group-hover:text-gold">
              <a.icon />
            </span>
            <span className="text-[12.5px] text-txt-secondary">{a.label}</span>
          </>
        );
        const cls = "group flex w-[76px] flex-col items-center gap-2 text-center";
        if (a.onClick)
          return (
            <button
              key={a.key}
              type="button"
              onClick={a.onClick}
              className={cls}
              data-testid={`qa-${a.key}`}
            >
              {inner}
            </button>
          );
        if (a.href)
          return (
            <a
              key={a.key}
              href={a.href}
              target={a.key === "wa" ? "_blank" : undefined}
              rel="noreferrer"
              className={cls}
              data-testid={`qa-${a.key}`}
            >
              {inner}
            </a>
          );
        return (
          <Link key={a.key} to={a.to} className={cls} data-testid={`qa-${a.key}`}>
            {inner}
          </Link>
        );
      })}
      {more}
    </div>
  );
}
