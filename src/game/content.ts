import Decimal from 'break_eternity.js';
import { format } from './format';
import type { GeneratorDef, UpgradeDef, GameState, PermanentUpgradeDef, TutorialDef } from '../types';

/**
 * 主资源 / peak 软上限。
 * M7 起换 break_eternity.js，MAX_PEAK 推到 layer 3 边界（eee1e15 = 10↑↑↑↑3.5）。
 * Stage 5 终点 = ee1e15（layer 2 边界），Stage 6 终点 = eee1e15 = MAX_PEAK。
 * break_eternity 对各层 mag 上限 ~1e15（内部规范化），eee1e15 是当前有效上限。
 *
 * ⚠️ 不能用 `new Decimal('1e1e1e15')` —— break_eternity 同样只 split 第一个 'e'，
 * 会被错误解析成 '10'。必须用 `Decimal.pow(10, exp)` 显式构造每一层。
 */
export const MAX_PEAK = Decimal.pow(10, Decimal.pow(10, Decimal.pow(10, new Decimal(1e15))));

/**
 * 第 7 节终点 = ordinal ≥ MAX_ORDINAL 触发第 7 次转生。
 * 选 Decimal.pow(10, 1e16) = ee1e16: 比 Stage 6 endpoint (ee1e15) 大一个数量级,
 * 留出 1e15 的增长空间给玩家用 Stage 7 generators 推动。
 */
export const MAX_ORDINAL = Decimal.pow(10, 1e16);

/**
 * autobuy 等级 hard cap (per memory 规则:per-tick/per-sec 效果必须有上限)。
 * 防止 upg_autobuy 自己买自己导致反馈循环 —— 等级理论上无限叠加 (autobuy 可以买它自己),
 * 但每 tick 跑几万次循环会卡死主线程。100 次/tick 已经远超人手点击速度。
 */
export const AUTOBUY_HARD_CAP = 100;

/**
 * 序数标记 α 的显示规则 (MVP):
 * - < 3: 显示整数
 * - 在 layer 0/1 范围: e 记号 (跟 format() 一样)
 * - ≥ ee1e15 (Stage 6 endpoint): 显示 "ε₀"
 * - ≥ MAX_ORDINAL (ee1e16, Stage 7 endpoint): 显示 "Γ₀"
 * - 介于 ordinal 起点和 ee1e15 之间: 用 e 记号
 */
export function formatOrdinal(n: Decimal): string {
  if (n.lt(3)) return n.toString();
  if (n.gte(MAX_ORDINAL)) return 'Γ₀';
  if (n.gte(Decimal.pow(10, 1e15))) return 'ε₀';
  // layer 1 (10^1eN) 但还没到 ee1e15
  if ((n as any).layer === undefined && n.e >= 1e10) return 'ω^ω';
  // layer 0/1 用 e 记号
  return format(n);
}

/**
 * 节 → 解锁阈值（peak >= 阈值 才解锁该节）
 * M0~M5 范围：节 1=0, 节 2=1e3, 节 3=1e15, 节 4=1e30
 * Stage 5+（10↑↑↑n、Conway）暂留给后续
 */
export const STAGE_THRESHOLDS: Record<number, Decimal> = {
  1: new Decimal(0),
  2: new Decimal(1e3),
  3: new Decimal(1e15),
  4: new Decimal('1e30'),
  5: Decimal.pow(10, 1e10), // 10^^3 = 10^1e10 —— Stage 4 终点 = Stage 5 起点
  6: Decimal.pow(10, 1e15), // 10^^3.5 = 10^1e15 = Stage 5 终点 = Stage 6 起点 (bestPeak 到这层解锁 Stage 6)
  7: MAX_PEAK, // 10↑↑↑↑3.5 = eee1e15 = Stage 6 终点 = Stage 7 起点 (ordinal 区起点)
  8: MAX_ORDINAL, // Stage 8 解锁需 ordinal = Γ₀ (= ee1e16 = MAX_ORDINAL)
};

export const STAGE_NAMES: Record<number, string> = {
  1: '线性',
  2: '科学计数法',
  3: '双重指数',
  4: '指数塔',
  5: '多箭头', // 10↑↑n 范围 (layer 1)
  6: '链式箭头', // 10↑↑↑n 范围 (layer 2, Conway/Bowers 起点)
  7: '序数', // ε₀, Γ₀ 范围 (M6 新增, ordinal 是独立资源)
  8: '序数扩展', // M7 新增:ordinal ≥ Γ₀ 解锁, 推 ordinalTier 累加器
};

export function currentStage(peak: Decimal): number {
  let max = 1;
  for (const [s, threshold] of Object.entries(STAGE_THRESHOLDS)) {
    if (peak.gte(threshold)) max = Math.max(max, Number(s));
  }
  return max;
}

export function isStageUnlocked(peak: Decimal, stage: number): boolean {
  const threshold = STAGE_THRESHOLDS[stage];
  return threshold ? peak.gte(threshold) : false;
}

/**
 * ─────────── 第 1 节：线性 ───────────
 * 0 ~ 1e3：纯加法生成器
 */

