import { store } from '../game/state';
import { format, formatRate } from '../game/format';
import {
  GENERATORS,
  UPGRADES,
  PERMANENT_UPGRADES,
  STAGE_THRESHOLDS,
  STAGE_NAMES,
  generatorCost,
  upgradeCost,
  permanentUpgradeCost,
  totalRate,
  clickPower as computeClick,
  isStageUnlocked,
  currentStage,
  computeRebirthGain,
  computeRebirthGainOrdinal,
  getActiveTutorial,
  formatDuration,
  formatOrdinal,
  ordinalRate,
} from '../game/content';
import {
  doClick,
  buyGenerator,
  buyUpgrade,
  rebirth,
  buyPermanentUpgrade,
  dismissTutorial,
  rebirthMinPeak,
  rebirthMinOrdinal,
} from '../game/actions';
import { save, exportSave, resetSave } from '../game/save';
import { SLOT_LABEL } from '../game/slots';
import Decimal from 'break_eternity.js';
import { getTodayChallenge } from '../game/daily-challenge';
import { getOrdinalTier } from '../game/ordinal-tier';

// formatOrdinal 保留作为 ordinal panel 内部 fallback (task 6 brief out-of-scope: 不动 formatOrdinal)
void formatOrdinal;

let unsubRender: (() => void) | null = null;
export function mount(root: HTMLElement): void {
  // HMR 安全：避免多次 mount 时 store 订阅者堆积（每次 state 变化都跑多遍 renderAll）。
  // Vite 默认行为是整页 reload，但显式 idempotent 更稳。
  if (unsubRender) {
    unsubRender();
    unsubRender = null;
  }

  root.innerHTML = `
    <div class="game">
      <header class="header">
        <div class="title">大数增量 <span class="muted">M0~M6</span></div>
        <div class="stage-info">
          <span class="stage-label" id="stage-label">第 1 节 · 线性</span>
          <span class="stage-progress" id="stage-progress"></span>
          <span class="compute-display" id="compute-display" title="转生货币">算力 0</span>
          <span class="muted" id="slot-badge" title="当前存档槽（由网址 ?v= 决定，各槽互相独立）"
            >存档槽 ${SLOT_LABEL}</span>
        </div>
      </header>

      <div class="tutorial-banner hidden" id="tutorial-banner">
        <div class="tutorial-title" id="tutorial-title"></div>
        <div class="tutorial-body" id="tutorial-body"></div>
        <button class="tutorial-dismiss" id="tutorial-dismiss" data-tutorial-dismiss>知道了</button>
      </div>

      <section class="resource-block">
        <div class="main-number" id="main-number">0</div>
        <div class="rate" id="rate">每秒 +0</div>
        <button class="click-btn" id="click-btn">+<span id="click-power">1</span></button>
      </section>

      <section class="rebirth-section">
        <button id="btn-rebirth" class="rebirth-btn" disabled>
          <span data-rebirth-label>转生</span>
        </button>
        <div class="rebirth-hint" id="rebirth-hint"></div>
      </section>

      <section class="debug-panel" style="background:#fff3cd;border:1px solid #f0c040;padding:8px;margin:8px 0;font-family:monospace;font-size:12px;border-radius:4px;">
        <div style="font-weight:bold;color:#856404;margin-bottom:4px;">⚙ 调试面板（看到 bug 时告诉我这行的数）</div>
        <div id="debug-info" style="line-height:1.6;color:#333;">加载中...</div>
      </section>

      <section class="panel panel-permanent">
        <h2>永久升级（算力）</h2>
        <div class="panel-body" id="permanent">
          ${PERMANENT_UPGRADES.map(buildPermanentRowHTML).join('')}
        </div>
      </section>

      <section class="panel panel-ordinal" id="ordinal-panel" style="display:none;">
        <h2>序数标记 α <span class="muted" id="ordinal-display">0</span> · 每秒 +<span id="ordinal-rate">0</span></h2>
        <div class="panel-body" id="ordinal-generators">
          ${GENERATORS.filter((g) => g.stage === 7).map(buildGeneratorRowHTML).join('')}
        </div>
        <div class="panel-body" id="ordinal-upgrades">
          ${UPGRADES.filter((u) => u.stage === 7).map(buildUpgradeRowHTML).join('')}
        </div>
      </section>

      <div class="tree3-hint hidden" id="tree3-hint" style="background:#fff3cd;border:2px solid #f0c040;padding:12px;margin:8px 0;border-radius:4px;color:#856404;">
        <strong>数学的尽头</strong>：你的 tier ≥ 500 (Γ₁ 区域)。已逼近 TREE(3) —— 一个普通计算机永远无法验证的函数。继续推到 tier = 1000 可达不可计算函数的新高度。
      </div>

      <section class="panel panel-challenge" id="daily-challenge">
        <h2>每日挑战 <span class="muted" id="challenge-date"></span></h2>
        <div class="panel-body" id="challenge-body">
          推进 ordinal 到 tier ≥ <span id="challenge-target"></span>
          （当前 <span id="challenge-current"></span>）
        </div>
        <div class="panel-status" id="challenge-status"></div>
      </section>

      <section class="panels">
        <div class="panel">
          <h2>生成器</h2>
          <div class="panel-body" id="generators">
            ${GENERATORS.map(buildGeneratorRowHTML).join('')}
          </div>
        </div>
        <div class="panel">
          <h2>升级</h2>
          <div class="panel-body" id="upgrades">
            ${UPGRADES.map(buildUpgradeRowHTML).join('')}
          </div>
        </div>
      </section>

      <footer class="footer">
        <div class="stats-bar" id="stats-bar">
          <span class="stat">游玩 <span data-stat-time>0s</span></span>
          <span class="stat">点击 <span data-stat-clicks>0</span></span>
          <span class="stat">峰值 <span data-stat-peak>0</span></span>
          <span class="stat">最高 <span data-stat-best>0</span></span>
          <span class="stat">转生 <span data-stat-rebirths>0</span></span>
        </div>
        <div class="footer-actions">
          <button class="btn-secondary" id="btn-save">立即存盘</button>
          <button class="btn-secondary" id="btn-export">导出存档</button>
          <button class="btn-secondary" id="btn-reset">重置游戏</button>
          <span class="hint">每 30 秒自动存盘</span>
        </div>
      </footer>

      <div id="toast" class="toast hidden"></div>
    </div>
  `;

  bindEvents(root);
  renderAll();

  unsubRender = store.subscribe(() => renderAll());
}

