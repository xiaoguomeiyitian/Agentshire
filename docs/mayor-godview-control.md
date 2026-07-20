# 镇长行走改为 sheShou 上帝视角模式(双端适配)

> 实施日期:2026-07-20
> 目标:在 Agentshire 中新增「虚拟摇杆(移动端)+ WASD/方向键(PC 端)」驱动的连续移动控制,对齐 sheShou 上帝视角操作手感。

## TL;DR

摇杆/键盘方向直接驱动镇长位移与朝向(复用 `NPC.transitionTo` 动画状态机 + `CrowdService.getClosestPoint` 贴导航网格防穿墙),相机沿用现有 `CameraController.follow` 跟随。移动端移除点击空地行走(摇杆接管),PC 端保留点击行走与 WASD 共存;点击 NPC/建筑/门交互两端全保留。

## 研究结论(两项目对比)

| 维度 | Agentshire 现状 | sheShou 上帝视角(参考) |
|------|----------------|--------------------------|
| 移动触发 | 点击地面 raycast → `mayor.moveTo` 寻路 | 摇杆持续输入 |
| 方向控制 | 目标点寻路 | 摇杆 `forward=(h,0,-v)` 归一化直接驱动 |
| 朝向 | 寻路路径决定 | `atan2(h,-v)+180°` |
| 键盘 | **无**(仅编辑器预览页有) | WASD+Shift |
| 移动端 | 无专门控制 | 动态虚拟摇杆 |
| 相机 | `CameraController` 跟随+拖拽+缩放 | `GodPersonCamera` 跟随(位置平均平滑)+拖拽+缩放 |
| 寻路 | `CrowdService` | `navMesh.getClosestPoint` 贴地 |

关键发现:Agentshire 的 `PreviewPlayerController.ts`(编辑器预览页)已实现 WASD+点击移动,可作为键盘分支的现成参考;`NPC.moveTo` 基于 `CrowdService` 寻路,但连续移动场景应改为直接位移 + `transitionTo('walking')`,不走 `moveTo` 寻路。

## 实施步骤

### Phase 1: 摇杆 UI 与设备检测基础设施

1. 新增 `town-frontend/src/ui/VirtualJoystick.ts` —— 参考 `sheShou/client_dev/assets/src/core/ui/JoyStick.ts`,DOM/Canvas 绘制动态摇杆(触摸处出现),输出 `{magnitude, horizontal, vertical, rotation, active}`,归一化 + 半径 clamp(130px)
2. 在 `town-frontend/town.html` 增加摇杆容器 DOM(左下 1/3 区域透明层);在 `town-frontend/src/ui/town-panel.css` 增加半透明圆形背景+摇杆点样式。**摇杆容器 `pointer-events` 优先级高于 NPC 对话气泡**(避免气泡触摸拦截摇杆);**PC 端(`!isTouchDevice()`)隐藏摇杆容器**(`display:none` 或 JS 隐藏),保持键鼠原生体验。*依赖 step 1,3*
3. 新增 `town-frontend/src/utils/device.ts` —— `isTouchDevice()` 基于 `navigator.maxTouchPoints > 0 || 'ontouchstart' in window`。*并行 step 1*

### Phase 2: 键盘+摇杆输入统一抽象

4. 新增 `town-frontend/src/game/MayorInputController.ts` —— 参考 `PreviewPlayerController.ts`(键盘分支)与 sheShou `MoveMentSystem.handleGodViewMovement`(摇杆分支),统一输出归一化方向 `{x, z, magnitude}`。键盘按下禁用摇杆(互斥)。速度档位:`magnitude < 0.8` 行走,`≥ 0.8` 奔跑;PC 端 Shift 加速。*依赖 step 1,3*
5. 在 `MainScene.ts` 构造时实例化 `MayorInputController`,传入 `engine`、`container`、`mayor NPC`、`cameraCtrl`、`citizenChat`、`followBehavior`、`steward`、`crowdService`。在 `update(dt)` 循环调用 `mayorInput.update(dt)`。*依赖 step 4*

### Phase 3: 镇长连续移动驱动

6. `MayorInputController.update()`:`magnitude > 0` 时,计算 `dir * speed * dt` 增量位移,先算候选新位置,再调用 `CrowdService.getClosestPoint` **贴导航网格防穿墙进入建筑内部**(与点击寻路一致性),写入 `mayor.mesh.position`;设置 `mayor.mesh.rotation.y = atan2(dir.x, dir.z)`,`mayor.transitionTo('walking')`;`magnitude === 0` 时 `mayor.transitionTo('idle')`。**不调用 `moveTo()`**(那是点击寻路模式)。*依赖 step 5*
7. 移动时调用 `citizenChat.onPlayerMoveInterrupt()` 中断对话(与现有 `handleGroundTap` 一致),`cameraCtrl.follow(mayor.mesh)` 保持跟随;管家 `followBehavior` 同步跟随。*依赖 step 6*
8. 摇杆/键盘激活期间设 `playerMoveEnabled = false` 防止与点击寻路冲突,松开后恢复。*依赖 step 6*

### Phase 4: 点击交互适配

