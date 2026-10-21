import Decimal from 'break_eternity.js';
import { store } from './state';
import {
  GENERATORS,
  UPGRADES,
  PERMANENT_UPGRADES,
  generatorCost,
  upgradeCost,
  permanentUpgradeCost,
  totalRate,
  ordinalRate,
  clickPower as computeClick,
  permRateMultiplier,
  isStageUnlocked,
  computeRebirthGain,
  computeRebirthGainOrdinal,
  MAX_PEAK,
  MAX_ORDINAL,
  AUTOBUY_HARD_CAP,
} from './content';
import { format } from './format';
import type { GameState } from '../types';
import { getTodayChallenge, markDailyComplete } from './daily-challenge';

/** 点击：增加主资源 */
export function doClick(): void {
  store.set((s) => {
    const gain = computeClick(s);
    const main = s.main.add(gain);
    const peak = main.gt(s.peak) ? main : s.peak;
    const bestPeak = peak.gt(s.bestPeak) ? peak : s.bestPeak;
    return {
      ...s,
      main,
      peak,
      bestPeak,
      totalClicks: s.totalClicks + 1,
    };
  });
}

/** 购买生成器 */
export function buyGenerator(id: string): boolean {
  const def = GENERATORS.find((g) => g.id === id);
  if (!def) return false;

  let success = false;
  store.set((s) => {
    const owned = s.generators[id] ?? 0;
    const cost = generatorCost(def, owned);
    if (s.main.lt(cost)) return s;
    success = true;
    return {
      ...s,
      main: s.main.sub(cost),
      generators: { ...s.generators, [id]: owned + 1 },
    };
  });
  return success;
}

/** 购买升级 */
export function buyUpgrade(id: string): boolean {
  const def = UPGRADES.find((u) => u.id === id);
  if (!def) return false;

  let success = false;
  store.set((s) => {
    const owned = s.upgrades[id] ?? 0;
    const cost = upgradeCost(def, owned);
    if (s.main.lt(cost)) return s;
    success = true;
    return {
      ...s,
      main: s.main.sub(cost),
      upgrades: { ...s.upgrades, [id]: owned + 1 },
    };
  });
  return success;
}

/**
 * 主循环：每秒 tick，把所有生成器的产出加到主资源。
 * 同时处理自动购买 —— 每 tick 买 autobuyLevel 次（默认 1，最便宜的优先）。
 */