function bindEvents(root: HTMLElement): void {
  root.querySelector('#click-btn')!.addEventListener('click', () => doClick());

  root.querySelector('#btn-save')!.addEventListener('click', () => {
    save();
    toast('已存盘');
  });

  root.querySelector('#btn-export')!.addEventListener('click', () => {
    const json = exportSave();
    navigator.clipboard.writeText(json).then(
      () => toast('已复制到剪贴板'),
      () => toast('导出失败'),
    );
  });

  root.querySelector('#btn-reset')!.addEventListener('click', () => {
    if (confirm('确定要重置整个进度？此操作不可撤销。')) {
      // resetSave() 负责：换 epoch（让其它标签页的旧存档立刻作废）
      // → 删存档 → 广播给其它标签页 → 重载。
      // 旧实现只删了 localStorage 里的 key，其它还开着的标签页会在
      // 30 秒后（或关页面时）把内存里的旧进度写回来 —— 这就是「重置没生效」。
      resetSave();
    }
  });

  // 事件委托：生成器面板
  root.querySelector('#generators')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-gen]');
    if (!btn) return;
    const id = btn.getAttribute('data-gen');
    if (id && !buyGenerator(id)) toast('资源不足');
  });

  // 事件委托：升级面板
  root.querySelector('#upgrades')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-upg]');
    if (!btn) return;
    const id = btn.getAttribute('data-upg');
    if (id && !buyUpgrade(id)) toast('资源不足');
  });

  // 转生按钮
  root.querySelector('#btn-rebirth')!.addEventListener('click', () => {
    const res = rebirth();
    if (res.success) {
      toast(`转生成功 +${res.gain} 算力`);
    } else {
      toast(res.reason ?? '转生失败');
    }
  });

  // 事件委托：永久升级面板
  root.querySelector('#permanent')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-perm]');
    if (!btn) return;
    const id = btn.getAttribute('data-perm');
    if (id && !buyPermanentUpgrade(id)) toast('算力不足');
  });

  // 教程 banner 关闭
  root.querySelector('#tutorial-banner')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-tutorial-dismiss]');
    if (!btn) return;
    const active = getActiveTutorial(store.get());
    if (active) dismissTutorial(active.id);
  });

  // 事件委托：序数 panel 内的 generator 行（cost 仍用 main 支付）
  root.querySelector('#ordinal-generators')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-gen]');
    if (!btn) return;
    const id = btn.getAttribute('data-gen');
    if (id && !buyGenerator(id)) toast('资源不足');
  });

  // 事件委托：序数 panel 内的 upgrade 行
  root.querySelector('#ordinal-upgrades')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-upg]');
    if (!btn) return;
    const id = btn.getAttribute('data-upg');
    if (id && !buyUpgrade(id)) toast('资源不足');
  });
}

