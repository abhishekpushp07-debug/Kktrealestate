import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { SERVICE_PRIORITY_LABELS } from "@kkt/contracts";
import { errorMessage, newIdempotencyKey } from "@/api/client";
import { useCreateRequest, useRequestCategories } from "@/api/queries";
import { useBooking } from "@/booking/BookingProvider";
import type { LocalFile } from "@/lib/upload";
import { AttachmentPicker } from "@/ui/Attachments";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { Field, SelectField } from "@/ui/Field";
import { Header, Screen } from "@/ui/Screen";
import { OptionRow, Sheet } from "@/ui/Sheet";
import { ErrorState, Notice } from "@/ui/States";
import { T } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { colors, space } from "@/ui/theme";

export function RequestCreateScreen(): React.JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const { bookings, bookingId, current } = useBooking();
  const categories = useRequestCategories();
  const create = useCreateRequest();
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [targetBooking, setTargetBooking] = useState<string | null>(bookingId);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [picker, setPicker] = useState<"category" | "booking" | null>(null);
  const [errors, setErrors] = useState<{ category?: string; subject?: string; description?: string; form?: string }>({});

  const category = useMemo(() => categories.data?.find((c) => c.id === categoryId) ?? null, [categories.data, categoryId]);
  const booking = bookings.find((b) => b.booking_id === (targetBooking ?? bookingId)) ?? current;

  const submit = async () => {
    const next: typeof errors = {};
    if (!categoryId) next.category = "Pick a category.";
    if (subject.trim().length < 3) next.subject = "Give your request a short subject (3+ characters).";
    if (description.trim().length < 1) next.description = "Tell us a little more.";
    if (!booking) next.form = "Select the booking this request is about.";
    setErrors(next);
    if (Object.keys(next).length || !booking || !categoryId) return;
    try {
      const { detail, failed } = await create.mutateAsync({ body: { booking_id: booking.booking_id, category_id: categoryId, subject: subject.trim(), description: description.trim(), attachment_ids: [] }, files, idempotencyKey });
      if (failed.length) toast.error(`Request raised, but ${failed.length} photo${failed.length > 1 ? "s" : ""} failed to upload. You can add them from the request.`);
      else toast.success(`Request ${detail.ticket_number} raised`);
      router.replace(`/more/requests/${detail.id}`);
    } catch (e) {
      setErrors({ form: errorMessage(e, "Could not raise the request.") });
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <Header title="Raise a request" subtitle={booking ? `${booking.flat_number} · ${booking.block_name}` : undefined} back />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Screen>
          <Card style={{ gap: space.lg, maxWidth: 640 }}>
            {errors.form ? <Notice tone="danger" body={errors.form} /> : null}
            {bookings.length > 1 ? <SelectField label="Booking" value={booking ? `${booking.flat_number} · ${booking.block_name} · ${booking.project_name}` : null} onPress={() => setPicker("booking")} /> : null}
            {categories.isError && !categories.data ? (
              <ErrorState error={categories.error} title="Categories unavailable" onRetry={() => void categories.refetch()} style={{ paddingVertical: space.md }} />
            ) : (
              <SelectField label="Category" value={category?.name ?? null} placeholder={categories.isPending ? "Loading categories…" : "What is this about?"} onPress={() => setPicker("category")} error={errors.category} disabled={categories.isPending} />
            )}
            {category ? (
              <View style={styles.priorityRow}>
                <T variant="caption" color={colors.inkMuted}>
                  Priority
                </T>
                <Chip label={SERVICE_PRIORITY_LABELS[category.default_priority]} tone={category.default_priority === "URGENT" ? "danger" : category.default_priority === "HIGH" ? "warning" : "info"} small />
                <T variant="caption" color={colors.inkSubtle}>
                  set by category; our team may adjust it
                </T>
              </View>
            ) : null}
            <Field label="Subject" value={subject} onChangeText={setSubject} placeholder="e.g. Receipt missing for cheque dated 12 Mar" maxLength={200} error={errors.subject} />
            <Field label="Description" value={description} onChangeText={setDescription} placeholder="Describe the issue, with dates and amounts where relevant." multiline maxLength={2000} error={errors.description} hint={`${description.length}/2000`} />
            <View style={{ gap: 6 }}>
              <T variant="caption" color={colors.inkMuted}>
                Photos (optional)
              </T>
              <AttachmentPicker files={files} onChange={setFiles} onError={(m) => toast.error(m)} />
            </View>
            <Button title="Submit request" variant="gold" size="lg" block loading={create.isPending} onPress={() => void submit()} />
          </Card>
        </Screen>
      </KeyboardAvoidingView>
      <Sheet visible={picker === "category"} onClose={() => setPicker(null)} title="Category">
        {(categories.data ?? []).map((c) => (
          <OptionRow key={c.id} label={c.name} hint={`Default priority: ${SERVICE_PRIORITY_LABELS[c.default_priority]}`} selected={c.id === categoryId} onPress={() => { setCategoryId(c.id); setPicker(null); }} />
        ))}
        {categories.data && categories.data.length === 0 ? <T variant="small" color={colors.inkMuted}>No categories are configured yet. Please contact your relationship manager.</T> : null}
      </Sheet>
      <Sheet visible={picker === "booking"} onClose={() => setPicker(null)} title="Which booking?">
        {bookings.map((b) => (
          <OptionRow key={b.booking_id} label={`${b.flat_number} · ${b.block_name}`} hint={`${b.project_name} · ${b.booking_number}`} selected={b.booking_id === (targetBooking ?? bookingId)} onPress={() => { setTargetBooking(b.booking_id); setPicker(null); }} />
        ))}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({ priorityRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap", marginTop: -space.sm } });
