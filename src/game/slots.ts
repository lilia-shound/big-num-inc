/**
 * 存档槽 (slot) 管理
 *
 * ── 为什么要这个模块 ──────────────────────────────────────────────
 * 线上地址形如 https://<host>/?v=19、?v=20、?v=21。
 * 修复前源码里根本没有读 `location.search` / `URLSearchParams`（grep 出现 0 次），
 * 所以 ?v=19 / ?v=20 / ?v=21 **共用同一个 localStorage key `bigNumInc.save`**：
 *   · 三个地址看到的永远是同一份进度；
 *   · 在任意一个地址点「重置」，会把另外两个地址的进度一起清掉；
 *   · 任何一个还开着的标签页都能把内存里的旧状态写回来，导致「重置没生效」。
 *
 * 现在 ?v= 决定存档槽：
 *   ?v=19 → 'bigNumInc.save.v19'
 *   ?v=20 → 'bigNumInc.save.v20'
 *   不带 ?v → 沿用 legacy key 'bigNumInc.save'（老玩家的进度不丢）
 *
 * ── epoch（重置世代号）────────────────────────────────────────────
 * `bigNumInc.save[.v19].epoch` 记录这个槽「被重置过几代」。
 * 重置时先把 epoch 换掉，再删存档：
 *   · 其它标签页启动时记住的 epoch 和磁盘上的对不上 → 它们的内存存档已作废，
 *     save() 会拒绝写盘（这就是「重置真的归零」的关键）；
 *   · 存档 JSON 内部也带一份 epoch，所以「重置前写出来的旧档」即使侥幸
 *     抢在删档之后落盘，重新载入时也会因为 epoch 不匹配被丢弃。
 */

/** 当前槽位 id：URL 上 ?v= 的值（已清洗）；没有 ?v 则为 'default' */
export const SLOT_ID: string = (() => {
  try {
    const raw = new URLSearchParams(window.location.search).get('v');
    if (!raw) return 'default';
    // 只允许安全字符，避免 key 里出现奇怪字符
    const clean = raw.trim().replace(/[^0-9A-Za-z_-]/g, '').slice(0, 32);
    return clean || 'default';
  } catch {
    return 'default';
  }
})();

/** legacy 存档 key（老版本所有人共用） */
export const LEGACY_SAVE_KEY = 'bigNumInc.save';

/** legacy 每日挑战 key */
export const LEGACY_DAILY_KEY = 'bigNumInc.daily';

/** 本槽的存档 key */
export const SAVE_KEY = SLOT_ID === 'default' ? LEGACY_SAVE_KEY : `${LEGACY_SAVE_KEY}.v${SLOT_ID}`;

/** 本槽的每日挑战 key */
export const DAILY_KEY = SLOT_ID === 'default' ? LEGACY_DAILY_KEY : `${LEGACY_DAILY_KEY}.v${SLOT_ID}`;

/** 本槽的 epoch key */
export const EPOCH_KEY = `${SAVE_KEY}.epoch`;

/** 记录 legacy 存档已经被哪个槽继承走了（保证只继承一次） */
export const ADOPT_KEY = `${LEGACY_SAVE_KEY}.adopted`;

/** 跨标签页广播频道名（按槽隔离） */
export const CHANNEL_NAME = `bigNumInc:${SLOT_ID}`;

/** 读当前 epoch；从未重置过时是 '0' */
export function readEpoch(): string {
  try {
    return localStorage.getItem(EPOCH_KEY) ?? '0';
  } catch {
    return '0';
  }
}

/** 生成一个新的 epoch（重置时用） */
export function newEpoch(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 槽位显示名，用于 UI */
export const SLOT_LABEL = SLOT_ID === 'default' ? '默认' : `v${SLOT_ID}`;