function buildGeneratorRowHTML(g: typeof GENERATORS[number]): string {
  return `
    <div class="row" data-gen-row="${g.id}">
      <div class="row-main">
        <div class="row-name">${g.name} <span class="muted" data-gen-owned>×0</span></div>
        <div class="row-desc">${g.description}（每 owned 每秒）</div>
      </div>
      <button class="btn-buy" data-gen="${g.id}" disabled>
        <span class="cost" data-gen-cost>—</span>
      </button>
    </div>
  `;
}

function buildUpgradeRowHTML(u: typeof UPGRADES[number]): string {
  return `
    <div class="row" data-upg-row="${u.id}">
      <div class="row-main">
        <div class="row-name">${u.name} <span class="muted" data-upg-lv>Lv.0</span></div>
        <div class="row-desc">${u.description}</div>
      </div>
      <button class="btn-buy" data-upg="${u.id}" disabled>
        <span class="cost" data-upg-cost>—</span>
      </button>
    </div>
  `;
}

function buildPermanentRowHTML(u: typeof PERMANENT_UPGRADES[number]): string {
  return `
    <div class="row" data-perm-row="${u.id}">
      <div class="row-main">
        <div class="row-name">${u.name} <span class="muted" data-perm-lv>Lv.0</span></div>
        <div class="row-desc">${u.description}</div>
      </div>
      <button class="btn-buy btn-perm" data-perm="${u.id}" disabled>
        <span class="cost" data-perm-cost>—</span>
      </button>
    </div>
  `;
}

