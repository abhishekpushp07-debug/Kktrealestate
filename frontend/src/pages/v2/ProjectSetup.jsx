/* eslint-disable react/no-array-index-key -- positional editable rows without ids; data-derived keys would remount inputs on edit */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Check, Plus, Trash2 } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { useCatalogues } from "@/hooks/useCatalogues";
import { inr } from "@/lib/format";
import { Card, Field, FormSection, PageHero, Skeleton, Stepper, CELL } from "@/components/v2";
import { Select } from "@/components/v2/Select";
import { cn } from "@/lib/utils";

const STEPS = ["Basics", "Towers", "Floor plans", "Stages", "Payment plans", "Pricing", "Review"];
const PATTERNS = [["{block}-{floor}{pos2}", "A-1201"], ["{floor}{pos2}", "1201"], ["{block}{seq}", "A017"]];
const FACINGS = ["N", "S", "E", "W", "NE", "NW", "SE", "SW"].map((f) => ({ value: f, label: f }));
const codeOf = (n) => n.toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(" ").filter(Boolean).map((w) => w.slice(0, 3)).join("").slice(0, 8);
const chips = (s) => String(s || "").split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n));

function Basics({ p, setP, cats }) {
  const stateId = cats.opts("state").find((s) => s.label === p.address?.state)?.value;
  const cityId = cats.opts("city").find((c) => c.label === p.address?.city)?.value;
  return (<>
    <FormSection title="Project basics" helper="Name, location and registration. Everything else is chosen from catalogues.">
      <Field label="Project name" required><input className="input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value, code: p.codeTouched ? p.code : codeOf(e.target.value) })} placeholder="Shree Ganesh Heights" data-testid="setup-name" /></Field>
      <Field label="Code" hint="Auto-generated; used in unit numbers" required><input className="input uppercase" value={p.code} onChange={(e) => setP({ ...p, code: e.target.value.toUpperCase(), codeTouched: true })} data-testid="setup-code" /></Field>
      <Field label="Type"><Select options={["Residential", "Commercial", "Mixed"].map((v) => ({ value: v, label: v }))} value={p.project_type} onChange={(v) => setP({ ...p, project_type: v })} clearable={false} testId="setup-type" /></Field>
      <Field label="Status"><Select options={["Planning", "Launched", "Under Construction", "Ready", "Completed"].map((v) => ({ value: v, label: v }))} value={p.status} onChange={(v) => setP({ ...p, status: v })} clearable={false} testId="setup-status" /></Field>
      <Field label="State"><Select type="state" value={stateId} onChange={(v, o) => setP({ ...p, address: { ...p.address, state: o?.label || null, city: null } })} testId="setup-state" /></Field>
      <Field label="City"><Select type="city" parentId={stateId} value={cityId} onChange={(v, o) => setP({ ...p, address: { ...p.address, city: o?.label || null } })} testId="setup-city" /></Field>
      <Field label="Locality / address line"><Select type="locality" parentId={cityId} value={cats.opts("locality").find((l) => l.label === p.address?.line1)?.value} onChange={(v, o) => setP({ ...p, address: { ...p.address, line1: o?.label || null } })} testId="setup-locality" /></Field>
      <Field label="Pincode"><input className="input" value={p.address?.pincode || ""} onChange={(e) => setP({ ...p, address: { ...p.address, pincode: e.target.value || null } })} placeholder="800001" inputMode="numeric" data-testid="setup-pincode" /></Field>
      <Field label="RERA number"><input className="input" value={p.rera_number || ""} onChange={(e) => setP({ ...p, rera_number: e.target.value || null })} data-testid="setup-rera" /></Field>
      <Field label="Launch date"><input type="date" className="input" value={p.launch_date || ""} onChange={(e) => setP({ ...p, launch_date: e.target.value || null })} data-testid="setup-launch" /></Field>
      <Field label="Expected possession"><input type="date" className="input" value={p.expected_possession_date || ""} onChange={(e) => setP({ ...p, expected_possession_date: e.target.value || null })} data-testid="setup-possession" /></Field>
      <Field label="Cover image URL" hint="Paste a hosted image URL (upload arrives with the media library)"><input className="input" value={p.cover_image_url || ""} onChange={(e) => setP({ ...p, cover_image_url: e.target.value || null })} data-testid="setup-cover" /></Field>
      <Field label="Default cash share %" hint="Pre-fills the Cash/Account split in the booking wizard"><input type="number" min="0" max="100" step="0.5" className="input" value={p.default_cash_percent ?? 0} onChange={(e) => setP({ ...p, default_cash_percent: Number(e.target.value) || 0 })} data-testid="setup-cash-percent" /></Field>
    </FormSection>
    <FormSection title="Cancellation & bounce policy" helper="Drives refund payable on cancellation and the auto-raised bounce charge (see Settings → Definitions).">
      <Field label="Deduction type"><Select options={[{ value: "percent", label: "% of agreement value" }, { value: "fixed", label: "Fixed ₹" }]} value={p.cancellation_policy?.deduction_type || "percent"} onChange={(v) => setP({ ...p, cancellation_policy: { ...(p.cancellation_policy || {}), deduction_type: v } })} clearable={false} testId="setup-ded-type" /></Field>
      <Field label="Deduction value"><input type="number" min="0" className="input" value={p.cancellation_policy?.deduction_value ?? 10} onChange={(e) => setP({ ...p, cancellation_policy: { ...(p.cancellation_policy || {}), deduction_value: Number(e.target.value) } })} data-testid="setup-ded-value" /></Field>
      <Field label="GST on deduction"><Select options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes (18%)" }]} value={p.cancellation_policy?.gst_on_deduction ? "yes" : "no"} onChange={(v) => setP({ ...p, cancellation_policy: { ...(p.cancellation_policy || {}), gst_on_deduction: v === "yes" } })} clearable={false} testId="setup-ded-gst" /></Field>
      <Field label="Refund SLA (days)"><input type="number" min="0" className="input" value={p.cancellation_policy?.refund_sla_days ?? 45} onChange={(e) => setP({ ...p, cancellation_policy: { ...(p.cancellation_policy || {}), refund_sla_days: Number(e.target.value) } })} data-testid="setup-refund-sla" /></Field>
      <Field label="Auto bounce charge"><Select options={[{ value: "on", label: "On — raise Other-charge demand on bounce" }, { value: "off", label: "Off" }]} value={p.bounce_policy?.enabled === false ? "off" : "on"} onChange={(v) => setP({ ...p, bounce_policy: { ...(p.bounce_policy || {}), enabled: v === "on" } })} clearable={false} testId="setup-bounce-enabled" /></Field>
      <Field label="Bounce charge ₹"><input type="number" min="0" className="input" value={p.bounce_policy?.amount ?? 500} onChange={(e) => setP({ ...p, bounce_policy: { ...(p.bounce_policy || {}), amount: Number(e.target.value) } })} data-testid="setup-bounce-amount" /></Field>
    </FormSection>
  </>);
}

