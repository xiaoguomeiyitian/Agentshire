# Game 层架构指南

> 3D 小镇前端的场景管理、生活模拟、小游戏、NPC 行为、视觉效果。

## 目录结构

```
town-frontend/src/game/
├── MainScene.ts           # 场景总控（1600+行）：init + update循环 + 子系统编排
├── EventDispatcher.ts     # 65种GameEvent纯路由（switch → handler回调，零逻辑）
├── DialogManager.ts       # 对话流式显示 + 活动日志面板(activity/thinking/todo) + recentlyFlushed去重
├── SceneBootstrap.ts      # 启动流程（mock/live分支 + PublishedCitizenConfig加载）
├── GameClock.ts           # 24h循环（6时段，夜间3x加速，localStorage持久化）
├── WeatherSystem.ts       # 12种天气 + 10种日主题 + seeded random
├── DebugBindings.ts       # console调试绑定
│
├── animal-mode/           # ★ 动物模式自治系统（取代旧 workflow/ + DailyScheduler + AgentBrain）
│   ├── AnimalModeManager.ts  # 总控：注册/注销居民 + 引擎生命周期 + L2决策循环(30s)
│   ├── AutonomyEngine.ts     # L2决策循环：每30s扫描到期居民 → 生成行动 → 执行
│   ├── NeedsEngine.ts        # 需求系统：饥饿/社交/休息/娱乐/探索 5维需求 + 衰减
│   ├── MoodEngine.ts         # 心情系统：需求满足度 → 心情值 + 事件修正
│   ├── RelationshipEngine.ts # 关系系统：居民间互动 → 关系值 + 好感度
│   ├── MoveEngine.ts         # 移动引擎：需求 → 目标地点 → A*寻路 → 移动执行
│   ├── NeedActionMapper.ts   # 需求 → 行动映射（纯函数：需求类型 → NPC状态/动画/对话）
│   ├── MoodAnimator.ts       # 心情 → 视觉表现（表情/姿态/光环色调）
│   ├── IndoorTracker.ts      # 室内追踪：居民是否在建筑内 + 室内外状态切换
│   ├── FestivalEngine.ts     # 节日系统：特殊日期触发节日事件 + 全镇氛围
│   ├── RulesEngine.ts        # 规则引擎：动物模式行为规则（animal-rules.md驱动）
│   ├── MemoryStore.ts        # 记忆存储：居民短期/长期记忆 + 事件日志
│   └── index.ts              # Barrel export
│
├── minigame/              # ★ 小游戏系统
│   ├── MinigameSlot.ts        # 小游戏插槽接口（mount/start/stop/addTroubledNpc）
│   ├── TroubleGame.ts          # "小镇烦恼事件"：worry气泡生成/combo/NPC心情/语音池
│   ├── TroubleRenderer.ts      # DOM渲染层：worry气泡/HUD/屏幕震动/粒子
│   └── TroubleNpcEffects.ts    # NPC烦恼视觉（去饱和+紫光+变形+减速）
│
├── scene/                 # 3D 场景构建
│   ├── TownBuilder.ts         # 小镇（8建筑/14组路灯/20棵树/喷泉/花坛/长椅）
│   ├── OfficeBuilder.ts       # 工坊（10工作台A-J + 访客区 + 白板）
│   ├── MuseumBuilder.ts       # 博物馆（6展台 + unlockStand效果）
│   ├── ScreenRenderer.ts      # 工作台屏幕（Canvas2D→Texture，6种状态含代码动画）
│   └── VehicleManager.ts      # 车辆系统（对象池6辆，按时段调频，夜间开灯）
│
├── visual/                # VFX + 渲染
│   ├── VFXSystem.ts           # VFX Facade → 委托4个子模块
│   ├── SpawnEffects.ts        # 人格变换冲击波 / 错误闪电 / 召唤涟漪(4.2s)
│   ├── WorkEffects.ts         # 思考光环 / 手艺粒子 / 文件图标 / 搜索雷达 / 连接光束
│   ├── CelebrationEffects.ts  # 庆祝烟花(5连发) / 彩纸(200个) / 光柱 / 技能仪式(8s)
│   ├── DebugEffects.ts        # 路径调试可视化
│   ├── Effects.ts             # 基础粒子（ripple/stars/sparks/pillar/exclamation）
│   ├── ParticlePool.ts        # GPU粒子池（512个，AdditiveBlending）
│   ├── EffectRegistry.ts      # 特效注册表 + 更新循环 + 相机震动
│   ├── CameraController.ts    # 跟随/拖拽/缩放/巡逻/工坊模式/动画过渡
│   ├── TimeOfDayLighting.ts   # 昼夜光照（10关键帧，smoothstep插值，天气覆盖）
│   ├── WeatherEffects.ts      # GLSL粒子天气（雨25000/雪12000/沙10000/水花/积雪/地雾/极光）
│   ├── PostProcessing.ts      # 后处理（RenderPass + UnrealBloomPass）
│   └── AssetLoader.ts         # GLTF加载器（批次并行6个，builtin/library/custom三源）
│
└── __tests__/
    ├── EventDispatcher.test.ts
    ├── DialogManager.test.ts
    ├── GameClock.test.ts
    └── SceneBootstrap.loadConfig.test.ts
```

## 数据流

```
DataSource (Mock / DirectorBridge)
 │ onGameEvent
 ▼
MainScene.handleGameEvent()
 │ 委托
 ▼
EventDispatcher.dispatch(event)
 ├─ npc_spawn/despawn/phase/emoji/glow/anim  → MainScene NPC操作
 ├─ dialog_message/dialog_end                 → DialogManager
 ├─ npc_activity/activity_stream/activity_todo → DialogManager（活动日志）
 ├─ fx                                        → MainScene.onFx → VFXSystem
 ├─ deliverable_card                          → MediaPreview
 ├─ skill_learned                             → SkillLearnCard + 技能仪式VFX
 └─ set_time/set_weather                      → GameClock / WeatherSystem
```

