import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import type { PortalRequestDetailResponse, PortalRequestMessage } from "@kkt/contracts";
import { errorMessage } from "@/api/client";
import { queryClient, useAddRequestMessage, useRateRequest, useReopenRequest, useRequest } from "@/api/queries";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { LocalFile } from "@/lib/upload";
import { AttachmentPicker, AttachmentThumb } from "@/ui/Attachments";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip, PriorityChip, ServiceStatusChip } from "@/ui/Chip";
import { Field } from "@/ui/Field";
import { Lightbox } from "@/ui/Lightbox";
import { StarRating } from "@/ui/ListRow";
import { Header, Screen } from "@/ui/Screen";
import { Sheet } from "@/ui/Sheet";
import { SkeletonCard, SkeletonRows } from "@/ui/Skeleton";
import { ErrorState, Notice, StatusBar } from "@/ui/States";
import { T } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { colors, radius, space } from "@/ui/theme";

export function RequestDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const requestId = typeof id === "string" ? id : "";
  const q = useRequest(requestId || null);
  const d = q.data;
  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <Header title={d ? d.ticket_number : "Request"} subtitle={d ? `${d.category_name} · ${d.flat_number}` : undefined} back />
      {q.isError && d ? <StatusBar text="Showing saved conversation — couldn't refresh." tone="warning" /> : null}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Screen onRefresh={() => queryClient.invalidateQueries({ queryKey: ["request", requestId] })}>
          {d ? <Detail d={d} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <><SkeletonCard lines={3} /><SkeletonRows rows={3} /></>}
        </Screen>
      </KeyboardAvoidingView>
    </View>
  );
}

function Detail({ d }: { d: PortalRequestDetailResponse }): React.JSX.Element {
  const toast = useToast();
  const reply = useAddRequestMessage(d.id);
  const reopen = useReopenRequest(d.id);
  const rate = useRateRequest(d.id);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [rating, setRating] = useState(d.rating ?? 0);
  const [comment, setComment] = useState("");
  const [lightbox, setLightbox] = useState<{ uri: string; caption: string } | null>(null);
  const closed = d.status === "RESOLVED" || d.status === "CLOSED";

  const send = async () => {
    if (body.trim().length === 0) return toast.error("Write a message first.");
    try {
      await reply.mutateAsync({ body: body.trim(), files });
      setBody("");
      setFiles([]);
      toast.success("Reply sent");
    } catch (e) {
      toast.error(errorMessage(e, "Could not send your reply."));
    }
  };
  const doReopen = async () => {
    if (reason.trim().length < 3) return toast.error("Tell us why you're reopening (a few words).");
    try {
      await reopen.mutateAsync({ reason: reason.trim() });
      setReopenOpen(false);
      setReason("");
      toast.success("Request reopened");
    } catch (e) {
      toast.error(errorMessage(e, "Could not reopen the request."));
    }
  };
  const doRate = async () => {
    if (rating < 1) return toast.error("Tap a star to rate.");
    try {
      await rate.mutateAsync({ rating, comment: comment.trim() || null });
      toast.success("Thank you for your feedback");
    } catch (e) {
      toast.error(errorMessage(e, "Could not save your rating."));
    }
  };

  return (
    <>
      <Card>
        <View style={styles.chips}>
          <ServiceStatusChip status={d.status} small />
          <PriorityChip priority={d.priority} small />
          <T variant="caption" color={colors.inkSubtle} style={{ marginLeft: "auto" }}>
            Raised {formatDateTime(d.created_at)}
          </T>
        </View>
        <T variant="h2" style={{ marginTop: space.sm }}>
          {d.subject}
        </T>
        <T variant="body" color={colors.inkMuted} style={{ marginTop: 4 }}>
          {d.description}
        </T>
      </Card>

      {d.status === "AWAITING_CUSTOMER" ? <Notice tone="warning" icon="chat" title="Our team is waiting for your reply" body="Add the details requested below so we can continue." /> : null}
      {d.status === "RESOLVED" && d.can_reopen ? <Notice tone="success" title="Marked resolved" body="Not fixed? You can reopen this request within 7 days." /> : null}

      <View style={{ gap: space.sm }}>
        {d.messages.map((m) => (
          <Bubble key={m.id} m={m} onOpenImage={(uri, caption) => setLightbox({ uri, caption })} />
        ))}
        {d.messages.length === 0 ? (
          <T variant="small" color={colors.inkMuted} align="center" style={{ paddingVertical: space.md }}>
            No replies yet — our team usually responds within a working day.
          </T>
        ) : null}
      </View>

      {!closed || d.status === "RESOLVED" ? (
        <Card style={{ gap: space.md }}>
          <T variant="h3">{d.status === "RESOLVED" ? "Add a note" : "Reply"}</T>
          <Field value={body} onChangeText={setBody} placeholder="Write your message…" multiline maxLength={5000} />
          <AttachmentPicker files={files} onChange={setFiles} onError={(m) => toast.error(m)} max={10} />
          <Button title="Send" icon="chat" variant="primary" loading={reply.isPending} onPress={() => void send()} />
        </Card>
      ) : null}

      {d.can_reopen ? (
        <Card style={{ gap: space.sm }}>
          <T variant="h3">Still an issue?</T>
          <T variant="small" color={colors.inkMuted}>
            Reopen within 7 days of it being marked resolved and we'll pick it up again.
          </T>
          <Button title="Reopen request" variant="outline" icon="refresh" onPress={() => setReopenOpen(true)} />
        </Card>
      ) : null}

      {d.can_rate || d.rating ? (
        <Card style={{ gap: space.md }}>
          <T variant="h3">{d.rating ? "Your rating" : "How did we do?"}</T>
          <StarRating value={rating} onChange={d.can_rate ? setRating : undefined} />
          {d.can_rate ? (
            <>
              <Field value={comment} onChangeText={setComment} placeholder="Anything we should know? (optional)" multiline maxLength={1000} />
              <Button title={d.rating ? "Update rating" : "Submit rating"} variant="gold" loading={rate.isPending} onPress={() => void doRate()} />
            </>
          ) : null}
        </Card>
      ) : null}

      <Sheet visible={reopenOpen} onClose={() => setReopenOpen(false)} title="Reopen request" subtitle="Tell us what's still pending">
        <Field value={reason} onChangeText={setReason} placeholder="e.g. The leak has started again after the repair." multiline maxLength={500} />
        <View style={styles.sheetActions}>
          <Button title="Cancel" variant="outline" onPress={() => setReopenOpen(false)} />
          <Button title="Reopen" variant="primary" loading={reopen.isPending} onPress={() => void doReopen()} />
        </View>
      </Sheet>
      <Lightbox images={lightbox ? [{ uri: lightbox.uri, caption: lightbox.caption }] : []} index={lightbox ? 0 : null} onClose={() => setLightbox(null)} onIndexChange={() => undefined} />
    </>
  );
}

