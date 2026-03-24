// Shared types for pages/index.vue
//
// NOTE:
// This project may replace EaselJS in the future, so we keep these types as
// minimal structural interfaces (only the members used by index.vue).

export type ObjectId = string

export type CacheRef = { value: Record<string, string> }

export type StrokePoint = { x: number; y: number }

export type Stroke = {
  id: ObjectId
  color: string
  points: StrokePoint[]
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
