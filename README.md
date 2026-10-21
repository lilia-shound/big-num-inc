# 大数增量 (Big Number Incremental)

一个把大数表示法本身做成玩法的增量小游戏。

**本仓库是 `https://t6rvv3p56esg2.space.mcode.cn/` 的源码，并修复了存档重置失效的 bug。**

## 存档槽（`?v=`）

存档 key 按 URL 上的 `?v=` 参数隔离，各档**互相独立**：

| 地址 | localStorage key |
|---|---|
| `/?v=19` | `bigNumInc.save.v19` |
| `/?v=20` | `bigNumInc.save.v20` |
| `/?v=21` | `bigNumInc.save.v21` |
| `/`（不带 `?v=`） | `bigNumInc.save`（legacy，老玩家进度不丢） |

## 修复了什么

原实现里所有 `?v=` 共用同一个 `bigNumInc.save`，且：

- 自动存盘 30 秒一次、关页面时（`beforeunload`）再存一次；
- 「重置」只做了 `localStorage.removeItem(SAVE_KEY)` + `location.reload()`；
- 唯一的写盘保护是 `sessionStorage['resetting']` —— 而 `sessionStorage`
  **按标签页隔离**，其它还开着的标签页读不到这个标记。

于是只要还有第二个标签页开着，它就会在 30 秒后（或关页面时）把内存里的
**旧进度原样写回** `bigNumInc.save`，表现为「点了重置进度没归零」。

### 现在的做法

1. **槽位隔离**（`src/game/slots.ts`）：`?v=` 决定存档 key。
2. **epoch 重置世代号**（`src/game/save.ts`）：重置时先换 epoch 再删档。
   其它标签页发现 epoch 变了 → 内存里的存档作废 → 拒绝写盘并自动重载。
   存档 JSON 内部也带 epoch，所以「重置前写出来的旧档」即使抢在删档后落盘，
   重新载入时也会因为 epoch 不匹配被丢弃 —— **重置真的归零**。
3. **跨标签页合并**（`src/game/save.ts`）：同一槽开两个标签页时，存盘取各进度维度的
   最大值合并，谁也覆盖不了谁，进度只会前进不会倒退。
4. 每日挑战（`bigNumInc.daily`）也按槽隔离。

## 开发

```bash
npm install
npm run dev      # 本地开发
npm run build    # 产出 dist/
npm run preview  # 预览构建产物
```

## 部署

推送到 `main` 分支后，`.github/workflows/deploy.yml` 自动构建并发布到 GitHub Pages。