function Bubble({ m, onOpenImage }: { m: PortalRequestMessage; onOpenImage: (uri: string, caption: string) => void }): React.JSX.Element {
  const mine = m.author === "YOU";
  const system = m.author === "SYSTEM";
  if (system) {
    return (
      <View style={styles.system}>
        <Chip label={m.body} tone="neutral" small />
        <T variant="caption" color={colors.inkSubtle}>
          {formatRelative(m.created_at)}
        </T>
      </View>
    );
  }
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : null]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleStaff]}>
        <View style={styles.bubbleHead}>
          <T variant="caption" color={mine ? colors.onNavyMuted : colors.gold700}>
            {mine ? "You" : m.author_name}
          </T>
          <T variant="caption" color={mine ? colors.onNavySubtle : colors.inkSubtle}>
            {formatDateTime(m.created_at)}
          </T>
        </View>
        <T variant="body" color={mine ? colors.onNavy : colors.ink} selectable>
          {m.body}
        </T>
        {m.attachments.length ? (
          <View style={styles.attachments}>
            {m.attachments.map((a) => (
              <AttachmentThumb key={a.id} uri={a.thumb_url} name={a.file_name} onPress={a.thumb_url && a.mime.startsWith("image/") ? () => onOpenImage(a.thumb_url ?? "", a.file_name) : undefined} />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  system: { alignItems: "center", gap: 4, paddingVertical: 4 },
  bubbleRow: { flexDirection: "row", justifyContent: "flex-start" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubble: { maxWidth: "88%", borderRadius: radius.lg, padding: space.md, gap: 6 },
  bubbleMine: { backgroundColor: colors.navy, borderBottomRightRadius: 4 },
  bubbleStaff: { backgroundColor: colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.line },
  bubbleHead: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  attachments: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  sheetActions: { flexDirection: "row", justifyContent: "flex-end", gap: space.sm, marginTop: space.md },
});
