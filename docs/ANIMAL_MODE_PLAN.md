# 动森模式改造方案（v4 — 含进出房间细节）

> 借鉴《动物森友会》将 Agentshire 改造为大模型驱动的自治小镇。
> 每个居民都是独立个体，有自己的思想、需求、每日计划，由 LLM 驱动决策与对话。
> 本文件是可实施的工程方案，按 Phase 顺序执行。

---

## 一、设计目标

1. **每个居民都是独立的人**：有自己的思想、需求、心情、每日计划、记忆、好感度
2. **大模型驱动**：所有居民的思考、决策、对话由 LLM 驱动（复用 implicit-chat 通道）
3. **基础规则**：定义小镇的形式逻辑和规则（Markdown 规则手册注入 LLM），居民按规则执行
4. **动森特色**：昼夜节律、天气反馈、串门社交、节日庆典、好感度积累、搬家机制
5. **可配置开关**：用户可在设置中开关动森模式（默认关闭，保持现有工作模式）

## 二、用户决策（已确认）

| 决策项 | 选择 |
|---|---|
| 决策模式 | 并行模式（居民独立思考，不串行） |
| LLM 调用 | 激进模式（每个居民独立 LLM 调用，不合并） |
| 规则形式 | Markdown 规则手册（注入 LLM system prompt） |
| 动森特色 | 5 项：昼夜节律、天气反馈、串门社交、节日庆典、好感度 |
| 开关 | 设置面板开关，默认关闭 |
| 居民数量 | 5-8 个（可配置） |
| 历史持久化 | JSONL 文件（复用现有 session-history 机制） |
| 复用对话 | 复用 EncounterManager（深度多轮对话） |
| 决策间隔 | 可配置（默认 L2 间隔 60-120s） |
| 镇长 | = 玩家（user），不参与自治，可串门/对话 |

## 三、现有架构调研发现

### 3.1 可复用机制
- **AgentBrain 3 层决策**：L1 日计划（dawn 触发 LLM 生成 3-5 计划）/ L2 战术（60-120s 触发 stay/talk_to/leave_to/go_home）/ L3 对话（委托 EncounterManager）
- **implicit-chat LLM 通道**：前端 implicit_chat_request → WS → 插件 onImplicitChat → llm-agent-proxy → LLM → implicit_chat_response，10 场景，qwen-turbo 默认
- **NPC 7 态状态机**：idle/walking/working/thinking/celebrating/emoting/departing
- **DailyBehavior 9 态**：sleeping/leaving_home/roaming/at_building/walking_home/summoned/gathered/assigned/at_office
- **GameClock**：24h 6 周期（dawn/morning/noon/afternoon/dusk/night），night 3x 加速，onPeriodChange 回调，localStorage 持久化
- **WeatherSystem**：12 天气类型
- **EncounterManager**：居民相遇对话，含冷却/并发上限 2/状态校验，可复用
- **ActivityJournal**：活动/对话/关系/日计划/反思记录
- **PersonaStore**：人设缓存 + 紧凑 prompt 构建器

### 3.2 关键缺口（10 项）
| 编号 | 缺口 | 影响 |
|---|---|---|
| A | `getNearbyNpcsForBrain` 硬编码排除 steward 和 user | 镇长感知缺口 |
| B | NPC 7 态无 sleeping/dining | 需求映射缺口 |
| C | `llm-agent-proxy` MAX_CONCURRENT=2 | 并发不足 |
| D | implicit-chat 复用确认 | 需扩展场景 |
| E | GameClock 周期驱动 | 需接入自治引擎 |
| F | 场景切换 | 住宅无室内场景 |
| G | PreviewPlayerController 移植 | 镇长控制 |
| H | TownConfig 扩展 | 需求/心情字段 |
| I | 记忆持久化 WS 通道 | 跨会话记忆 |
| J | 节日 VFX | 直接 broadcastAgentEvent |

