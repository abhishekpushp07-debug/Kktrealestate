import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { isTrackedEdit, subscribeSaved, useUnsavedChangesGuard } from "@/lib/unsaved";
import { ConfirmDialog } from "./confirm-dialog";

export interface DirtyCloseOptions {
  /** The form's own dirty flag (e.g. react-hook-form `formState.isDirty`). When omitted, any edit inside counts as dirty. */
  dirty?: boolean;
  /** false = never ask (read-only drawers, pickers). Default true. */
  guard?: boolean;
}

export interface DirtyCloseGuard {
  dirty: boolean;
  /** Esc / outside-click / close-button handler: prevents the close and asks while dirty. */
  intercept: (event: { preventDefault: () => void; defaultPrevented?: boolean }) => void;
  /** onInputCapture / onChangeCapture of the content: notes the first edit. */
  trackEdit: (event: SyntheticEvent) => void;
  /** Render inside the Radix content: the confirm prompt and the hidden Close the prompt clicks to really close. */
  elements: ReactNode;
}

/**
 * Shared by SheetContent and DialogContent: a sheet or dialog hosting a form asks "Discard unsaved changes?" before it closes on
 * Esc, an outside click or the close button while its form is dirty, and keeps in-app navigation blocked meanwhile (the
 * registry in lib/unsaved.ts). Programmatic closes (after a successful save, a Cancel button) are not intercepted.
 */
export function useDirtyClose({ dirty: dirtyProp, guard = true }: DirtyCloseOptions): DirtyCloseGuard {
  const [edited, setEdited] = useState(false);
  const [asking, setAsking] = useState(false);
  // SheetContent / DialogContent stay mounted while the sheet is closed (only the Radix content unmounts), so the guard counts only
  // while the content is open: the probe below lives inside the content and reports its mount; closing forgets the edits.
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dirty = guard && open && (dirtyProp ?? edited);
  const registry = useUnsavedChangesGuard(dirty);
  // A successful save (any mutation) applies the edits made so far: "any edit" tracking starts over.
  useEffect(() => subscribeSaved(() => setEdited(false)), []);

  return {
    dirty,
    intercept: (event) => {
      if (!dirty || event.defaultPrevented) return;
      event.preventDefault();
      setAsking(true);
    },
    trackEdit: (event) => {
      // Only the user's own edits count: Radix Select's hidden native <select> and form libraries dispatch synthetic (untrusted)
      // change events when a value is set programmatically (e.g. a drawer loading its record), which must not mark the form dirty.
      if (event.nativeEvent.isTrusted === false) return;
      if (guard && dirtyProp === undefined && !edited && isTrackedEdit(event.target)) setEdited(true);
    },
    elements: (
      <>
        <OpenProbe
          onChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) {
              setEdited(false);
              setAsking(false);
            }
          }}
        />
        <DialogPrimitive.Close ref={closeRef} hidden tabIndex={-1} aria-hidden="true" data-dirty-close="" />
        <ConfirmDialog
          open={asking}
          onOpenChange={setAsking}
          title="Discard unsaved changes?"
          description="You have changed this form. Closing it now loses those changes."
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          variant="destructive"
          onConfirm={() => {
            registry.allowNavigation();
            setEdited(false);
            closeRef.current?.click();
          }}
        />
      </>
    ),
  };
}

/** Rendered inside the Radix content: reports when the sheet / dialog content mounts (opens) and unmounts (closes). */
function OpenProbe({ onChange }: { onChange: (open: boolean) => void }): null {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    latest.current(true);
    return () => latest.current(false);
  }, []);
  return null;
}
