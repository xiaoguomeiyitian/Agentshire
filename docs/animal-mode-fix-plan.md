# Animal Mode 经济/决策/结算/背包系统修复实施方案

> 本文档为可执行的完整实施方案，对应 `town-frontend/src/game/animal-mode/` 经济、决策、每日结算系统的修复与背包系统新增。
> 评审依据：`docs/vitals-system-design.md` + 源码通读。
> 实施日期：2026.7.20

## 一、问题清单与优先级

| 优先级 | 编号 | 问题 | 影响 |
|--------|------|------|------|
| P0 | P0-1 | mood 量纲文档(0-100)与实现(-100..+100)不一致；`<=-100` 阈值几乎不触发 | 镇长关怀失效 |
| P0 | P0-2 | L2 决策不注入 coins/frugal，居民没钱仍去咖啡店 | 决策不合理 |
| P0 | P0-3 | parseDecision 不校验 go_cafe 可负担 | 寻路落空 |
| P1 | P1-1 | 室内恢复 hunger 与 breakfast 双倍叠加（用户要求：删室内恢复，保留 breakfast） | 数值跳变 |
| P1 | P1-2 | DailySettlement 既 satisfy needs 又 applyEvent，mood 跳变 | mood 抖动 |
| P1 | P1-3 | leave_warning/move_out/celebration 无去重节流 | 镇长被打扰 |
| P1 | P1-4 | frozenCitizens 跨定时器有时序窗口 | 话题期间误触发 |
| P2 | P2-1 | 借贷 key 用 `${from}->${to}`，同对只能一笔 | 借贷受限 |
| P2 | P2-2 | frugal 与 hoardingThreshold 两套防囤积未联动 | 双重惩罚 |
| P2 | P2-3 | NeedActionMapper 不检查 canAfford | 寻路落空 |
| 新增 | N-1 | 居民背包系统（购买/收到/产出的物品保存在身上） | 物品无处存放 |
| 新增 | N-2 | 居民详情面板展示全部信息（经济+背包） | 信息不可见 |

## 二、实施顺序

```
P0-1 → P0-2 → P0-3 → P1-1 → N-1 → N-2 → P1-2 → P1-3 → P1-4 → P2-1 → P2-2 → P2-3 → 测试
```

依赖关系：N-1 背包依赖 P1-1（hunger 恢复路径改为 breakfast + 背包物品使用）；N-2 面板依赖 N-1。

---

## 三、P0 修复（影响正确性）

### P0-1 统一 mood 量纲

**文件**：
- `docs/vitals-system-design.md` §1.1、§9.1
- `town-frontend/src/game/animal-mode/EconomyEventEngine.ts`

**改动**：
1. 文档 §1.1 mood 范围改为 `-100~+100`，0=中性，`< -60` 低落，`> 60` 愉悦
2. 文档 §9.1 庆祝触发改为 `mood > 60 持续 1 日`
3. `EconomyEventEngine.ts`：
   - `moodState.value <= -100` → `<= -60`（镇长关怀）
   - `moodState.value > 90` → `> 60`（庆祝）

### P0-2 L2 决策注入经济上下文

**文件**：
- `town-frontend/src/game/animal-mode/AutonomyEngine.ts`（`AutonomyContext`、`AutonomyDeps`、`buildContext`、`buildUserPrompt`）
- `town-frontend/src/game/animal-mode/AnimalModeManager.ts`（`buildAutonomyEngine`）

**改动**：
1. `AutonomyContext` 新增：`coins: number; frugal: boolean; savingsGoal: number; todayWorkReward: number`
2. `AutonomyDeps` 新增：`getEconomyState?: (npcId: string) => { coins: number; frugal: boolean; savingsGoal: number; todayWorkReward: number } | null`
3. `buildContext` 注入经济字段
4. `buildUserPrompt` 在"最迫切的需求"后追加金币行 + 钱不够警告
5. `AnimalModeManager.buildAutonomyEngine` 注入 `getEconomyState`

### P0-3 parseDecision 校验 go_cafe 可负担

**文件**：`town-frontend/src/game/animal-mode/AutonomyEngine.ts`（`parseDecision` 的 `leave_to` 分支）

**改动**：目标为 cafe/market 且 `coins < 5` 时，改输出 `go_home` 或 `talk_to`（求助）。

---

## 四、P1 修复（路径冗余与重复触发）

### P1-1 删除室内 hunger 恢复（用户要求）

**文件**：`town-frontend/src/game/animal-mode/AnimalModeManager.ts`（`update()` 室内恢复循环）

**改动**：删除所有室内场景的 `satisfy(hunger, ...)`，保留 fatigue/hygiene/safety 恢复。hunger 恢复路径改为：
- 06:00 breakfast（`DailySettlementEngine` 一次性 +40，仅在家）
- 咖啡店购买食物 → 入背包 → 使用背包物品时 satisfy

### P1-2 mood 恢复去掉 applyEvent

**文件**：`town-frontend/src/game/animal-mode/DailySettlementEngine.ts`

**改动**：删除 `moodEngine.applyEvent` 调用，只走 needs 路径（satisfy fun/esteem/belonging）。

### P1-3 事件去重节流

**文件**：`town-frontend/src/game/animal-mode/EconomyEventEngine.ts`

**改动**：`CitizenEventTracker` 新增 `lastLeaveWarningDay`、`lastMoveOutDay`、`lastCelebrationDay`，每个事件每日最多触发一次。

### P1-4 frozenCitizens 时序修复

**文件**：`town-frontend/src/game/animal-mode/AnimalModeManager.ts`

