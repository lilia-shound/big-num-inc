import Decimal from 'break_eternity.js';
import type { GameState } from '../types';
import { SAVE_VERSION } from '../types';
import { store } from './state';
import {
  SLOT_ID,
  SAVE_KEY,
  DAILY_KEY,
  EPOCH_KEY,
  ADOPT_KEY,
  LEGACY_SAVE_KEY,
  CHANNEL_NAME,
  readEpoch,
  newEpoch,
} from './slots';

interface SerializedGameState {
  version: number;
  main: string;
  peak: string;
  /** 历史最高峰值（v3+ 起；旧档默认 = peak） */
  bestPeak?: string;
  /** 序数标记 α（v4+ 起；旧档默认 = '0'） */
  ordinal?: string;
  /** 历史最高 ordinal（v4+ 起；旧档默认 = '0'） */
  bestOrdinal?: string;
  /** 序数 tier 累加器（v4+ 起；旧档默认 = 0） */
  ordinalTier?: number;
  /** 历史最高 tier（v4+ 起；旧档默认 = 0） */
  bestOrdinalTier?: number;
  generators: Record<string, number>;
  upgrades: Record<string, number>;
  totalClicks: number;
  lastTick: number;
  rebirthCount: number;
  rebirthCurrency: string;
  /** v2 起：永久升级购买次数 */
  permanentUpgrades?: Record<string, number>;
  /** v1/v2 兼容：旧存档的点击基础（v3 起移除，总是 1） */
  clickPower?: number;
  /** v3+ 起：已看过的教程 id 列表 */
  tutorialsSeen?: string[];
  /** v3+ 起：首次启动时间戳（ms） */
  startedAt?: number;
  /** 写入时的 epoch（重置世代号）。旧档没有此字段 = '0' */
  epoch?: string;
  /** 写入时间戳（ms），跨标签页合并用 */
  savedAt?: number;
}

/**
 * 本页面启动时看到的 epoch。
 * 磁盘上的 epoch 和它不一致 => 这个槽在别处被重置过 => 本页内存里的存档已作废。
 */
let myEpoch = readEpoch();

/** 我们最后一次见到的磁盘存档的 savedAt（用来判断「是不是别的标签页刚写过」） */
let lastSeenSavedAt = 0;

/** 跨标签页广播频道 */
let channel: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL_NAME);
} catch {
  channel = null;
}

/**
 * 存档版本迁移。
 * 任何 version < SAVE_VERSION 的旧存档都会在这里被自动补齐缺失字段。
 * 每次 SAVE_VERSION 递增都必须在这里加一段。
 */
function migrate(json: SerializedGameState): SerializedGameState {
  let cur = json;

  // v1 → v2：引入 permanentUpgrades
  if (cur.version < 2) {
    cur = {
      ...cur,
      permanentUpgrades: cur.permanentUpgrades ?? {},
      version: 2,
    };
    console.info('[migrate] v1 → v2: injected permanentUpgrades');
  }

  // v2 → v3：移除 clickPower 字段（一直是常量 1，dead state）
  if (cur.version < 3) {
    const { clickPower: _dead, ...rest } = cur;
    cur = { ...rest, version: 3 };
    console.info('[migrate] v2 → v3: dropped clickPower');
  }

  // v3 → v4：引入序数体系（ordinal / bestOrdinal），旧档默认 = '0'
  if (cur.version < 4) {
    cur = {
      ...cur,
      ordinal: cur.ordinal ?? '0',
      bestOrdinal: cur.bestOrdinal ?? '0',
      ordinalTier: cur.ordinalTier ?? 0,
      bestOrdinalTier: cur.bestOrdinalTier ?? 0,
      version: 4,
    };
    console.info('[migrate] v3 → v4: injected ordinal/bestOrdinal + ordinalTier/bestOrdinalTier');
  }

  return cur;
}

