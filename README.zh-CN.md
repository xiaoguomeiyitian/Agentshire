# Agentshire — 夏尔小镇

[English](README.md) | 中文

> **Agentshire — 让你的 OpenClaw/QClaw Agent 住进你亲手搭建的3D游戏小镇，而不是ChatBox。**

Agentshire 是一个支持OpenClaw/QClaw的插件，让 AI Agent 变成 3D 游戏小镇里活生生的 NPC——你可以观看、对话、也可以亲手改造这个世界。它融合了生活模拟与 UGC 工具：天气系统、昼夜循环、NPC 自主社交、地图编辑器、角色工坊。

**同时支持 OpenClaw CLI 和 [QClaw](https://qclaw.cn) 桌面端。**

**[查看完整愿景](VISION.md)** | **[查看路线图](ROADMAP.md)**

> **⚠️ 兼容性说明**
>
> | 平台 | 版本 | 状态 |
> |---|---|---|
> | **OpenClaw CLI** | 2026.3.13 | ✅ 推荐 |
> | **OpenClaw CLI** | 2026.6.11+ | ✅ 支持（已迁移至 `defineChannelPluginEntry`） |
> | **QClaw 桌面端** | 0.2.x | ✅ 支持 |
> | OpenClaw CLI | 2026.3.7 – 3.12 | ⚠️ 可能兼容 |
> | OpenClaw CLI | 2026.4.x – 2026.6.10 | ❌ Channel 初始化回归（已通过迁移修复） |
>
> 版本相关问题请查看[故障排除](#故障排除)。

---

## 眼见为实

> **📺 [观看完整 Demo 视频](https://www.youtube.com/watch?v=R6YXvkkwo9I)**

**一座小镇，不是仪表盘。**

https://github.com/user-attachments/assets/c888d2ef-dcba-4caa-b0af-9b5f3e3b1365

**造你的居民——选模型，赋灵魂，看他活过来。**

https://github.com/user-attachments/assets/b9697432-b3ba-4e23-85fe-4c0b5c35a1b9

**造你的小镇——拖拽搭建，一键预览。**

https://github.com/user-attachments/assets/3328aa6c-3432-4f71-abfd-91aea4db15df

**每个居民都有自己的想法。**

https://github.com/user-attachments/assets/720a63fc-863c-483c-bfdf-5e07e82c6f0e

**下达任务，居民集结。**

https://github.com/user-attachments/assets/1983f60b-aaf6-4adc-b46c-5612e4ba4c83

**干太久？班味 Boss 来了。消灭它。**

https://github.com/user-attachments/assets/9be946e0-9ecf-42de-b793-a5d7ebe55612

**任务完成。烟花庆祝。成品交付。**

https://github.com/user-attachments/assets/fa6563ae-e78b-49b1-ae7b-8a8a96738341

---

## 功能特性

### 三模式界面

- **Town 模式** — 3D 低多边形小镇，实时观看 NPC 生活、工作、协作、庆祝
- **Chat 模式** — IM 风格聊天界面，左侧 Agent 列表（管家 + 居民，在线状态），右侧消息流，支持文本/图片多模态、聊天历史（游标分页）、命令系统（`/new` `/help` `/stop` `/clear`）、群聊 @提及、清空会话确认
- **Claw 设置** — 应用内面板，管理 OpenClaw 运行时配置（Gateway 模式、子 Agent 超时、日志、浏览器、更新通道）并实时查看会话与 token 用量；内嵌 LLM 模型管理子模块
- **顶部导航栏** — Town / Chat / Claw 一键切换，右上角快捷菜单（居民管理 / 小镇改造 / 技能商店 / 设置）
- **双语界面** — 完整中英文界面，自动检测或手动切换

### 核心

- **Agent = NPC** — 每个子 Agent 自动变成小镇里的 3D 居民，有名字、有形象、有人格
- **电影级工作流** — 召唤 → 集结 → 分配 → 进办公室 → 编码 → 庆祝 → 返回小镇，全程动画编排
- **实时对话气泡** — AI 的回复以打字机效果显示在 NPC 头顶，支持流式更新和分页
- **多 Agent 协作** — 管家自动拆解任务、分步骤并行 spawn 子 Agent，支持文件边界校验
- **零配置** — 安装插件，启动 Gateway，小镇自动运行

### 小镇生活

- **昼夜循环** — 24 小时时钟系统（6 个时段）、实时光照变化、路灯/窗灯自动开关
- **12 种天气** — 晴/阴/雾/小雨/大雨/暴风/雪/暴雪/沙尘暴/极光…每天随机日主题，时段间平滑过渡
- **程序合成环境音** — 雨声、风声、鸟鸣、蟋蟀、交通噪声、雷声——全部零音频文件，Web Audio API 实时合成
- **4 轨 BGM** — day / dusk / night / work 四首背景音乐，按天气、时段、场景自动切换，3.5 秒交叉淡化
- **NPC 日常行为（双模式）** — 默认算法驱动：DailyBehavior 状态机 + 5 种行为模板（按专业匹配） + 400+ 条预设台词社交，零 LLM 开销；开启灵魂模式后切换为 AI 驱动：AgentBrain 三层决策（L1 日计划 / L2 战术 / L3 对话）+ LLM 深度多轮对话 + 关系图谱 + 每日叙事摘要
- **居民独立聊天** — 点击居民 NPC 直接发起对话，消息路由到居民自己的独立 Agent 会话
- **群聊** — 多居民群聊对话，支持 @提及选择器、居民职位显示、JSONL 历史持久化、上下文 token 预算跟踪
- **话题讨论** — 发起多居民参与的群组话题讨论，支持结构化轮流发言和 AI 主持
- **班味消除小游戏** — NPC 工作时头顶生成"班味团子"，点击消除！含 combo 连击、Boss 战、NPC 压力系统，可扩展更多玩法

### UGC 工具

- **居民工坊** — 创建和配置居民角色：选择/上传 3D 模型、编辑灵魂人设（支持 AI 一键生成）、配置动画映射（8 槽位）、分配独立 LLM 模型（留空则继承全局默认）、发布为独立 Agent
- **小镇编辑器** — 可视化拖拽编辑地图：放置建筑/道路/道具/灯光，支持组合、对齐、撤销、导入导出（已支持导出 JSON，与小镇接入开发中）
- **AI 小镇编辑** — 管家可通过自然语言用 7 个新工具编辑小镇：列出资产/物件、放置/移动/变换/删除物件、设置地形、扩展地图——所有改动实时反映到 3D 场景
- **编辑器预览** — 一键打开游戏级预览窗口（WASD 控制 + 完整昼夜天气 + 车辆动画 + 音频）
- **LLM 模型管理** — 直接在 Claw 设置面板内管理 `openclaw.json` 提供商/模型：增删改查、导入导出、撤销重做——无需独立页面
- **灵魂系统** — 每个 NPC 有一份 Markdown 人设文件，定义性格、说话风格、专长和工作方式

### 交互与视觉

- **交互式 3D** — 点击 NPC 查看状态卡片（头像/人格/工作日志/thinking 流/TODO），拖拽视角，滚轮缩放
- **三场景切换** — 小镇（日常生活）/ 办公室（工作）/ 展示厅（开发中），带淡入淡出过渡和 NPC 迁移
- **丰富的 VFX** — 召唤冲击波、完成烟花、错误闪电、人格变换魔法阵、思考光环、搜索雷达、部署彩纸…
- **10 工位办公室** — 每个工位有独立显示器（实时代码动画），NPC 进场/工作/离场全流程编排
- **交付物预览** — 项目完成后弹出交付物卡片，支持图片（lightbox 放大）、视频、音频预览和下载，游戏/网站类直接 iframe 启动
- **AI 工具控制** — Agent 可以通过工具主动控制小镇（广播消息、生成 NPC、触发特效、设置时间/天气，现已支持编辑地图：放置/移动/变换/删除物件、设置地形、扩展地图）
- **Token 用量跟踪** — 每轮对话的 token 用量，含缓存读写拆分与压缩次数；当 LLM API 返回 0 时启用启发式估算回退
- **断线重连** — WebSocket 断线自动指数退避重连，工作状态自动恢复

---

## 环境要求

- [OpenClaw](https://github.com/openclaw/openclaw) **2026.3.13** 或 [QClaw](https://qclaw.cn) **0.2.x**
- Node.js >= 18（QClaw 用户无需安装）

---

## 快速安装

### OpenClaw CLI

```bash
openclaw plugins install agentshire
```

### QClaw 桌面端

克隆到 QClaw 的 **extensions** 目录（内置插件 `qclaw-plugin`、`lossless-claw` 所在的目录，**不是** `~/.qclaw/plugins/`），安装依赖后重启 QClaw：

```bash
# 找到 extensions 目录（包含 qclaw-plugin、lossless-claw 等）
ls ~/Library/Application\ Support/QClaw/openclaw/config/extensions/  # macOS
# 克隆并安装
cd <extensions-directory>
git clone https://github.com/Agentshire/Agentshire.git agentshire
cd agentshire && npm install
```

重启 QClaw 后，小镇会自动在 `http://localhost:20009` 打开。

> 前端已**预编译**（`town-frontend/dist/`），无需 build。

### 备选：Link 安装（开发用）

```bash
git clone https://github.com/Agentshire/Agentshire.git
cd Agentshire && npm install
openclaw plugins install --link .
```

### 首次启动时插件自动配置

1. 在状态目录下创建管家工作区（`workspace-town-steward/`）
2. 在 `openclaw.json` 中注册 `town-steward` Agent
3. 添加路由规则，将小镇频道的消息路由到管家
4. 设置 `subagents.runTimeoutSeconds: 600` — 子 Agent 运行超时 10 分钟，防止提前终止

> 状态目录自动检测：OpenClaw CLI 为 `~/.openclaw/`，QClaw 为 `~/.qclaw/`。

> **重要**：请勿在 `openclaw.json` 中手动添加 `tools` 配置段。插件通过 `api.registerTool()` 注册工具。手动添加 `tools.allow` 列表会覆盖插件注册的工具，导致 Agent 无法使用。

### 更新

```bash
openclaw plugins install agentshire
```

Link 安装用户：`cd Agentshire && git pull && npm install`。

然后重启 Gateway（或重启 QClaw）。

---

## 使用方式

1. 完成[快速安装](#快速安装)
2. 启动（或重启）OpenClaw Gateway：
   ```bash
   openclaw gateway
   ```
3. 小镇会自动在浏览器中打开
4. 在浏览器中对话——所有 Agent 活动会自动映射到小镇中

> **提示**：如果浏览器没有自动打开，手动访问：
> `http://localhost:20009?ws=ws://localhost:20008`


### 居民工坊

访问 `http://localhost:20009/citizen-editor.html` 打开居民工坊，创建和配置你的 NPC 团队。

### 小镇编辑器

访问 `http://localhost:20009/editor.html` 打开小镇编辑器，可视化编辑地图布局。

### LLM 模型管理

点击顶部导航栏的 **Claw** Tab（或访问 `http://localhost:20009/#claw`），切换到 **模型** 模块即可管理 `openclaw.json` 中的 LLM 提供商和模型。模型管理现已作为一等 React 面板内嵌于 Claw 设置视图，无需独立页面。

### 配置（可选）

在你的 `openclaw.json` 中自定义端口和行为（OpenClaw CLI 为 `~/.openclaw/openclaw.json`，QClaw 为 `~/.qclaw/openclaw.json`）：

```json
{
  "plugins": {
    "entries": {
      "agentshire": {
        "enabled": true,
        "config": {
          "wsPort": 20008,
          "townPort": 20009,
          "autoLaunch": true
        }
      }
    }
  }
}
```

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `wsPort` | 20008 | WebSocket 端口（插件与前端实时通信） |
| `townPort` | 20009 | HTTP 端口（前端静态资源 + 编辑器 API） |
| `autoLaunch` | true | 启动时自动在浏览器中打开小镇 |

### AI 可用工具

| 工具名 | 说明 |
|--------|------|
| `town_announce` | 在小镇广播消息 |
| `town_spawn_npc` | 生成新 NPC |
| `town_effect` | 触发视觉特效（庆祝/烟花/光圈等） |
| `town_set_time` | 控制游戏时钟（设置时间） |
| `town_set_weather` | 控制天气（12 种天气可选） |
| `town_status` | 查看小镇当前状态 |
| `register_project` | 注册简单项目（单 Agent 或管家独立完成） |
| `create_project` | 创建多 Agent 项目目录 |
| `create_task` | 创建单次委派任务目录 |
| `create_plan` | 创建协作计划（分步骤并行执行，需先 `create_project` 或 `create_task`） |
| `next_step` | 查询计划进度，获取下一步指令 |
| `mission_complete` | 统一完成处理 — 自动判断触发庆祝结束或仅发交付物卡片 |
| `town_list_assets` | 列出可用 3D 资产（建筑/道具/道路/角色/宠物），可按分类筛选 |
| `town_list_objects` | 列出当前小镇地图中已放置的物件，可按类型筛选 |
| `town_place_object` | 在网格上放置新物件（建筑/道具/道路），支持旋转、缩放、占地尺寸 |
| `town_move_object` | 将已有物件移动到新网格坐标 |
| `town_transform_object` | 变换物件：旋转、缩放、X/Z 轴翻转 |
| `town_delete_object` | 从小镇地图删除物件 |
| `town_set_terrain` | 批量设置格子地形类型（草地/沙地/街道/广场/人行道/水面） |
| `town_expand_map` | 将小镇地图扩展到更大的网格尺寸 |

---

## 灵魂系统

每个 NPC 都有独立的**灵魂文件**（Markdown），定义了角色的性格、说话风格、专长和工作方式。

灵魂文件格式：以 `# 角色名` 开头的 Markdown 文件，可包含元数据（模型 id、性别、岗位）、人设核心、性格详细设定、对话示例等。内容会作为 system prompt 注入 Agent。

**搜索优先级**（后者覆盖前者）：

1. `插件内置/town-souls/` — 预设灵魂（8 个居民 + 管家）
2. `当前工作目录/town-souls/` — 项目级灵魂
3. `{状态目录}/town-souls/` — 用户自定义灵魂（`~/.openclaw/` 或 `~/.qclaw/`）
4. `town-data/souls/` — 居民工坊发布的灵魂

你可以：
- 在居民工坊中 **AI 一键生成**灵魂文件
- 修改内置灵魂文件来调整角色性格
- 在状态目录的 `town-souls/` 下放置自定义灵魂来覆盖预设
- 创建全新的灵魂文件来定义新角色

---

## 架构概览


```
┌──────────────────────────────────────────────────────────┐
│                      OpenClaw Runtime                    │
│                                                          │
│  Gateway ─── Agent Sessions ─── Hook System ─── LLM      │
└──────┬────────────────────────────┬──────────────────────┘
       │ dispatch                   │ hook callback
       ▼                            ▼
┌──────────────────────────────────────────────────────────┐
│  Plugin Layer (Node.js)                     src/plugin/  │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ channel  │  │  hook-   │  │ws-server │  │  tools   │  │
│  │ dispatch │  │translator│  │ WS:20008 │  │ 11 tools │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  plan-   │  │ editor-  │  │ citizen- │  │llm-proxy │  │
│  │ manager  │  │  serve   │  │  router  │  │ 2 concur │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└──────┬───────────────┬───────────────────────────────────┘
       │ WS :20008     │ HTTP :20009
       │ AgentEvent    │ Editor API
       ▼               ▼
┌──────────────────────────────────────────────────────────┐
│  Bridge Layer (Browser)                     src/bridge/  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ DirectorBridge — Phase State Machine               │  │
│  │ idle→summoning→assigning→office→working→publish→ret│  │
│  └────────────────────────────────────────────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Event-  │  │  Route-  │  │ Citizen- │  │implicit- │  │
│  │Transltor │  │ Manager  │  │ Manager  │  │  chat    │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└──────┬────────────────────────────────────────────┬──────┘
       │ GameEvent (65)                 GameAction  │
       ▼                                (14)        ▲
┌──────────────────────────────────────────────────────────┐
│  Frontend Layer (Three.js)          town-frontend/src/   │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ MainScene ── EventDispatcher ── update() loop      │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │workflow/ │  │  npc/    │  │   ui/    │  │  audio/  │  │
│  │Choreogr  │  │ NPC 7-SM │  │ChatBubbl │  │ BGM+Amb  │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ scene/   │  │ editor/  │  │ engine/  │  │  data/   │  │
│  │Town/Offc │  │Workshop  │  │ Render   │  │ Protocol │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└──────────────────────────────────────────────────────────┘
```
> 开发者架构指南见 [AGENTS.md](AGENTS.md)。

---

## 开发

```bash
# 克隆仓库后
cd agentshire

# 构建小镇前端
cd town-frontend && npm install && npm run build

# 开发模式（前端热更新）
cd town-frontend && npm run dev

# 运行测试
npm test                              # 插件 + 桥接层
cd town-frontend && npx vitest run    # 前端
```

前端有 4 个入口页面：

| 页面 | URL | 说明 |
|------|-----|------|
| 小镇主页 | `index.html` | 3D 小镇 + 聊天 + Claw 设置（3 个 Tab） |
| 小镇编辑器 | `editor.html` | 地图可视化编辑 |
| 居民工坊 | `citizen-editor.html` | 角色创建和配置 |
| 编辑器预览 | `preview.html` | 游戏级预览窗口 |

> LLM 模型管理现已内嵌于小镇主页的 **Claw** Tab（`index.html#claw`），不再是独立页面。

> 开发者架构指南见 [AGENTS.md](AGENTS.md)。

---

## 扩展资产包（可选）

基础功能**不需要额外下载**——小镇、办公室、NPC 使用的内置模型（KayKit + Kenney）已包含在仓库中。

如果你需要以下高级功能，可以下载扩展资产包：

- **居民工坊 Library 角色**（308 个角色模型，多种变体和配色）
- **编辑器 Cartoon City 资产**（建筑、车辆、道路、公园等数百个模型）

### 下载方式

1. 从 [GitHub Releases (v0.1.0)](https://github.com/Agentshire/Agentshire/releases/tag/v0.1.0) 下载 `agentshire-assets.7z`（约 164MB，解压后约 4.4GB）
2. 解压到插件根目录：
   ```bash
   cd /path/to/agentshire
   7z x agentshire-assets.7z
   ```
3. 确保目录结构为：

```
agentshire/
├── assets/
│   ├── Characters_1/    ← Library 角色模型 + 共享动画
│   └── Map_1/           ← Cartoon City 编辑器资产
├── src/
├── town-frontend/
└── ...
```

不下载资产包时：游戏正常运行，编辑器基础资产可用，居民工坊仅显示内置和自定义模型。

> 资产来源和许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

## 故障排除

### Agent 无法识别插件工具

**现象**：管家 Agent 无法找到 `create_project`、`create_plan` 等插件工具。

**原因**：OpenClaw 2026.3.13 中 Rollup 代码分割会创建独立的模块实例，导致 `api.registerTool()` 注册的工具对 Agent 运行时不可见。此外，`openclaw.json` 中手动添加的 `tools` 配置段会覆盖插件注册的工具。

**解决**：
1. 删除 `openclaw.json` 中的整个 `tools` 配置段（如果有）
2. 重启 Gateway

### QClaw：插件更新后仍运行旧代码

**原因**：关闭 QClaw 窗口不会停止后台 `openclaw-gateway` 进程。

**解决**：重启前先杀掉 gateway：`ps aux | grep openclaw-gateway | grep -v grep | awk '{print $2}' | xargs kill`

### OpenClaw 2026.4.x 上 Channel 不启动

**现象**：插件加载成功但 WebSocket 连接未建立，小镇页面一直显示"连接中…"。

**原因**：OpenClaw 2026.4.x 在外部插件的 Channel 初始化流程中存在回归 Bug，使用旧式 `register(api) { api.registerChannel(...) }` 路径注册的频道生命周期未被正确调用。

**解决**：升级到已通过 `defineChannelPluginEntry` 注册的 Agentshire 版本（入口现已用 `openclaw/plugin-sdk/channel-core` 的 `defineChannelPluginEntry` 包装 `agentTownPlugin`），兼容 OpenClaw 2026.6.11+。对于更早的 OpenClaw 2026.4.x–2026.6.10，请降级到 OpenClaw 2026.3.13。

### 角色工坊"AI 生成"返回 500 错误

**现象**：在角色工坊中点击"AI 生成"失败。

**原因**：灵魂生成接口需要 `openclaw.json` 中配置有效的 LLM 提供商。如果未配置或 API Key 无效，请求会失败。

**解决**：确保 `openclaw.json` 中有有效的 `models` 配置，详见 [OpenClaw 文档](https://github.com/openclaw/openclaw)。

---

## 为什么叫 Agentshire

**Agentshire** 这个名字的灵感来自《指环王》里的**夏尔（Shire）**。

夏尔最打动人的地方，从来不是宏大的史诗感，而是它的宁静、日常、缓慢、丰饶，与那种"这里适合好好生活"的感觉。是田野、小路、窗灯、饭香、邻里、散步、闲谈——一种不需要时刻战斗、时刻加速的存在状态。

今天很多 AI 产品对未来的想象，总是赛博朋克的、高压的、极度加速的。Agent 活在 dashboard 里，活在日志/接口里，却不像真正生活在某个地方。

但我想象的是另一种未来——一个更安静的未来，一个更温柔的界面。让智能体不只是被调用、被驱动、被消费，而是可以真正"住下来"的地方。

**如果智能体会越来越进入我们的生活，那么它们也应该拥有一个像"家"一样的地方。**

不是冰冷的机房，不是永远待命的控制台，而是一个有道路、有广场、有咖啡馆、有日常节奏的游戏小镇。

AI 的未来不一定非要长得像未来战场。它也可以像一个让人愿意住进去、也愿意让自己的 Agent 住进去的地方。

---

## 愿景与路线图

> 团队不住在仪表盘里。团队住在一座小镇里。  
> 当孤岛连成大陆，小镇就长成了世界。

| 阶段 | 方向 | 状态 |
|------|------|------|
| **一座小镇** | 3D 可视化、工作流编排、灵魂系统、居民工坊、双模式界面 | ✅ 已实现 |
| **让小镇稳定运行** | QClaw + OpenClaw 兼容、双语 i18n、话题讨论、npm 发布 | 🔥 当前重点 |
| **让小镇活起来** | 编辑器打通、生活模拟（衣食住行玩）、成长体系、手机版 | 📋 下一步 |
| **连成世界** | 小镇联邦协议、跨镇 NPC 互访、技能交换、世界事件 | 🌍 远期愿景 |

详见 **[VISION.md](VISION.md)** 和 **[ROADMAP.md](ROADMAP.md)**。

---

## License

MIT