export function tick(): void {
  store.set((s) => {
    const dt = (Date.now() - s.lastTick) / 1000;
    if (dt <= 0) return s;

    // M3：perm_rate 永久升级乘性叠加
    const rate = totalRate(s).mul(permRateMultiplier(s));
    let main = s.main.add(rate.mul(dt));
    let generators = s.generators;
    let upgrades = s.upgrades;

    // 关键修复：peak 必须在 autobuy 之前用"涨完的 main"算。
    // 否则 autobuy 会把 main 扣回去 → peak 永远卡在 s.peak 上不去（典型表现：永远停在 10）。
    // peak 是"曾经到达过的最高水位"，不应被支出压回。
    // peak/bestPeak 直接引用 —— Decimal 的 add/sub/mul 都是返回新实例，
    // 不会原地修改，所以 autobuy 改 main 不会污染 peak/bestPeak。
    // 之前用 `new Decimal(other)` clone 是误以为 Decimal 会原地变更 —— 但 layer ≥ 2
    // 时 `new Decimal(layer2)` 会经过 toString 解析，可能丢精度/降层。直接引用既安全又快。
    const peak = main.gt(s.peak) ? main : s.peak;
    const bestPeak = peak.gt(s.bestPeak) ? peak : s.bestPeak;

    // M6：ordinal 增长（独立于 main/peak，操作 ordinal 资源）。
    // 硬上限：防止 layer 3 溢出。每 tick 至多 +1e10。
    // M7: 拆 rate (Stage 7 ordinal Decimal) + tierRate (Stage 8 ordinalTier number)
    const ORDINAL_HARD_CAP = 1e10;
    const ORDINAL_TIER_RATE_HARD_CAP = 1000; // 每 tick tier rate 上限, 防止 tier 爆炸
    const { rate: ordinalRawRate, tierRate } = ordinalRate(s);
    const ordinalBump = ordinalRawRate.mul(dt).gt(ORDINAL_HARD_CAP)
      ? new Decimal(ORDINAL_HARD_CAP)
      : ordinalRawRate.mul(dt);
    const ordinal = s.ordinal.add(ordinalBump);
    const finalOrdinal = ordinal.gt(MAX_ORDINAL) ? MAX_ORDINAL : ordinal;

    // M7: tier 累加 (number, floor 整数)
    const tierBump = tierRate * dt;
    const cappedTierBump = tierBump > ORDINAL_TIER_RATE_HARD_CAP
      ? ORDINAL_TIER_RATE_HARD_CAP
      : tierBump;
    const finalOrdinalTier = Math.floor(s.ordinalTier + cappedTierBump);

    // 调试：把这一帧的关键内部变量挂到 window 上，让 render 显示出来
    const tickStart = performance.now();
    const autobuyLevelForDebug = s.upgrades['upg_autobuy'] ?? 0;
    // Hard cap:upg_autobuy 等级理论上可以无限叠加（autobuy 自己也能买它自己），
    // 但每 tick 跑几万次循环会直接卡死主线程。100 次/tick 已经远超人手点击速度，
    // 超过这个数就 cap 住。同时显示真实 cap 后的值，玩家买的"高级"不浪费感。
    // AUTOBUY_HARD_CAP 从 ./content 导入（与 pickCheapestUpgrade 共享）
    const autobuyLevelRaw = autobuyLevelForDebug;
    const autobuyLevel = Math.min(autobuyLevelRaw, AUTOBUY_HARD_CAP);
    (globalThis as any).__tickInfo = {
      sMain: s.main.toString(),
      sPeak: s.peak.toString(),
      rate: rate.toString(),
      dt,
      mainAfterAdd: main.toString(),
      computedPeak: peak.toString(),
      gtResult: main.gt(s.peak),
      autobuyLevel: autobuyLevelRaw,
      autobuyLevelCapped: autobuyLevel,
      tickMs: 0,
      autobuyBought: 0,
    };

    // 自动购买：每 tick 用 autobuyLevel 个"买次"买最便宜的 generator/upgrade。
    // 优化：批量买 —— 一次挑最便宜的，连续买 N 次直到买不起或用完买次，
    // 避免每轮都遍历 16 generator + 19 upgrade + 算 cost（后期大数时这点很卡）。
    // - autobuyUpgradeOn 每次循环重读，否则 upg_buy2 自己无法被 autobuy 解锁。
    // - 解锁检查用 main（已加 rate*dt）而不是 s.peak，避免 tick 期间 main 跨过阶段阈值时
    //   生成器晚一 tick 才解锁。
    if (autobuyLevel > 0) {
      let curGen = generators;
      let curUpg = upgrades;
      let boughtTotal = 0;

      // 用一次批量买代替 N 次单买循环
      let remaining = autobuyLevel;
      while (remaining > 0) {
        // 重新挑最便宜的 generator 和 upgrade（因为 curGen/curUpg 变了）
        const cheapestGen = pickCheapestGenerator(main, {
          peak: main,
          generators: curGen,
        });
        const autobuyUpgradeOn = (curUpg['upg_buy2'] ?? 0) > 0;
        const cheapestUpg = autobuyUpgradeOn
          ? pickCheapestUpgrade(main, {
              peak: main,
              upgrades: curUpg,
            })
          : null;

        // 选最便宜的(generator vs upgrade),买不起的那一边 = null
        let pickGen: typeof cheapestGen = null;
        let pickUpg: typeof cheapestUpg = null;
        if (cheapestGen && cheapestUpg) {
          if (cheapestGen.cost.lt(cheapestUpg.cost)) {
            pickGen = cheapestGen;
          } else {
            pickUpg = cheapestUpg;
          }
        } else if (cheapestGen) {
          pickGen = cheapestGen;
        } else if (cheapestUpg) {
          pickUpg = cheapestUpg;
        }

        // 都不买得起就停
        if (!pickGen && !pickUpg) break;

        // 批量买 generator —— 算连续 N 个 cost 总和（costMult 是等比）
        if (pickGen) {
          let buyCount = 0;
          let totalCost = new Decimal(0);
          let nextCost = pickGen.cost;
          const costMult = pickGen.def.costMultiplier;
          // 先算 candidate 再判断，少一次 add()（之前 condition + body 算了两遍 totalCost.add）
          while (buyCount < remaining) {
            const candidate = totalCost.add(nextCost);
            if (!main.gte(candidate)) break;
            totalCost = candidate;
            // 几何数列:cost(n+1) = cost(n) * costMult
            nextCost = nextCost.mul(costMult);
            buyCount++;
          }
          if (buyCount === 0) break; // 买不起 1 个
          main = main.sub(totalCost);
          curGen = { ...curGen, [pickGen.def.id]: pickGen.owned + buyCount };
          boughtTotal += buyCount;
          remaining -= buyCount;
        } else if (pickUpg) {
          // upgrade 一次性最多买 N 次（每次独立算 cost，因为 mult 不一定是整数幂）
          let buyCount = 0;
          let totalCost = new Decimal(0);
          let nextCost = pickUpg.cost;
          const costMult = pickUpg.def.costMultiplier;
          while (buyCount < remaining) {
            const candidate = totalCost.add(nextCost);
            if (!main.gte(candidate)) break;
            totalCost = candidate;
            nextCost = nextCost.mul(costMult);
            buyCount++;
          }
          if (buyCount === 0) break;
          main = main.sub(totalCost);
          curUpg = { ...curUpg, [pickUpg.def.id]: pickUpg.owned + buyCount };
          boughtTotal += buyCount;
          remaining -= buyCount;
        }
      }

      generators = curGen;
      upgrades = curUpg;
      (globalThis as any).__tickInfo.autobuyBought = boughtTotal;
    }

    // 软上限：防止 break_infinity.js 内部 mantissa 溢出成 Infinity
    const finalPeak = peak.gt(MAX_PEAK) ? MAX_PEAK : peak;
    const finalBestPeak = bestPeak.gt(MAX_PEAK) ? MAX_PEAK : bestPeak;
    const ret = {
      ...s,
      main,
      generators,
      upgrades,
      peak: finalPeak,
      bestPeak: finalBestPeak,
      ordinal: finalOrdinal,
      ordinalTier: finalOrdinalTier,
      bestOrdinalTier: Math.max(s.bestOrdinalTier, finalOrdinalTier),
      lastTick: Date.now(),
    };
    // 调试：把 return 的对象挂出来，对比 store.get()
    (globalThis as any).__lastReturned = {
      peak: ret.peak.toString(),
      bestPeak: ret.bestPeak.toString(),
      main: ret.main.toString(),
      keys: Object.keys(ret).join(','),
      hasOwnPeak: Object.prototype.hasOwnProperty.call(ret, 'peak'),
    };
    // tick 性能监控
    const tickMs = performance.now() - tickStart;
    (globalThis as any).__tickInfo.tickMs = tickMs.toFixed(2);
    // M7: 每日挑战完成检测
    // 必须在 tier 累加后 ret 构造前 — 用 finalOrdinalTier 而不是 s.ordinalTier
    // 奖励:+1 Compute (MVP, 后续可调整)
    const challenge = getTodayChallenge();
    if (!challenge.completed && finalOrdinalTier >= challenge.targetTier) {
      markDailyComplete();
      // 奖励:rebirthCurrency +1 (与星图奖励同规模, 早期玩家可见, 后期 trivial)
      const retWithReward = {
        ...ret,
        rebirthCurrency: ret.rebirthCurrency.add(new Decimal(1)),
      };
      (globalThis as any).__tickInfo.dailyChallenge = {
        date: challenge.date,
        targetTier: challenge.targetTier,
        completed: true,
      };
      return retWithReward;
    }
    (globalThis as any).__tickInfo.dailyChallenge = {
      date: challenge.date,
      targetTier: challenge.targetTier,
      completed: challenge.completed,
    };
    return ret;
  });
}