function serialize(s: GameState): SerializedGameState {
  return {
    version: SAVE_VERSION,
    main: s.main.toString(),
    peak: s.peak.toString(),
    bestPeak: s.bestPeak.toString(),
    ordinal: s.ordinal.toString(),
    bestOrdinal: s.bestOrdinal.toString(),
    ordinalTier: s.ordinalTier,
    bestOrdinalTier: s.bestOrdinalTier,
    generators: { ...s.generators },
    upgrades: { ...s.upgrades },
    totalClicks: s.totalClicks,
    lastTick: s.lastTick,
    rebirthCount: s.rebirthCount,
    rebirthCurrency: s.rebirthCurrency.toString(),
    permanentUpgrades: { ...s.permanentUpgrades },
    tutorialsSeen: [...s.tutorialsSeen],
    startedAt: s.startedAt,
    epoch: myEpoch,
    savedAt: Date.now(),
  };
}

function deserialize(json: SerializedGameState): GameState {
  const peak = new Decimal(json.peak ?? '0');
  // 旧档没有 bestPeak 字段 —— 默认 = peak（既保护了 v3 之前的存档
  // 把当时的"保留的 peak"作为历史最高，又保持字段单调不减）
  const bestPeak = json.bestPeak !== undefined ? new Decimal(json.bestPeak) : peak;
  return {
    main: new Decimal(json.main ?? '0'),
    peak,
    bestPeak,
    ordinal: new Decimal(json.ordinal ?? '0'),
    bestOrdinal: new Decimal(json.bestOrdinal ?? '0'),
    ordinalTier: Number(json.ordinalTier ?? 0),
    bestOrdinalTier: Number(json.bestOrdinalTier ?? 0),
    generators: json.generators ?? {},
    upgrades: json.upgrades ?? {},
    totalClicks: json.totalClicks ?? 0,
    lastTick: json.lastTick ?? Date.now(),
    rebirthCount: json.rebirthCount ?? 0,
    rebirthCurrency: new Decimal(json.rebirthCurrency ?? '0'),
    permanentUpgrades: json.permanentUpgrades ?? {},
    tutorialsSeen: json.tutorialsSeen ?? [],
    startedAt: json.startedAt ?? Date.now(),
    version: json.version ?? SAVE_VERSION,
  };
}

// ── 跨标签页合并工具 ────────────────────────────────────────────────

function decMax(a: string, b: string): string {
  const da = new Decimal(a);
  const db = new Decimal(b);
  return da.gte(db) ? da.toString() : db.toString();
}

function numMax(a: number, b: number): number {
  return Math.max(a, b);
}

/** 两个计数表按「逐项取大」合并 —— 同一个玩家开两个标签页时，进度只会前进不会倒退 */
function recMax(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) {
    out[k] = Math.max(out[k] ?? 0, v);
  }
  return out;
}

/**
 * 把磁盘上的存档和内存中的存档合并（取各个进度维度的最大值）。
 * 两个标签页玩同一个槽时，任何一方都不会把另一方的进度覆盖掉。
 */
function mergeStates(mine: SerializedGameState, disk: SerializedGameState): SerializedGameState {
  return {
    version: SAVE_VERSION,
    main: decMax(mine.main, disk.main),
    peak: decMax(mine.peak, disk.peak),
    bestPeak: decMax(mine.bestPeak ?? '0', disk.bestPeak ?? '0'),
    ordinal: decMax(mine.ordinal ?? '0', disk.ordinal ?? '0'),
    bestOrdinal: decMax(mine.bestOrdinal ?? '0', disk.bestOrdinal ?? '0'),
    ordinalTier: numMax(mine.ordinalTier ?? 0, disk.ordinalTier ?? 0),
    bestOrdinalTier: numMax(mine.bestOrdinalTier ?? 0, disk.bestOrdinalTier ?? 0),
    generators: recMax(mine.generators ?? {}, disk.generators ?? {}),
    upgrades: recMax(mine.upgrades ?? {}, disk.upgrades ?? {}),
    totalClicks: numMax(mine.totalClicks ?? 0, disk.totalClicks ?? 0),
    lastTick: numMax(mine.lastTick ?? 0, disk.lastTick ?? 0),
    rebirthCount: numMax(mine.rebirthCount ?? 0, disk.rebirthCount ?? 0),
    rebirthCurrency: decMax(mine.rebirthCurrency ?? '0', disk.rebirthCurrency ?? '0'),
    permanentUpgrades: recMax(mine.permanentUpgrades ?? {}, disk.permanentUpgrades ?? {}),
    tutorialsSeen: [...new Set([...(mine.tutorialsSeen ?? []), ...(disk.tutorialsSeen ?? [])])],
    startedAt: Math.min(mine.startedAt ?? Date.now(), disk.startedAt ?? Date.now()),
    epoch: myEpoch,
    savedAt: Date.now(),
  };
}

