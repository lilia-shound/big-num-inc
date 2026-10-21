import { load, save, saveOnUnload, installCrossTabWatch } from './game/save';
import { store } from './game/state';
import { tick } from './game/actions';
import { mount } from './ui/render';
import { AUTOSAVE_INTERVAL_MS } from './types';
import { SLOT_ID } from './game/slots';
import './style.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app element not found');

// 0. 监听跨标签页事件：别的标签页重置了本槽 → 本页立刻重新载入
installCrossTabWatch();

// 1. 尝试从 localStorage 恢复
const loaded = load();

// 1.5: 清掉 reset 标记 (上一轮 reset 留下的 sessionStorage 标记,save() 之前会跳过)
if (sessionStorage.getItem('resetting')) {
  sessionStorage.removeItem('resetting');
}

// 2. 挂载 UI（订阅 store 变化）
mount(root);

// 3. 启动主循环（100ms tick）
setInterval(tick, 100);

// 4. 定期自动存盘
setInterval(() => save(), AUTOSAVE_INTERVAL_MS);

// 5. 关闭前存盘（注意：关页面时绝不能触发 reload，所以用 saveOnUnload）
window.addEventListener('beforeunload', () => saveOnUnload());

// 调试用：把 store 挂到 window，方便控制台查看
Object.defineProperty(window, '__game', { value: store, writable: false });

if (loaded) {
  console.info('[main] save loaded');
} else {
  console.info('[main] fresh game');
}
console.info(`[slot] 存档槽 = ${SLOT_ID}`);

// build version marker —— 用于浏览器区分缓存的旧 JS。
// 每次重新 build 这个常量都会变，文件名 hash 跟着变，强制浏览器拉新版本。
console.info('[build] M7 v24 save-fix — slot-scoped save key (?v=) + epoch reset guard + cross-tab merge');