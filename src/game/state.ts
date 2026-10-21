import Decimal from 'break_eternity.js';
import type { GameState } from '../types';
import { SAVE_VERSION } from '../types';
import { GENERATORS } from './content';

type Listener = () => void;

function freshState(): GameState {
  const gens: Record<string, number> = {};
  for (const g of GENERATORS) gens[g.id] = 0;
  return {
    main: new Decimal(0),
    peak: new Decimal(0),
    bestPeak: new Decimal(0),
    ordinal: new Decimal(0),
    bestOrdinal: new Decimal(0),
    ordinalTier: 0,
    bestOrdinalTier: 0,
    generators: gens,
    upgrades: {},
    totalClicks: 0,
    lastTick: Date.now(),
    rebirthCount: 0,
    rebirthCurrency: new Decimal(0),
    permanentUpgrades: {},
    tutorialsSeen: [],
    startedAt: Date.now(),
    version: SAVE_VERSION,
  };
}

/**
 * 极简响应式状态管理：state 变化触发 listeners。
 * 主循环每秒 tick 一次，UI 用 subscribe 拿到通知后重渲染。
 */
class Store {
  private state: GameState = freshState();
  private listeners = new Set<Listener>();

  get(): GameState {
    return this.state;
  }

  set(updater: (s: GameState) => GameState): void {
    const next = updater(this.state);
    // 不可变替换：state 引用必须变，订阅者才能感知到
    this.state = next;
    for (const l of this.listeners) l();
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const store = new Store();

export function resetGame(): void {
  store.set(() => freshState());
}