// ── epoch / 失效处理 ─────────────────────────────────────────────────

/** 本槽在别处被重置过：内存里的存档作废，重新载入 */
let staleHandled = false;
function onStaleSlot(): void {
  if (staleHandled) return;
  staleHandled = true;
  console.warn('[save] slot was reset in another tab — dropping stale state, reloading');
  try {
    location.reload();
  } catch {
    /* ignore */
  }
}

/** 磁盘 epoch 和本页记住的不一致 → 本页状态已作废 */
function isStale(): boolean {
  return readEpoch() !== myEpoch;
}

/**
 * 旧档继承（全局只做一次）。
 *
 * 老版本所有人共用 `bigNumInc.save`。升级后 ?v=19/20/21 各自独立，
 * 如果直接换 key，老玩家进度会凭空消失。这里让「第一个访问某个 ?v= 槽的页面」
 * 把 legacy 存档继承过来一次并登记，其余槽从零开始 ——
 * 既不丢老玩家的进度，也保证三档真正独立。
 */
function adoptLegacyOnce(): void {
  if (SLOT_ID === 'default') return; // legacy 槽就是它自己
  try {
    if (localStorage.getItem(SAVE_KEY)) return; // 本槽已经有存档了
    if (localStorage.getItem(ADOPT_KEY)) return; // 已经被别的槽继承走了
    const legacy = localStorage.getItem(LEGACY_SAVE_KEY);
    if (!legacy) return;
    const parsed = JSON.parse(legacy) as SerializedGameState;
    if (typeof parsed.version !== 'number') return;
    // legacy 存档没有 epoch 字段 —— 补上当前 epoch，它才能被正常读取
    parsed.epoch = myEpoch;
    parsed.savedAt = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(parsed));
    localStorage.setItem(ADOPT_KEY, SLOT_ID);
    console.info(`[adopt] legacy save adopted by slot "${SLOT_ID}"`);
  } catch (e) {
    console.warn('[adopt] failed', e);
  }
}

// ── 存盘 ─────────────────────────────────────────────────────────────

/**
 * 写盘。
 * @param allowReload 磁盘 epoch 和本页不一致时，是否允许触发重新载入。
 *                    关页面（beforeunload）时必须传 false，否则会触发重载死循环。
 */
function writeSave(allowReload: boolean): void {
  // 老机制保留：重置流程中跳过写盘
  if (sessionStorage.getItem('resetting')) return;

  // 新机制：别的标签页重置过这个槽 —— 我们的内存存档已经作废，绝不能写回去
  if (isStale()) {
    if (allowReload) onStaleSlot();
    return;
  }

  try {
    const mine = serialize(store.get());
    const raw = localStorage.getItem(SAVE_KEY);
    let final = mine;
    if (raw) {
      const disk = JSON.parse(raw) as SerializedGameState;
      const diskAt = disk.savedAt ?? 0;
      if (diskAt > lastSeenSavedAt) {
        // 别的标签页在我们上次看盘之后写过 —— 合并，别覆盖
        final = mergeStates(mine, disk);
      }
      lastSeenSavedAt = Math.max(lastSeenSavedAt, diskAt);
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(final));
    lastSeenSavedAt = final.savedAt ?? Date.now();
  } catch (e) {
    console.error('[save] failed', e);
  }
}

/** 正常存盘（自动存盘 / 手动「立即存盘」） */
export function save(): void {
  writeSave(true);
}

/** 关页面 / 刷新前存盘 —— 绝不触发重新载入 */
export function saveOnUnload(): void {
  writeSave(false);
}