**改动**：`checkEconomyEvents` 读取最新的 `this.frozenCitizens`（每帧由 update 更新），并在话题暂停时立即设置 frozen 集合。

---

## 五、P2 修复（实现细节）

### P2-1 借贷唯一 loanId

**文件**：`town-frontend/src/game/animal-mode/CitizenTradeSystem.ts`

**改动**：`loans` Map key 改为唯一 `loanId`，支持同对居民多笔借款。

### P2-2 frugal 与 hoarding 联动

**文件**：`town-frontend/src/game/animal-mode/EconomyEngine.ts`（`runDailySettlement`）

**改动**：frugal 时 hoardingThreshold 降至 300（原 500）。

### P2-3 NeedActionMapper 接入 economy

**文件**：`town-frontend/src/game/animal-mode/NeedActionMapper.ts`

**改动**：`resolveAction` 增加可选 `economy` 参数，hunger urgent 且 `coins < 5` 时改映射 home。

---

## 六、N-1 新增：居民背包系统

### 6.1 数据结构

**新文件**：`town-frontend/src/game/animal-mode/InventoryEngine.ts`

```ts
export interface InventoryItem {
  id: string              // 唯一 id
  itemId: string          // 物品类型 id（'coffee','sandwich','gift_box'...）
  name: string            // 显示名（i18n）
  icon: string            // lucide icon name
  count: number           // 数量
  category: 'food' | 'gift' | 'craft' | 'misc'
  effects?: { hunger?: number; energy?: number; mood?: number; belonging?: number }
  obtainedAt: number      // 获得时间戳
  source: string          // 'cafe_purchase' | 'gift_received' | 'trade' | 'craft' | 'pickup' | 'share_food'
}

export interface InventorySnapshot {
  citizens: Record<string, InventoryItem[]>
  savedAt: number
}
```

### 6.2 集成点

| 来源 | 文件 | 改动 |
|------|------|------|
| 咖啡店购买 | `EconomyEngine.buyCafeItem` | 返回 item，调用方 push 到背包 |
| 收到礼物 | `CitizenTradeSystem.giftItem` | 接收方背包 push gift 物品 |
| 分享食物 | `CitizenTradeSystem.shareFood` | 接收方背包 push food 物品 |
| 手艺产出 | `AutonomyEngine` work_on 完成时 | push craft 物品 |

### 6.3 持久化

**新文件**：`src/plugin/inventory-state.ts`（镜像 `economy-state.ts` 结构）

**WS 协议**：
- 新增 `GameAction`：`inventory_state_save`（前端→插件，60s 上报）
- `animal_state_load` 响应新增 `inventory` 字段（插件→前端）
- `town/init` reset 流程调用 `clearInventoryState()`

### 6.4 AnimalModeManager 接入

- 新增 `inventoryEngine` 成员
- `enable()` 注册居民、`disable()` 清空
- `buildAutonomyEngine` 注入 `getInventory`
- `reportInventoryState()` 60s 上报
- `restoreInventoryState()` 重连恢复

---

## 七、N-2 新增：居民详情面板展示全部信息

### 7.1 现状

`NpcCardPanel` 状态 tab 当前显示：位置 + 心情需求 + 关系。缺少经济和背包。

### 7.2 改动

**文件**：`town-frontend/src/ui/NpcCardPanel.ts`

状态 tab 区块顺序：
1. 位置信息（已有）
2. **经济信息（新增 `buildEconomyArea`）**：金币/声望/储蓄目标/今日报酬/消费模式
3. **背包（新增 `buildInventoryArea`）**：物品列表（图标+名称+数量+来源）
4. 心情与需求（已有）
5. 人际关系（已有）

**文件**：`town-frontend/src/game/MainScene.ts`（`showNpcCard`）

补充采集 `economy` 和 `inventory` 数据，传入 `npcCardPanel.show()`。

**文件**：`town-frontend/src/styles/npc-card.css`

新增 `.card-inventory-list`、`.card-inventory-item`、`.card-inventory-name`、`.card-inventory-source` 样式。

---

## 八、验证清单

```bash
# 1. 根目录测试
cd /root/Agentshire && npm test

# 2. 前端测试
cd /root/Agentshire/town-frontend && npx vitest run

# 3. 类型检查
cd /root/Agentshire && npx tsc --noEmit
cd /root/Agentshire/town-frontend && npx tsc --noEmit
```

### 手动场景验证

1. 居民 coins=0 → L2 决策不输出 `go_cafe`
2. 06:00 在家居民 hunger +40 一次，06:00-08:00 不再持续上涨
3. 居民购买三明治 → 背包出现"三明治 ×1"，使用后 hunger +30
4. 居民收到礼物 → 背包出现礼物条目
5. 打开居民详情 → 状态 tab 显示经济+背包+心情+关系
6. 刷新页面 → 背包从插件恢复
7. reset 小镇 → 背包清空
8. belonging<10 持续 → move_out 每日只通知 1 次
9. 发起话题 → 冻结居民立即停止事件触发

---

## 九、风险与回滚

| 修复项 | 风险 | 回滚 |
|--------|------|------|
| P1-1 删除室内 hunger 恢复 | 06:00-08:00 间 hunger 偏低 | 恢复室内 hunger 恢复（一行） |
| N-1 背包系统 | 新增持久化文件，reset 需同步清理 | `clearInventoryState()` 纳入 reset |
| N-2 详情面板 | 状态 tab 内容变多 | 已有 `card-status-scroll` 滚动容器 |
| N-1 buyCafeItem 改为入背包 | 旧逻辑立即 satisfy hunger | 保留 fallback 路径 |
| P0-2 接口改动 | AutonomyContext/Deps 字段变更 | tsc 定位所有调用方 |
