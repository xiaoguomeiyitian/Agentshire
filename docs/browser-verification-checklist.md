# 未提交代码 — 浏览器实测清单

> 生成日期:2026-07-20
> 范围:`git status` 中所有未提交改动(本次会话的镇长上帝视角控制 + 此前未提交的 inventory/economy/animal-mode 改动)
> 目的:列出无法通过单元测试覆盖、必须在真实浏览器(桌面 + 移动端)中人工验证的功能点。

## 一、镇长上帝视角控制(本次会话新增)

> 相关文件:`MayorInputController.ts`、`VirtualJoystick.ts`、`utils/device.ts`、`MainScene.ts`、`CameraController.ts`、`Input.ts`、`town.html`、`town-panel.css`、`CrowdService.ts`

### 1.1 PC 端(桌面浏览器,非触屏)

| # | 验证点 | 预期 | 备注 |
|---|--------|------|------|
| 1 | WASD / 方向键控制镇长行走 | 按下移动,松开停止;W→前(-z)、S→后(+z)、A→左(-x)、D→右(+x) | 方向映射正确 |
| 2 | Shift 加速 | 按住 Shift 同方向移动明显更快 | RUN_SPEED=4.5 vs WALK_SPEED=2.5 |
| 3 | 镇长朝向 | 移动时镇长面向移动方向 | `rotation.y = atan2(dir.x, dir.z)` |
| 4 | 行走动画 | 移动时播放 walk 动画,停止切回 idle | `transitionTo('walking'/'idle')` |
| 5 | 摇杆容器不显示 | 左下角无 `#joystick-zone` 可见区域 | `body.no-touch` class 应存在 |
| 6 | 点击空地行走(保留) | 鼠标点击地面空地,镇长寻路过去 | PC 端保留点击行走 |
| 7 | 点击 NPC 对话 | 点击 NPC 弹出对话气泡/卡片 | 交互不被摇杆拦截 |
| 8 | 点击建筑进入 | 点击建筑/门/标签,镇长走到门口进入 | 交互保留 |
| 9 | 鼠标拖拽平移相机 | 在游戏区域拖拽,相机平移 | 摇杆未激活,drag 正常 |
| 10 | 滚轮缩放相机 | 滚轮上滚拉近,下滚拉远;拉远上限提升,可获得更高俯视角 | ZOOM 0.5~2.2 |
| 11 | 键盘移动中断对话 | 镇长正在与 NPC 对话时按 WASD,对话中断 | `onPlayerMoveInterrupt` |
| 12 | 管家跟随 | 镇长移动时管家同步跟随,行走动画连贯不抖动 | `FollowBehavior` recheck 400ms + 阈值 0.8 + walking 不中断 |
| 13 | 进入虚拟建筑时摇杆禁用 | 进入建筑后 WASD 无响应,退出后恢复 | `inputEnabled=false` |
| 14 | 键盘输入不触发聊天框 | 聚焦聊天输入框时按 WASD 不移动镇长 | `instanceof HTMLInputElement` 守卫 |

### 1.2 移动端(触屏浏览器 / DevTools 触摸模拟)

