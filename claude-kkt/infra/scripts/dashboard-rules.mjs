// Turns every PromQL expression of the Grafana dashboard into a recording rule so `promtool check rules` validates its syntax.
//   node infra/scripts/dashboard-rules.mjs infra/grafana/kkt-api.json > /tmp/dashboard-rules.yml && promtool check rules /tmp/dashboard-rules.yml
import { readFileSync } from "node:fs";

const dash = JSON.parse(readFileSync(process.argv[2] ?? "infra/grafana/kkt-api.json", "utf8"));
const exprs = [];
const walk = (panels) => {
  for (const p of panels ?? []) {
    for (const t of p.targets ?? []) if (t.expr) exprs.push({ panel: p.title, expr: t.expr });
    walk(p.panels);
  }
};
walk(dash.panels);
if (exprs.length === 0) throw new Error("no expressions found");
const lines = ["groups:", "  - name: dashboard-syntax", "    rules:"];
exprs.forEach((e, i) => {
  lines.push(`      - record: dashboard:expr_${i}`, `        expr: ${JSON.stringify(e.expr)}`);
});
process.stdout.write(`${lines.join("\n")}\n`);
process.stderr.write(`${exprs.length} expressions from ${dash.panels.length} panels\n`);
