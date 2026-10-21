import Decimal from 'break_eternity.js';
import { MAX_ORDINAL } from './content';

/**
 * Ordinal tier labels (symbolic, beyond break_eternity's Γ₀ cap).
 * ordinal 实际值 cap 在 MAX_ORDINAL = ee1e16 = Γ₀,
 * 但用 ordinalTier (number) 累加器表达"渐进"。
 */
export type OrdinalTierLabel =
  | 'Γ₀'
  | 'Γ₀ + n'
  | 'Γ₀ · ω'
  | 'Γ₀²'
  | 'Γ₁ (Veblen 极限)';

/**
 * OrdinalTier 阈值 (整数 tier 数):
 * - 0: Γ₀ (DEFAULT, ordinal = MAX_ORDINAL 时)
 * - 1-99: Γ₀ + n
 * - 100: Γ₀ · ω (100 = ω 简化)
 * - 200: Γ₀²
 * - 500: Γ₁ (Veblen 极限)
 */
export const ORDINAL_TIER_THRESHOLDS: { tier: number; label: OrdinalTierLabel }[] = [
  { tier: 0, label: 'Γ₀' },
  { tier: 100, label: 'Γ₀ · ω' },
  { tier: 200, label: 'Γ₀²' },
  { tier: 500, label: 'Γ₁ (Veblen 极限)' },
];

/**
 * ordinal 实际值 >= MAX_ORDINAL 视为"达到 Γ₀",后续 tier 由 ordinalTier 累加
 */
export function getOrdinalTier(ordinal: Decimal, tier: number): string {
  if (!ordinal.gte(MAX_ORDINAL)) {
    return tier > 0 ? `ω + ${tier}` : 'ω';
  }
  // 找最高 tier label (按阈值从大到小遍历)
  let label: OrdinalTierLabel = 'Γ₀';
  for (const t of ORDINAL_TIER_THRESHOLDS) {
    if (tier >= t.tier) label = t.label;
  }
  if (label === 'Γ₀' && tier > 0) {
    return `Γ₀ + ${tier}`;
  }
  return label;
}