### 3.3 进出房间现状（第五轮调研关键发现）
- `BUILDING_REGISTRY` 8 个建筑都有 `scene` 字段，但**只有 office/museum 有室内场景**（OfficeBuilder/MuseumBuilder）
- `house_a/b/c`、`market`、`cafe`、`user_home` **没有室内 Builder**，只是 TownBuilder 里的外观建筑
- `DailyBehavior.enterBuilding()` 只是走到门口 waypoint、停在门外、播放 idle/sitting 动画，**不消失、不切场景**
- `MainScene.walkToDoor()` 的 `sceneMap` 只映射 office/museum/exit_office/exit_museum，其他建筑 `return`，且只有镇长能触发
- `SceneSwitcher` 只支持 town/office/museum 三场景切换

## 四、进出房间机制（核心设计）

### 4.1 设计原则
- **住宅 = 消失**：住宅无室内场景，居民进入即从 town 场景消失（`mesh.visible=false`），NeedsEngine/AutonomyEngine 继续运行
- **公共建筑 = 停留**：咖啡馆/市场/博物馆，居民不消失，停在门口附近播放 sitting/idle，多个居民可见可互动
- **不新建室内场景**：house/market/cafe 不建室内 Builder，用"消失+需求继续运行"模拟室内
- **串门是核心社交**：通过 `town_knock_door` 工具 + IndoorTracker 实现
- **镇长不能进住宅**：与居民一致，只能门口对话

### 4.2 IndoorTracker（Phase 1 新增）

**职责**：记录哪个居民在哪个建筑内，提供查询接口

```typescript
// animal-mode/IndoorTracker.ts
export class IndoorTracker {
  private indoorMap: Map<string, string> = new Map() // npcId -> buildingKey

  enter(npcId: string, buildingKey: string): void
  leave(npcId: string): void
  isIndoor(npcId: string): boolean
  getIndoorAt(buildingKey: string): string[]   // 谁在这个建筑内
  getIndoorLocation(npcId: string): string | null
  clear(): void
}
```

### 4.3 进出房间流程

**居民进入住宅（house_a/b/c、user_home）**：
1. AutonomyEngine L2 决策 `leave_to: house_a_door`（回家睡觉）
2. 居民走到门口 waypoint（复用 `walkToBuilding`）
3. 到达后：`npc.setVisible(false)` + `IndoorTracker.enter(npcId, 'house_a_door')`
4. NeedsEngine 继续运行（疲劳恢复、饥饿增长）
5. L2 决策照常运行，但 `getNearbyNpcs` 不返回室内居民

**居民离开住宅**：
1. AutonomyEngine L2 决策 `leave_to: plaza_center`（出门）
2. `IndoorTracker.leave(npcId)` + `npc.setVisible(true)`
3. 居民从门口 waypoint 重新可见，恢复 town 场景行为

**居民进入公共建筑（cafe/market/museum）**：
1. 走到门口 waypoint，**不消失**
2. 播放 sitting/idle 动画，多个居民可见可互动
3. 复用现有 occupancy 机制（capacity 限制）

**镇长进入建筑**：
- office/museum：走现有 SceneSwitcher 切场景
- 其他建筑：只能门口对话（与居民一致）

### 4.4 串门机制（Phase 3 新增）

**流程**：
1. 居民 A L2 决策 `talk_to: B`，但 B 在室内（IndoorTracker 记录）
2. A 走到 B 家门口，调用 `town_knock_door` 工具
3. 工具查 IndoorTracker：
   - B 在家 → 触发"敲门"对话（EncounterManager），B 可选择"开门接待"（重新出现）或"不在家"（LLM 决策）
   - B 不在家 → 返回"没人在家"，A 离开
4. 规则手册注入："串门前考虑时间，22:00 后不串门"（软约束）
5. 好感度影响：串门 +3、被拒 -2、不请自来 -1

## 五、实施 Phase（7 个阶段）

### Phase 1：骨架 + 规则 + 玩家控制 + 配置 + IndoorTracker

**目标**：搭建动森模式骨架，不破坏现有工作模式

