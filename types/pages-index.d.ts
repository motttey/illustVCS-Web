// Shared types for pages/index.vue
//
// NOTE:
// This project may replace EaselJS in the future, so we keep these types as
// minimal structural interfaces (only the members used by index.vue).

export type ObjectId = string

export type CacheRef = { value: Record<string, string> }

export interface EaselMouseEventLike {
  stageX: number
  stageY: number
}

export interface EaselGraphicsLike {
  moveTo(x: number, y: number): unknown
  lineTo(x: number, y: number): unknown
  beginStroke(color: string): unknown
  endStroke(): unknown
}

export interface EaselDisplayObjectLike {
  id: number | string
  name?: string
  clone?: (recursive?: boolean) => EaselDisplayObjectLike
}

export interface EaselContainerLike extends EaselDisplayObjectLike {
  children?: EaselDisplayObjectLike[]
  addChild(child: EaselDisplayObjectLike): unknown
  removeChild(child: EaselDisplayObjectLike): unknown
  removeAllChildren(): void
  getChildByName(name: string): EaselDisplayObjectLike | null
}

export interface EaselStageLike extends EaselContainerLike {
  canvas?: HTMLCanvasElement | object
  update(...args: unknown[]): void
  addEventListener(type: string, listener: (...args: unknown[]) => void): unknown
  removeEventListener(type: string, listener: (...args: unknown[]) => void): unknown
}

export interface EaselShapeLike extends EaselDisplayObjectLike {
  graphics: EaselGraphicsLike
}

export type Layer = {
  index: number
  stage_layer: EaselStageLike | null
  color: string
  undo_stack: ObjectId[]
  redo_stack: ObjectId[]
  redo_revs: Record<ObjectId, EaselDisplayObjectLike | undefined>
  objectsById: Record<ObjectId, EaselDisplayObjectLike>
  name?: string
}

export type Revision = {
  hash: string
  layer_revs: Array<{ key: string; revs: ObjectId[] }>
}

export type DagNodeDatum = {
  id: string
  parentIds: string[]
  revs: ObjectId[]
  index: number
}