export const GENERATORS: GeneratorDef[] = [
  {
    id: 'gen_basic',
    stage: 1,
    name: '基础生成器',
    description: '每秒 +1',
    baseRate: new Decimal(1),
    baseCost: new Decimal(10),
    costMultiplier: 1.15,
  },
  {
    id: 'gen_better',
    stage: 1,
    name: '进阶生成器',
    description: '每秒 +5',
    baseRate: new Decimal(5),
    baseCost: new Decimal(100),
    costMultiplier: 1.15,
  },
  {
    id: 'gen_best',
    stage: 1,
    name: '高效生成器',
    description: '每秒 +25',
    baseRate: new Decimal(25),
    baseCost: new Decimal(1000),
    costMultiplier: 1.15,
  },

  /**
   * ─────────── 第 2 节：科学计数法 ───────────
   * 1e3 ~ 1e15：更大的加法生成器，配合加成升级快速冲 1e15
   */
  {
    id: 'gen_mul_a',
    stage: 2,
    name: '乘法器 I',
    description: '每秒 +50',
    baseRate: new Decimal(50),
    baseCost: new Decimal(1000),
    costMultiplier: 1.15,
  },
  {
    id: 'gen_mul_b',
    stage: 2,
    name: '乘法器 II',
    description: '每秒 +500',
    baseRate: new Decimal(500),
    baseCost: new Decimal(1e4),
    costMultiplier: 1.15,
  },
  {
    id: 'gen_mul_c',
    stage: 2,
    name: '倍增器 I',
    description: '每秒 +5,000',
    baseRate: new Decimal(5000),
    baseCost: new Decimal(1e5),
    costMultiplier: 1.15,
  },
  {
    id: 'gen_mul_d',
    stage: 2,
    name: '倍增器 II',
    description: '每秒 +50,000',
    baseRate: new Decimal(50000),
    baseCost: new Decimal(1e7),
    costMultiplier: 1.15,
  },

  /**
   * ─────────── 第 3 节：双重指数 ───────────
   * 1e15 ~ 1e100：突破 Number 上限的"巨大数字"生成器。
   * cost 跟 rate 都走 Decimal 字符串路径以避免 1e15+ 的精度损失。
   * 终点 1e100（M3 转生阈值从 1e15 提到这里）。
   */
  {
    id: 'gen_dbl_a',
    stage: 3,
    name: '双倍器 I',
    description: '每秒 +1e20',
    baseRate: new Decimal('1e20'),
    baseCost: new Decimal('1e10'),
    costMultiplier: 1.5,
  },
  {
    id: 'gen_dbl_b',
    stage: 3,
    name: '双倍器 II',
    description: '每秒 +1e30',
    baseRate: new Decimal('1e30'),
    baseCost: new Decimal('1e18'),
    costMultiplier: 2,
  },
  {
    id: 'gen_dbl_c',
    stage: 3,
    name: '双倍器 III',
    description: '每秒 +1e50',
    baseRate: new Decimal('1e50'),
    baseCost: new Decimal('1e35'),
    costMultiplier: 3,
  },
  {
    id: 'gen_dbl_d',
    stage: 3,
    name: '双倍器 IV',
    description: '每秒 +1e95',
    baseRate: new Decimal('1e95'),
    baseCost: new Decimal('1e70'),
    costMultiplier: 5,
  },

  /**
   * ─────────── 第 4 节：指数塔 ───────────
   * 1e30 ~ 10^^3：rate 跨越 1e1000 到 10^(10^20)，峰值推到 10^^3 (= 10^1e10) 转生。
   * break_infinity.js 内部极限 10^^1e308，足够覆盖。
   */
  {
    id: 'gen_4_a',
    stage: 4,
    name: '塔基 I',
    description: '每秒 +1e1000',
    baseRate: new Decimal('1e1000'),
    baseCost: new Decimal('1e100'),
    costMultiplier: 1.5,
  },
  {
    id: 'gen_4_b',
    stage: 4,
    name: '塔基 II',
    description: '每秒 +10^1e10（≈10^^3）',
    baseRate: new Decimal('1e1e10'),
    baseCost: new Decimal('1e1000'),
    costMultiplier: 2,
  },
  {
    id: 'gen_4_c',
    stage: 4,
    name: '塔基 III',
    description: '每秒 +10^1e15',
    baseRate: new Decimal('1e1e15'),
    baseCost: new Decimal('1e1e10'),
    costMultiplier: 3,
  },
  {
    id: 'gen_4_d',
    stage: 4,
    name: '塔基 IV',
    description: '每秒 +10^1e20',
    baseRate: new Decimal('1e1e20'),
    baseCost: new Decimal('1e1e15'),
    costMultiplier: 5,
  },

  /**
   * ─────────── 第 5 节：多箭头（10↑↑n 推广）───────────
   * 10^^3 (= 10^1e10) ~ 10^^(3.5) (= 10^1e15 = MAX_PEAK)。
   * 区间 exp ∈ [1e10, 1e15]，break_infinity.js 仍能精确表示。
   * Stage 5 终点同时是第 2 次转生阈值，玩家需要推到 10^1e15 才能再转生。
   */
  {
    id: 'gen_5_a',
    stage: 5,
    name: '多箭头 I',
    description: '每秒 +10^1e11（≈10↑↑3.1）',
    baseRate: Decimal.pow(10, 1e11),
    baseCost: Decimal.pow(10, 1e10),
    costMultiplier: 2,
  },
  {
    id: 'gen_5_b',
    stage: 5,
    name: '多箭头 II',
    description: '每秒 +10^1e12（≈10↑↑3.2）',
    baseRate: Decimal.pow(10, 1e12),
    baseCost: Decimal.pow(10, 1e11),
    costMultiplier: 3,
  },
  {
    id: 'gen_5_c',
    stage: 5,
    name: '多箭头 III',
    description: '每秒 +10^1e13（≈10↑↑3.3）',
    baseRate: Decimal.pow(10, 1e13),
    baseCost: Decimal.pow(10, 1e12),
    costMultiplier: 5,
  },
  {
    id: 'gen_5_d',
    stage: 5,
    name: '多箭头 IV',
    description: '每秒 +10^1e14（≈10↑↑3.4）',
    baseRate: Decimal.pow(10, 1e14),
    baseCost: Decimal.pow(10, 1e13),
    costMultiplier: 10,
  },

  /**
   * ─────────── 第 6 节：链式箭头（10↑↑↑n 起步 → 跨入 layer 3）───────────
   * M7 起换 break_eternity.js。Stage 5 终点 = 10^1e15 = ee1e15（layer 1 边界），
   * Stage 6 把 MAX_PEAK 推到 layer 3 边界（eee1e15 = 10↑↑↑↑3.5）。
   *
   * 设计逻辑（M8 修复）：
   *  - 原版 cost = ee1e10..ee1e13（layer 2），要求 player main ≥ ee1e15 才能买，
   *    但 player 在 ee20 plateau 推不动 main 到 ee1e15 → 鸡生蛋 → 卡死
   *  - 修复后 cost = ee1e5..ee1e8（layer 1，Decimal.pow 单层），
   *    player ee20 main 直接买得起
   *  - rate 保持 layer 3 (eee1e11..eee1e15)，买完 main 跨 layer → peak = MAX_PEAK
   *
   * ⚠️ rate 必须用 `Decimal.pow(10, Decimal.pow(10, Decimal.pow(10, ...)))` 构造 layer 3 数，
   *    字符串路径 `new Decimal('1e1e1e15')` 会被解析成 '10'。
   */
  {
    id: 'gen_6_a',
    stage: 6,
    name: '链箭头 I',
    description: '每秒 +10↑↑↑↑3.1（≈ eee1e11）',
    baseRate: Decimal.pow(10, Decimal.pow(10, Decimal.pow(10, new Decimal(1e11)))),
    baseCost: Decimal.pow(10, new Decimal(1e5)),              // ee1e5 layer 1 (M8: 降成本让 player ee20 买得起)
    costMultiplier: 2,
  },
  {
    id: 'gen_6_b',
    stage: 6,
    name: '链箭头 II',
    description: '每秒 +10↑↑↑↑3.2（≈ eee1e12）',
    baseRate: Decimal.pow(10, Decimal.pow(10, Decimal.pow(10, new Decimal(1e12)))),
    baseCost: Decimal.pow(10, new Decimal(1e6)),              // ee1e6
    costMultiplier: 3,
  },
  {
    id: 'gen_6_c',
    stage: 6,
    name: '链箭头 III',
    description: '每秒 +10↑↑↑↑3.3（≈ eee1e13）',
    baseRate: Decimal.pow(10, Decimal.pow(10, Decimal.pow(10, new Decimal(1e13)))),
    baseCost: Decimal.pow(10, new Decimal(1e7)),              // ee1e7
    costMultiplier: 5,
  },
  {
    id: 'gen_6_d',
    stage: 6,
    name: '链箭头 IV',
    description: '每秒 +10↑↑↑↑3.5（≈ eee1e15 = MAX_PEAK）',
    baseRate: Decimal.pow(10, Decimal.pow(10, Decimal.pow(10, new Decimal(1e15)))),
    baseCost: Decimal.pow(10, new Decimal(1e8)),              // ee1e8
    costMultiplier: 10,
  },
  // ── Stage 7：序数（ordinal 区，独立资源，不操作 main）──
  // 这 4 个 generator 操作 ordinal (Task 6 ordinalRate)。
  // baseRate 是 ordinal 的"每 owned 每秒"产出；baseCost 用 main 支付（ordinal 不能买自己）。
  // Stage 7 在 ordinal 区 (peak ≥ MAX_PEAK = eee1e15) 解锁。
  // 数值设计：baseRate 1/5/25/125 (线性 5x), baseCost ee1e15 × 1/10/100/1000
  {
    id: 'gen_ord_a',
    stage: 7,
    name: '序数标记 I',
    description: 'ordinal +1/owned（每秒）',
    baseRate: new Decimal(1),
    baseCost: Decimal.pow(10, 1e15),              // 首次购买 = ee1e15 (Stage 6 endpoint = Stage 7 起点)
    costMultiplier: 1.5,
  },
  {
    id: 'gen_ord_b',
    stage: 7,
    name: '序数标记 II',
    description: 'ordinal +5/owned（每秒）',
    baseRate: new Decimal(5),
    baseCost: Decimal.pow(10, 1e15).mul(10),      // ee1e16 (= MAX_ORDINAL)
    costMultiplier: 1.5,
  },
  {
    id: 'gen_ord_c',
    stage: 7,
    name: '序数标记 III',
    description: 'ordinal +25/owned（每秒）',
    baseRate: new Decimal(25),
    baseCost: Decimal.pow(10, 1e15).mul(100),     // ee1e15 × 1e2
    costMultiplier: 1.5,
  },
  {
    id: 'gen_ord_d',
    stage: 7,
    name: '序数标记 IV',
    description: 'ordinal +125/owned（每秒）',
    baseRate: new Decimal(125),
    baseCost: Decimal.pow(10, 1e15).mul(1000),    // ee1e15 × 1e3
    costMultiplier: 1.5,
  },
  // ── Stage 8：序数扩展（推动 ordinalTier, rate 是 number 加到 tier 整数）──
  // baseRate 是 tier "每 owned 每秒" (number 量级, 0.01/0.05/0.25/1.0)
  // baseCost 用 main 支付 (ee1e15 × 1.05~2.00, 玩家推到 MAX_ORDINAL = ee1e16 之后才买得起)
  // costMultiplier 1.5/2/3/5 (Stage 7 是 1.5 全平直, Stage 8 适度递进避免前两台买不起第三台)
  // 实际 ordinal 值仍 cap 在 MAX_ORDINAL_2 (Task 3 加), 但 tier 持续推进, 显示"Γ₀ + n"
  {
    id: 'gen_8_a',
    stage: 8,
    name: '序数扩展 I',
    description: 'tier +0.01/owned（每秒）',
    baseRate: new Decimal(0.01),                                       // 平直小数值, Task 3 转 number
    baseCost: Decimal.pow(10, 1e15).mul(1.05),                         // ee1e15 × 1.05 (略超 MAX_ORDINAL)
    costMultiplier: 1.5,
  },
  {
    id: 'gen_8_b',
    stage: 8,
    name: '序数扩展 II',
    description: 'tier +0.05/owned（每秒）',
    baseRate: new Decimal(0.05),
    baseCost: Decimal.pow(10, 1e15).mul(1.10),                         // ee1e15 × 1.10
    costMultiplier: 2,
  },
  {
    id: 'gen_8_c',
    stage: 8,
    name: '序数扩展 III',
    description: 'tier +0.25/owned（每秒）',
    baseRate: new Decimal(0.25),
    baseCost: Decimal.pow(10, 1e15).mul(1.50),                         // ee1e15 × 1.50
    costMultiplier: 3,
  },
  {
    id: 'gen_8_d',
    stage: 8,
    name: '序数扩展 IV',
    description: 'tier +1.0/owned（每秒）',
    baseRate: new Decimal(1.0),
    baseCost: Decimal.pow(10, 1e15).mul(2.00),                         // ee1e15 × 2.00
    costMultiplier: 5,
  },
];

