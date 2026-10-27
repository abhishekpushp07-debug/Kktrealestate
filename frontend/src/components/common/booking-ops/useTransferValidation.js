/** Transfer money-split validation: new price, revised cash/account buckets and the min/max cash % that keep both buckets ≥ money already received. */
export function useTransferValidation(booking, f, flats) {
  const curPct = booking.agreement_value_paise ? Math.round((booking.cash_agreed_paise * 10000) / booking.agreement_value_paise) / 100 : 0;
  const target = flats.find((x) => x.id === f.new_flat_id);
  const s = booking.summary || {};
  const newPrice = target?.price_paise ?? (target?.price != null ? Math.round(target.price * 100) : null);
  const revise = f.price_handling === "revise_agreement" && newPrice != null && newPrice !== booking.agreement_value_paise;
  const newCash = revise ? Math.round((newPrice * Number(f.cash_percent || 0)) / 100) : booking.cash_agreed_paise;
  const newAcc = revise ? newPrice - newCash : booking.account_agreed_paise;
  const belowCash = revise && newCash < (s.cash_paid_paise || 0);
  const belowAcc = revise && newAcc < (s.account_paid_paise || 0);
  const minPct = revise && newPrice ? Math.ceil(((s.cash_paid_paise || 0) * 10000) / newPrice) / 100 : null;
  const maxPct = revise && newPrice ? Math.floor(((newPrice - (s.account_paid_paise || 0)) * 10000) / newPrice) / 100 : null;
  return { curPct, target, s, newPrice, revise, newCash, newAcc, belowCash, belowAcc, minPct, maxPct };
}