| # | 验证点 | 预期 | 备注 |
|---|--------|------|------|
| 15 | 摇杆触发区尺寸与位置 | 触发区扩大到屏幕左半区(50vw × 35vh),覆盖左下到中间,方便单手操作;摇杆外层圆视觉尺寸 180px(thumb 60px);触发区上移至底部输入框上方(bottom:140px),不与输入框重合 | 触发区与视觉圆解耦;避开输入框 |
| 16 | 动态摇杆出现 | 在左下触发区任意位置按下,摇杆背景出现在触摸处 | 动态摇杆 |
| 17 | 摇杆推动行走 | 推动摇杆,镇长按方向移动;松开消失,镇长停止 | |
| 18 | 摇杆幅度 <80% 行走 | 轻推摇杆,镇长慢速行走 | WALK_SPEED=2.5 |
| 19 | 摇杆幅度 ≥80% 奔跑 | 推到底,镇长快速奔跑 | RUN_SPEED=4.5 |
| 20 | 摇杆方向映射 | 右推→+x,上推→-z,左下推→对应方向 | horizontal/vertical 归一化 |
| 21 | 摇杆不被对话气泡拦截 | 摇杆触发区内的触摸不被 NPC 气泡拦截 | `pointer-events` 优先级 + z-index |
| 22 | 点击空地不行走(移动端) | 点击地面空地,镇长不移动(摇杆接管) | `isTouchDevice()` 判断 |
| 23 | 点击 NPC 对话(移动端) | 点击 NPC 仍弹出对话 | 交互保留 |
| 24 | 点击建筑进入(移动端) | 点击建筑/门仍进入 | 交互保留 |
| 25 | 双指缩放方向与灵敏度 | 两指**拉开→镜头拉近**(画面放大),**捏合→镜头拉远**(画面缩小);缩放跟手,大幅拉开快速拉近、微调精细 | 本次修正方向反转 + `pinchMinDistance=3` + 按 `deltaScale` 比例缩放 |
| 26 | 单指拖拽相机(摇杆区外) | 在摇杆触发区外单指拖拽,相机平移 | drag 守卫:摇杆激活时忽略 |
| 27 | 摇杆激活时不误触相机拖拽 | 推动摇杆时相机不平移 | `if (this.joystick?.active) return` |
| 28 | 镇长不穿墙 | 摇杆/键盘移动时,镇长不穿过建筑墙体进入内部 | `CrowdService.getClosestPoint` 贴导航网格 |
| 28a | 摇杆走到居民家门口进入 | 摇杆推动镇长**正朝门走**且距门 < 1.2m 时,自动触发进入(切换室内场景或虚拟进入);路过门口(非朝门)不误触发 | `onDoorProximity` → `walkToDoor`,朝向判断 cos>0.5 |
| 28b | 摇杆走到办公室门口进入 | 摇杆推动镇长**正朝门走**且距办公室门 < 1.2m,自动进入办公室场景 | 同上 |
| 28c | 摇杆走到博物馆门口进入 | 摇杆推动镇长**正朝门走**且距博物馆门 < 1.2m,自动进入 | 同上 |
| 28d | 摇杆走到其他建筑门口进入 | 摇杆推动镇长**正朝门走**且距门 < 1.2m,自动虚拟进入(UI 显示“在XX中”) | 同上 |
| 28e | 键盘走到门口同样进入 | PC 端 WASD 正朝门走且距门 < 1.2m,自动进入 | 门检测对键盘/摇杆统一生效 |
| 28f | 路过门口不误触发 | 镇长平行经过建筑门口(非朝门),不触发进入 | 朝向判断:移动方向与到门方向夹角 ≥ 60° 不触发 |
| 28g | 室内摇杆可行走 | 进入 office/home 室内场景后,摇杆/键盘可正常行走 | office inputEnabled 立即设置(不等待入场动画) |
| 28h | 室内镜头跟随镇长 | 室内行走时镜头跟随镇长移动,不锁死在场景中央 | `updateOfficePan` 加入 followTarget 处理 |
| 28i | 室内摇杆走到门口出房间 | 室内(office/home)摇杆/键盘正朝门走且距门 < 2.0m,自动退出回 town | `checkDoorProximityForMove` 扩展室内场景,`walkToDoor('exit_office')` |
| 29 | 摇杆触摸不触发浏览器手势 | 摇杆区双指不触发浏览器缩放/旋转 | `touch-action: none` |

### 1.3 双端通用

| # | 验证点 | 预期 | 备注 |
|---|--------|------|------|
| 30 | 镇长移动后相机跟随 | 镇长移动时相机跟随,停止后保持 | `cameraCtrl.follow(mayor.mesh)` |
| 31 | 话题模式下镇长移动重新聚集 | 开启话题后镇长移动,居民重新聚集 | `topicFollowTimer` 逻辑 |
| 32 | 运行时状态保存 | 镇长移动后 10s 快照保存,刷新页面位置恢复 | `saveSnapshot` |
| 33 | 切换场景后摇杆/键盘正常 | town↔office↔home 切换后,控制仍正常 | `activeCrowd` 切换 |

---