/**
 * 升级按阶段分组；Stage 2 升级要 peak >= 1e3 才解锁
 */
export const UPGRADES: UpgradeDef[] = [
  // ── Stage 1 ──
  {
    id: 'upg_click',
    stage: 1,
    name: '强力点击',
    description: '点击 +1',
    cost: new Decimal(50),
    costMultiplier: 1.5,
    target: 'click',
    effect: 1,
  },
  {
    id: 'upg_boost1',
    stage: 1,
    name: '加成 I',
    description: '所有生成器 +20%',
    cost: new Decimal(200),
    costMultiplier: 3,
    target: 'global',
    effect: 0.2,
  },
  {
    id: 'upg_boost2',
    stage: 1,
    name: '加成 II',
    description: '所有生成器 +50%',
    cost: new Decimal(2000),
    costMultiplier: 4,
    target: 'global',
    effect: 0.5,
  },
  {
    id: 'upg_autobuy',
    stage: 1,
    name: '自动购买',
    description: '每 tick 自动买最便宜的（每级 +1 次/tick）',
    cost: new Decimal(5000),
    costMultiplier: 5,
    target: 'autobuy',
    effect: 1,
  },
  {
    id: 'upg_offline',
    stage: 1,
    name: '离线加成',
    description: '离线收益 +25%',
    cost: new Decimal(25_000),
    costMultiplier: 10,
    target: 'offline',
    effect: 0.25,
  },

  // ── Stage 2 ──
  {
    id: 'upg_click2',
    stage: 2,
    name: '强力点击 II',
    description: '点击 +5',
    cost: new Decimal(1e4),
    costMultiplier: 2,
    target: 'click',
    effect: 5,
  },
  {
    id: 'upg_boost3',
    stage: 2,
    name: '加成 III',
    description: '所有生成器 +30%',
    cost: new Decimal(1e4),
    costMultiplier: 3,
    target: 'global',
    effect: 0.3,
  },
  {
    id: 'upg_boost4',
    stage: 2,
    name: '加成 IV',
    description: '所有生成器 +100%',
    cost: new Decimal(1e6),
    costMultiplier: 4,
    target: 'global',
    effect: 1.0,
  },
  {
    id: 'upg_offline2',
    stage: 2,
    name: '离线加成 II',
    description: '离线收益额外 +50%',
    cost: new Decimal(5e5),
    costMultiplier: 5,
    target: 'offline',
    effect: 0.5,
  },
  {
    id: 'upg_buy2',
    stage: 2,
    name: '自动购买 II',
    description: '自动购买也能买升级',
    cost: new Decimal(1e5),
    costMultiplier: 5,
    target: 'autobuy_upgrade',
    effect: 1,
  },

  // ── Stage 3 ──
  {
    id: 'upg_boost5',
    stage: 3,
    name: '加成 V',
    description: '所有生成器 +50%',
    cost: new Decimal('1e18'),
    costMultiplier: 5,
    target: 'global',
    effect: 0.5,
  },
  {
    id: 'upg_boost6',
    stage: 3,
    name: '加成 VI',
    description: '所有生成器 +100%',
    cost: new Decimal('1e30'),
    costMultiplier: 10,
    target: 'global',
    effect: 1.0,
  },
  {
    id: 'upg_click3',
    stage: 3,
    name: '强力点击 III',
    description: '点击 +1e6/Lv',
    cost: new Decimal('1e18'),
    costMultiplier: 3,
    target: 'click',
    effect: 1e6,
  },
  {
    id: 'upg_offline3',
    stage: 3,
    name: '离线加成 III',
    description: '离线收益 +100%',
    cost: new Decimal('1e25'),
    costMultiplier: 5,
    target: 'offline',
    effect: 1.0,
  },

  // ── Stage 4 ──
  {
    id: 'upg_boost7',
    stage: 4,
    name: '加成 VII',
    description: '所有生成器 +200%',
    cost: new Decimal('1e100'),
    costMultiplier: 5,
    target: 'global',
    effect: 2.0,
  },
  {
    id: 'upg_boost8',
    stage: 4,
    name: '加成 VIII',
    description: '所有生成器 +500%',
    cost: new Decimal('1e500'),
    costMultiplier: 10,
    target: 'global',
    effect: 5.0,
  },
  {
    id: 'upg_click5',
    stage: 4,
    name: '强力点击 IV',
    description: '点击 +1e10/Lv',
    cost: new Decimal('1e200'),
    costMultiplier: 3,
    target: 'click',
    effect: 1e10,
  },
  {
    id: 'upg_offline4',
    stage: 4,
    name: '离线加成 IV',
    description: '离线收益 +200%',
    cost: new Decimal('1e300'),
    costMultiplier: 5,
    target: 'offline',
    effect: 2.0,
  },

  // ── Stage 5：多箭头区 ──
  // cost 都在 10^1e11 ~ 10^1e13 区间，玩家需要推 peak 到 10^^3 才能买
  {
    id: 'upg_boost9',
    stage: 5,
    name: '加成 IX',
    description: '所有生成器 +50%',
    cost: Decimal.pow(10, 1e11),
    costMultiplier: 5,
    target: 'global',
    effect: 0.5,
  },
  {
    id: 'upg_boost10',
    stage: 5,
    name: '加成 X',
    description: '所有生成器 +100%',
    cost: Decimal.pow(10, 1e12),
    costMultiplier: 10,
    target: 'global',
    effect: 1.0,
  },
  {
    id: 'upg_click6',
    stage: 5,
    name: '强力点击 V',
    description: '点击 +1e15/Lv',
    cost: Decimal.pow(10, 1e12),
    costMultiplier: 3,
    target: 'click',
    effect: 1e15,
  },
  {
    id: 'upg_offline5',
    stage: 5,
    name: '离线加成 V',
    description: '离线收益 +200%',
    cost: Decimal.pow(10, 1e13),
    costMultiplier: 5,
    target: 'offline',
    effect: 2.0,
  },

  // ── Stage 6：链式箭头区（layer 2，break_eternity 才能算）──
  {
    id: 'upg_boost11',
    stage: 6,
    name: '加成 XI',
    description: '所有生成器 +50%',
    cost: Decimal.pow(10, Decimal.pow(10, new Decimal(1e11))),
    costMultiplier: 5,
    target: 'global',
    effect: 0.5,
  },
  {
    id: 'upg_boost12',
    stage: 6,
    name: '加成 XII',
    description: '所有生成器 +100%',
    cost: Decimal.pow(10, Decimal.pow(10, new Decimal(1e12))),
    costMultiplier: 10,
    target: 'global',
    effect: 1.0,
  },
  {
    id: 'upg_click7',
    stage: 6,
    name: '强力点击 VI',
    description: '点击 +1e15/Lv',
    cost: Decimal.pow(10, Decimal.pow(10, new Decimal(1e12))),
    costMultiplier: 3,
    target: 'click',
    effect: 1e15,
  },
  {
    id: 'upg_offline6',
    stage: 6,
    name: '离线加成 VI',
    description: '离线收益 +200%',
    cost: Decimal.pow(10, Decimal.pow(10, new Decimal(1e13))),
    costMultiplier: 5,
    target: 'offline',
    effect: 2.0,
  },

  // ── Stage 7：序数 ──
  // cost 用 main 支付（ordinal 不能买自己）。cost 设计参考 Stage 6 模式。
  // 4 个新 target 类型在 Task 6 ordinalRate 里处理。
  // - 'ordinal_rate': 乘性加成 (1 + effect)^bought
  // - 'ordinal_floor': 每级 +1/sec 基础产出
  // - 'ordinal_exp': baseRate 指数化 (effect = 10 的幂次)
  // - 'ordinal_pow': ordinal 整体按当前 ordinal 加速 (effect = 简化 FGH 系数)
  {
    id: 'upg_ord_mult',
    stage: 7,
    name: '序数加成 I',
    description: 'ordinal 产出 ×2',
    cost: Decimal.pow(10, 1e15),                // 首次 = ee1e15
    costMultiplier: 10,
    target: 'ordinal_rate',
    effect: 1,                                 // (1 + 1)^bought = 2^bought
  },
  {
    id: 'upg_ord_floor',
    stage: 7,
    name: '序数下限',
    description: '每秒 ordinal 至少 +1/Lv',
    cost: Decimal.pow(10, 1e15).mul(1e5),       // ee1e15 × 1e5
    costMultiplier: 5,
    target: 'ordinal_floor',
    effect: 1,                                 // 每级 +1/sec
  },
  {
    id: 'upg_ord_exp',
    stage: 7,
    name: '序数指数化',
    description: 'ordinal 产出按 baseRate 指数化',
    cost: Decimal.pow(10, 1e15).mul(1e6),       // ee1e15 × 1e6
    costMultiplier: 10,
    target: 'ordinal_exp',
    effect: 1,                                 // 简化: Decimal.pow(10, bought)
  },
  {
    id: 'upg_ord_pow',
    stage: 7,
    name: '序数迭代',
    description: 'ordinal 产出按当前 ordinal 加速（简化 FGH）',
    cost: Decimal.pow(10, 1e15).mul(1e7),       // ee1e15 × 1e7
    costMultiplier: 10,
    target: 'ordinal_pow',
    effect: 1,                                 // 简化: rate *= (1 + ordinal/1e10)^bought
  },
  // ── M7 Stage 8: 序数 tier 升级 ──
  // 用新 target 'tier_pow' (避免复用 'ordinal_pow' 引起 Stage 7 Decimal 爆炸)
  // baseCost ee1e15 × 2.5/5 (Stage 8 generator 终点是 max → payee1e15 × 5)
  // costMultiplier 10 (Stage 6/7 模式, 防重复购买)
  // 注意:ordinalRate() 里的 tier_pow 逻辑需要新加 (见 Step 3)
  {
    id: 'upg_ord_exp2',
    stage: 8,
    name: '序数迭代 II',
    description: 'tier rate ×2 / Lv（基础加成）',
    cost: Decimal.pow(10, 1e15).mul(2.5),                           // ee1e15 × 2.5
    costMultiplier: 10,
    target: 'tier_pow',                                             // 新 target
    effect: 10,                                                     // ×2 per purchase (1 + 10 * 0.1 = 2)
  },
  {
    id: 'upg_ord_pow2',
    stage: 8,
    name: '序数极限',
    description: 'tier rate ×11 / Lv（极限加成）',
    cost: Decimal.pow(10, 1e15).mul(5),                             // ee1e15 × 5 (= gen_8_d 起价 ×2.5)
    costMultiplier: 10,
    target: 'tier_pow',
    effect: 100,                                                    // ×11 per purchase (1 + 100 * 0.1 = 11)
  },
];