function pickCheapestGenerator(
  main: Decimal,
  state: Pick<GameState, 'peak' | 'generators'> = store.get(),
): { def: (typeof GENERATORS)[number]; owned: number; cost: Decimal } | null {
  let best: { def: (typeof GENERATORS)[number]; cost: Decimal } | null = null;
  for (const g of GENERATORS) {
    if (!isStageUnlocked(state.peak, g.stage)) continue;
    const owned = state.generators[g.id] ?? 0;
    const cost = generatorCost(g, owned);
    if (main.lt(cost)) continue;
    if (!best || cost.lt(best.cost)) {
      best = { def: g, cost };
    }
  }
  if (!best) return null;
  return { def: best.def, owned: state.generators[best.def.id] ?? 0, cost: best.cost };
}

function pickCheapestUpgrade(
  main: Decimal,
  state: Pick<GameState, 'peak' | 'upgrades'> = store.get(),
): { def: (typeof UPGRADES)[number]; owned: number; cost: Decimal } | null {
  // AUTOBUY_HARD_CAP 从 ./content 导入 (与 tick() 共享同一个常量)
  const autobuyCurrent = state.upgrades['upg_autobuy'] ?? 0;
  const autobuyUpgradeOn = (state.upgrades['upg_buy2'] ?? 0) > 0;
  let best: { def: (typeof UPGRADES)[number]; cost: Decimal } | null = null;
  for (const u of UPGRADES) {
    if (!isStageUnlocked(state.peak, u.stage)) continue;
    const owned = state.upgrades[u.id] ?? 0;
    // 反馈循环防护:upg_autobuy 等级已到 cap 时再买无意义 (cap 在 tick 里硬限 100)
    if (u.id === 'upg_autobuy' && autobuyCurrent >= AUTOBUY_HARD_CAP) continue;
    // upg_buy2 是布尔开关,买一次就解锁"自动买升级",再买无意义
    if (u.id === 'upg_buy2' && autobuyUpgradeOn) continue;
    const cost = upgradeCost(u, owned);
    if (main.lt(cost)) continue;
    if (!best || cost.lt(best.cost)) {
      best = { def: u, cost };
    }
  }
  if (!best) return null;
  return { def: best.def, owned: state.upgrades[best.def.id] ?? 0, cost: best.cost };
}

