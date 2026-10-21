import Decimal from 'break_eternity.js';

export interface GeneratorDef {
  id: string;
  name: string;
  description: string;
  /** 基础产出（每 owned 每秒）—— Decimal 路径支持 1e20+ */
  baseRate: Decimal;
  /** 基础购买成本 —— Decimal 路径 */
  baseCost: Decimal;
  /** 每次购买后成本乘数 */
  costMultiplier: number;
  /** 解锁阶段（M2+ 用） */
  stage: number;
}

export interface UpgradeDef {
  id: string;
  name: string;
  description: string;
  /** 基础成本（第 1 次购买）—— 走 Decimal 路径，避免 1e308+ 时溢出 */
  cost: Decimal;
  /** 每次购买后成本乘数；1 = 成本固定 */
  costMultiplier: number;
  /** 解锁阶段（M2+ 用） */
  stage: number;
  /** 升级目标：'click' | 'generator:<id>' | 'global' | 'autobuy' | 'offline' */
  target: string;
  /** 升级效果：增量（如 +0.1 表示 +10%），仅在 target 为数值类时有意义 */
  effect: number;
}

/**
 * 永久升级定义（M3 起出现）。
 * cost / costMultiplier 走 Decimal 路径，避免后期进入 1e308 时崩。
 */
export interface PermanentUpgradeDef {
  id: string;
  name: string;
  description: string;
  /** 基础成本（第 1 次购买） */
  cost: Decimal;
  /** 每次购买后成本乘数；1 = 成本固定 */
  costMultiplier: number;
  /** 解锁阶段 —— bestPeak 达到对应阶段阈值（STAGE_THRESHOLDS[N]）后才显示。未设置则默认。 */
  unlockStage?: number;
  /** 目标：'perm_boost'（全局生成器加成）|'perm_click'（点击加成）|'perm_rate'（每秒产出乘性） */
  target: 'perm_boost' | 'perm_click' | 'perm_rate';
  /** 效果：
   *  - perm_boost: 每次 +0.25（即 +25% 全局生成器产出）
   *  - perm_click: 每次 +1（点击 +1）
   *  - perm_rate:  每次 ×1.05（每秒总产出乘性）
   */
  effect: number;
}

export interface GameState {
  /** 主资源（big num） */
  main: Decimal;
  /** 本轮峰值 —— 每次转生重置 */
  peak: Decimal;
  /** 历史最高峰值 —— 转生也不清 */
  bestPeak: Decimal;
  /** 序数标记 α（M6+）：Ordinal 体系下的当前序数层级 */
  ordinal: Decimal;
  /** 历史最高 ordinal（M6+）：转生不清，作为永久进度锚点 */
  bestOrdinal: Decimal;
  /** 序数 tier 累加器 (M7+),独立于 ordinal 实际值,允许 ordinal 已 cap 后仍有进度 */
  ordinalTier: number;
  /** 历史最高 tier (转生不清) */
  bestOrdinalTier: number;
  /** 生成器数量：id → 拥有数 */
  generators: Record<string, number>;
  /** 升级购买次数：id → 次数 */
  upgrades: Record<string, number>;
  /** 累计点击次数 */
  totalClicks: number;
  /** 上次保存时间戳（ms） */
  lastTick: number;
  /** 转生次数（M3 之前为 0） */
  rebirthCount: number;
  /** 转生货币（M3 起 = Compute） */
  rebirthCurrency: Decimal;
  /** 永久升级购买次数：id → 次数 */
  permanentUpgrades: Record<string, number>;
  /** 已看过的教程 id（v3+ 起；旧档默认空） */
  tutorialsSeen: string[];
  /** 首次启动时间戳（ms）；用于"游玩时间"统计 */
  startedAt: number;
  /** 版本号，用于存档迁移 */
  version: number;
}

/**
 * 教程定义 —— 触发条件为 true 且未在 tutorialsSeen 里时显示
 */
export interface TutorialDef {
  id: string;
  title: string;
  body: string;
  /** 触发条件：返回 true 时显示 */
  trigger: (s: GameState) => boolean;
}

export const SAVE_VERSION = 4;
/**
 * 存档 key 现在按「槽」隔离（?v= 参数），见 src/game/slots.ts。
 * 这里保留常量仅为兼容旧引用，实际请用 slots.ts 的 SAVE_KEY。
 */
export const SAVE_KEY = 'bigNumInc.save';
export const AUTOSAVE_INTERVAL_MS = 30_000;