/**
 * ─────────── M3：永久升级（Compute 购买）───────────
 * 转生后保留，购买消耗 rebirthCurrency（= Compute）。
 * 解锁按 bestPeak 节卡门：bestPeak ≥ STAGE_THRESHOLDS[unlockStage] 才显示。
 * id 命名空间与普通 UPGRADES 隔离，避免混淆。
 */
export const PERMANENT_UPGRADES: PermanentUpgradeDef[] = [
  {
    id: 'perm_boost',
    name: '永久加成',
    description: '所有生成器 +25%/Lv',
    cost: new Decimal(1),
    costMultiplier: 1.5,
    unlockStage: 2, // bestPeak ≥ 1e3 解锁
    target: 'perm_boost',
    effect: 0.25,
  },
  {
    id: 'perm_click',
    name: '永久点击',
    description: '点击 +1/Lv',
    cost: new Decimal(2),
    costMultiplier: 2,
    unlockStage: 2,
    target: 'perm_click',
    effect: 1,
  },
  {
    id: 'perm_rate',
    name: '产出加速',
    description: '每秒产出 ×1.05^Lv',
    cost: new Decimal(5),
    costMultiplier: 3,
    unlockStage: 2,
    target: 'perm_rate',
    effect: 1.05,
  },
  // M4：第 3 节解锁的新永久升级
  {
    id: 'perm_stage3',
    name: '指数世代',
    description: '所有生成器 +50%/Lv（解锁于第 3 节）',
    cost: new Decimal(10),
    costMultiplier: 4,
    unlockStage: 3, // bestPeak ≥ 1e15 解锁
    target: 'perm_boost', // 跟 perm_boost 同一通路，乘性叠加
    effect: 0.5,
  },
  // M6：第 5 节解锁的新永久升级
  {
    id: 'perm_stage5',
    name: '多箭头世代',
    description: '所有生成器 +100%/Lv（解锁于第 5 节）',
    cost: new Decimal(100),
    costMultiplier: 5,
    unlockStage: 5, // bestPeak ≥ 10^^3 解锁
    target: 'perm_boost', // 跟 perm_boost 同一通路，乘性叠加
    effect: 1.0,
  },
  // M7：第 6 节解锁的新永久升级
  {
    id: 'perm_stage6',
    name: '链箭头世代',
    description: '所有生成器 +200%/Lv（解锁于第 6 节）',
    cost: new Decimal(1000),
    costMultiplier: 10,
    unlockStage: 6, // bestPeak ≥ 10↑↑↑3 解锁
    target: 'perm_boost',
    effect: 2.0,
  },
  // M6: 第 7 节解锁的新永久升级 (Stage 7 = ordinal 区)
  {
    id: 'perm_stage7',
    name: '序数世代',
    description: '所有生成器 +500%/Lv（解锁于第 7 节）',
    cost: new Decimal(10000),
    costMultiplier: 10,
    unlockStage: 7,                       // bestPeak ≥ STAGE_THRESHOLDS[7] 解锁
    target: 'perm_boost',                 // 跟 perm_boost 同一通路,乘性叠加
    effect: 5.0,                          // +500% per Lv
  },
  // M7: 第 8 节解锁的新永久升级 (Stage 8 = ordinalTier 区)
  {
    id: 'perm_stage8',
    name: '序数世代 II',
    description: '所有生成器 +1000%/Lv（解锁于第 8 节）',
    cost: new Decimal(100000),                                      // 比 perm_stage7 (10000) 高 10x
    costMultiplier: 10,
    unlockStage: 8,                                                // bestOrdinalTier ≥ STAGE_THRESHOLDS[8] 解锁
    target: 'perm_boost',                                          // 跟 perm_boost 同一通路, 乘性叠加
    effect: 10.0,                                                   // +1000% per Lv (Stage 7 是 +500%)
  },
];

