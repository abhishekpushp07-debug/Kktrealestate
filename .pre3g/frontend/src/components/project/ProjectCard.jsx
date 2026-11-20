import { Link } from "react-router-dom";
import { inr, inrShort } from "@/lib/format";
import { cn } from "@/lib/utils";

export function coverOf(p) {
  if (p.cover_image_url) return p.cover_image_url;
  if (/plan/i.test(p.status || "")) return "/covers/planning.jpg";
  if (/villa|plot|row/i.test(`${p.project_type || ""} ${p.name || ""}`))
    return "/covers/villas.jpg";
  return "/covers/towers.jpg";
}

const short = (minor) => inrShort((minor || 0) / 100);

/** REQ-177: project banner — figures from services/cards.py project_cards + unit_counts (tie-out). */
export function ProjectCard({ p, startSelling }) {
  const k = p.card || {};
  const u = p.unit_counts || {};
  const sold = (u.sold || 0) + (u.booked || 0);
  const testId = `project-card-${p.code}`;
  const photo = p.cover_image_url?.startsWith("/api/") ? p.cover_image_url : null; // owner photos only
  const caps = [p.name, p.address?.city].filter(Boolean).join(" · ");
  return (
    <article className={cn("e-pban", !photo && "e-pban-plain")} data-testid={testId}>
      {photo && <div className="ph" style={{ backgroundImage: `url("${photo}")` }} />}
      <div className="in">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="e-caps-gold !text-[#d4b477]">{caps}</span>
          {p.status && (
            <span className="e-pchip" data-testid={`${testId}-status`}>
              {p.status.toLowerCase()}
            </span>
          )}
        </div>
        <Link
          to={`/projects/${p.id}`}
          className="e-pst block hover:underline"
          data-testid={`${testId}-open`}
        >
          <span data-testid={`${testId}-inventory`}>
            {sold} of {u.total || 0}
            <span className="ml-2 text-[17px] font-semibold tracking-normal text-[#b4bdcd]">
              booked or sold
            </span>
          </span>
        </Link>
        {k.bookings ? (
          <p className="e-psub">
            <span data-testid={`${testId}-collected`} title={inr(k.collected_paise / 100)}>
              {short(k.collected_paise)} collected
            </span>
            {" · "}
            <span
              data-testid={`${testId}-outstanding`}
              title={inr(k.outstanding_paise / 100)}
              style={k.outstanding_paise ? { color: "#ff7a59" } : undefined}
            >
              {short(k.outstanding_paise)} outstanding
            </span>
          </p>
        ) : (
          <p className="e-psub">no bookings yet · {u.available || 0} flats ready to sell</p>
        )}
        {(k.towers || []).length > 0 && (
          <div className="e-ptowers" data-testid={`${testId}-towers`}>
            {k.towers.slice(0, 4).map((t) => (
              <div
                key={t.id}
                title={t.next_stage ? `next: ${t.next_stage}` : "all stages complete"}
              >
                {t.name.toLowerCase()} · {t.percent}%
                <i>
                  <b style={{ width: `${t.percent}%` }} />
                </i>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {k.bookings ? (
            <Link to={`/projects/${p.id}`} className="e-wbtn">
              Open project
            </Link>
          ) : (
            <Link to={startSelling} className="e-wbtn" data-testid={`${testId}-start-selling`}>
              Start selling
            </Link>
          )}
          <span className="e-obtn" data-testid={`${testId}-next`}>
            {k.next
              ? `next · ${k.next.stage} · ${k.next.tower}`
              : k.bookings
                ? "all stages complete"
                : "set up towers and prices"}
          </span>
        </div>
      </div>
    </article>
  );
}
