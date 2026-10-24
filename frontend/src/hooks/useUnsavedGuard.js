import { useEffect } from "react";

/* Warns on tab close / reload while a form has unsaved changes. */
export function useUnsavedGuard(dirty, message = "You have unsaved changes. Leave this page?") {
  useEffect(() => {
    if (!dirty) return;
    const h = (e) => { e.preventDefault(); e.returnValue = message; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty, message]);
}