/**
 * 第 1 节 → 第 2 节 解锁阈值（M3 起统一通过 STAGE_THRESHOLDS[2] 引用，
 * 此常量是已删除 export —— 不再单独导出）
 */

// ────────────────────────────────────────────────────────────
// 成本 / 产出计算
// ────────────────────────────────────────────────────────────

/**
 * 第 n 个生成器的当前购买成本
 * n=0 是第一个，n=owned 是下一个要买的
 */
export function generatorCost(def: GeneratorDef, owned: number): Decimal {
  return def.baseCost.mul(Decimal.pow(def.costMultiplier, owned));
}

/**
 * 升级当前购买成本
 * 第 1 次购买 = base，第 n 次 = base × mult^(n-1)
 */
export function upgradeCost(def: UpgradeDef, owned: number): Decimal {
  return def.cost.mul(Decimal.pow(def.costMultiplier, owned));
}

/**
 * 全局加成：所有 'global' 类升级 + 所有 target='perm_boost' 的永久升级，
 * 每个买 N 次 → multiplier = (1 + effect)^N（乘性叠加）
 */
export function globalMultiplier(state: GameState): Decimal {
  let mult = new Decimal(1);
  for (const u of UPGRADES) {
    if (u.target !== 'global') continue;
    const bought = state.upgrades[u.id] ?? 0;
    if (bought > 0) {
      mult = mult.mul(Decimal.pow(1 + u.effect, bought));
    }
  }
  // 永久升级（target === 'perm_boost'）—— 同一通路，乘性叠加
  for (const u of PERMANENT_UPGRADES) {
    if (u.target !== 'perm_boost') continue;
    const bought = state.permanentUpgrades[u.id] ?? 0;
    if (bought > 0) {
      mult = mult.mul(Decimal.pow(1 + u.effect, bought));
    }
  }
  return mult;
}

