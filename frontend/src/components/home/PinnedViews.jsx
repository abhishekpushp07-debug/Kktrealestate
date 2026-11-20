import { Link } from "react-router-dom";
import { Pin } from "lucide-react";
import { useFetch } from "@/hooks/useList";
import { useAuth } from "@/context/AuthContext";

/** REQ-268: up to 6 report views pinned to Home — one tap opens the exact filtered view. */
export function PinnedViews() {
  const { can } = useAuth();
  const { data } = useFetch(
    can("reports.collections.view") || can("reports.outstanding.view") ? "/reports/presets" : null,
  );
  const pins = (data?.items || []).filter((v) => v.pinned).slice(0, 6);
  if (!pins.length) return null;
  return (
    <section data-testid="home-pinned-views">
      <div className="e-sec">
        <h2>
          Pinned reports<span className="e-count">{pins.length}</span>
        </h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {pins.map((v) => (
          <Link
            key={v.id}
            to={`/reports/v3/${v.report_key}?${new URLSearchParams(v.filters || {})}`}
            className="r3-fbtn on"
            data-testid={`home-pin-${v.id}`}
          >
            <Pin className="h-3.5 w-3.5" /> {v.name}
          </Link>
        ))}
      </div>
    </section>
  );
}
