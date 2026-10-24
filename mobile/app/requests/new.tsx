import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useBookings } from "@/src/hooks";
import { api, buildForm, errMsg } from "@/src/api/client";
import { haptic } from "@/src/haptics";
import type { LocalFile } from "@/src/utils/upload";
import { Screen, PageHeader } from "@/src/ui/screen";
import { Button, Card } from "@/src/ui/primitives";
import { ChoiceChips, Field } from "@/src/ui/field";
import { T } from "@/src/ui/text";
import { SkeletonList } from "@/src/ui/skeleton";
import { ErrorState, NoBooking } from "@/src/ui/states";
import { AttachmentPicker } from "@/src/ui/attachments";
import { Pills } from "@/src/ui/pills";
import { toast } from "@/src/ui/toast";

export default function NewRequest() {
  const router = useRouter();
  const qc = useQueryClient();
  const bookings = useBookings();
  const cats = useQuery({ queryKey: ["p-cats"], queryFn: () => api.get<{ items: { id: string; name: string }[] }>("/service-categories").then((r) => r.items) });
  const [bookingId, setBookingId] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ subject?: string; description?: string; category?: string }>({});
  const bk = bookings.data || [];
  const selBooking = bookingId || bk[0]?.id || "";

  const submit = async () => {
    const e: typeof err = {};
    if (!category) e.category = "Choose what this is about";
    if (subject.trim().length < 3) e.subject = "Add a short subject (3+ characters)";
    if (description.trim().length < 3) e.description = "Tell us a little more";
    setErr(e);
    if (Object.keys(e).length) return haptic.error();
    setBusy(true);
    try {
      const fd = await buildForm({ booking_id: selBooking, category, priority, subject: subject.trim(), description: description.trim() }, files);
      const sr = await api.form<{ id: string; ticket_number: string }>("/service-requests", fd);
      haptic.success();
      toast.success(`Ticket ${sr.ticket_number} raised`);
      qc.invalidateQueries({ queryKey: ["p-requests"] });
      router.replace(`/requests/${sr.id}`);
    } catch (x) {
      haptic.error();
      toast.error(errMsg(x, "Could not submit the request"));
    } finally {
      setBusy(false);
    }
  };

  const loading = bookings.isLoading || cats.isLoading;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <Screen testID="new-request-screen">
        <PageHeader back title="Raise a request" sub="We usually reply within one working day." />
        {loading ? (
          <SkeletonList rows={3} h={90} />
        ) : cats.isError || bookings.isError ? (
          <ErrorState message={errMsg(cats.error || bookings.error)} onRetry={() => (cats.refetch(), bookings.refetch())} />
        ) : !bk.length ? (
          <NoBooking />
        ) : (
          <Card style={{ gap: 18, padding: 20 }} testID="new-request-form">
            {bk.length > 1 ? (
              <View style={{ gap: 8 }}>
                <T v="label" tone="muted">Booking</T>
                <Pills testIDPrefix="nr-booking" items={bk.map((b) => ({ key: b.id, label: `${b.flat_number} · ${b.project_name}` }))} value={selBooking} onChange={setBookingId} />
              </View>
            ) : null}
            <View style={{ gap: 8 }}>
              <T v="label" tone="muted">Category</T>
              <ChoiceChips testIDPrefix="nr-category" options={(cats.data || []).map((c) => c.name)} value={category} onChange={setCategory} />
              {err.category ? <T v="small" tone="error" testID="nr-category-error">{err.category}</T> : null}
            </View>
            <View style={{ gap: 8 }}>
              <T v="label" tone="muted">Priority</T>
              <ChoiceChips testIDPrefix="nr-priority" options={["Low", "Medium", "High"]} value={priority} onChange={setPriority} />
            </View>
            <Field label="Subject" placeholder="e.g. Receipt for NEFT not received" value={subject} onChangeText={setSubject} maxLength={120} error={err.subject} testID="nr-subject-input" />
            <Field label="Describe the issue" placeholder="Share details, dates, amounts or location on site" value={description} onChangeText={setDescription} multiline maxLength={4000} error={err.description} testID="nr-description-input" />
            <View style={{ gap: 8 }}>
              <T v="label" tone="muted">Photos</T>
              <AttachmentPicker files={files} onChange={setFiles} testIDPrefix="nr-attach" />
            </View>
            <Button label={busy ? "Submitting…" : "Submit request"} icon="send" loading={busy} onPress={submit} testID="nr-submit-button" />
          </Card>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