/** 单个生成器每秒实际产出（受全局加成影响） */
export function generatorRate(def: GeneratorDef, state: GameState): Decimal {
  const mult = globalMultiplier(state);
  return def.baseRate.mul(mult);
}

/** 所有生成器每秒产出总和 */
export function totalRate(state: GameState): Decimal {
  // 优化：globalMultiplier 提到循环外，之前每个 generator 都重算一次（16 个 = ×16）。
  // globalMultiplier 在一次 tick 内只依赖 state，跟 generator 无关。
  const mult = globalMultiplier(state);
  let total = new Decimal(0);
  for (const g of GENERATORS) {
    // Stage 7 + Stage 8 generators 操作 ordinal/ordinalTier, 不进 main 产出。
    // 它们的产出由 ordinalRate() 单独计算，避免污染 main 增长曲线。
    if (g.stage === 7 || g.stage === 8) continue;
    const owned = state.generators[g.id] ?? 0;
    if (owned === 0) continue;
    total = total.add(g.baseRate.mul(mult).mul(owned));
  }
  return total;
}

/**
 * Stage 7 ordinal 基础产出 = sum(stage 7 generator baseRate × owned) + ordinal_floor upgrade 等级
 */
export function ordinalFloor(state: GameState): Decimal {
  let floor = new Decimal(0);
  for (const g of GENERATORS) {
    if (g.stage !== 7) continue;
    const owned = state.generators[g.id] ?? 0;
    if (owned === 0) continue;
    floor = floor.add(g.baseRate.mul(owned));
  }
  // upg_ord_floor: 每级 +1/sec
  const floorBought = state.upgrades['upg_ord_floor'] ?? 0;
  if (floorBought > 0) floor = floor.add(floorBought);
  return floor;
}

/**
 * Stage 7 + Stage 8 总产出。
 * - `rate`: Stage 7 ordinal 实际值增长率 (Decimal, cap = MAX_ORDINAL)
 * - `tierRate`: Stage 8 ordinalTier 整数累加率 (number)
 *
 * Stage 7 处理 4 个 target:ordinal_rate / ordinal_exp / ordinal_pow / perm_boost
 * Stage 8 generators (gen_8_a/b/c/d) tierRate = baseRate.toNumber() * owned
 *   - 注意 tierRate 不走 perm_boost (避免 tier 爆炸)
 *   - 注意 tierRate 不走 ordinal_rate / ordinal_pow (Stage 8 升级在 Task 4 处理)
 *
 * 硬上限:
 * - rate 由 tick() 里的 ORDINAL_HARD_CAP (1e10/tick) 防止 layer 3 溢出
 * - tierRate 由 tick() 里的 ORDINAL_TIER_RATE_HARD_CAP (1000/tick, 见 actions.ts) 防止 tier 爆炸
 */
