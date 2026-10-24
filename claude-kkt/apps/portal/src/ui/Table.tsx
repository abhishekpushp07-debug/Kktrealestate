// Lightweight table for desktop widths (ledger, rooms). Phones use card layouts instead.
import { ScrollView, StyleSheet, View, type ReactNode } from "react-native";
import { T } from "./Text";
import { colors, radius, space } from "./theme";

export interface Column<Row> {
  key: string;
  title: string;
  width?: number;
  flex?: number;
  align?: "left" | "right" | "center";
  render: (row: Row, index: number) => ReactNode;
}

export function Table<Row>({ columns, rows, keyOf, minWidth = 720, emptyText = "Nothing here yet." }: { columns: ReadonlyArray<Column<Row>>; rows: ReadonlyArray<Row>; keyOf: (row: Row, index: number) => string; minWidth?: number; emptyText?: string }): React.JSX.Element {
  const cell = (c: Column<Row>) => ({ width: c.width, flex: c.width ? undefined : (c.flex ?? 1), alignItems: c.align === "right" ? "flex-end" : c.align === "center" ? "center" : "flex-start" } as const);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: "100%" }}>
      <View style={[styles.table, { minWidth }]}>
        <View style={[styles.row, styles.head]}>
          {columns.map((c) => (
            <View key={c.key} style={[styles.cell, cell(c)]}>
              <T variant="label" color={colors.inkSubtle} style={{ textAlign: c.align ?? "left" }}>
                {c.title}
              </T>
            </View>
          ))}
        </View>
        {rows.length === 0 ? (
          <View style={styles.empty}>
            <T variant="small" color={colors.inkMuted}>
              {emptyText}
            </T>
          </View>
        ) : (
          rows.map((r, i) => (
            <View key={keyOf(r, i)} style={[styles.row, i % 2 === 1 ? styles.zebra : null]}>
              {columns.map((c) => (
                <View key={c.key} style={[styles.cell, cell(c)]}>
                  {c.render(r, i)}
                </View>
              ))}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  table: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  head: { backgroundColor: colors.navy50 },
  zebra: { backgroundColor: "#FBFAF7" },
  cell: { paddingVertical: 12, paddingHorizontal: space.sm, minWidth: 0 },
  empty: { padding: space.xl, alignItems: "center" },
});