const newTower = (code, i) => ({ _new: true, name: `Tower ${String.fromCharCode(65 + i)}`, code: String.fromCharCode(65 + i), block_type_id: null, floors: 12, floor_start: 1, skip_floors: "", refuge_floors: "", podium_floors: "", numbering_pattern: "{block}-{floor}{pos2}", flats_per_floor: 4, floor_plans: [] });

function Towers({ towers, setTowers, code }) {
  const upd = (i, patch) => setTowers(towers.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const example = (t) => { const [pat] = PATTERNS.find(([k]) => k === t.numbering_pattern) || PATTERNS[0]; return pat.replace("{block}", t.code || "A").replace("{floor}", String(t.floor_start + 1)).replace("{pos2}", "02").replace("{seq}", "007"); };
  return (
    <div className="space-y-6">
      {towers.map((t, i) => (
        <FormSection key={t.id || i} title={t.name || `Tower ${i + 1}`} helper={t.id ? `${t.units?.total || 0} units generated · structural fields locked` : "New tower — units are generated at the end"}>
          <Field label="Tower name" required><input className="input" value={t.name} onChange={(e) => upd(i, { name: e.target.value })} data-testid={`tower-${i}-name`} /></Field>
          <Field label="Code" required><input className="input uppercase" value={t.code} disabled={!!t.id} onChange={(e) => upd(i, { code: e.target.value.toUpperCase().slice(0, 10) })} data-testid={`tower-${i}-code`} /></Field>
          <Field label="Block type" required><Select type="block_types" value={t.block_type_id} onChange={(v) => upd(i, { block_type_id: v })} allowAdd={false} testId={`tower-${i}-type`} /></Field>
          <Field label="Floors" required><input type="number" className="input" value={t.floors} disabled={!!t.id} min={1} onChange={(e) => upd(i, { floors: Number(e.target.value) })} data-testid={`tower-${i}-floors`} /></Field>
          <Field label="First residential floor"><input type="number" className="input" value={t.floor_start} disabled={!!t.id} min={0} onChange={(e) => upd(i, { floor_start: Number(e.target.value) })} /></Field>
          <Field label="Units per floor (default)"><input type="number" className="input" value={t.flats_per_floor || ""} disabled={!!t.id} min={1} onChange={(e) => upd(i, { flats_per_floor: Number(e.target.value) })} /></Field>
          <Field label="Skip floors" hint="Comma separated, e.g. 13"><input className="input" value={t.skip_floors} disabled={!!t.id} onChange={(e) => upd(i, { skip_floors: e.target.value })} /></Field>
          <Field label="Refuge floors" hint="No saleable units"><input className="input" value={t.refuge_floors} disabled={!!t.id} onChange={(e) => upd(i, { refuge_floors: e.target.value })} /></Field>
          <Field label="Numbering pattern" hint={`Example: ${example(t)}`}><Select options={PATTERNS.map(([k, ex]) => ({ value: k, label: k, sub: ex }))} value={t.numbering_pattern} disabled={!!t.id} onChange={(v) => upd(i, { numbering_pattern: v })} clearable={false} testId={`tower-${i}-pattern`} /></Field>
          {!t.id && <div className="flex items-end"><button type="button" onClick={() => setTowers(towers.filter((_, j) => j !== i))} className="btn btn-ghost btn-sm text-brick" data-testid={`tower-${i}-remove`}><Trash2 className="h-3.5 w-3.5" />Remove</button></div>}
        </FormSection>
      ))}
      <button type="button" onClick={() => setTowers([...towers, newTower(code, towers.length)])} className="btn btn-ghost" data-testid="add-tower"><Plus className="h-4 w-4" />Add tower</button>
    </div>
  );
}

function FloorPlans({ towers, setTowers, cats }) {
  const flatTypes = cats.opts("flat_types");
  const upd = (i, fp) => setTowers(towers.map((t, j) => (j === i ? { ...t, floor_plans: fp } : t)));
  return (
    <div className="space-y-6">
      {towers.map((t, i) => {
        const ranges = t.floor_plans?.length ? t.floor_plans : [{ from_floor: t.floor_start, to_floor: t.floor_start + t.floors - 1, positions: Array.from({ length: t.flats_per_floor || 4 }, (_, k) => ({ position: k + 1, flat_type_id: null, facing: null })) }];
        const setR = (ri, patch) => upd(i, ranges.map((r, j) => (j === ri ? { ...r, ...patch } : r)));
        return (
          <Card key={t.id || i} testId={`fp-tower-${i}`}>
            <div className="flex items-center justify-between"><h3 className="font-display text-lg">{t.name}</h3>{t.id ? <span className="pill bg-warm-100 text-txt-secondary">Locked — units exist</span> : <button type="button" onClick={() => upd(i, [...ranges, { from_floor: ranges.at(-1).to_floor + 1, to_floor: t.floor_start + t.floors - 1, positions: ranges.at(-1).positions.map((p) => ({ ...p })) }])} className="btn btn-ghost btn-sm"><Plus className="h-3.5 w-3.5" />Add floor range</button>}</div>
            {ranges.map((r, ri) => (
              <div key={ri} className="mt-5 rounded-2xl border border-warm-200 p-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="From floor"><input type="number" className="input" disabled={!!t.id} value={r.from_floor} onChange={(e) => setR(ri, { from_floor: Number(e.target.value) })} /></Field>
                  <Field label="To floor"><input type="number" className="input" disabled={!!t.id} value={r.to_floor} onChange={(e) => setR(ri, { to_floor: Number(e.target.value) })} /></Field>
                  <Field label="Use a template instead"><Select type="floor_plan_templates" value={r.floor_plan_template_id} disabled={!!t.id} onChange={(v) => setR(ri, { floor_plan_template_id: v, positions: v ? null : Array.from({ length: t.flats_per_floor || 4 }, (_, k) => ({ position: k + 1, flat_type_id: null, facing: null })) })} allowAdd={false} testId={`fp-${i}-${ri}-template`} /></Field>
                </div>
                {!r.floor_plan_template_id && (
                  <div className="mt-4">
                    <p className="label mb-2">Positions on each floor</p>
                    <div className="space-y-2">{(r.positions || []).map((pos, pi) => <div key={pi} className="grid items-center gap-3 md:grid-cols-[48px_1fr_140px_40px]"><span className="cell bg-warm-100 text-ink-950">{String(pos.position).padStart(2, "0")}</span><Select options={flatTypes} value={pos.flat_type_id} disabled={!!t.id} onChange={(v) => setR(ri, { positions: r.positions.map((x, k) => (k === pi ? { ...x, flat_type_id: v } : x)) })} placeholder="Flat type" allowAdd={false} testId={`fp-${i}-${ri}-pos-${pi}`} /><Select options={FACINGS} value={pos.facing} disabled={!!t.id} onChange={(v) => setR(ri, { positions: r.positions.map((x, k) => (k === pi ? { ...x, facing: v } : x)) })} placeholder="Facing" />{!t.id && <button type="button" onClick={() => setR(ri, { positions: r.positions.filter((_, k) => k !== pi).map((x, k) => ({ ...x, position: k + 1 })) })} className="text-txt-muted hover:text-brick" aria-label="Remove position"><Trash2 className="h-4 w-4" /></button>}</div>)}</div>
                    {!t.id && <button type="button" onClick={() => setR(ri, { positions: [...(r.positions || []), { position: (r.positions?.length || 0) + 1, flat_type_id: null, facing: null }] })} className="btn btn-ghost btn-sm mt-3"><Plus className="h-3.5 w-3.5" />Add position</button>}
                    <div className="mt-4"><p className="label mb-2">Preview · floors {r.from_floor}–{r.to_floor}</p><div className="flex flex-wrap gap-1.5">{(r.positions || []).map((pos, pi) => <span key={pi} className={cn("cell", pos.flat_type_id ? CELL.Available : "bg-warm-100 text-txt-muted")} title={flatTypes.find((f) => f.value === pos.flat_type_id)?.label}>{flatTypes.find((f) => f.value === pos.flat_type_id)?.sub || "?"}</span>)}<span className="ml-2 self-center text-xs text-txt-muted">× {Math.max(0, r.to_floor - r.from_floor + 1 - chips(t.skip_floors).length - chips(t.refuge_floors).length)} floors = {(r.positions || []).length * Math.max(0, r.to_floor - r.from_floor + 1 - chips(t.skip_floors).length - chips(t.refuge_floors).length)} units</span></div></div>
                  </div>
                )}
              </div>
            ))}
          </Card>
        );
      })}
    </div>
  );
}

function Stages({ seq, setSeq, cats, setup }) {
  const all = cats.opts("construction_stages");
  const chosen = seq.map((s) => s.stage_id);
  const planRefs = useMemo(() => { const m = {}; (setup?.plans?.catalogue || []).forEach((p) => p.installments?.forEach((i) => i.trigger_stage_id && (m[i.trigger_stage_id] = (m[i.trigger_stage_id] || 0) + 1))); return m; }, [setup]);
  const move = (i, d) => { const n = [...seq]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setSeq(n.map((s, k) => ({ ...s, seq: k + 1 }))); };
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card testId="stages-chosen"><h3 className="font-display text-lg">Project sequence (setup summary)</h3><p className="mb-4 text-xs text-txt-secondary">Default order for new towers. Per-tower stage plans are managed in <Link to="/masters/stage-plans" className="font-semibold text-ink-950 underline" data-testid="setup-link-stage-plans">Masters → Construction Stage Plans</Link>.</p>
        <ol className="space-y-2">{seq.map((s, i) => <li key={s.stage_id} className="flex items-center gap-3 rounded-xl border border-warm-200 px-3 py-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-ink-950 font-display text-xs text-gold-400">{i + 1}</span><span className="flex-1 text-sm font-semibold">{all.find((a) => a.value === s.stage_id)?.label}</span>{planRefs[s.stage_id] && <span className="pill bg-gold-light text-[#8a6d12]">{planRefs[s.stage_id]} plan{planRefs[s.stage_id] > 1 ? "s" : ""}</span>}<button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="text-txt-muted hover:text-ink-950 disabled:opacity-30">↑</button><button type="button" disabled={i === seq.length - 1} onClick={() => move(i, 1)} className="text-txt-muted hover:text-ink-950 disabled:opacity-30">↓</button><button type="button" onClick={() => setSeq(seq.filter((x) => x.stage_id !== s.stage_id).map((x, k) => ({ ...x, seq: k + 1 })))} className="text-txt-muted hover:text-brick" aria-label="Remove"><Trash2 className="h-4 w-4" /></button></li>)}</ol>
        {seq.length === 0 && <p className="text-sm text-txt-muted">Pick stages from the catalogue →</p>}
      </Card>
      <Card testId="stages-catalogue"><h3 className="font-display text-lg">Stage catalogue</h3><p className="mb-4 text-xs text-txt-secondary">Global list (Settings → Catalogues). Click to add in order.</p>
        <div className="flex flex-wrap gap-2">{all.map((a) => <button key={a.value} type="button" disabled={chosen.includes(a.value)} onClick={() => setSeq([...seq, { stage_id: a.value, seq: seq.length + 1 }])} className={cn("pill border", chosen.includes(a.value) ? "border-sage/30 bg-sage-50 text-sage" : "border-warm-200 bg-white hover:border-gold")} data-testid={`stage-pick-${a.sub}`}>{chosen.includes(a.value) && <Check className="h-3 w-3" />}{a.label}</button>)}</div>
        {all.length > 0 && seq.length === 0 && <button type="button" onClick={() => setSeq(all.map((a, k) => ({ stage_id: a.value, seq: k + 1 })))} className="btn btn-ghost btn-sm mt-4" data-testid="stages-use-all">Use the full standard sequence</button>}
      </Card>
    </div>
  );
}

