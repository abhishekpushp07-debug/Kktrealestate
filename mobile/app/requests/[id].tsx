import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";

import { api, ApiError, buildForm, errMsg } from "@/src/api/client";
import { authedUri, openFile } from "@/src/api/pdf";
import { fmtDateTime } from "@/src/format";
import { haptic } from "@/src/haptics";
import type { LocalFile } from "@/src/utils/upload";
import { makeStyles, useTheme } from "@/src/theme";
import { Screen, PageHeader } from "@/src/ui/screen";
import { Button, Card, Chip, Press } from "@/src/ui/primitives";
import { Field } from "@/src/ui/field";
import { T } from "@/src/ui/text";
import { SkeletonScreen } from "@/src/ui/skeleton";
import { Empty, ErrorState } from "@/src/ui/states";
import { AttachmentPicker } from "@/src/ui/attachments";
import { toast } from "@/src/ui/toast";
import { Lightbox } from "@/src/ui/lightbox";
import { statusTone } from "@/src/screens/shared";
import { Bubble, isImageAtt, type AttView, type ThreadMsg } from "@/src/screens/requests/bubble";

type SR = { id: string; ticket_number: string; status: string; priority: string; subject: string; category: string; flat_number: string; created_at: string; rating?: number | null; can_reopen?: boolean; thread: ThreadMsg[] };

