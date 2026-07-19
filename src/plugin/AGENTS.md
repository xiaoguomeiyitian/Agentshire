# Plugin 层架构指南

> OpenClaw 插件的 Node.js 端：Hook 监听、WebSocket 广播、AI 工具、编辑器 API、居民 Agent 管理。

## 目录结构

```
src/plugin/
├── channel.ts                 # ChannelPlugin 实现（startAccount启动WS/注册回调）
├── hook-translator.ts         # 纯函数：OpenClaw Hook名 → AgentEvent
├── ws-server.ts               # WebSocket服务器 + 会话绑定 + 消息路由
├── tools.ts                   # AI工具注册（8个工具）
├── auto-config.ts             # 零配置：自动创建town-steward Agent + Binding
├── citizen-agent-manager.ts   # 独立居民Agent CRUD（写openclaw.json）
├── citizen-chat-router.ts     # 用户↔居民Agent消息路由
├── citizen-workshop-manager.ts # 居民工坊配置持久化（citizen-config.json）
├── editor-serve.ts            # 编辑器HTTP API（资产/工坊/发布/agent-config/sessions）
├── llm-agent-proxy.ts         # LLM代理（走OpenClaw embedded agent runtime，2并发+10队列）
├── session-history.ts         # 跨会话聊天历史加载（管家+居民）
├── soul-prompt-template.ts    # 灵魂文件AI生成模板
├── outbound-adapter.ts        # 出站适配（text→AgentEvent, media→deliverable_card）
├── subagent-tracker.ts        # 子Agent会话日志实时转发
├── session-log-watcher.ts     # JSONL日志增量读取（300ms轮询）
├── custom-asset-manager.ts    # 自定义GLB资产管理（最多20个，10MB限制）
├── town-session.ts            # Session ID标准化/解析
└── runtime.ts                 # Runtime注入（getter/setter）
```

## 核心数据流

```
index.ts register(api)
 ├─ api.registerChannel(agentTownPlugin)   → channel.ts
 ├─ registerHooks(api)                      → 监听8种Hook
 ├─ api.registerTool(createTownTools())     → tools.ts
 ├─ ensureTownAgentConfig()                 → auto-config.ts
 ├─ subagent_spawning hook                  → town-souls.ts 注入灵魂
 └─ api.registerService("agentshire-frontend") → HTTP服务器(:20009)
     └─ handleEditorRequest()               → editor-serve.ts

Hook事件流：
 OpenClaw Hook → isStewardDirect() 判断
  ├─ 管家直接事件 → dispatchSteward() → hookToAgentEvent() → broadcastAgentEvent()
  └─ 居民Agent事件 → dispatchCitizen() → 附加npcId → broadcastAgentEvent()

子Agent生命周期：
 subagent_spawned → pendingSpawnTasks缓存task → onSubagentSpawned()
   → SessionLogWatcher监听JSONL → broadcastAgentEvent(子事件)
 subagent_ended → onSubagentEnded() → 转发完成事件
```

## Hook 翻译表（hook-translator.ts）

| Hook名 | AgentEvent类型 | 备注 |
|--------|---------------|------|
| `before_agent_start` | `system.init` | sessionId/model/persona |
| `agent_end` | `turn_end` (+可选error) | usage/toolCalls/durationMs |
| `llm_input` | `thinking_delta` | 提取thinking/reasoning字段 |
| `llm_output` | `text` | assistantTexts最后一项 |
| `before_tool_call` | `tool_use` | name/input |
| `after_tool_call` | `tool_result` (+可选media_output) | 自动检测媒体文件 |
| `subagent_spawned` | `sub_agent.started` | label/task/agentId |
| `subagent_ended` | `sub_agent.done` | outcome→status映射 |
| `message_sending` | `text` | 发送中的消息 |
| `session_end` | `system.done` | — |

## AI 工具（tools.ts）

| 工具名 | 功能 | 发出的事件 |
|--------|------|-----------|
| `town_announce` | 广播消息 | `text` |
| `town_spawn_npc` | 生成NPC | `sub_agent.started`(模拟) |
| `town_effect` | 触发VFX | `fx` |
| `town_set_time` | 控制时钟 | `world_control.time` |
| `town_set_weather` | 控制天气 | `world_control.weather` |
| `town_status` | 查看状态 | —（返回文本） |
| `town_get_my_status` | 获取自身状态/位置 | —（plugin↔frontend NPC查询通道） |
| `town_query_nearby_citizens` | 查询半径内居民 | —（plugin↔frontend NPC查询通道） |
| `town_walk_to` | 行走至坐标 | —（plugin↔frontend NPC查询通道） |

## editor-serve：编辑器 HTTP API

路由结构（全部走 `handleEditorRequest()`）：