function Plans({ setup, assign, setAssign, towers }) {
  const plans = setup?.plans?.catalogue || [];
  const toggle = (pid, bid) => { const k = (a) => a.payment_plan_id === pid && (a.block_id || null) === (bid || null); setAssign(assign.some(k) ? assign.filter((a) => !k(a)) : [...assign, { payment_plan_id: pid, block_id: bid || null, is_default: false }]); };
  const setDefault = (pid, bid) => setAssign(assign.map((a) => ((a.block_id || null) === (bid || null) ? { ...a, is_default: a.payment_plan_id === pid } : a)));
  const sample = 1e7;
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">{plans.map((p) => { const on = assign.some((a) => a.payment_plan_id === p.id && !a.block_id); return (
        <Card key={p.id} className={cn("border-2", on ? "border-gold" : "border-transparent")} testId={`plan-card-${p.code}`}>
          <div className="flex items-start justify-between gap-3"><div><h3 className="font-display text-lg">{p.name}</h3><p className="text-xs text-txt-secondary">{p.code} · {p.plan_type} · {p.installments.length} installments</p></div><button type="button" onClick={() => toggle(p.id, null)} className={cn("btn btn-sm", on ? "btn-primary" : "btn-ghost")} data-testid={`plan-toggle-${p.code}`}>{on ? "Assigned" : "Assign to project"}</button></div>
          <div className="mt-3 flex flex-wrap gap-1.5">{p.installments.map((i) => <span key={i.seq} className="pill bg-warm-100 text-txt-secondary" title={`${i.trigger_type}${i.trigger_stage_id ? " · stage" : ""}`}>{i.seq}. {i.name} · {i.percent}%</span>)}</div>
          <details className="mt-3 text-xs text-txt-secondary"><summary className="cursor-pointer font-semibold text-ink-950">Schedule preview for ₹1 Cr</summary><table className="mt-2 w-full text-left"><tbody>{p.installments.map((i) => <tr key={i.seq} className="border-t border-warm-100"><td className="py-1">{i.name}</td><td className="py-1 text-right">{i.percent}%</td><td className="py-1 text-right font-display text-ink-950">{inr((sample * i.percent) / 100)}</td></tr>)}</tbody></table></details>
          {on && <div className="mt-3 flex items-center gap-2 text-xs"><input type="radio" name="default-project" checked={assign.some((a) => a.payment_plan_id === p.id && !a.block_id && a.is_default)} onChange={() => setDefault(p.id, null)} id={`def-${p.id}`} className="accent-[#C9A227]" /><label htmlFor={`def-${p.id}`}>Default for the project</label></div>}
        </Card>); })}</div>
      {towers.filter((t) => t.id).length > 0 && <Card testId="plan-matrix"><h3 className="font-display text-lg">Per-tower overrides</h3><p className="mb-3 text-xs text-txt-secondary">Tick to make a plan available only on a tower; the project default applies otherwise.</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left"><th className="label py-2">Tower</th>{plans.map((p) => <th key={p.id} className="label py-2 text-center">{p.code}</th>)}</tr></thead><tbody>{towers.filter((t) => t.id).map((t) => <tr key={t.id} className="border-t border-warm-100">{[<td key="n" className="py-2 font-semibold">{t.name}</td>, ...plans.map((p) => { const on = assign.some((a) => a.payment_plan_id === p.id && a.block_id === t.id); return <td key={p.id} className="py-2 text-center"><button type="button" onClick={() => toggle(p.id, t.id)} className={cn("h-7 w-7 rounded-lg border", on ? "border-gold bg-gold text-ink-950" : "border-warm-200")} aria-label={`${p.code} on ${t.name}`} data-testid={`plan-${p.code}-${t.code}`}>{on ? "✓" : ""}</button></td>; })]}</tr>)}</tbody></table></div></Card>}
      {plans.length === 0 && <Card><p className="text-sm text-txt-secondary">No payment plan templates yet — create them under Settings → Catalogues → Payment plans.</p></Card>}
    </div>
  );
}

