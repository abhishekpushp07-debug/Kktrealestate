import { useEffect, useState } from "react";
import { conflictHandler } from "@/lib/api";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export function VersionConflictDialog() {
  const [data, setData] = useState(null);
  useEffect(() => { conflictHandler.fn = setData; return () => { conflictHandler.fn = null; }; }, []);
  return (
    <AlertDialog open={!!data} onOpenChange={(o) => !o && setData(null)}>
      <AlertDialogContent data-testid="version-conflict-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Record changed by someone else</AlertDialogTitle>
          <AlertDialogDescription>{data?.detail} {data?.current?.updated_at ? `Last updated ${new Date(data.current.updated_at).toLocaleString("en-IN")}.` : ""} Reload to see the latest version before editing again.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => window.location.reload()} className="bg-navy hover:bg-navy-700" data-testid="version-conflict-reload">Reload</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
