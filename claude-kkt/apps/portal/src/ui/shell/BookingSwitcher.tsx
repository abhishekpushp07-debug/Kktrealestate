// Booking switcher: a header chip (flat · tower) that opens a sheet listing every booking
// where the customer is primary or co-applicant. Hidden when there is a single booking.
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { BOOKING_STATUS_LABELS } from "@kkt/contracts";
import { useBooking } from "@/booking/BookingProvider";
import { haptics } from "@/lib/haptics";
import { useLayout } from "@/ui/Responsive";
import { Chip } from "@/ui/Chip";
import { Icon } from "@/ui/Icon";
import { OptionRow, Sheet } from "@/ui/Sheet";
import { T } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

export function BookingChip({ onNavy, block }: { onNavy?: boolean; block?: boolean }): React.JSX.Element | null {
  const { bookings, current, select } = useBooking();
  const [open, setOpen] = useState(false);
  const { isPhone } = useLayout();
  if (!current) return null;
  const multiple = bookings.length > 1;
  const compact = isPhone && !block;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={multiple ? "Switch booking" : "Current booking"}
        disabled={!multiple}
        onPress={() => {
          haptics.tap();
          setOpen(true);
        }}
        style={({ pressed }) => [styles.chip, onNavy ? styles.chipNavy : styles.chipIvory, block ? styles.block : null, pressed ? { opacity: 0.8 } : null]}
      >
        <Icon name="flat" size={14} color={onNavy ? colors.gold : colors.navy} />
        <View style={{ flexShrink: 1 }}>
          <T variant="caption" color={onNavy ? colors.onNavy : colors.navy} numberOfLines={1}>
            {compact ? current.flat_number : `${current.flat_number} · ${current.block_name}`}
          </T>
          {block ? (
            <T variant="caption" color={onNavy ? colors.onNavySubtle : colors.inkSubtle} numberOfLines={1} style={{ fontWeight: "400" }}>
              {current.project_name}
            </T>
          ) : null}
        </View>
        {multiple ? <Icon name="chevron-down" size={12} color={onNavy ? colors.onNavyMuted : colors.inkSubtle} /> : null}
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Your bookings" subtitle="Switch between the flats on your name">
        {bookings.map((b) => (
          <OptionRow
            key={b.booking_id}
            label={`${b.flat_number} · ${b.block_name}`}
            hint={`${b.project_name} · ${b.booking_number} · ${b.role === "PRIMARY" ? "Primary applicant" : "Co-applicant"} · ${BOOKING_STATUS_LABELS[b.status]}`}
            selected={b.booking_id === current.booking_id}
            onPress={() => {
              select(b.booking_id);
              setOpen(false);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}

export function BookingRoleChip(): React.JSX.Element | null {
  const { current } = useBooking();
  if (!current) return null;
  return <Chip label={current.role === "PRIMARY" ? "Primary applicant" : "Co-applicant"} tone={current.role === "PRIMARY" ? "gold" : "navy"} small />;
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, maxWidth: 240 },
  chipIvory: { backgroundColor: colors.surface, borderColor: colors.line },
  chipNavy: { backgroundColor: "rgba(255,255,255,0.1)", borderColor: "rgba(255,255,255,0.18)" },
  block: { maxWidth: undefined, alignSelf: "stretch", paddingVertical: 10, gap: space.sm },
});
