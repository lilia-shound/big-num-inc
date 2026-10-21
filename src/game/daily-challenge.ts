/**
 * 每日挑战系统 (M7)
 * - 每天 (用本地时区 YYYY-MM-DD) 自动生成一个目标 tier
 * - 玩家推到 ordinalTier >= targetTier 完成挑战
 * - 完成一次后该挑战不再变化,跨日重新生成
 * - 存 localStorage['bigNumInc.daily'],独立于主存档
 * - 每日挑战也按存档槽隔离（?v=19 / ?v=20 各有各的挑战进度）
 */

import { DAILY_KEY } from './slots';

export interface DailyChallenge {
  /** YYYY-MM-DD (本地时区日期,跨日重新生成) */
  date: string;
  /** 目标 tier (1-20) */
  targetTier: number;
  /** 是否已完成 */
  completed: boolean;
  /** 随机种子 (玩家可能好奇当天奇偶的随机性) */
  seed: number;
}

/** 今天日期字符串 YYYY-MM-DD (本地时区) */
function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 取今天的挑战:
 * - 如果 localStorage 有当天记录 → 返回
 * - 如果过期 (date !== today) 或缺失 → 生成新挑战并写回
 */
export function getTodayChallenge(): DailyChallenge {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    if (raw) {
      const c = JSON.parse(raw) as DailyChallenge;
      if (c && c.date === today() && typeof c.targetTier === 'number') {
        return c;
      }
    }
  } catch {
    // 解析失败或 localStorage 不可用, 重新生成
  }
  // 新生成
  const seed = Math.floor(Math.random() * 1e9);
  // targetTier 范围 1-20 (MVP), 玩家推 ordinalTier >= targetTier 完成
  const targetTier = 1 + Math.floor(seed % 20);
  const fresh: DailyChallenge = {
    date: today(),
    targetTier,
    completed: false,
    seed,
  };
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(fresh));
  } catch {
    // localStorage 不可用 (e.g. 隐私模式), 静默失败 — 仅本次会话有效
  }
  return fresh;
}

/** 标记今日挑战已完成, 写回 localStorage */
export function markDailyComplete(): void {
  const c = getTodayChallenge();
  if (c.completed) return;
  c.completed = true;
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(c));
  } catch {
    // 静默
  }
}