9. 修改 `MainScene.handleTap()` —— 保留点击 NPC/建筑/门交互;**移动端**(`isTouchDevice()`):点击空地不再触发 `handleGroundTap` 行走(摇杆接管);**PC 端**:保留点击空地行走(与 WASD 共存)。*依赖 step 6*
10. `handleGroundTap` 内增加守卫:摇杆激活时忽略点击行走。*依赖 step 6*

### Phase 5: 相机双端适配

11. `CameraController` 已支持拖拽+缩放+跟随,无需大改。在 `Input` 或 `MainScene` 的 drag 处理中判断触摸点是否落在摇杆容器区域(左下 1/3),若是则忽略 drag(避免摇杆触摸误触相机平移)。*依赖 step 2*
12. PC 端 WASD 控制镇长(非相机平移),不引入 sheShou 的 WASD 平移相机逻辑。*决策*

### Phase 6: 测试与验证

13. 单元测试 `VirtualJoystick` 输出归一化、边界 clamp、动态出现/消失。*依赖 step 1*
14. 单元测试 `MayorInputController` 键盘→方向、摇杆→方向、互斥逻辑、速度档位、贴地防穿墙。*依赖 step 4*
15. 手动验证双端操作。*依赖全部*

## 相关文件

- `town-frontend/src/game/MainScene.ts:401,2891,3269` —— tap 入口、`handleTap`、`handleGroundTap`(修改 step 5,9,10)
- `town-frontend/src/game/visual/CameraController.ts` —— 相机跟随/拖拽/缩放(复用,step 11 小改 drag 守卫)
- `town-frontend/src/npc/NPC.ts:609,398` —— `moveTo`、`transitionTo`(复用 `transitionTo`,不用 `moveTo`)
- `town-frontend/src/game/nav/CrowdService.ts` —— `getClosestPoint` 贴导航网格(step 6 防穿墙)
- `town-frontend/src/editor/PreviewPlayerController.ts` —— WASD+点击参考实现(键盘分支参考)
- `town-frontend/src/engine/Input.ts` —— PointerEvent 统一输入(复用)
- `town-frontend/town.html:129` —— 摇杆容器 DOM(新增 step 2)
- `town-frontend/src/ui/town-panel.css` —— 摇杆样式(新增 step 2)
- `sheShou/client_dev/assets/src/core/ui/JoyStick.ts` —— 摇杆参考实现(参考)
- `sheShou/client_dev/assets/src/game/sheshou/gameLogic/MoveMentSystem.ts:53-78` —— 上帝视角移动算法(参考)
- `sheShou/client_dev/assets/src/core/camera/GodPersonCamera.ts` —— 上帝视角相机(参考,不照搬)

## 验证

1. `cd town-frontend && npx vitest run` —— 新增单测通过,现有 244 测试不回归
2. `cd town-frontend && npx tsc --noEmit` —— 无类型错误
3. PC 端浏览器:WASD/方向键控制镇长行走,松开停止;Shift 加速;点击 NPC 弹对话;点击空地行走(保留);鼠标拖拽平移相机;滚轮缩放;**摇杆容器不显示**
4. 移动端浏览器(DevTools 触摸模拟):左下 1/3 区域按下出现动态摇杆,推动行走,幅度≥80% 奔跑,松开消失;点击 NPC 对话;双指缩放;单指拖拽相机(摇杆区外);**摇杆触摸不被对话气泡拦截**
5. 摇杆移动中点击 NPC 不冲突;镇长不穿墙进入建筑内部(贴导航网格);进入虚拟建筑时摇杆自动禁用(复用 `inputEnabled=false` 机制)

## 决策

- **保留点击交互**:不完全替换点击,保留点击 NPC/建筑/门交互,仅移动端点击空地行走改为摇杆接管
- **不引入视角切换**:本次只做上帝视角,不引入 sheShou 的第三/第一人称切换
- **不引入帧同步**:Agentshire 单机,摇杆输入直接驱动本地 NPC,不打包输入帧
- **相机沿用现有**:复用 `CameraController`(已有跟随+拖拽+缩放),不照搬 `GodPersonCamera`
- **键盘控制镇长而非相机**:WASD 控制镇长移动,相机跟随镇长

## 已确认决策(用户 2026-07-20)

1. **点击空地行走**:移动端移除(摇杆接管),PC 端保留(鼠标点击空地行走与 WASD 共存)。点击 NPC/建筑/门交互两端都保留
2. **摇杆显示方式**:动态摇杆,触摸处出现,松开消失,不遮挡画面
3. **行走速度档位**:摇杆幅度驱动 —— 推动 <80% 行走,≥80% 奔跑(移动端直觉);PC 端 Shift 键加速作为补充
4. **摇杆触发区域**:屏幕左下 1/3 区域按下即出现摇杆,右侧留给相机拖拽
5. **摇杆贴地防穿墙**:启用 `CrowdService.getClosestPoint` 贴导航网格,避免镇长穿墙进入建筑内部(与点击寻路一致性)
6. **摇杆容器 pointer-events 优先级**:摇杆容器优先级高于 NPC 对话气泡,避免气泡触摸拦截摇杆
7. **PC 端不显示摇杆容器**:PC 端隐藏摇杆容器,保持键鼠原生体验(WASD/方向键 + Shift 加速 + 鼠标点击)
