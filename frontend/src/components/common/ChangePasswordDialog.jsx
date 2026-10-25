import { useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "./Bits";

export function ChangePasswordDialog({ open, onOpenChange }) {
  const [form, setForm] = useState({ current_password: "", new_password: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/auth/change-password", form);
      toast.success("Password changed");
      onOpenChange(false);
      setForm({ current_password: "", new_password: "" });
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="change-password-dialog">
        <DialogHeader><DialogTitle>Change password</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Current password" required><Input type="password" value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} data-testid="current-password-input" required /></Field>
          <Field label="New password" required hint="Min 8 chars, at least 1 letter and 1 number"><Input type="password" value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })} data-testid="new-password-input" required /></Field>
          <DialogFooter><Button type="submit" disabled={busy} className="bg-ink-950 hover:bg-ink-800" data-testid="change-password-submit">Update password</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