**Steps**：
1. 新建 `town-frontend/src/game/animal-mode/` 目录
2. `AnimalModeManager.ts`：动森模式总开关，管理所有自治子系统生命周期
3. `IndoorTracker.ts`：室内居民追踪
4. `RulesEngine.ts`：加载 `town-data/animal-rules.md` 规则手册，注入 LLM system prompt
5. `MayorController.ts`：移植 PreviewPlayerController，走 NPC.moveTo（WASD + 点击移动）
6. `NeedsEngine.ts`：8 需求（饥饿/疲劳/社交/娱乐/卫生/安全/自我实现/归属）随时间变化
7. `MoodEngine.ts`：心情 = 需求加权和 + 事件影响，影响动画/对话语气
8. TownConfig 扩展：新增 `animalMode: boolean`、`needsConfig`、`moodConfig` 字段
9. 设置面板新增"动森模式"开关（SettingsPanel）
10. GameClock onPeriodChange 接入 AnimalModeManager（dawn 触发 L1 计划）

**Relevant files**：
- `town-frontend/src/game/animal-mode/AnimalModeManager.ts` — 新建
- `town-frontend/src/game/animal-mode/IndoorTracker.ts` — 新建
- `town-frontend/src/game/animal-mode/RulesEngine.ts` — 新建
- `town-frontend/src/game/animal-mode/MayorController.ts` — 新建
- `town-frontend/src/game/animal-mode/NeedsEngine.ts` — 新建
- `town-frontend/src/game/animal-mode/MoodEngine.ts` — 新建
- `town-data/animal-rules.md` — 新建（规则手册）
- `town-frontend/src/ui/SettingsPanel.ts` — 扩展开关
- `town-frontend/src/data/TownConfig.ts` — 扩展字段
- `town-frontend/src/game/MainScene.ts` — 挂载 AnimalModeManager

### Phase 2：需求心情引擎

**目标**：居民有动态需求与心情，驱动行为

**Steps**：
1. NeedsEngine 8 需求实现：每秒衰减，低于阈值触发"不满"
2. MoodEngine 实现：心情 = Σ(需求满足度 × 权重) + 事件影响
3. 需求映射到行为（satisfy_need）：
   - 睡觉 → 回家消失 + idle（疲劳恢复）
   - 用餐 → 去咖啡馆不消失 + sitting（饥饿恢复）
   - 社交 → 离开建筑找人（社交恢复）
   - 娱乐 → 去博物馆/广场（娱乐恢复）
4. 心情影响：动画选择（开心→celebrating，疲惫→idle）、对话语气（prompt 注入）
5. ActivityJournal 记录需求/心情变化

**Relevant files**：
- `town-frontend/src/game/animal-mode/NeedsEngine.ts` — 实现
- `town-frontend/src/game/animal-mode/MoodEngine.ts` — 实现
- `town-frontend/src/npc/ActivityJournal.ts` — 扩展记录

### Phase 3：自治决策 + 工具 + 串门

**目标**：居民自主决策，LLM 驱动，可串门

**Steps**：
1. `AutonomyEngine.ts`：整合 AgentBrain + NeedsEngine + MoodEngine，L2 决策由需求驱动
2. 扩展 implicit-chat 场景：新增 `autonomy_decide`（L2 决策）、`knock_door`（串门）
3. 新增工具 `town_knock_door`：居民 A 到 B 门口调用，查 IndoorTracker
4. 新增工具 `town_query_place`：查询建筑内居民
5. 新增工具 `town_query_citizen`：查询居民状态（需求/心情/位置）
6. 新增工具 `town_recall_memory`：居民回忆（跨会话记忆）
7. 室内感知：`getNearbyNpcs` 不返回室内居民（除非同建筑）
8. 室内对话：两个居民都在咖啡馆 → AutonomyEngine 检测 → 调 requestEncounter
9. LLM 并发提升：`llm-agent-proxy` MAX_CONCURRENT 2→6，MAX_QUEUE 10→30

**Relevant files**：
- `town-frontend/src/game/animal-mode/AutonomyEngine.ts` — 新建
- `src/plugin/tools.ts` — 新增 4 工具
- `src/plugin/llm-agent-proxy.ts` — 提升并发
- `town-frontend/src/game/DailyScheduler.ts` — `getNearbyNpcsForBrain` 修复（不排除 user）
- `town-frontend/src/bridge/implicit-chat.ts` — 新增场景

### Phase 4：好感度 + 记忆

**目标**：居民有关系记忆，跨会话持久化