| 路径前缀 | 功能 |
|---------|------|
| `/ext-assets/*` | 角色/地图资产静态文件 |
| `/citizen-workshop/avatars/*` | 用户上传头像 |
| `/custom-assets/_api/{action}` | 自定义资产CRUD + GLB优化(@gltf-transform) |
| `/custom-assets/*` | 自定义资产静态文件 |
| `/citizen-workshop/_api/load` | 加载工坊草稿配置 |
| `/citizen-workshop/_api/save` | 保存工坊草稿 |
| `/citizen-workshop/_api/publish` | **发布**：changeset检测→Agent CRUD→同步town-defaults |
| `/citizen-workshop/_api/load-published` | 加载已发布配置 |
| `/citizen-workshop/_api/generate-soul` | AI生成灵魂文件 |
| `/citizen-workshop/_api/upload-avatar` | 上传头像 |
| `/citizen-workshop/_api/upload-anim` | 上传动画文件 |
| `/citizen-workshop/_api/agents` | 查询Agent列表 |
| `/citizen-workshop/_api/buildings` | 查询建筑列表 |
| `/citizen-workshop/_api/media` | 媒体文件代理 |
| `/claw-api/get-agent-config` | 查询单个Agent配置（agents.list[]） |
| `/claw-api/update-agent-config` | 更新单个Agent配置（patch agents.list[]） |
| `/claw-api/sessions/delete` | 删除会话（sessions.json + .jsonl/.trajectory） |

**发布流程**：
1. 构建 `PublishedCitizenConfig`（bake所有URL）
2. 比较新旧配置，检测 changeset（create/disable/update_soul）
3. 调用 `citizen-agent-manager.applyAgentChanges()` 执行Agent CRUD
4. 管家人设变更时更新管家SOUL.md
5. 同步 `town-defaults.json`

## citizen-agent-manager：独立居民 Agent

居民是独立Agent（有自己的工作区和会话），有自己的手艺和日常节奏。

| 操作 | 行为 |
|------|------|
| `create` | 创建 `~/.openclaw/workspace-citizen-{id}/` + SOUL.md + 注册到openclaw.json |
| `disable` | 从 openclaw.json agents.list 中移除 |
| `update_soul` | 更新 SOUL.md 文件 |
| `getAgentConfig` | 读取单个 agent 配置（agents.list[]） |
| `updateAgentConfig` | patch 单个 agent 配置字段 |

`citizen-chat-router.ts` 路由用户消息到居民Agent的独立会话（SessionKey = `agent:{agentId}:main`）。

## WebSocket 协议（ws-server.ts）

**浏览器 → 服务端**：

| 消息类型 | 说明 |
|---------|------|
| `town_session_init` | 绑定会话，回复 `town_session_bound` + `work_snapshot` |
| `chat` | 用户消息 → onChat回调 → 管家Agent |
| `multimodal` | 多模态消息（图片/视频/音频） |
| `citizen_chat` | 居民聊天 → citizen-chat-router |
| `implicit_chat_request` | 前端隐式LLM请求 → llm-agent-proxy |
| `chat_history_request` | 请求历史消息 → session-history |
| `command` | 命令消息（`/xxx`） |
| `abort` | 中止当前请求 |

**服务端 → 浏览器**：

| 消息类型 | 说明 |
|---------|------|
| `agent_event` | 主事件流（AgentEvent） |
| `work_snapshot` | 工作状态快照（子Agent列表+活动日志） |
| `chat_new_messages` | 新消息增量推送 |
| `chat_history` | 历史消息（含分页cursor） |
| `implicit_chat_response` | 隐式LLM响应 |

## Nudge 机制（index.ts）

（工作流已删除，Nudge 机制已停用。子Agent完成事件直接转发，不再提醒管家调用 next_step。）

## 常见改动

| 要做的事 | 改哪里 |
|---------|--------|
| 新增Hook→AgentEvent映射 | `hook-translator.ts` |
| 新增AI工具 | `tools.ts` |
| 修改编辑器API | `editor-serve.ts` |
| 修改居民Agent创建/销毁 | `citizen-agent-manager.ts` |
| 修改居民聊天路由 | `citizen-chat-router.ts` |
| 修改隐式LLM调用格式 | `llm-agent-proxy.ts` |
| 修改聊天历史解析 | `session-history.ts` |
| 修改灵魂文件生成模板 | `soul-prompt-template.ts` |
| 修改WS消息路由 | `ws-server.ts` |
| 修改出站消息格式 | `outbound-adapter.ts` |
| 修改自定义资产限制 | `custom-asset-manager.ts` |

## 测试

```
src/plugin/__tests__/
└── hook-translator.test.ts   # Hook名 → AgentEvent 映射
```