export function ordinalRate(state: GameState): { rate: Decimal; tierRate: number } {
  // ── Stage 7 ordinal rate ──
  let rate = ordinalFloor(state);
  // 'ordinal_rate' upgrade：乘性加成
  for (const u of UPGRADES) {
    if (u.target !== 'ordinal_rate') continue;
    const bought = state.upgrades[u.id] ?? 0;
    if (bought > 0) {
      rate = rate.mul(Decimal.pow(1 + u.effect, bought));
    }
  }
  // 'perm_boost' permanent upgrades：跟 main 一样通路
  for (const u of PERMANENT_UPGRADES) {
    if (u.target !== 'perm_boost') continue;
    const bought = state.permanentUpgrades[u.id] ?? 0;
    if (bought > 0) {
      rate = rate.mul(Decimal.pow(1 + u.effect, bought));
    }
  }
  // 'ordinal_exp' upgrade：指数化（简化：×10^bought）
  const expBought = state.upgrades['upg_ord_exp'] ?? 0;
  if (expBought > 0) {
    rate = rate.mul(Decimal.pow(10, expBought));
  }
  // 'ordinal_pow' upgrade：ordinal 自身做加速（简化 FGH）
  const powBought = state.upgrades['upg_ord_pow'] ?? 0;
  if (powBought > 0 && state.ordinal.gt(0)) {
    const factor = Decimal.pow(state.ordinal.div(1e10).add(1), powBought);
    rate = rate.mul(factor);
  }

  // ── M7 Stage 8 tier rate (number 累加) ──
  let tierRate = 0;
  for (const g of GENERATORS) {
    if (g.stage !== 8) continue;
    const owned = state.generators[g.id] ?? 0;
    if (owned === 0) continue;
    // baseRate 是 Decimal (0.01/0.05/0.25/1.0), 转 number 加到 tier
    tierRate += g.baseRate.toNumber() * owned;
  }
  // ── M7 Stage 8 upgrade: 'tier_pow' 乘性加成 ──
  for (const u of UPGRADES) {
    if (u.target !== 'tier_pow') continue;
    const bought = state.upgrades[u.id] ?? 0;
    if (bought > 0) {
      // effect=10 → ×2 per purchase; effect=100 → ×11 per purchase
      tierRate *= Math.pow(1 + u.effect * 0.1, bought);
    }
  }
  // 注意:tier rate 不乘 globalMultiplier / perm_boost (避免 tier 爆炸)
  // 硬上限由 tick() 里的 ORDINAL_TIER_RATE_HARD_CAP (1000/tick) 处理

  return { rate, tierRate };
}

/** 当前点击产出 */
export function clickPower(state: GameState): number {
  let base = 1;
  for (const u of UPGRADES) {
    if (u.target !== 'click') continue;
    const bought = state.upgrades[u.id] ?? 0;
    if (bought > 0) base += u.effect * bought;
  }
  // 永久升级（target === 'perm_click'）
  for (const u of PERMANENT_UPGRADES) {
    if (u.target !== 'perm_click') continue;
    const bought = state.permanentUpgrades[u.id] ?? 0;
    if (bought > 0) base += u.effect * bought;
  }
  return base;
}

/**
 * 永久升级当前购买成本
 * 第 1 次购买 = base，第 n 次 = base × mult^(n-1)
 */
export function permanentUpgradeCost(def: PermanentUpgradeDef, owned: number): Decimal {
  return def.cost.mul(Decimal.pow(def.costMultiplier, owned));
}

/**
 * perm_rate 永久升级的乘性系数：每秒总产出 × effect^Lv
 * effect = 1.05，所以 lv=0 → 1，lv=1 → 1.05，lv=10 → 1.05^10 ≈ 1.629
 */
export function permRateMultiplier(state: GameState): Decimal {
  const lv = state.permanentUpgrades['perm_rate'] ?? 0;
  if (lv <= 0) return new Decimal(1);
  const def = PERMANENT_UPGRADES.find((u) => u.id === 'perm_rate');
  if (!def) return new Decimal(1);
  return Decimal.pow(def.effect, lv);
}

/** 是否已解锁生成器自动购买 */
export function hasAutobuy(state: GameState): boolean {
  return (state.upgrades['upg_autobuy'] ?? 0) > 0;
}

/** 是否已解锁升级自动购买 */
export function hasAutobuyUpgrade(state: GameState): boolean {
  return (state.upgrades['upg_buy2'] ?? 0) > 0;
}

/**
 * 转生收益公式：max(1, log10(peak) - 4)
 * M7 起每个 stage 终点都设转生节点，公式常量从 -14 改 -4 让前几级奖励不会太小。
 * - peak = 1e3   → 1 (Stage 1 终点,新玩家首次转生)
 * - peak = 1e15  → 11 (Stage 2 终点)
 * - peak = 1e30  → 26 (Stage 3 终点)
 * - peak = 10^1e10 ≈ 1e10 (Stage 4 终点)
 * - peak = 10^1e15 ≈ 1e15 (Stage 5 终点)
 * - peak = eee1e15 ≈ ee1e15 (Stage 6 终点,reward 跨到 layer 2)
 *
 * 返回 Decimal:break_eternity 的 log10() 对 layer >= 1 返回 Decimal(layer 2 时是 layer 1),
 * 对 layer 0 返回 number.统一返回 Decimal 让调用方灵活。
 *
 * layer >= 2 时 log10 返回的 Decimal toNumber() 一定是 Infinity（超过 Number 安全区），
 * 走 fallback 路径：直接给 MAX_PEAK（layer 3 边界）作为奖励上限。
 */
export function computeRebirthGain(peak: Decimal): Decimal {
  if ((peak as any).layer >= 2) {
    // peak 是 layer >= 2 数,log10().toNumber() = Infinity,走 cap 路径
    return MAX_PEAK;
  }
  const log = peak.log10();
  // log 是 number 时包成 Decimal；已是 Decimal 直接用
  const logDec = typeof log === 'number' ? new Decimal(log) : log;
  return Decimal.max(new Decimal(1), logDec.sub(4));
}

/**
 * Ordinal 版转生收益公式 (M6): max(1, log10(ordinal) - 4)
 * - ordinal = MAX_ORDINAL (ee1e16)  → 15.5 (Stage 7 终点,reward 跨到 layer 1.5)
 * - ordinal = layer 0 number         → log10(number)
 * - ordinal = layer 1+ number        → fallback (log10().toNumber() = Infinity)
 *
 * 跟 computeRebirthGain 类似,但用 ordinal 而非 peak。
 * 对 layer >= 3 的 ordinal 走 fallback (直接给 MAX_ORDINAL 作为奖励上限)。
 */
export function computeRebirthGainOrdinal(ordinal: Decimal): Decimal {
  if ((ordinal as any).layer >= 3) {
    // ordinal 是 layer >= 3 数,log10 不可用,走 cap 路径
    return MAX_ORDINAL;
  }
  const log = ordinal.log10();
  const logDec = typeof log === 'number' ? new Decimal(log) : log;
  return Decimal.max(new Decimal(1), logDec.sub(4));
}

// ────────────────────────────────────────────────────────────
// 教程系统
// ────────────────────────────────────────────────────────────