## MainScene update 循环

```
update(deltaTime):
  1. 门廊交互检测（pendingDoorInteraction → 距离检查 → 场景切换）
  2. gameClock.update()
  3. 按场景分支：
     town:   cameraCtrl + timeOfDayLighting + weatherSystem + vehicleManager
     office: cameraCtrl.updateOfficePan
     museum: cameraCtrl.update
  4. followBehavior + citizenChat（ms 单位）
  5. timeHUD
  6. 音频：ambientSound(仅town) + bgm(天气/时段/场景)
  7. npcManager.update()
  8. 仅town: encounterManager + casualEncounter（轻量社交）
  9. vfx + bubbles + officeBuilder.updateScreens + minigame

## 动物模式（Animal Mode）

`AnimalModeManager` 取代旧的 workflow/ + DailyScheduler + AgentBrain，驱动居民自治行为：

- **L2 决策循环**：每 30s 扫描到期居民 → `AutonomyEngine.decide()` 调用 LLM 生成行动
- **行动执行**：`MainScene.executeAutonomyAction()` → NPC 移动/对话/进入建筑
- **需求系统**：8 维需求（饥饿/疲劳/社交/娱乐/卫生/安全/自我实现/归属）+ 衰减
- **心情系统**：需求满足度 → 心情值 + 事件修正 → 视觉表现
- **关系系统**：居民间互动 → 关系值 + 好感度
- **室内追踪**：居民进入/离开建筑时切换可见性
- **节日系统**：特殊日期触发全镇节日事件
- **规则引擎**：`animal-rules.md` 驱动 LLM 提示词

启用方式：`MainScene.setAnimalModeEnabled(true)` → 注册居民到 NeedsEngine → 启动 L2 循环。
居民在 `onNpcSpawn` 时自动注册到 Animal Mode（若已启用）。
```

## 小游戏系统

`MinigameSlot` 接口解耦小游戏与主场景。`TroubleGame` 是首个实现：

- **Worry 系统**：居民遇到烦恼时 5-30s 随机生成烦恼气泡（light/medium/heavy），每 NPC 最多 6 个
- **Combo 系统**：连击 ≥2/4/7/10 触发不同级别文案，每档 30 条生活化文案
- **NPC 心情**：worry 数量 → mood 值 → 去饱和+紫光+变形+减速
- **生命周期**：由 `AnimalModeManager` 的 help_request/conflict 事件触发 `addTroubledNpc`


## NPC 状态机

通过 `NPC.transitionTo(state)` 驱动，`STATE_TRANSITIONS` 限制合法转换。

| 状态 | 动画 | 自动转换 |
|------|------|---------|
| idle | idle | — |
| walking | walk | moveTo 到达后回 idle |
| working | typing/reading | — |
| thinking | idle(0.5x) | — |
| celebrating | cheer | LoopOnce 播完回 idle |
| emoting | wave/frustrated/dancing | LoopOnce 播完回 idle |
| departing | walk | 到达后由外部处理 |

`transitionCharacterKey()` 支持带淡入淡出的角色模型热切换。

## 天气系统

`WeatherSystem` 管理 12 种天气（clear/cloudy/overcast/foggy/drizzle/rain/heavyRain/storm/snow/blizzard/sandstorm/aurora），每天通过 seeded random 按权重滚 10 种日主题，每时段映射到具体天气。中间态路由确保平滑过渡（暴风→晴天需经 rain→cloudy→clear）。

天气驱动三个系统：
- `TimeOfDayLighting`：sunMul / ambMul / tint 覆盖
- `WeatherEffects`：GLSL 粒子（雨/雪/沙/地雾/极光等）
- `AmbientSoundManager`：程序合成音频层

## 常见改动

| 要做的事 | 改哪里 |
|---------|--------|
| 新增 GameEvent 处理 | `EventDispatcher.ts` 加 case + handler |
| 修改对话气泡 | `DialogManager.ts` |
| 修改场景切换 | `MainScene` 门廊交互逻辑 |
| 修改NPC日常 | `animal-mode/AnimalModeManager.ts` + `npc/DailyBehavior.ts` |
| 修改启动流程 | `SceneBootstrap.ts` |
| 修改NPC离场动画 | `MainScene.onNpcWorkDone()` |
| 修改小镇生活编排 | `MainScene` update 循环 + `animal-mode/` |
| 修改小游戏 | `minigame/TroubleGame.ts`（逻辑）+ `TroubleRenderer.ts`（渲染） |
| 新增小游戏 | 实现 `MinigameSlot` 接口 → `MainScene.initModeSystem()` 注册 |
| 修改NPC状态/动画 | `npc/NPC.ts` — `transitionTo()` 驱动 |
| 新增NPC状态 | `NpcState` 类型 + `STATE_TRANSITIONS` + `onEnterState` |
| 修改天气 | `WeatherSystem.ts`(状态机) + `WeatherEffects.ts`(视觉) |
| 修改VFX | `visual/` 下对应子模块 + `VFXSystem.ts` Facade |
| 修改相机 | `visual/CameraController.ts` |
| 修改光照 | `visual/TimeOfDayLighting.ts` |
| 修改建筑/场景 | `scene/TownBuilder.ts` 或对应 Builder |
| 新增VFX触发 | `MainScene.onFx()` 的 switch |