## 二、Inventory(背包)系统(此前未提交改动)

> 相关文件:`InventoryEngine.ts`、`AnimalModeManager.ts`、`AutonomyEngine.ts`、`CitizenTradeSystem.ts`、`EconomyEventEngine.ts`、`NeedActionMapper.ts`、`NpcCardPanel.ts`、`npc-card.css`、`inventory-state.ts`、`ws-server.ts`、`town-sync.ts`、`GameProtocol.ts`、`main.ts`

### 2.1 背包 UI 显示

| # | 验证点 | 预期 | 备注 |
|---|--------|------|------|
| 34 | NPC 卡片「状态」tab 显示背包 | 点击 NPC → 状态 tab,显示「背包(N)」区域及物品列表 | `buildInventoryArea` |
| 35 | 背包物品显示 | 每项显示图标、名称、数量(×N)、来源标签 | `card-inventory-item` |
| 36 | 空背包显示 | 背包为空时不显示背包区域或显示空提示 | `if (inventory.length > 0)` |
| 37 | 来源标签中英文 | 切换语言后来源标签正确(gift_received→礼物/ Gift) | `ITEM_SOURCE_LABELS_ZH/EN` |
| 38 | 背包样式 | 背包列表样式与卡片整体风格一致 | `npc-card.css` 新增样式 |

### 2.2 背包获取与消耗

| # | 验证点 | 预期 | 备注 |
|---|--------|------|------|
| 39 | 咖啡馆购买入背包 | 居民购买咖啡馆物品后,背包出现该物品 | `EconomyEngine.buyCafeItem → addItem` |
| 40 | 收到礼物入背包 | 居民收到礼物后,背包出现礼物物品 | `CitizenTradeSystem.giftItem → addItem` |
| 41 | 分享食物入背包 | 居民收到朋友分享的食物后,背包出现 | `CitizenTradeSystem.shareFood → addItem` |
| 42 | 工作产出入背包 | 居民工作完成产出物品后,背包出现 | `AutonomyEngine work_on → addItem` |
| 43 | 随机拾取入背包 | 随机事件拾取物品后,背包出现 | `EconomyEventEngine → addItem` |
| 44 | 使用食物恢复饥饿 | 居民使用背包中的食物,饥饿值恢复,物品消失 | `useItem` + `NEED_EFFECTS` |
| 45 | 使用礼物恢复归属感 | 居民使用背包中的礼物,归属感恢复 | `useItem` |
| 46 | L2 决策从背包取食 | 居民饥饿且背包有食物时,优先从背包取食而非外出 | `getInventory` 注入 AutonomyEngine |

### 2.3 背包持久化

| # | 验证点 | 预期 | 备注 |
|---|--------|------|------|
| 47 | 背包状态定期上报 | 每 60s 前端上报 `inventory_state_save` 到后端 | `reportInventoryState` |
| 48 | 后端保存背包 | 后端收到 `inventory_state_save` 后写入 `inventory-state.json` | `saveInventoryState` |
| 49 | 刷新页面背包恢复 | 刷新页面后,居民背包内容恢复 | `animal_state_load → restoreInventoryState` |
| 50 | WS 重连背包恢复 | WS 断开重连后,背包内容恢复 | `pendingAnimalState.inventory` |
| 51 | 后端日志记录 | 后端日志记录 `inventory_state_save` 事件 | `ws-server.ts` 日志 |

---

## 三、Economy / Animal-mode 其他改动(此前未提交)

> 相关文件:`EconomyEngine.ts`、`EconomyEventEngine.ts`、`DailySettlementEngine.ts`、`RulesEngine.ts`、`AssetLoader.ts`、`CharacterModelRegistry.ts`、`MediaPreview.ts`

