// ────────────────────────────────────────────────────────────
// Engine module — public API
// ────────────────────────────────────────────────────────────

export { Engine } from './Engine'
export type { GameScene } from './Engine'

export { Input } from './Input'
export type {
  TouchPoint, TouchState, NormalizedVector2,
  GestureType, SwipeDirection, GestureConfig,
  Gesture, TapGesture, DoubleTapGesture, LongPressGesture,
  SwipeGesture, PinchGesture, RotateGesture, DragGesture, DragPhase,
  GestureCallback, GestureEvent,
} from './Input'

export { World } from './World'
export type { GameObject } from './World'

export { Screen } from './Screen'
export type { ScreenOrientation, SafeAreaInsets, ScreenState, ScreenCallbacks } from './Screen'