/** 转生最低 peak（M5：10^^3 = 10^1e10，让 Stage 4 指数塔区有意义） */
/** 第 N 次转生所需的最低 peak（M7 起每个 stage 终点都设转生节点,让新玩家也能早期转生）
 *  - 第 1 次：1e3                (Stage 1 终点,新玩家 30 秒可到)
 *  - 第 2 次：1e15               (Stage 2 终点)
 *  - 第 3 次：1e30               (Stage 3 终点)
 *  - 第 4 次：10^^3 (= 10^1e10)  (Stage 4 终点)
 *  - 第 5 次：10^1e15 = ee1e15   (Stage 5 终点,layer 2 边界)
 *  - 第 6 次：eee1e15 = MAX_PEAK (Stage 6 终点,layer 3 边界,break_eternity 极限)
 *  - 6 次以后保持 eee1e15(已经是库极限)
 * ⚠️ 不能用 `new Decimal('1e1eN')` 等嵌套指数字符串 —— break_eternity.js 只 split 第一个 'e'，
 *    会解析成 '10'。必须用 `Decimal.pow(10, exp)` 显式构造。
 */
export function rebirthMinPeak(rebirthCount: number): Decimal {
  switch (rebirthCount) {
    case 0: return new Decimal(1e3);
    case 1: return new Decimal(1e15);
    case 2: return new Decimal('1e30');
    case 3: return Decimal.pow(10, 1e10);
    case 4: return Decimal.pow(10, 1e15); // ee1e15 = Stage 5 终点
    case 5: return MAX_PEAK; // 第 6 次转生:peak ≥ MAX_PEAK = Stage 6 终点 = eee1e15
    default: return MAX_PEAK; // 兜底:Task 9 会把 rebirthCount >= 6 转去 ordinal 路径
  }
}

/**
 * 第 7 次+ 转生所需的最低 ordinal (Stage 7 endpoint 阈值)
 * - 第 7 次 (rebirthCount === 6): MAX_ORDINAL = ee1e16
 * - 7 次以后: 保持 MAX_ORDINAL
 *
 * 注: 这个函数在 Task 9 才真正被 rebirth() 调用。本任务只定义 + 导出。
 */
export function rebirthMinOrdinal(rebirthCount: number): Decimal {
  // MVP: 所有 7 次+ 转生都要求 ordinal ≥ MAX_ORDINAL
  // 未来扩展可以按 rebirthCount 区分不同阈值
  switch (rebirthCount) {
    case 6: return MAX_ORDINAL; // 第 7 次转生
    default: return MAX_ORDINAL; // MVP: 后续也用 MAX_ORDINAL
  }
}

/**
 * 转生：重置 main/generators/upgrades/totalClicks/peak，
 * 保留 rebirthCurrency 与 permanentUpgrades，按 log10(peak) 发放 Compute
 *
 * peak 也清零 —— 标准 prestige 循环，让玩家重新爬更高的峰。
 * 历史最高单独由 rebirthCount + rebirthCurrency 体现。
 *
 * M6: 第 7 次+ 转生 (rebirthCount >= 6) 改用 ordinal 阈值 + computeRebirthGainOrdinal 公式,
 * 同时重置 ordinal 并更新 bestOrdinal。
 */
