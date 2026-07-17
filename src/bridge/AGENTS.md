# Bridge 层架构指南

> AgentEvent（OpenClaw 协议）→ GameEvent（3D 前端消费）的翻译与编排层。

## 目录结构

```
src/bridge/
├── DirectorBridge.ts      # 中央编排器：7阶段Phase状态机 + 事件分发
├── EventTranslator.ts     # 兜底翻译：AgentEvent → GameEvent 简单映射
├── RouteManager.ts        # A*寻路 + moveNpcAndWait(带ack/超时) + 目的地评分
├── CitizenManager.ts      # 居民生命周期：persona检测 → spawn动画编排 → 寻路
├── ActivityStream.ts      # 活动日志 + thinking流缓冲（500ms flush）
├── NpcEventQueue.ts       # 对话/phase事件排队（保护气泡不被快速覆盖）
├── StateTracker.ts        # agentId↔npcId双向映射 + 工位池(A-J共10个)
├── ToolVfxMapper.ts       # 纯函数：工具名 → VFX事件/emoji/动画phase
├── ReconnectManager.ts    # WebSocket指数退避重连
├── implicit-chat.ts       # NPC隐式LLM调用（10种场景，DI注入）
├── index.ts               # barrel export
└── data/
    ├── route-config.ts    # 路由图类型 + 导入
    └── route-config.json  # 小镇/办公室节点图 + 居民目的地坐标
```

## 数据流

```
hook-translator (plugin层)  →  AgentEvent
    │
    ▼  WebSocket
DirectorBridge.processAgentEvent(event)
    ├─ sub_agent.started  → 注册映射 + npc_spawn + 启动summon收集窗口(3s)
    ├─ sub_agent.progress → 转发内部事件给对应NPC的queue
    ├─ sub_agent.done     → npc_work_done + 更新进度
    ├─ text/text_delta    → handleStewardText() → 对话气泡 + activity
    ├─ thinking_delta     → ActivityStream.appendThinkingDelta()
    ├─ tool_use           → ActivityStream + ToolVfxMapper驱动VFX
    ├─ tool_result        → activity状态 + CitizenManager检测(persona/citizen)
    ├─ turn_end           → flush所有队列 + flushPendingCitizens
    ├─ bus_message        → NPC互看 + connectionBeam VFX
    ├─ hook_activity      → hookFlash VFX
    ├─ media_output       → deliverable_card
    ├─ error              → NPC error phase
    └─ default            → EventTranslator.translate() (兜底)
    │
    ▼  emit GameEvent[]
MainScene.handleGameEvent()

DirectorBridge.processCitizenEvent(npcId, event)
    → 居民Agent（非子Agent）的独立事件流，附加npcId后处理
```

## Phase 状态机

```
idle → summoning → assigning → going_to_office → working → publishing → returning → idle
```

| Phase | 触发条件 | 发出事件 | 前端编排 |
|-------|---------|---------|---------|
| idle | 初始/返回完成 | — | — |
| summoning | 首个 `sub_agent.started` | `workflow_summon`（收集窗口3s后） | SummonOrchestrator |
| assigning | 前端 `workflow_phase_complete(summoning)` | `workflow_assign` | BriefingOrchestrator |
| going_to_office | 前端 `workflow_phase_complete(assigning)` | `workflow_go_office` + 工位分配 | MainScene 场景切换 |
| working | 前端 `workflow_phase_complete(going_to_office)` | `progress` + 转发sub_agent事件 | 工位屏幕 + 小游戏 |
| publishing | `project_complete` tool_result | `workflow_publish` + deliverable_card | MainScene VFX |
| returning | 前端 `workflow_phase_complete(publishing)` | `workflow_return` | MainScene 散场 |

**迟到者处理**：working 阶段到达的 `sub_agent.started` 不走 summoning，直接分配工位。

**临时工机制**：未在 TownConfig 中配置的 agent 自动分配随机 avatar，标记为临时工。

## implicit-chat：NPC 隐式 LLM 调用

通过 `setImplicitChatFn()` 依赖注入实际调用函数（浏览器端走 WebSocket → llm-agent-proxy → OpenClaw embedded agent，Node端可直连）。

10 种场景及 maxTokens：

| 场景 | 用途 | maxTokens |
|------|------|-----------|
| `daily_plan` | 黎明日计划 | 200 |
| `encounter_init` | 发起对话 | 120 |
| `encounter_reply` | 回复对话 | 100 |
| `encounter_summary` | 对话摘要 | 80 |
| `tactical_decision` | L2战术决策 | 60 |
| `night_reflection` | 夜间反思 | 120 |
| `town_journal` | 每日叙事 | 300 |
| `greeting` | 问候 | 60 |
| `farewell` | 告别 | 60 |
| `micro_reaction` | 微反应 | 60 |

回退机制：无 chatFn / 超时(8s) / 异常时返回预设中文回退文本。

## 模块职责与依赖

| 模块 | 职责 | 依赖 |
|------|------|------|
| DirectorBridge | Phase状态机 + 事件分发 + 居民事件管道 | StateTracker, EventTranslator, NpcEventQueue, RouteManager, ActivityStream, CitizenManager, ToolVfxMapper |
| EventTranslator | AgentEvent→GameEvent 简单映射（兜底） | StateTracker |
| RouteManager | A*寻路 + moveNpcAndWait + 目的地评分 | route-config |
| CitizenManager | persona检测 + 居民spawn动画序列 | RouteManager, CharacterRoster（DI注入） |
| ActivityStream | 活动日志 + thinking流 + todo活动 | — |
| NpcEventQueue | 对话保护期 + phase缓冲 | — |
| StateTracker | 双向ID映射 + 工位池管理 | — |
| ToolVfxMapper | 工具→VFX/动画 纯函数 | — |
| implicit-chat | 隐式LLM调用 + 统计 | DI注入chatFn |

## 编排原则

- **Bridge 发高级意图事件，不做 setTimeout 微操**：NPC 完成时发 `npc_work_done`，前端 MainScene 用 async/await 编排完整序列
- **工位延迟释放**：Bridge 在 `sub_agent.done` 时不立即释放，等前端 `workstation_released` action 回传后才释放（12s安全网兜底）
- **Phase 前进靠前端回传**：前端通过 `workflow_phase_complete` 推动状态机，Bridge 不假设动画时长

## 常见改动

| 要做的事 | 改哪里 |
|---------|--------|
| 新增 AgentEvent → GameEvent 映射 | `EventTranslator.translate()` 加 case |
| 修改工具VFX/动画 | `ToolVfxMapper.ts` |
| 修改活动日志描述/图标 | `ActivityStream.ts` 的 `toolActivityMsg/toolActivityIcon` |
| 修改居民spawn动画序列 | `CitizenManager.spawnCitizenSequence()` |
| 修改寻路图节点 | `data/route-config.json` |
| 修改Phase编排 | `DirectorBridge` 的 phase 切换逻辑（发意图事件，不编排动画） |
| 新增隐式LLM场景 | `implicit-chat.ts` 的 `SCENE_CONFIG` |
| 修改对话保护时长 | `NpcEventQueue.ts` 的 `calcDialogDuration()` |

## 测试

```
src/bridge/__tests__/
├── EventTranslator.test.ts   # AgentEvent → GameEvent 映射
├── NpcEventQueue.test.ts     # 对话保护 + phase 缓冲
├── RouteManager.test.ts      # A*寻路 + 移动 + 目的地
├── ActivityStream.test.ts    # thinking流 + 活动日志
└── CitizenManager.test.ts    # 居民检测 + 名字匹配
```