**Steps**：
1. `RelationshipEngine.ts`：居民间好感度（-100 到 +100），影响对话/串门/礼物
2. 记忆持久化：JSONL 文件（复用 session-history 机制），WS 通道读写
3. 新增工具 `town_give_gift`：送礼影响好感度
4. 好感度影响：对话语气（prompt 注入好感度）、串门接受率、节日邀请
5. ActivityJournal 记录关系变化

**Relevant files**：
- `town-frontend/src/game/animal-mode/RelationshipEngine.ts` — 新建
- `src/plugin/session-history.ts` — 扩展记忆持久化
- `src/plugin/tools.ts` — 新增 `town_give_gift`

### Phase 5：节日系统

**目标**：动森式节日庆典

**Steps**：
1. `FestivalEngine.ts`：节日日历（樱花节/丰收节/雪人节等），定时触发
2. 节日时居民从室内出来去广场（IndoorTracker 释放）
3. 节日 VFX：直接 broadcastAgentEvent（不走工具，避免权限问题）
4. 新增工具 `town_query_festival` / `town_join_festival`
5. 节日特殊对话（prompt 注入节日上下文）

**Relevant files**：
- `town-frontend/src/game/animal-mode/FestivalEngine.ts` — 新建
- `src/plugin/tools.ts` — 新增 2 工具

### Phase 6：搬家机制

**目标**：居民可搬入搬出

**Steps**：
1. `MoveEngine.ts`：好感度低/长期不满 → 居民考虑搬走
2. 搬走时从室内消失（IndoorTracker 释放），新居民搬入
3. 搬家对话（告别/欢迎）
4. TownConfig 更新居民列表

**Relevant files**：
- `town-frontend/src/game/animal-mode/MoveEngine.ts` — 新建
- `town-frontend/src/data/TownConfig.ts` — 居民列表更新

### Phase 7：集成验证

**目标**：端到端验证

**Steps**：
1. 单元测试：IndoorTracker、NeedsEngine、MoodEngine、AutonomyEngine
2. 集成测试：动森模式开关、居民自治、串门、节日
3. 手动验证：进出房间、串门、节日、搬家
4. 性能验证：6 居民并发 LLM 调用

**Relevant files**：
- `town-frontend/src/game/animal-mode/__tests__/` — 新建测试
- `town-frontend/src/game/__tests__/` — 集成测试

## 六、工具集（现有 18 + 新增 6）

| 工具 | 用途 | Phase |
|---|---|---|
| `town_knock_door` | 串门敲门 | 3 |
| `town_query_place` | 查询建筑内居民 | 3 |
| `town_query_citizen` | 查询居民状态 | 3 |
| `town_recall_memory` | 居民回忆 | 3 |
| `town_give_gift` | 送礼 | 4 |
| `town_query_festival` / `town_join_festival` | 节日 | 5 |

## 七、Verification

### 进出房间专项
1. 居民 L1 计划"下午回家睡觉"→ 走到 house_a_door → 消失 → NeedsEngine 疲劳恢复 → 次日 dawn 重新出现
2. 镇长走到 house_a_door → 提示"没人在家"（居民外出）→ 居民回家后镇长再敲门 → 对话触发
3. 居民 A 串门到居民 B 家 → B 在家 → 敲门对话 → B 开门接待（重新出现）
4. 两个居民都在咖啡馆 → 室内对话触发（EncounterManager）
5. 节日触发 → 室内居民自动出来去广场

### 自治专项
1. dawn 触发 L1 计划（5-8 居民并发 LLM）
2. L2 决策间隔 60-120s，需求驱动
3. 天气变化 → 居民反馈（躲雨/赏雪）
4. 好感度影响对话语气

## 八、Further Considerations

1. **室内动画**：居民消失后无动画可见，NpcCardPanel 显示"室内状态"（如"正在睡觉""正在用餐"）
2. **多人同宅**：v1 不做，capacity=1 住宅只允许房主，后续扩展再考虑
3. **公共建筑容量**：复用现有 occupancy 机制，咖啡馆满员时居民 L2 决策去别处
4. **LLM 成本**：6 居民并发，每 60-120s 一次 L2 决策，需监控成本
5. **离线居民**：居民在室内时是否暂停 LLM 调用？推荐：不暂停，需求继续变化
