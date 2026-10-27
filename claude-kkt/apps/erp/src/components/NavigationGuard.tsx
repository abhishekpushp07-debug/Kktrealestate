import { useEffect } from "react";
import { useBlocker } from "react-router-dom";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { hasUnsavedChanges, shouldBlockNavigation, subscribeUnsaved } from "@/lib/unsaved";

/**
 * The app's single navigation blocker (needs the data router): while any registered form is dirty (lib/unsaved.ts), leaving the
 * page in-app asks "Leave without saving?" and a reload / tab close triggers the browser's own prompt.
 */
export function NavigationGuardHost() {
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    shouldBlockNavigation(currentLocation, nextLocation),
  );

  // beforeunload only while something is dirty (an always-on handler disables the bfcache).
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome < 119 and Safari need returnValue set.
      event.returnValue = "";
    };
    let attached = false;
    const sync = () => {
      const dirty = hasUnsavedChanges();
      if (dirty && !attached) window.addEventListener("beforeunload", handler);
      if (!dirty && attached) window.removeEventListener("beforeunload", handler);
      attached = dirty;
    };
    sync();
    const unsubscribe = subscribeUnsaved(sync);
    return () => {
      unsubscribe();
      if (attached) window.removeEventListener("beforeunload", handler);
    };
  }, []);

  return (
    <ConfirmDialog
      open={blocker.state === "blocked"}
      onOpenChange={(open) => {
        if (!open && blocker.state === "blocked") blocker.reset();
      }}
      title="Leave without saving?"
      description="You have unsaved changes on this page. If you leave now they will be lost."
      confirmLabel="Leave and discard"
      cancelLabel="Stay on this page"
      variant="destructive"
      onConfirm={() => {
        if (blocker.state === "blocked") blocker.proceed();
      }}
    />
  );
}