function Rate({ onRate, busy }: { onRate: (n: number) => void; busy: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [hover, setHover] = useState(0);
  return (
    <View style={s.stars}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Press key={n} disabled={busy} onPress={() => (setHover(n), onRate(n))} testID={`rate-${n}`} style={s.star} accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`}>
          <Feather name="star" size={24} color={n <= hover ? colors.gold : colors.borderStrong} />
        </Press>
      ))}
    </View>
  );
}

export default function RequestDetail() {
  const s = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["p-request", id], queryFn: () => api.get<SR>(`/service-requests/${id}`), enabled: !!id });
  const [msg, setMsg] = useState("");
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [busy, setBusy] = useState(false);
  const sr = q.data;
  const [lb, setLb] = useState<number | null>(null);
  const [fileBusy, setFileBusy] = useState<number | null>(null);

  // Ticket-wide attachment index (matches /attachments/{idx}: public thread order).
  const perMsg = useMemo(() => {
    let n = 0;
    return (sr?.thread || []).map((m) => (m.attachments || []).map((att) => ({ att, idx: n++, isImage: isImageAtt(att) })));
  }, [sr]);
  const images = perMsg.flat().filter((a) => a.isImage);
  const attPath = (idx: number) => `/service-requests/${id}/attachments/${idx}`;
  const imgQ = useQueries({
    queries: images.map((a) => ({
      queryKey: ["p-att", id, a.idx, a.att.name],
      queryFn: () => authedUri(attPath(a.idx), `att-${id}-${a.idx}-${a.att.name}`),
      staleTime: Infinity,
      gcTime: 30 * 60_000,
      retry: 1,
    })),
  });
  const uriFor = new Map(images.map((a, k) => [a.idx, imgQ[k]] as const));
  const views: AttView[][] = perMsg.map((list) =>
    list.map((a) => {
      const r = uriFor.get(a.idx);
      return { ...a, uri: r?.data, loading: r?.isLoading, error: r?.isError };
    }),
  );
  const photos = images.flatMap((a) => (uriFor.get(a.idx)?.data ? [{ idx: a.idx, uri: uriFor.get(a.idx)!.data as string, caption: a.att.name, sub: sr?.ticket_number }] : []));
  const openImage = (idx: number) => {
    const k = photos.findIndex((p) => p.idx === idx);
    if (k >= 0) setLb(k);
  };
  const openAtt = async (v: AttView) => {
    setFileBusy(v.idx);
    try {
      await openFile(attPath(v.idx), v.att.name, v.att.mime || "application/octet-stream");
    } catch (e) {
      toast.error(errMsg(e, "Could not open the attachment"));
    } finally {
      setFileBusy(null);
    }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      const updated = await fn();
      if (updated) qc.setQueryData(["p-request", id], updated);
      qc.invalidateQueries({ queryKey: ["p-request", id] });
      qc.invalidateQueries({ queryKey: ["p-requests"] });
      setMsg("");
      setFiles([]);
      haptic.success();
      toast.success(ok);
    } catch (e) {
      haptic.error();
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const reply = () => act(async () => api.form<SR>(`/service-requests/${id}/reply`, await buildForm({ message: msg.trim() }, files)), "Reply sent");
  const reopen = () => act(async () => api.form<SR>(`/service-requests/${id}/reopen`, await buildForm({ message: msg.trim() || "Reopening — the issue persists." })), "Ticket reopened");
  const rate = (n: number) => act(() => api.post<SR>(`/service-requests/${id}/rate`, { rating: n }), "Thanks for your feedback!");

  if (q.isLoading)
    return (
      <Screen testID="request-detail-screen">
        <PageHeader back title="Request" />
        <SkeletonScreen />
      </Screen>
    );
  if (q.isError || !sr)
    return (
      <Screen testID="request-detail-screen">
        <PageHeader back title="Request" />
        {q.error instanceof ApiError && q.error.status === 404 ? <Empty icon="search" title="Request not found" testID="request-not-found" /> : <ErrorState message={errMsg(q.error)} onRetry={q.refetch} />}
      </Screen>
    );

  const canReply = !["Closed", "Resolved"].includes(sr.status);
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <Screen testID="request-detail-screen" refreshKeys={[["p-request", id]]}>
        <PageHeader back title={sr.ticket_number} />
        <Card testID="request-summary">
          <View style={s.line}>
            <Chip label={sr.status} tone={statusTone(sr.status)} testID="request-status" />
            <Chip label={`${sr.priority} priority`} tone={sr.priority === "High" ? "error" : "neutral"} />
          </View>
          <T v="h2" style={{ marginTop: 10 }} testID="request-subject">
            {sr.subject}
          </T>
          <T v="small" tone="muted" style={{ marginTop: 4 }}>
            {sr.category} · Flat {sr.flat_number} · raised {fmtDateTime(sr.created_at)}
          </T>
          {sr.status === "Awaiting Customer" ? (
            <T v="small" tone="gold" style={{ marginTop: 8, fontFamily: "Manrope_700Bold" }}>
              Our team is waiting for your reply.
            </T>
          ) : null}
        </Card>

        <View style={{ gap: 10 }} testID="request-thread">
          {sr.thread.map((m, i) => (
            <Bubble key={i} m={m} i={i} atts={views[i] || []} onImage={openImage} onFile={openAtt} fileBusy={fileBusy} />
          ))}
        </View>

        {sr.status === "Resolved" && !sr.rating ? (
          <Card testID="request-rate" style={{ alignItems: "center" }}>
            <T v="title">How did we do?</T>
            <T v="small" tone="muted" style={{ marginTop: 2 }}>
              Rating closes the ticket.
            </T>
            <Rate onRate={rate} busy={busy} />
          </Card>
        ) : null}
        {sr.rating ? (
          <T tone="muted" style={{ textAlign: "center" }} testID="request-rating">
            You rated this {sr.rating}/5. Thank you!
          </T>
        ) : null}

        {sr.can_reopen ? (
          <Card testID="request-reopen-card" style={{ gap: 12 }}>
            <T v="bodyStrong">Issue not fixed?</T>
            <Field placeholder="Tell us what's still wrong (optional)" value={msg} onChangeText={setMsg} multiline testID="request-reopen-text" />
            <Button kind="ghost" icon="rotate-ccw" label="Reopen ticket" loading={busy} onPress={reopen} testID="request-reopen-button" />
          </Card>
        ) : null}

        {canReply ? (
          <Card testID="request-reply-box" style={{ gap: 12 }}>
            <Field placeholder="Write a reply…" value={msg} onChangeText={setMsg} multiline maxLength={4000} testID="request-reply-input" />
            <AttachmentPicker files={files} onChange={setFiles} testIDPrefix="reply-attach" />
            <Button icon="send" label={busy ? "Sending…" : "Send reply"} loading={busy} disabled={!msg.trim()} onPress={reply} testID="request-reply-send" />
          </Card>
        ) : null}
        <Lightbox photos={photos} index={lb} onClose={() => setLb(null)} />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(() => ({
  line: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  stars: { flexDirection: "row", gap: 6, marginTop: 12 },
  star: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
}));