/**
 * 每个教程：trigger 返回 true 且未在 tutorialsSeen 里时显示
 * 顺序敏感：先匹配先显示
 */
export const TUTORIALS: TutorialDef[] = [
  {
    id: 'stage2_unlock',
    title: '解锁第 2 节 · 科学计数法',
    body: '你的数字突破了 1,000 阈值！从现在起会用科学计数法显示（像 1.23e45 这样的）。第 2 节的 4 个生成器和 5 个升级都解锁了，去试试。',
    trigger: (s) => s.peak.gte(STAGE_THRESHOLDS[2]),
  },
  {
    id: 'stage3_unlock',
    title: '解锁第 3 节 · 双重指数',
    body: '你的数字突破了 1e15 阈值！从现在起会用"双重指数"显示（10^10^x 这种）。指数本身又是科学计数法。玩到 1e100 就能触发转生。',
    trigger: (s) => s.peak.gte(STAGE_THRESHOLDS[3]),
  },
  {
    id: 'stage4_unlock',
    title: '解锁第 4 节 · 指数塔',
    body: '数字突破了 1e30 阈值！进入指数塔节，符号开始变成 10^^n 这种"指数塔"（10 的 10 的 10 ... 次方）。目标 peak 达到 10^^3 就能再次转生。',
    trigger: (s) => s.bestPeak.gte(STAGE_THRESHOLDS[4]),
  },
  {
    id: 'stage5_unlock',
    title: '解锁第 5 节 · 多箭头',
    body: 'peak 突破 10^^3 后解锁第 5 节！节 4 是"双箭头"10^^n，节 5 是"多箭头"10↑↑↑n —— 10 的 10 的 10... 次方（n 层），符号进入"10↑↑n.x"的小数区域。目标是推到 10^(10^15)（≈10↑↑3.5）触发第二次转生。',
    trigger: (s) => s.bestPeak.gte(STAGE_THRESHOLDS[5]),
  },
  {
    id: 'stage6_unlock',
    title: '解锁第 6 节 · 链式箭头',
    body: 'peak 突破 10↑↑3.5 后解锁第 6 节！这一节靠 break_eternity.js 支撑，进入 Conway / Bowers 链式箭头区（10↑↑↑n），符号显示成 "10↑↑↑n.x" 形式。目标是推到 ee1e15（≈10↑↑↑3.5）触发第 6 次转生。',
    trigger: (s) => s.bestPeak.gte(STAGE_THRESHOLDS[6]),
  },
  {
    id: 'rebirth_ready',
    title: '可以转生了',
    body: 'peak 达到 1,000 后，你就可以转生了。转生会清空当前进度，但发放"算力"，用来买永久升级。算力跨转生保留，玩得越深奖励越多。',
    trigger: (s) => s.peak.gte(STAGE_THRESHOLDS[2]) && s.rebirthCount === 0,
  },
  {
    id: 'first_rebirth',
    title: '🎉 第一次转生',
    body: '恭喜！你现在有算力了，去永久升级区花掉它。永久加成（+25%/Lv）和永久点击（+1/Lv）是最开始的好选择。',
    trigger: (s) => s.rebirthCount >= 1,
  },
  {
    id: 'second_rebirth',
    title: '🎉 第二次转生',
    body: '你回到了 Stage 2 起点！每次转生都保留永久升级，所以推到下一个 stage 终点会更快。下一个目标：peak 达到 1e30（Stage 3 终点）。',
    trigger: (s) => s.rebirthCount >= 2,
  },
  {
    id: 'third_rebirth',
    title: '🎉 第三次转生',
    body: '你又上了一个台阶！算力已经能买好几级永久升级了。下一个目标：peak 达到 10^^3 = 10^(10^10)（Stage 4 终点），那是指数塔区。',
    trigger: (s) => s.rebirthCount >= 3,
  },
  {
    id: 'fourth_rebirth',
    title: '🎉 第四次转生',
    body: '你触到了 break_eternity.js 的精确上限 10^1e15 ≈ 10↑↑3.5。这是我们能稳定计算的极限了。算力已经天文数字，可以把永久升级买满。',
    trigger: (s) => s.rebirthCount >= 4,
  },
  {
    id: 'stage7_unlock',
    title: '解锁第 7 节 · 序数',
    body: 'peak 突破 MAX_PEAK 后解锁第 7 节！这里引入"序数标记 α"，独立于主资源。α 的增长用 break_eternity.js 的高 layer 算，符号显示成 ω / ε₀ / Γ₀ 风格。目标是推到 Γ₀ 级别触发第 7 次转生。',
    trigger: (s) => s.bestPeak.gte(STAGE_THRESHOLDS[7]),
  },
  {
    id: 'ordinal_reach',
    title: '🎉 触到 Γ₀',
    body: '你的序数标记达到了 Γ₀ 级别！这是 break_eternity.js 能稳定表达的序数上界。这将触发第 7 次转生。',
    trigger: (s) => s.ordinal.gte(MAX_ORDINAL),
  },
  {
    id: 'stage8_unlock',
    title: '解锁第 8 节 · 序数扩展',
    body: 'ordinal 达到 Γ₀ (= MAX_ORDINAL) 后解锁第 8 节。tier 累加器开始计数,符号从 Γ₀ 渐进到 Γ₀ + n / Γ₀ · ω / Γ₀² / Γ₁。继续推到 Ordinal Engine 不可计算函数的边界。',
    trigger: (s) => s.bestOrdinalTier >= 1,
  },
  {
    id: 'tree3_boundary',
    title: '数学的尽头',
    body: '你已经逼近 TREE(3) 的边界 —— 一个普通计算机永远无法验证的函数。继续推到 Γ₁ = Veblen(ω, 0) 也是不可计算的极限。当前引擎止步于 break_eternity.js 的精度,真正精确的序数代数需要 OmegaNum.js。',
    trigger: (s) => s.bestOrdinalTier >= 500,
  },
];

/**
 * 取当前应该显示的教程（第一个未见过且已触发的）
 * 没有就返回 null
 */
export function getActiveTutorial(state: GameState): TutorialDef | null {
  for (const t of TUTORIALS) {
    if (state.tutorialsSeen.includes(t.id)) continue;
    if (t.trigger(state)) return t;
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// 统计
// ────────────────────────────────────────────────────────────

/**
 * 把毫秒时长格式化成"Xh Ym" / "Ym Ys" / "Ys"
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}