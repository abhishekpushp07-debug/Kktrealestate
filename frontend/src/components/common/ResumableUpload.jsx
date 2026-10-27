/* eslint-disable react/no-array-index-key -- positional editable rows without ids; data-derived keys would remount inputs on edit */
import { useRef, useState } from "react";
import { UploadCloud, RotateCcw } from "lucide-react";
import api, { errMsg } from "../../lib/api";
import { toast } from "sonner";

const PART = 5 * 1024 * 1024;
const fp = (f) => `kkt.upload.${f.name}.${f.size}.${f.lastModified}`;

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function uploadResumable(file, meta, onProgress) {
  let up = null;
  // localStorage: resumable upload id per file fingerprint — non-sensitive (CR-7)
  const saved = localStorage.getItem(fp(file));
  if (saved) { try { up = (await api.get(`/uploads/${saved}`)).data; } catch { localStorage.removeItem(fp(file)); } }
  if (!up || up.state !== "uploading") {
    up = (await api.post("/uploads/init", { filename: file.name, size: file.size, ...meta })).data;
    localStorage.setItem(fp(file), up.id);
  }
  const have = new Set(up.received_parts || []);
  for (let i = 1; i <= up.parts; i++) {
    if (!have.has(i)) {
      const buf = await file.slice((i - 1) * PART, i * PART).arrayBuffer();
      await api.put(`/uploads/${up.id}/parts/${i}`, buf, { headers: { "Content-Type": "application/octet-stream", "X-Part-Sha256": await sha256Hex(buf) } });
      have.add(i);
    }
    onProgress?.(Math.round((have.size / up.parts) * 100), i, up.parts);
  }
  const res = await api.post(`/uploads/${up.id}/complete`);
  localStorage.removeItem(fp(file));
  return res.data;
}

export function ResumableUpload({ meta, accept = "image/*,.pdf,.docx,.xlsx,.mp4", multiple = true, onDone, label = "Upload", testId = "resumable-upload" }) {
  const ref = useRef();
  const [rows, setRows] = useState([]);
  const run = async (files) => {
    const list = [...files];
    setRows(list.map((f) => ({ name: f.name, pct: 0, state: "uploading" })));
    for (let k = 0; k < list.length; k++) {
      const f = list[k];
      try {
        await uploadResumable(f, meta, (pct) => setRows((r) => r.map((x, i) => (i === k ? { ...x, pct } : x))));
        setRows((r) => r.map((x, i) => (i === k ? { ...x, pct: 100, state: "done" } : x)));
      } catch (e) {
        setRows((r) => r.map((x, i) => (i === k ? { ...x, state: "failed", error: errMsg(e), file: f } : x)));
        toast.error(`${f.name}: ${errMsg(e)}`);
      }
    }
    onDone?.();
  };
  const retry = (row) => row.file && run([row.file]);
  return (
    <div data-testid={testId}>
      <input ref={ref} type="file" className="hidden" accept={accept} multiple={multiple} data-testid={`${testId}-input`} onChange={(e) => { if (e.target.files.length) run(e.target.files); e.target.value = ""; }} />
      <button type="button" className="btn-secondary h-9 gap-2 text-sm" data-testid={`${testId}-button`} onClick={() => ref.current?.click()}><UploadCloud className="h-4 w-4" />{label}</button>
      {rows.length > 0 && (
        <ul className="mt-3 space-y-1.5" data-testid={`${testId}-progress`}>
          {rows.map((r, i) => (
            <li key={i} className="text-xs" data-testid={`${testId}-row-${i}`} data-state={r.state}>
              <div className="flex items-center justify-between gap-2"><span className="truncate">{r.name}</span><span className="tabular-nums">{r.state === "failed" ? "failed" : `${r.pct}%`}</span>
                {r.state === "failed" && <button type="button" className="inline-flex items-center gap-1 text-gold" onClick={() => retry(r)} data-testid={`${testId}-resume-${i}`}><RotateCcw className="h-3 w-3" />Resume</button>}</div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-ink-100"><div className={`h-full transition-[width] duration-200 ${r.state === "failed" ? "bg-red-500" : "bg-gold"}`} style={{ width: `${r.pct}%` }} /></div>
              {r.error && <p className="mt-0.5 text-red-600">{r.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