/**
 * 彻底重置本槽。
 *
 * 顺序很关键：
 *   1) 先换 epoch —— 别的标签页立刻知道这个槽被重置了，它们的旧存档作废，
 *      之后即使触发 beforeunload / 30 秒定时器也不会把旧进度写回来；
 *   2) 再删存档 + 删每日挑战；
 *   3) 广播 + storage 事件 —— 别的标签页立刻感知并重新载入（不用等 30 秒）；
 *   4) 重载本页。
 */
export function resetSave(): void {
  const epoch = newEpoch();
  try {
    // 先 epoch 后删档：反过来的话，中间会有窗口让别的标签页把旧档写回来
    localStorage.setItem(EPOCH_KEY, epoch);
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(DAILY_KEY);
    // 老机制：让本页 unload 时的 save() 也跳过
    sessionStorage.setItem('resetting', '1');
  } catch (e) {
    console.error('[reset] failed', e);
  }
  // 通知别的标签页
  try {
    channel?.postMessage({ type: 'reset', epoch, slot: SLOT_ID });
  } catch {
    /* ignore */
  }
  location.reload();
}

/** 安装跨标签页监听：别的标签页重置了这个槽 → 本页立刻重新载入 */
export function installCrossTabWatch(): void {
  // storage 事件：同源其它标签页改了 localStorage 时触发（本页不会触发）
  window.addEventListener('storage', (e) => {
    if (e.key === EPOCH_KEY && isStale()) onStaleSlot();
  });
  // BroadcastChannel：同一槽的实时广播
  try {
    channel?.addEventListener('message', (e) => {
      const data = e.data as { type?: string; slot?: string };
      if (data?.type === 'reset' && data.slot === SLOT_ID && isStale()) onStaleSlot();
    });
  } catch {
    /* ignore */
  }
}

export function load(): boolean {
  try {
    adoptLegacyOnce();
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const json = JSON.parse(raw) as SerializedGameState;
    if (typeof json.version !== 'number') {
      console.warn('[load] invalid save: missing version');
      return false;
    }
    // 旧档继承后 savedAt 会被刷新，这里同步一下「我们最后见到的磁盘版本」
    lastSeenSavedAt = json.savedAt ?? 0;

    // epoch 校验：这个存档是「被重置前的旧世代」写出来的吗？是的话直接丢弃。
    // 这是「重置真的归零」的最后一道保险 —— 哪怕旧档抢在删档之后落盘也读不回来。
    const fileEpoch = json.epoch ?? '0';
    if (fileEpoch !== myEpoch) {
      console.warn('[load] stale save ignored (epoch mismatch)');
      // 顺手清掉这个作废的存档（别的标签页已经因为 epoch 变了写不进来了）
      try {
        localStorage.removeItem(SAVE_KEY);
      } catch {
        /* ignore */
      }
      return false;
    }

    const migrated = migrate(json);
    const restored = deserialize(migrated);
    store.set(() => restored);
    return true;
  } catch (e) {
    console.error('[load] failed', e);
    return false;
  }
}

export function exportSave(): string {
  return JSON.stringify(serialize(store.get()), null, 2);
}

/**
 * 导入存档（把「导出存档」的 JSON 粘进来）。
 *
 * 换域名/换部署地址时 localStorage 是按 origin 隔离的，老存档不会自动跟过来，
 * 这时可以用这个功能把进度搬过来。
 *
 * 注意：导入的存档必须盖上**当前 epoch** —— 否则 load() 的 epoch 校验会把它
 * 当成「重置前的旧世代」直接丢掉。
 */
export function importSave(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as SerializedGameState;
    if (typeof parsed.version !== 'number') {
      console.warn('[import] invalid save: missing version');
      return false;
    }
    const migrated = migrate(parsed);
    migrated.epoch = myEpoch;
    migrated.savedAt = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(migrated));
    // 立刻生效
    load();
    return true;
  } catch (e) {
    console.error('[import] failed', e);
    return false;
  }
}

/** 当前槽位 id（给 UI 显示用） */
export { SLOT_ID };