| # | 验证点 | 预期 | 备注 |
|---|--------|------|------|
| 52 | 咖啡馆物品转背包格式 | 购买的咖啡馆物品正确转换为背包物品 payload | `cafeItemToInventoryItem` |
| 53 | 饥饿+破产→回家吃饭 | 居民饥饿且 coins<5 时,回家吃饭而非外出 | `EconomyEventEngine` P2-3 |
| 54 | 每日结算不再叠加 mood 事件 | 每日结算恢复 fun/esteem needs,不再 `moodEngine.applyEvent` | `DailySettlementEngine` P1-2 |
| 55 | mood 反映 needs 状态 | mood 由 needs 自然计算,不叠加瞬时事件 | 避免双重计算 |
| 56 | 外部资源 URL 正确 | GLTF 模型、ext-assets 等外部资源 URL 带 API 前缀 | `AssetLoader` + `CharacterModelRegistry` 用 `apiUrl()` |
| 57 | 模型加载不因 URL 错误失败 | 外部资源加载成功,无 404/混合内容错误 | `resolvedUrl = apiUrl(url)` |
| 58 | MediaPreview 触摸交互 | 媒体预览的触摸滑动/关闭正常 | `MediaPreview.ts` |

---

## 四、回归验证(确保现有功能不破坏)

| # | 验证点 | 预期 | 备注 |
|---|--------|------|------|
| 59 | 现有点击寻路正常 | PC 端点击地面,镇长寻路过去(未被摇杆改动破坏) | `handleGroundTap` 保留 |
| 60 | NPC 自主行为正常 | 居民自主工作/吃饭/社交,无异常 | animal-mode 回归 |
| 61 | 群体避障正常 | NPC 之间不重叠,镇长能推开人群 | `CrowdService` 未破坏 |
| 62 | 天气/时钟正常 | 24h 时钟推进、天气切换正常 | `GameClock`/`WeatherSystem` |
| 63 | 对话流正常 | 与管家/居民对话,消息收发正常 | `CitizenChatManager` |
| 64 | 群聊正常 | @提及群聊,多居民回复正常 | `group-chat` |
| 65 | 编辑器正常 | 地图编辑器、居民工坊、模型管理器正常 | `editor/` |

---

## 五、测试环境建议

### PC 端
- Chrome / Edge / Firefox 最新版
- DevTools Console 无报错
- 键盘测试:WASD + 方向键 + Shift
- 鼠标测试:点击 + 拖拽 + 滚轮

### 移动端
- **真机测试优先**:iOS Safari + Android Chrome
- DevTools 触摸模拟(Portrait 模式)作为补充
- 触摸测试:单指摇杆 + 单指拖拽 + 双指缩放
- 注意:`isTouchDevice()` 在 DevTools 触摸模拟下应返回 true(验证 `navigator.maxTouchPoints`)

### 跨设备
- 平板(iPad):验证摇杆触发区在更大屏幕上的尺寸(28vw × 28vh,上限 220px)
- 带触摸屏的笔记本:验证 `isTouchDevice()` 返回 true 时摇杆显示,键盘仍可用

---

## 六、已知边界情况

| # | 场景 | 预期行为 | 风险 |
|---|------|----------|------|
| 66 | 摇杆触摸 + 键盘同时 | 键盘优先,摇杆归零 | 互斥逻辑 |
| 67 | 摇杆触摸移出触发区 | 摇杆仍跟随(window 监听 pointermove) | `attachWindowListeners` |
| 68 | 多指触摸摇杆 | 第一个 pointer 拥有摇杆,第二个被忽略 | `pointerId` 守卫 |
| 69 | 镇长在虚拟建筑内按 WASD | 无响应(`inputEnabled=false`) | 已有机制 |
| 70 | NavMesh 未就绪时移动 | 不贴地,直接位移(降级) | `crowd?.ready` 判断 |
| 71 | 摇杆幅度恰好在 0.8 阈值 | 边界值,可能行走/奔跑切换 | `RUN_MAGNITUDE_THRESHOLD` |
| 72 | 双指缩放 clamp | 单帧缩放因子限制在 [0.85, 1.15](已反转:factor=1/deltaScale) | 防抖动 |

---

## 七、验证通过标准

- 上述 72 项全部通过(或已知边界情况符合预期)
- `npx tsc --noEmit` 无错误
- `npx vitest run`(前端)518 通过
- `npm test`(后端)501 通过
- Console 无未捕获错误
- 性能:60 FPS 稳定(摇杆/键盘移动时无明显掉帧)
