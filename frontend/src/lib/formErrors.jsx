import { useCallback, useState } from "react";
import { errFields, errMsg } from "@/lib/api";

// Maps a 422 envelope (error.details[{field,message}]) onto form fields; returns helpers used by every form.
export function useFieldErrors() {
  const [fields, setFields] = useState({});
  const capture = useCallback((e) => {
    const f = errFields(e);
    setFields(f);
    return Object.keys(f).length ? `${errMsg(e)} — check the highlighted fields` : errMsg(e);
  }, []);
  const clear = useCallback((name) => setFields((p) => { if (!name) return {}; if (!(name in p)) return p; const n = { ...p }; delete n[name]; return n; }), []);
  return { fields, capture, clear, has: (n) => Boolean(fields[n]) };
}

export function FieldError({ name, fields }) {
  const msg = fields?.[name];
  if (!msg) return null;
  return <p className="mt-1 text-xs text-brick" role="alert" data-testid={`field-error-${name}`}>{msg}</p>;
}