export function rebirth(): { success: boolean; gain?: Decimal; reason?: string } {
  const s = store.get();
  // M6: 第 7 次+ (rebirthCount >= 6) 用 ordinal 阈值,否则用 peak
  const useOrdinal = s.rebirthCount >= 6;
  const threshold = useOrdinal ? rebirthMinOrdinal(s.rebirthCount) : rebirthMinPeak(s.rebirthCount);

  // 检查资源
  let resourceMet: boolean;
  let reason: string;
  if (useOrdinal) {
    resourceMet = s.ordinal.gte(threshold);
    reason = `需要 ordinal ≥ ${format(threshold)}`;
  } else {
    // 安全网：peak 溢出成 Infinity 时 gte 比较挂掉，强制允许转生并以阈值算 Compute
    // ⚠️ 不能用 `Number.isFinite(s.peak.m/e)` —— layer ≥ 2 时 peak.e 本身是 Infinity
    // （因为指数是 layer 1+ 的数），会让 valid 的 layer-2 peak 也被判成非 finite，
    // 转生奖励错误走 threshold 路径而不是 peak 路径。要用 Decimal 原生的 isFinite()。
    const peakIsFinite = s.peak.isFinite();
    resourceMet = peakIsFinite && !s.peak.lt(threshold);
    reason = `需要 peak ≥ ${format(threshold)}`;
  }
  if (!resourceMet) {
    return { success: false, reason };
  }

  // 算收益
  let computeGain: Decimal;
  if (useOrdinal) {
    computeGain = s.ordinal.isFinite()
      ? computeRebirthGainOrdinal(s.ordinal)
      : computeRebirthGainOrdinal(threshold);
  } else {
    const peakIsFinite = s.peak.isFinite();
    computeGain = peakIsFinite
      ? computeRebirthGain(s.peak)
      : computeRebirthGain(threshold);
  }

  store.set((cur) => {
    // 清空所有生成器
    const generators: Record<string, number> = {};
    for (const g of GENERATORS) generators[g.id] = 0;
    // bestPeak 用转生前的 peak 来评估（s 是 store.get() 的快照，转生前的 peak）
    const newBestPeak = s.peak.gt(cur.bestPeak) ? s.peak : cur.bestPeak;
    const cappedBestPeak = newBestPeak.gt(MAX_PEAK) ? MAX_PEAK : newBestPeak;
    // M6: bestOrdinal 同步更新 (转生前 ordinal 是 s.ordinal)
    const newBestOrdinal = s.ordinal.gt(cur.bestOrdinal) ? s.ordinal : cur.bestOrdinal;
    const cappedBestOrdinal = newBestOrdinal.gt(MAX_ORDINAL) ? MAX_ORDINAL : newBestOrdinal;
    return {
      ...cur,
      main: new Decimal(0),
      generators,
      upgrades: {},
      totalClicks: 0,
      peak: new Decimal(0),
      bestPeak: cappedBestPeak,
      ordinal: new Decimal(0),         // M6: 重置 ordinal
      bestOrdinal: cappedBestOrdinal,  // M6: 记录历史最高
      ordinalTier: 0,                            // M7: 重置 tier 累加器 (与 ordinal 同步)
      bestOrdinalTier: Math.max(cur.bestOrdinalTier, s.ordinalTier), // M7: 保留历史最高
      rebirthCount: cur.rebirthCount + 1,
      rebirthCurrency: cur.rebirthCurrency.add(computeGain),
      lastTick: Date.now(),
    };
  });

  return { success: true, gain: computeGain };
}

/** 购买永久升级：消耗 rebirthCurrency */
export function buyPermanentUpgrade(id: string): boolean {
  const def = PERMANENT_UPGRADES.find((u) => u.id === id);
  if (!def) return false;

  let success = false;
  store.set((s) => {
    const owned = s.permanentUpgrades[id] ?? 0;
    const cost = permanentUpgradeCost(def, owned);
    if (s.rebirthCurrency.lt(cost)) return s;
    success = true;
    return {
      ...s,
      rebirthCurrency: s.rebirthCurrency.sub(cost),
      permanentUpgrades: { ...s.permanentUpgrades, [id]: owned + 1 },
    };
  });
  return success;
}

/**
 * 关闭教程：标记为已见，不再显示
 */
export function dismissTutorial(id: string): void {
  store.set((s) => {
    if (s.tutorialsSeen.includes(id)) return s;
    return { ...s, tutorialsSeen: [...s.tutorialsSeen, id] };
  });
}