function renderAll(): void {
  const s = store.get();
  const root = document.getElementById('app');
  if (!root) return;

  // 教程 banner
  const activeTut = getActiveTutorial(s);
  const tutBanner = root.querySelector<HTMLElement>('#tutorial-banner');
  if (tutBanner) {
    if (activeTut) {
      tutBanner.classList.remove('hidden');
      setText(root, '#tutorial-title', activeTut.title);
      setText(root, '#tutorial-body', activeTut.body);
    } else {
      tutBanner.classList.add('hidden');
    }
  }

  // 序数区段：peak >= STAGE_THRESHOLDS[7] (= MAX_PEAK) 才显示
  const ordinalPanel = root.querySelector<HTMLElement>('#ordinal-panel');
  if (ordinalPanel) {
    const ordinalUnlocked = isStageUnlocked(s.peak, 7);
    ordinalPanel.style.display = ordinalUnlocked ? '' : 'none';
    if (ordinalUnlocked) {
      // M7: tier label 显示 (Γ₀ / Γ₀ + n / Γ₀ · ω / Γ₀² / Γ₁)
      const tier = Math.floor(s.ordinalTier);
      setText(root, '#ordinal-display', getOrdinalTier(s.ordinal, tier));
      const ordRate = ordinalRate(s).rate;
      setText(root, '#ordinal-rate', formatRate(ordRate));
      // 渲染 ordinal 区段里的 generator 行（cost 仍然是 main，ordinal 不能买自己）
      const ordGenBody = root.querySelector<HTMLElement>('#ordinal-generators');
      if (ordGenBody) {
        ordGenBody.innerHTML = GENERATORS
          .filter((g) => g.stage === 7)
          .map(buildGeneratorRowHTML)
          .join('');
        // 渲染每行的 cost/owned
        for (const g of GENERATORS.filter((gg) => gg.stage === 7)) {
          const row = ordGenBody.querySelector<HTMLElement>(`[data-gen-row="${g.id}"]`);
          if (!row) continue;
          const owned = s.generators[g.id] ?? 0;
          const cost = generatorCost(g, owned);
          const canBuy = s.main.gte(cost);
          setText(row, '[data-gen-owned]', `×${owned}`);
          setText(row, '[data-gen-cost]', format(cost));
          const btn = row.querySelector<HTMLButtonElement>('[data-gen]');
          if (btn) btn.disabled = !canBuy;
          row.classList.toggle('can-buy', canBuy);
        }
      }
      // 渲染 ordinal 区段里的 upgrade 行
      const ordUpgBody = root.querySelector<HTMLElement>('#ordinal-upgrades');
      if (ordUpgBody) {
        ordUpgBody.innerHTML = UPGRADES
          .filter((u) => u.stage === 7)
          .map(buildUpgradeRowHTML)
          .join('');
        for (const u of UPGRADES.filter((uu) => uu.stage === 7)) {
          const row = ordUpgBody.querySelector<HTMLElement>(`[data-upg-row="${u.id}"]`);
          if (!row) continue;
          const owned = s.upgrades[u.id] ?? 0;
          const cost = upgradeCost(u, owned);
          const canBuy = s.main.gte(cost);
          setText(row, '[data-upg-lv]', `Lv.${owned}`);
          setText(row, '[data-upg-cost]', format(cost));
          const btn = row.querySelector<HTMLButtonElement>('[data-upg]');
          if (btn) btn.disabled = !canBuy;
          row.classList.toggle('can-buy', canBuy);
        }
      }
    }
  }

  // M7: TREE(3) 边界提示 — bestOrdinalTier >= 500 时一次性显示
  if (s.bestOrdinalTier >= 500) {
    const hint = root.querySelector<HTMLElement>('#tree3-hint');
    if (hint && !sessionStorage.getItem('tree3-shown')) {
      hint.classList.remove('hidden');
      sessionStorage.setItem('tree3-shown', '1');
    }
  }

  // M7: 每日挑战面板
  const challenge = getTodayChallenge();
  const challengePanel = root.querySelector<HTMLElement>('#daily-challenge');
  if (challengePanel) {
    setText(root, '#challenge-date', challenge.date);
    setText(root, '#challenge-target', String(challenge.targetTier));
    setText(root, '#challenge-current', String(Math.floor(s.ordinalTier)));
    const statusEl = root.querySelector<HTMLElement>('#challenge-status');
    if (statusEl) {
      if (challenge.completed) {
        statusEl.textContent = '✅ 已完成 (+1 Compute)';
        statusEl.style.color = '#28a745';
      } else if (s.ordinalTier >= challenge.targetTier) {
        statusEl.textContent = '✅ 已达成 (下次 tick 领取奖励)';
        statusEl.style.color = '#28a745';
      } else {
        const remaining = challenge.targetTier - Math.floor(s.ordinalTier);
        statusEl.textContent = `还差 ${remaining} tier`;
        statusEl.style.color = '#6c757d';
      }
    }
  }

  // 统计条
  const elapsed = Date.now() - (s.startedAt || Date.now());
  setText(root, '[data-stat-time]', formatDuration(elapsed));
  setText(root, '[data-stat-clicks]', String(s.totalClicks));
  setText(root, '[data-stat-peak]', format(s.peak));
  setText(root, '[data-stat-best]', format(s.bestPeak));
  setText(root, '[data-stat-rebirths]', String(s.rebirthCount));

  // 调试面板：渲染 store 内部状态 + 最近一次 tick 算出的中间值
  const debugEl = root.querySelector<HTMLElement>('#debug-info');
  if (debugEl) {
    const t = (globalThis as any).__tickInfo;
    const r = (globalThis as any).__lastReturned;
    const lines = [
      `store.main        = ${s.main.toString()}`,
      `store.peak        = ${s.peak.toString()}`,
      `store.bestPeak    = ${s.bestPeak.toString()}`,
      `store.lastTick    = ${s.lastTick}  (${((Date.now() - s.lastTick) / 1000).toFixed(2)}s 前)`,
      `tick.computedPeak = ${t ? t.computedPeak : 'n/a'}`,
      `tick.autobuyLevel = ${t ? t.autobuyLevel : 'n/a'} (cap 100)`,
      `tick.autobuyBought = ${t ? t.autobuyBought : 'n/a'} (本 tick 实际买次)`,
      `tick.duration     = ${t ? t.tickMs : 'n/a'} ms (每 100ms tick)`,
      `---`,
      `ret.peak          = ${r ? r.peak : 'n/a'}`,
      `ret.bestPeak      = ${r ? r.bestPeak : 'n/a'}`,
      `ret.main          = ${r ? r.main : 'n/a'}`,
      `ret.hasOwnPeak    = ${r ? r.hasOwnPeak : 'n/a'}`,
    ];
    debugEl.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  }

  // 资源块
  setText(root, '#main-number', format(s.main));
  const rate = totalRate(s);
  setText(root, '#rate', `每秒 +${formatRate(rate)}`);
  setText(root, '#click-power', String(computeClick(s)));

  // 阶段信息 —— 当前节按 peak，但若转生后 bestPeak 仍在更高节，附加"历史最高"后缀，
  // 否则玩家重置后会一直卡在"第 1 节 · 线性"，不知道曾经到过更高阶段。
  const peakStage = currentStage(s.peak);
  const bestStage = currentStage(s.bestPeak);
  const peakName = STAGE_NAMES[peakStage] ?? `第 ${peakStage} 节`;
  const stageLabel = bestStage > peakStage
    ? `第 ${peakStage} 节 · ${peakName}（历史最高 第 ${bestStage} 节）`
    : `第 ${peakStage} 节 · ${peakName}`;
  setText(root, '#stage-label', stageLabel);

  const nextThreshold = nextStageThreshold(peakStage);
  const progressEl = root.querySelector('#stage-progress')!;
  progressEl.innerHTML = nextThreshold
    ? `下一节阈值 ${format(nextThreshold)}（当前 ${format(s.peak)}）`
    : `<span class="badge">第 ${peakStage} 节已完成</span>`;

  // 生成器行
  for (const g of GENERATORS) {
    const row = root.querySelector<HTMLElement>(`[data-gen-row="${g.id}"]`);
    if (!row) continue;
    const unlocked = isStageUnlocked(s.peak, g.stage);
    if (!unlocked) {
      row.classList.add('locked');
      row.classList.remove('can-buy');
      setText(row, '[data-gen-owned]', '🔒');
      setText(row, '[data-gen-cost]', '未解锁');
      const btn = row.querySelector<HTMLButtonElement>('[data-gen]');
      if (btn) btn.disabled = true;
      continue;
    }
    row.classList.remove('locked');
    const owned = s.generators[g.id] ?? 0;
    const cost = generatorCost(g, owned);
    const canBuy = s.main.gte(cost);

    setText(row, '[data-gen-owned]', `×${owned}`);
    setText(row, '[data-gen-cost]', format(cost));
    const btn = row.querySelector<HTMLButtonElement>('[data-gen]');
    if (btn) btn.disabled = !canBuy;
    row.classList.toggle('can-buy', canBuy);
  }

  // 升级行
  for (const u of UPGRADES) {
    const row = root.querySelector<HTMLElement>(`[data-upg-row="${u.id}"]`);
    if (!row) continue;
    const unlocked = isStageUnlocked(s.peak, u.stage);
    if (!unlocked) {
      row.classList.add('locked');
      row.classList.remove('can-buy');
      setText(row, '[data-upg-lv]', '🔒');
      setText(row, '[data-upg-cost]', '未解锁');
      const btn = row.querySelector<HTMLButtonElement>('[data-upg]');
      if (btn) btn.disabled = true;
      continue;
    }
    row.classList.remove('locked');
    const owned = s.upgrades[u.id] ?? 0;
    const cost = upgradeCost(u, owned);
    const canBuy = s.main.gte(cost);

    setText(row, '[data-upg-lv]', `Lv.${owned}`);
    setText(row, '[data-upg-cost]', format(cost));
    const btn = row.querySelector<HTMLButtonElement>('[data-upg]');
    if (btn) btn.disabled = !canBuy;
    row.classList.toggle('can-buy', canBuy);
  }

  // 头部 Compute
  setText(root, '#compute-display', `算力 ${format(s.rebirthCurrency)}`);

  // 转生按钮 —— 阈值按 rebirthCount 递增（每个 stage 终点一个节点）
  // M6: 第 7 次+ (rebirthCount >= 6) 用 ordinal 阈值
  const rebirthBtn = root.querySelector<HTMLButtonElement>('#btn-rebirth');
  if (rebirthBtn) {
    const useOrdinal = s.rebirthCount >= 6;
    const threshold = useOrdinal ? rebirthMinOrdinal(s.rebirthCount) : rebirthMinPeak(s.rebirthCount);
    const canRebirth = useOrdinal ? s.ordinal.gte(threshold) : s.peak.gte(threshold);
    rebirthBtn.disabled = !canRebirth;
    const gain = useOrdinal ? computeRebirthGainOrdinal(s.ordinal) : computeRebirthGain(s.peak);
    const nextNum = s.rebirthCount + 1;
    const resourceName = useOrdinal ? 'ordinal' : 'peak';
    const labelEl = rebirthBtn.querySelector<HTMLElement>('[data-rebirth-label]');
    if (labelEl) {
      labelEl.textContent = !canRebirth
        ? `第 ${nextNum} 次转生（需要 ${resourceName} ≥ ${format(threshold)}）`
        : `第 ${nextNum} 次转生（+${format(gain)} 算力）`;
    }
    setText(
      root,
      '#rebirth-hint',
      canRebirth
        ? `当前 ${resourceName} ${format(useOrdinal ? s.ordinal : s.peak)}，第 ${nextNum} 次转生将获得 ${format(gain)} 算力`
        : `${resourceName} ${format(useOrdinal ? s.ordinal : s.peak)} / ${format(threshold)}（第 ${nextNum} 次转生阈值）`,
    );
  }

  // 永久升级行（按 bestPeak 节卡门过滤）
  const currentBestStage = currentStage(s.bestPeak);
  for (const u of PERMANENT_UPGRADES) {
    // 还没达到解锁阶段 → 跳过（永久不渲染，直到达到）
    if (u.unlockStage && currentBestStage < u.unlockStage) continue;
    const row = root.querySelector<HTMLElement>(`[data-perm-row="${u.id}"]`);
    if (!row) continue;
    const owned = s.permanentUpgrades[u.id] ?? 0;
    const cost = permanentUpgradeCost(u, owned);
    const canBuy = s.rebirthCurrency.gte(cost);

    setText(row, '[data-perm-lv]', `Lv.${owned}`);
    setText(row, '[data-perm-cost]', format(cost));
    const btn = row.querySelector<HTMLButtonElement>('[data-perm]');
    if (btn) btn.disabled = !canBuy;
    row.classList.toggle('can-buy', canBuy);
  }
}

function nextStageThreshold(current: number): Decimal | null {
  return STAGE_THRESHOLDS[current + 1] ?? null;
}

function setText(scope: ParentNode, selector: string, text: string): void {
  const el = scope.querySelector(selector);
  if (el) el.textContent = text;
}

let toastTimer: number | null = null;
function toast(msg: string): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add('hidden'), 1500);
}