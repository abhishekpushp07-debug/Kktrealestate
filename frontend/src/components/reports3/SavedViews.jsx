import { useState } from "react";
import { Bookmark, Pin, Share2, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useFetch } from "@/hooks/useList";
import { useAuth } from "@/context/AuthContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** REQ-268: named views per user, optionally shared with the team, up to 6 pinned to Home. */
export function SavedViews({ reportKey, sp, apply }) {
  const { data, reload } = useFetch(`/reports/presets?report_key=${reportKey}`);
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [open, setOpen] = useState(false);
  const items = data?.items || [];
  const save = async () => {
    try {
      await api.post("/reports/presets", {
        report_key: reportKey,
        name: name.trim(),
        filters: Object.fromEntries(sp),
        shared,
      });
      toast.success("View saved");
      setName("");
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const patch = async (v, body) => {
    try {
      await api.patch(`/reports/presets/${v.id}`, body, { unversioned: true });
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const del = async (v) => {
    try {
      await api.delete(`/reports/presets/${v.id}`);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="r3-tool" data-testid="report-views-btn">
          <Bookmark className="h-4 w-4" /> Views{items.length ? ` · ${items.length}` : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="end" data-testid="report-views-menu">
        <p className="r3-flab mb-2">Save this view</p>
        <div className="flex gap-2">
          <input
            className="input h-9 flex-1 text-sm"
            placeholder="e.g. SGH overdue 30+"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="report-view-name"
          />
          <button
            type="button"
            className="r3-tool on"
            onClick={save}
            disabled={!name.trim()}
            title={name.trim() ? "Save" : "Give the view a name first"}
            data-testid="report-view-save"
          >
            Save
          </button>
        </div>
        <button
          type="button"
          className={`r3-fbtn mt-2 ${shared ? "on" : ""}`}
          onClick={() => setShared(!shared)}
          data-testid="report-view-shared"
        >
          <Users className="h-3.5 w-3.5" /> Share with team
        </button>
        <div className="mt-3 max-h-60 space-y-1 overflow-y-auto">
          {items.length === 0 && <p className="text-sm text-txt-muted">No saved views yet</p>}
          {items.map((v) => (
            <div
              key={v.id}
              className="flex items-center gap-1 rounded-lg px-1 py-1 hover:bg-black/5"
              data-testid={`report-view-${v.id}`}
            >
              <button
                type="button"
                className="flex-1 truncate text-left text-sm"
                onClick={() => {
                  apply(v.filters || {});
                  setOpen(false);
                }}
                data-testid={`report-view-open-${v.id}`}
              >
                {v.name}
                {v.shared && <Share2 className="ml-1 inline h-3 w-3 opacity-60" />}
              </button>
              {v.user_id === user?.id ? (
                <>
                  <button
                    type="button"
                    className={`r3-ico ${v.pinned ? "on" : ""}`}
                    title={v.pinned ? "Unpin from Home" : "Pin to Home (up to 6)"}
                    onClick={() => patch(v, { pinned: !v.pinned })}
                    data-testid={`report-view-pin-${v.id}`}
                  >
                    <Pin className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="r3-ico"
                    title="Delete view"
                    onClick={() => del(v)}
                    data-testid={`report-view-del-${v.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <span className="text-[10px] text-txt-muted">
                  shared by {v.created_by_name || "a teammate"}
                </span>
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
