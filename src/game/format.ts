import Decimal from 'break_eternity.js';

/**
 * 大数格式化器（M0 ~ M7 范围,覆盖到 10↑↑↑↑3.5 即 eee1e15）
 * - (0, 1): 2 位小数
 * - [1, 1000): 整数
 * - [1000, 1e1000): 科学计数法 a.bcd × 10^n
 * - [1e1000, 1e1e6): "10^n" 单层（n 是普通整数）
 * - [1e1e6, 10^1e21): "10^x" 单层（x 用 sci 表示,避免 10^10000000000 这种）
 * - [10^1e10, 10^1e15): "10↑↑n.x" 多箭头节 5（M6）—— innerExp = log10(exp) ∈ [10, 15)
 *   → n = log10(innerExp) + 2 ∈ [3, ~3.18)
 * - layer 1 break_eternity 的 "10^^n" 范围 (10^1e15~10^1e1e15) 用 "10↑↑n.x" 同样显示
 * - layer 2 (10↑↑↑n) 显示成 "10↑↑↑n.x" 用 mag 计算
 * - layer 3+ (10↑↑↑↑n 等) 委托给 break_eternity 的 toString（ee/eee notation）
 *
 * 关键：break_eternity.js 提供 n.layer / n.mag / n.sign 字段,可直接用
 */
export function format(n: Decimal): string {
  if (!isFiniteDecimal(n)) return '∞';
  // 负数 / 0：log10 会得到 -Infinity / NaN,提前兜住
  if (!n.gt(0)) return '0';
  if (n.lt(1)) return n.toFixed(2).replace(/\.?0+$/, '');
  if (n.lt(1000)) return n.toFixed(0);

  // M7：break_eternity 的 layer 系统 —— 直接读 n.layer 字段
  // 注意：break_eternity 的 layer 是**自动选择**的（mag > ~15 自动升级到下一 layer），
  // 所以 ee20 字符串实际是 layer 2 (mag=20),Decimal.pow 出来链的可能是 layer 3 (mag=20)。
  const layer = (n as any).layer ?? 0;
  const mag = (n as any).mag;

  // layer 3+：四箭头及以上,显示成 "10↑↑↑↑n" 这种（其中 n 来自 mag 显示）
  if (layer >= 3) {
    // mag 是 layer 2 数,递归 format 显示成 "10↑↑↑n.x"
    const magStr = mag instanceof Decimal ? format(mag) : (mag?.toString?.() ?? '?');
    return `10↑↑↑↑(${magStr})`;
  }

  // layer 2：10↑↑↑n 范围
  if (layer === 2) {
    // mag 可能是普通数(<=1e15)或 layer 1 数(>1e15)。break_eternity 已自动选 layer 2.
    // 直接递归 format mag,前面加 "10↑↑↑" 前缀
    const magStr = mag instanceof Decimal ? format(mag) : (mag?.toString?.() ?? '?');
    return `10↑↑↑(${magStr})`;
  }

  // layer 1:10^^n 范围
  if (layer === 1) {
    const magStr = mag instanceof Decimal ? format(mag) : (mag?.toString?.() ?? '?');
    return `10^^(${magStr})`;
  }

  // layer 0:普通数,走原有科学计数法
  // break_eternity 的 log10() 对 layer 0 返回 number,layer >= 1 返回 Decimal.
  // 强制 toNumber() 让 TS 推断成 number 走原有数学比较
  const expRaw = n.log10();
  const exp = typeof expRaw === 'number' ? expRaw : expRaw.toNumber();
  if (!Number.isFinite(exp)) return '∞';
  if (exp < 1000) return formatSci(n);

  // exp >= 1000：用单层 "10^x"
  if (exp < 1e6) return `10^${Math.round(exp)}`;
  if (exp < 1e21) return `10^${exp.toExponential(2)}`;

  // exp >= 1e21：用双层
  const innerExp = Math.log10(exp);
  if (!Number.isFinite(innerExp)) return '∞';

  // M6:Stage 5 多箭头节 —— exp ∈ [1e10, 1e15)
  // innerExp ∈ [10, 15),n = log10(innerExp) + 2 ∈ [3, 3.18)
  if (innerExp < 100) {
    const arrowN = Math.log10(innerExp) + 2;
    return `10↑↑${arrowN.toFixed(2)}`;
  }

  if (innerExp < 1e6) return `10^10^${innerExp.toFixed(2)}`;

  // 三层
  const tripleExp = Math.log10(innerExp);
  if (!Number.isFinite(tripleExp)) return '∞';
  return `10^10^10^${tripleExp.toFixed(2)}`;
}

function formatSci(n: Decimal): string {
  const logRaw = n.log10();
  const logNum = typeof logRaw === 'number' ? logRaw : logRaw.toNumber();
  const expNum = Math.floor(logNum);
  const exp = new Decimal(expNum);
  const mant = n.div(Decimal.pow(10, exp));
  return `${mant.toFixed(2)}e${format(exp)}`;
}

/**
 * 专门给速率（每秒产出）用 —— 小数字下保留 2 位小数,
 * 避免 "+1.2/sec" 被取整成 "+1/sec" 让玩家看不到加成生效
 */
export function formatRate(n: Decimal): string {
  if (!isFiniteDecimal(n)) return '∞';
  if (n.lt(0.01)) return '0';
  if (n.lt(1000)) return n.toFixed(2).replace(/\.?0+$/, '');
  return format(n);
}

/**
 * break_eternity.js:Decimal.isFinite(value) 和 n.isFinite() 都行,
 * 它们递归检查所有 layer 的 mag / m / e 是否 finite.
 * 自己写 Number.isFinite 检查只看了顶层 m/e,layer >= 2 的 mag 会被漏掉。
 */
function isFiniteDecimal(n: Decimal): boolean {
  return n.isFinite();
}