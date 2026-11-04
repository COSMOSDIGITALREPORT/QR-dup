/**
 * Weight formatting utility to ensure 3-decimal precision across the dashboard.
 * Examples:
 *   1       -> '1.000 kg' (or '1.000')
 *   1.09    -> '1.090 kg' (or '1.090')
 *   1.085   -> '1.085 kg' (or '1.085')
 *   1085    -> '1085.000 kg' (or '1085.000')
 */
export function formatWeight(val, withUnit = true) {
  if (val == null || val === '') return '—';
  const num = Number(val);
  if (!Number.isFinite(num)) return '—';
  const formatted = num.toFixed(3);
  return withUnit ? `${formatted} kg` : formatted;
}