function Pricing({ towers, setTowers, cats }) {
  const ft = cats.opts("flat_types");
  const upd = (i, patch) => setTowers(towers.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const sample = ft[0];
  return (
    <div className="space-y-6">
      {towers.map((t, i) => { const sbu = sample?.meta?.super_builtup_sqft || 1000; const rate = Number(t.rate_per_sqft) || sample?.meta?.base_rate_per_sqft || 0; const price = rate * sbu + (Number(t.floor_rise_per_sqft) || 0) * 5 * sbu; return (
        <FormSection key={t.id || i} title={t.name} helper={sample ? `Sample: ${sample.label} (${sbu} sq.ft) on the 6th floor ≈ ${inr(price)}` : "Add flat types in Settings → Catalogues to preview prices"}>
          <Field label="Base rate (₹ / sq.ft)" hint="Blank = flat type's own rate"><input type="number" className="input" value={t.rate_per_sqft ?? ""} onChange={(e) => upd(i, { rate_per_sqft: e.target.value === "" ? null : Number(e.target.value) })} data-testid={`price-${i}-rate`} /></Field>
          <Field label="Floor rise (₹ / sq.ft / floor)"><input type="number" className="input" value={t.floor_rise_per_sqft ?? ""} onChange={(e) => upd(i, { floor_rise_per_sqft: e.target.value === "" ? null : Number(e.target.value) })} data-testid={`price-${i}-rise`} /></Field>
          <Field label="Cash share % override" hint="Blank = project default"><input type="number" min="0" max="100" step="0.5" className="input" value={t.default_cash_percent ?? ""} onChange={(e) => upd(i, { default_cash_percent: e.target.value === "" ? null : Number(e.target.value) })} data-testid={`price-${i}-cash`} /></Field>
        </FormSection>); })}
      <Card><p className="text-sm text-txt-secondary">PLC rules (corner, facing, view) and dated rate cards live in the project's <b>Pricing</b> tab after creation — they re-price Available units in bulk.</p></Card>
    </div>
  );
}

export default function ProjectSetup() {
  const { id } = useParams();
  const navigate = useNavigate();
  const cats = useCatalogues();
  const [step, setStep] = useState(0);
  const [pid, setPid] = useState(id || null);
  const [p, setP] = useState({ name: "", code: "", project_type: "Residential", status: "Planning", address: {}, codeTouched: false });
  const [towers, setTowers] = useState([]);
  const [seq, setSeq] = useState([]);
  const [assign, setAssign] = useState([]);
  const [setup, setSetup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!id);
  const load = async (projectId) => {
    const [pr, st] = await Promise.all([api.get(`/projects/${projectId}`), api.get(`/projects/${projectId}/setup`)]);
    setP({ ...pr.data, codeTouched: true }); setSetup(st.data);
    setTowers(st.data.towers.map((t) => ({ ...t, _orig_name: t.name, _orig_block_type_id: t.block_type_id, skip_floors: (t.skip_floors || []).join(","), refuge_floors: (t.refuge_floors || []).join(","), podium_floors: (t.podium_floors || []).join(",") })));
    setSeq(st.data.stages.project_sequence.map((s, k) => ({ stage_id: s.stage_id, seq: k + 1 })));
    setAssign(st.data.plans.assignments.map((a) => ({ payment_plan_id: a.payment_plan_id, block_id: a.block_id || null, is_default: !!a.is_default })));
  };
  useEffect(() => { if (id) load(id).catch((e) => toast.error(errMsg(e))).finally(() => setLoading(false)); else api.get("/projects/new/setup").catch(() => {}).then(() => setSetup(null)); }, [id]);
  useEffect(() => { if (!setup && !id) api.get("/catalogues").then(() => {}).catch(() => {}); }, [setup, id]);

  const saveStep = async () => {
    setBusy(true);
    try {
      if (step === 0) {
        const body = { name: p.name, code: p.code, project_type: p.project_type, status: p.status, cancellation_policy: p.cancellation_policy || null, bounce_policy: p.bounce_policy || null, address: { line1: p.address?.line1 || null, city: p.address?.city || null, state: p.address?.state || null, pincode: p.address?.pincode || null }, rera_number: p.rera_number || null, launch_date: p.launch_date || null, expected_possession_date: p.expected_possession_date || null, cover_image_url: p.cover_image_url || null, default_cash_percent: Number(p.default_cash_percent) || 0 };
        if (!pid) { const r = await api.post("/projects", body); setPid(r.data.id); navigate(`/projects/${r.data.id}/setup`, { replace: true }); await load(r.data.id); toast.success("Project created as a draft — continue with towers"); }
        else { const { code, ...patch } = body; await api.patch(`/projects/${pid}`, { ...patch, version: p.version }); await load(pid); }
      } else if (step === 1 || step === 2) {
        for (const t of towers) {
          if (!t.block_type_id) throw new Error(`${t.name}: choose a block type`);
          if (t.id) { if (step === 1 && (t.name !== t._orig_name || t.block_type_id !== t._orig_block_type_id)) await api.patch(`/blocks/${t.id}`, { name: t.name, block_type_id: t.block_type_id }); }
          else if (step === 1) { if (!t.name || !t.code || !t.floors) throw new Error("Each new tower needs a name, code and floors"); }
          else {
            const fps = (t.floor_plans?.length ? t.floor_plans : [{ from_floor: t.floor_start, to_floor: t.floor_start + t.floors - 1, positions: [] }]).map((r) => ({ from_floor: r.from_floor, to_floor: r.to_floor, floor_plan_template_id: r.floor_plan_template_id || null, positions: r.floor_plan_template_id ? null : (r.positions || []).filter((x) => x.flat_type_id).map((x) => ({ position: x.position, flat_type_id: x.flat_type_id, facing: x.facing || null })) }));
            if (fps.some((r) => !r.floor_plan_template_id && !r.positions.length)) throw new Error(`${t.name}: pick a flat type for each position (or a floor-plan template)`);
            await api.post("/blocks", { project_id: pid, block_type_id: t.block_type_id, name: t.name, code: t.code, floors: Number(t.floors), floor_start: Number(t.floor_start), skip_floors: chips(t.skip_floors), refuge_floors: chips(t.refuge_floors), podium_floors: chips(t.podium_floors), numbering_pattern: t.numbering_pattern, flats_per_floor: t.flats_per_floor || null, floor_plans: fps, rate_per_sqft: t.rate_per_sqft ?? null, floor_rise_per_sqft: t.floor_rise_per_sqft ?? null });
          }
        }
        if (step === 2) await load(pid);
      } else if (step === 3) { await api.put(`/projects/${pid}/setup/stages`, { project_sequence: seq }); await load(pid); }
      else if (step === 4) { await api.put(`/projects/${pid}/setup/plans`, { assignments: assign }); await load(pid); }
      else if (step === 5) { await api.put(`/projects/${pid}/setup/pricing`, { block_rates: towers.filter((t) => t.id).map((t) => ({ block_id: t.id, rate_per_sqft: t.rate_per_sqft ?? null, floor_rise_per_sqft: t.floor_rise_per_sqft ?? null, default_cash_percent: t.default_cash_percent ?? null })) }); await load(pid); }
      setStep(step + 1);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const generate = async () => {
    setBusy(true);
    try { let n = 0; for (const t of setup.towers) { if (!t.units.total) { const r = await api.post(`/blocks/${t.id}/generate-flats`); n += r.data.generated || 0; } } toast.success(n ? `${n} units generated` : "Setup saved"); navigate(`/projects/${pid}`); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  if (loading || cats.loading) return <div className="space-y-6"><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>;
  const pending = setup?.towers.filter((t) => !t.units.total).length || 0;
  return (
    <div className="space-y-6" data-testid="project-setup">
      <PageHero dark={false} crumbs={[{ label: "Projects", to: "/projects" }, ...(pid ? [{ label: p.name, to: `/projects/${pid}` }] : []), { label: "Setup" }]} eyebrow={pid ? "Edit setup" : "New project"} title={p.name || "Set up a project"} subtitle="Towers → floor plans → stages → payment plans → pricing. Every step saves; you can come back any time." testId="setup-hero"><div className="mt-6"><Stepper steps={STEPS} current={step} onStep={setStep} allowJump={!!pid} /></div></PageHero>
      {step === 0 && <Basics p={p} setP={setP} cats={cats} />}
      {step === 1 && <Towers towers={towers} setTowers={setTowers} code={p.code} />}
      {step === 2 && <FloorPlans towers={towers} setTowers={setTowers} cats={cats} />}
      {step === 3 && <Stages seq={seq} setSeq={setSeq} cats={cats} setup={setup} />}
      {step === 4 && <Plans setup={setup} assign={assign} setAssign={setAssign} towers={towers} />}
      {step === 5 && <Pricing towers={towers} setTowers={setTowers} cats={cats} />}
      {step === 6 && setup && (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4" data-testid="setup-review">
          {[["Towers", setup.towers.length, setup.towers.map((t) => t.name).join(", ")], ["Units", setup.towers.reduce((a, t) => a + t.units.total, 0), pending ? `${pending} tower(s) to generate` : "All generated"], ["Stages", setup.stages.project_sequence.length, setup.stages.project_sequence.map((s) => s.name).slice(0, 3).join(" → ") + "…"], ["Payment plans", setup.plans.assignments.length, setup.plans.assignments.map((a) => a.plan_name).join(", ") || "None"]].map(([l, v, h]) => <Card key={l}><p className="label">{l}</p><p className="mt-2 font-display text-3xl">{v}</p><p className="mt-1 truncate text-xs text-txt-secondary">{h}</p></Card>)}
          <Card className="md:col-span-2 xl:col-span-4"><h3 className="font-display text-lg">Checklist</h3><div className="mt-3 flex flex-wrap gap-2">{Object.entries(setup.checklist).map(([k, v]) => <span key={k} className={cn("pill", v ? "bg-sage-50 text-sage" : "bg-amber2-50 text-amber2")}>{v ? <Check className="h-3 w-3" /> : null}{k.replace(/_/g, " ")}</span>)}</div></Card>
        </div>
      )}
      <div className="sticky bottom-4 flex items-center justify-between rounded-2xl border border-warm-200 bg-white/90 px-5 py-3 shadow-warm backdrop-blur">
        <button type="button" disabled={step === 0 || busy} onClick={() => setStep(step - 1)} className="btn btn-ghost" data-testid="setup-back">Back</button>
        <p className="hidden text-xs text-txt-muted md:block">Step {step + 1} of {STEPS.length}</p>
        {step < 6 ? <button type="button" disabled={busy || (step === 0 && !p.name) || (step > 0 && !pid)} onClick={saveStep} className="btn btn-primary" data-testid="setup-next">{busy ? "Saving…" : step === 0 && !pid ? "Create draft & continue" : "Save & continue"}</button>
          : <button type="button" disabled={busy} onClick={generate} className="btn btn-gold" data-testid="setup-finish">{pending ? `Create project & generate units` : "Finish"}</button>}
      </div>
    </div>
  );
}
