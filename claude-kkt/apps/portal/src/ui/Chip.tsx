import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import {
  DEMAND_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  SCHEDULE_STATUS_LABELS,
  SERVICE_PRIORITY_LABELS,
  SERVICE_STATUS_LABELS,
  STAGE_STATUS_LABELS,
  type DemandStatus,
  type PaymentBucket,
  type PaymentStatus,
  type ScheduleStatus,
  type ServicePriority,
  type ServiceStatus,
  type StageStatus,
} from "@kkt/contracts";
import { haptics } from "@/lib/haptics";
import { Icon, type IconName } from "./Icon";
import { T } from "./Text";
import { colors, radius, toneStyles, type Tone } from "./theme";

export interface ChipProps {
  label: string;
  tone?: Tone;
  icon?: IconName;
  small?: boolean;
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function Chip({ label, tone = "neutral", icon, small, selected, onPress, style }: ChipProps): React.JSX.Element {
  const t = toneStyles[tone];
  const bg = selected ? colors.navy : t.bg;
  const fg = selected ? colors.onNavy : t.fg;
  const content = (
    <View style={[styles.chip, { backgroundColor: bg, borderColor: selected ? colors.navy : t.border }, small ? styles.small : null, style]}>
      {icon ? <Icon name={icon} size={small ? 12 : 14} color={fg} /> : null}
      <T variant="caption" color={fg} style={small ? { fontSize: 11, lineHeight: 14 } : null} numberOfLines={1}>
        {label}
      </T>
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}

export function BucketChip({ bucket, small = true }: { bucket: PaymentBucket | null; small?: boolean }): React.JSX.Element | null {
  if (!bucket) return null;
  return <Chip label={bucket === "CASH" ? "Cash" : "Account"} tone={bucket === "CASH" ? "gold" : "navy"} small={small} />;
}

const scheduleTone: Record<ScheduleStatus, Tone> = { NOT_YET_DUE: "neutral", RAISED: "info", PARTIALLY_PAID: "warning", PAID: "success", OVERDUE: "danger" };
const demandTone: Record<DemandStatus, Tone> = { OPEN: "info", PARTIALLY_PAID: "warning", PAID: "success", VOID: "neutral", CANCELLED: "neutral" };
const paymentTone: Record<PaymentStatus, Tone> = { PENDING: "warning", CLEARED: "success", BOUNCED: "danger", REVERSED: "neutral" };
const serviceTone: Record<ServiceStatus, Tone> = { NEW: "info", IN_PROGRESS: "navy", AWAITING_CUSTOMER: "warning", RESOLVED: "success", CLOSED: "neutral" };
const priorityTone: Record<ServicePriority, Tone> = { LOW: "neutral", MEDIUM: "info", HIGH: "warning", URGENT: "danger" };
const stageTone: Record<StageStatus, Tone> = { PENDING: "neutral", IN_PROGRESS: "gold", COMPLETED: "success" };

export const ScheduleStatusChip = ({ status, small }: { status: ScheduleStatus; small?: boolean }) => <Chip label={SCHEDULE_STATUS_LABELS[status]} tone={scheduleTone[status]} small={small} />;
export const DemandStatusChip = ({ status, overdue, small }: { status: DemandStatus; overdue?: boolean; small?: boolean }) =>
  overdue && status !== "PAID" ? <Chip label="Overdue" tone="danger" small={small} /> : <Chip label={DEMAND_STATUS_LABELS[status]} tone={demandTone[status]} small={small} />;
export const PaymentStatusChip = ({ status, cancelled, small }: { status: PaymentStatus; cancelled?: boolean; small?: boolean }) =>
  cancelled ? <Chip label="Cancelled" tone="danger" small={small} /> : <Chip label={PAYMENT_STATUS_LABELS[status]} tone={paymentTone[status]} small={small} />;
export const ServiceStatusChip = ({ status, small }: { status: ServiceStatus; small?: boolean }) => <Chip label={SERVICE_STATUS_LABELS[status]} tone={serviceTone[status]} small={small} />;
export const PriorityChip = ({ priority, small }: { priority: ServicePriority; small?: boolean }) => <Chip label={SERVICE_PRIORITY_LABELS[priority]} tone={priorityTone[priority]} small={small} />;
export const StageStatusChip = ({ status, small }: { status: StageStatus; small?: boolean }) => <Chip label={STAGE_STATUS_LABELS[status]} tone={stageTone[status]} small={small} />;

/** Small count badge (notification bell, unread notices). */
export function Badge({ count, style }: { count: number; style?: StyleProp<ViewStyle> }): React.JSX.Element | null {
  if (count <= 0) return null;
  return (
    <View style={[styles.badge, style]}>
      <T variant="caption" color={colors.onNavy} style={{ fontSize: 10, lineHeight: 12 }}>
        {count > 99 ? "99+" : String(count)}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, alignSelf: "flex-start" },
  small: { paddingHorizontal: 8, paddingVertical: 3 },
  badge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
});
