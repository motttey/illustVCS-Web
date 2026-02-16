<template>
  <div class="container">
    <div>
      <h1 class="title">
        illustVCS
      </h1>
      <h2 class="subtitle">
        version control system for drawing
      </h2>

      <div id="palette">
        Select Color <input id="inputColor" width="200px" type="color" value="#000000">
      </div>

      <div id="revisions">
        <div class="revisions_header">
          <div class="revisions_title">
            <span>Revisions (selected layer: {{ layer_index }})</span>
            <small class="operation_hint">s: save / r: redo / ctrl: undo / l: change layer</small>
          </div>

          <div class="revisions_toolbar btn-group" role="group" aria-label="Operations">
            <button
              type="button"
              class="btn btn-sm btn-outline-primary"
              title="Save (S)"
              @click="saveRevision"
            >
              Save
            </button>
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              title="Undo (Ctrl)"
              :disabled="!canUndo"
              @click="handleUndo"
            >
              Undo
            </button>
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              title="Redo (R)"
              :disabled="!canRedo"
              @click="handleRedo"
            >
              Redo
            </button>
            <button
              type="button"
              class="btn btn-sm btn-outline-success"
              title="Change layer (L)"
              @click="handleChangeLayer"
            >
              Next layer
            </button>

            <button
              type="button"
              class="btn btn-sm btn-outline-info"
              title="Add layer"
              @click="addLayer"
            >
              Add layer
            </button>
          </div>
        </div>
      </div>

      <div id="layers">
        <button
          v-for="(layer, idx) in all_stage_layers"
          :key="layer.index"
          type="button"
          class="layer_card"
          :class="{ layer_card_selected: idx === layer_index }"
          @click="selectLayerByIndex(idx)"
        >
          <div class="layer_card_label">
            Layer {{ idx }}
          </div>
          <div class="layer_card_preview">
            <img
              v-if="head_hash[idx]"
              :src="getLayerPreviewForLayer(idx)"
              :alt="`Layer ${idx} preview`"
            >
            <div v-else class="layer_card_preview_placeholder">
              (no revision)
            </div>
          </div>
        </button>
      </div>

      <div id="work_area">
        <div id="canvas_holder">
          <canvas
            v-for="(layer, idx) in all_stage_layers"
            :key="layer.index"
            :id="`layer${idx + 1}`"
            width="960"
            height="800"
          ></canvas>
          <canvas id="drawingCanvas" width="960" height="800"></canvas>
        </div>

        <div id="dag_div">
          <svg id="dag"></svg>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import sha256 from 'crypto-js/sha256'
import * as d3 from "d3";
import * as d3dag from "d3-dag";

import type {
  CacheRef,
  DagNodeDatum,
  EaselMouseEventLike,
  EaselShapeLike,
  EaselStageLike,
  Layer,
  ObjectId,
  Revision
} from '~/types/pages-index'

const layer_index = ref(0)
const head_hash = ref(Array<string>())

const stage = ref<EaselStageLike | null>(null)
const stage_layer = ref<EaselStageLike | null>(null)
const all_stage_layers = ref<Layer[]>([])
const new_shape = ref<EaselShapeLike | null>(null)
const surface_layer_shape = ref<EaselShapeLike | null>(null)
const all_revisions = ref<Revision[]>([])

const thumbnailByLayerAndRevisionId = ref<Record<string, string>>({})
const layerPreviewByLayerAndRevisionId = ref<Record<string, string>>({})

const THUMB_SIZE = 96
const LAYER_PREVIEW_W = 120
const LAYER_PREVIEW_H = 100

const canUndo = computed(() => {
  const layer = all_stage_layers.value[layer_index.value]
  return (layer?.undo_stack?.length ?? 0) > 0
})

const canRedo = computed(() => {
  const layer = all_stage_layers.value[layer_index.value]
  return (layer?.redo_stack?.length ?? 0) > 0
})

// EaselJS: 別ライブラリに置換するかもなのでpseudo typing
let easljs: any

function getLatestRevsForLayer(layerIdx: number): ObjectId[] {
  const headId = head_hash.value[layerIdx]
  if (!headId) return []

  for (let i = all_revisions.value.length - 1; i >= 0; i--) {
    const rev = all_revisions.value[i]
    const layer = rev.layer_revs[layerIdx]
    if (layer?.key === headId) return layer.revs ?? []
  }
  return []
}

function getRevsForLayerKey(layerIdx: number, layerKey: string): ObjectId[] {
  if (!layerKey) return []
  for (let i = all_revisions.value.length - 1; i >= 0; i--) {
    const rev = all_revisions.value[i]
    const layer = rev.layer_revs[layerIdx]
    if (layer?.key === layerKey) return (layer.revs ?? []) as ObjectId[]
  }
  return []
}

function getLayerPreviewForLayer(layerIdx: number) {
  const headId = head_hash.value[layerIdx]
  if (!headId) return ''
  const revs = getLatestRevsForLayer(layerIdx)
  return getOrCreateLayerPreview(layerIdx, headId, revs) ?? ''
}

function renderRevisionToTempCanvas(layerIdx: number, revIds: ObjectId[]) {
  const layer = all_stage_layers.value[layerIdx]
  if (!layer || !easljs || !layer.stage_layer) return undefined

  const baseCanvas = layer.stage_layer?.canvas as HTMLCanvasElement | undefined
  const srcW = baseCanvas?.width ?? 960
  const srcH = baseCanvas?.height ?? 800

  const tempCanvas = document.createElement('canvas')
  tempCanvas.width = srcW
  tempCanvas.height = srcH
  const tempStage = new easljs.Stage(tempCanvas) as EaselStageLike

  const ids = (revIds ?? []).map((x) => String(x))
  for (const id of ids) {
    const orig = layer.objectsById[id]
    if (!orig) continue
    // EaselJS display objects can only belong to one parent.
    // IMPORTANT: never add the original object to the temp stage, otherwise it
    // will be detached from the real layer stage and break checkout/undo/redo.
    const cloned = typeof orig.clone === 'function' ? orig.clone(true) : undefined
    if (!cloned) {
      console.warn('renderRevisionToTempCanvas: object is not cloneable, skip', id)
      continue
    }
    tempStage.addChild(cloned)
  }
  tempStage.update()
  return { tempCanvas, srcW, srcH }
}

function getOrCreateRenderedDataUrl(
  cacheRef: CacheRef,
  cacheKey: string,
  render: () => string | undefined
) {
  const cached = cacheRef.value[cacheKey]
  if (cached) return cached
  const dataUrl = render()
  if (!dataUrl) return undefined
  cacheRef.value[cacheKey] = dataUrl
  return dataUrl
}

function toContainDataUrl(
  srcCanvas: HTMLCanvasElement,
  srcW: number,
  srcH: number,
  destW: number,
  destH: number
) {
  const canvas = document.createElement('canvas')
  canvas.width = destW
  canvas.height = destH
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, destW, destH)

  const scale = Math.min(destW / srcW, destH / srcH)
  const dw = srcW * scale
  const dh = srcH * scale
  const dx = (destW - dw) / 2
  const dy = (destH - dh) / 2
  ctx.drawImage(srcCanvas, 0, 0, srcW, srcH, dx, dy, dw, dh)

  return canvas.toDataURL('image/png')
}

function getOrCreateThumbnail(layerIdx: number, revisionId: string, revIds: Array<ObjectId>) {
  const cacheKey = `${layerIdx}:${revisionId}`
  return getOrCreateRenderedDataUrl(thumbnailByLayerAndRevisionId, cacheKey, () => {
    const rendered = renderRevisionToTempCanvas(layerIdx, revIds)
    if (!rendered) return undefined
    const { tempCanvas, srcW, srcH } = rendered

    // Keep original aspect ratio (contain) inside a square thumbnail
    return toContainDataUrl(tempCanvas, srcW, srcH, THUMB_SIZE, THUMB_SIZE)
  })
}

function getOrCreateLayerPreview(layerIdx: number, revisionId: string, revIds: ObjectId[]) {
  const cacheKey = `${layerIdx}:${revisionId}`
  return getOrCreateRenderedDataUrl(layerPreviewByLayerAndRevisionId, cacheKey, () => {
    const rendered = renderRevisionToTempCanvas(layerIdx, revIds)
    if (!rendered) return undefined
    const { tempCanvas, srcW, srcH } = rendered

    return toContainDataUrl(tempCanvas, srcW, srcH, LAYER_PREVIEW_W, LAYER_PREVIEW_H)
  })
}

async function addLayer() {
  if (!easljs) return
  const index = all_stage_layers.value.length

  all_stage_layers.value.push({
    index,
    stage_layer: null,
    color: '#000000',
    undo_stack: [],
    redo_stack: [],
    redo_revs: {},
    objectsById: {}
  })
  head_hash.value.push('')

  await nextTick()

  const canvasId = `layer${index + 1}`
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null
  if (!canvas) {
    console.warn('addLayer: canvas not found', canvasId)
    return
  }

  all_stage_layers.value[index].stage_layer = new easljs.Stage(canvasId) as EaselStageLike

  if (all_stage_layers.value.length === 1) {
    layer_index.value = 0
    stage_layer.value = selectLayer()
  }
}

function setLayerColor() {
  const el = document.querySelector<HTMLInputElement>('#inputColor')
  if (!el) return '#000000'
  all_stage_layers.value[layer_index.value].color = el.value
  return all_stage_layers.value[layer_index.value].color
}

function selectLayer() {
  return all_stage_layers.value[layer_index.value]?.stage_layer
}

function selectLayerByIndex(idx: number) {
  layer_index.value = idx
  stage_layer.value = selectLayer()
}

function scheduleDagRender() {
  const cb = () => renderDagForSelectedLayer()
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    ;window.requestIdleCallback(cb, { timeout: 200 })
  } else {
    setTimeout(cb, 0)
  }
}

function handleMove(event: EaselMouseEventLike) {
  if (!new_shape.value) return
  new_shape.value.graphics.lineTo(event.stageX, event.stageY)
}

// EaselJS `Stage.add/removeEventListener` is typed in this project as
// `(...args: unknown[]) => void` (see `types/pages-index.d.ts`).
//
// TypeScript function parameter variance means we can't pass a strongly-typed
// `(event: EaselMouseEventLike) => void` directly. So we register thin wrapper
// listeners that accept `unknown[]` and cast the first arg.
const handleMoveListener = (...args: unknown[]) => {
  handleMove(args[0] as EaselMouseEventLike)
}

function handleUp(event: EaselMouseEventLike) {
  if (!new_shape.value || !surface_layer_shape.value) return

  new_shape.value.graphics.lineTo(event.stageX, event.stageY)
  new_shape.value.graphics.endStroke()

  stage.value?.removeEventListener('stagemousemove', handleMoveListener)
  stage.value?.removeEventListener('stagemouseup', handleUpListener)
  stage.value?.update()
  stage_layer.value?.update()

  // If we draw a new stroke after undoing, redo history becomes invalid.
  all_stage_layers.value[layer_index.value].redo_stack = []
  all_stage_layers.value[layer_index.value].redo_revs = {}

  all_stage_layers.value[layer_index.value].undo_stack.push(
    String(surface_layer_shape.value.name ?? surface_layer_shape.value.id)
  )
}

const handleUpListener = (...args: unknown[]) => {
  handleUp(args[0] as EaselMouseEventLike)
}

function handleDown(event: EaselMouseEventLike) {
  new_shape.value = new easljs.Shape() as EaselShapeLike
  new_shape.value.name = String(new_shape.value.id)

  new_shape.value.graphics.beginStroke('black')
  new_shape.value.graphics.moveTo(event.stageX, event.stageY)
  stage.value?.addChild(new_shape.value)

  surface_layer_shape.value = new_shape.value
  surface_layer_shape.value.graphics.beginStroke(setLayerColor())
  surface_layer_shape.value.name = String(surface_layer_shape.value.id)
  stage_layer.value?.addChild(surface_layer_shape.value)

  all_stage_layers.value[layer_index.value].objectsById[String(surface_layer_shape.value.id)] =
    surface_layer_shape.value

  stage.value?.addEventListener('stagemousemove', handleMoveListener)
  stage.value?.addEventListener('stagemouseup', handleUpListener)
}

const handleDownListener = (...args: unknown[]) => {
  handleDown(args[0] as EaselMouseEventLike)
}

function checkoutLayerToRevs(layerIdx: number, revIds: ObjectId[]) {
  const layer = all_stage_layers.value[layerIdx]
  if (!layer?.stage_layer) return

  if (stage.value) {
    stage.value.removeAllChildren()
    stage.value.update()
  }

  const targetStage = layer.stage_layer
  targetStage.removeAllChildren()

  const ids = (revIds ?? []).map((x) => String(x))
  for (const id of ids) {
    const obj = layer.objectsById[id]
    if (obj) {
      targetStage.addChild(obj)
    } else {
      console.warn('checkout: object not found for id', id)
    }
  }

  layer.undo_stack = [...ids]
  layer.redo_stack = []
  layer.redo_revs = {}

  targetStage.update()
}

function handleUndo() {
  if (all_stage_layers.value[layer_index.value].undo_stack.length === 0) return
  const name = all_stage_layers.value[layer_index.value].undo_stack.pop()!
  all_stage_layers.value[layer_index.value].redo_stack.push(name)
  const found = stage_layer.value?.getChildByName(name) ?? undefined
  all_stage_layers.value[layer_index.value].redo_revs[name] = found

  if (found) stage_layer.value?.removeChild(found)
  stage_layer.value?.update()
}

function handleRedo() {
  if (all_stage_layers.value[layer_index.value].redo_stack.length === 0) return
  const name = all_stage_layers.value[layer_index.value].redo_stack.pop()!
  all_stage_layers.value[layer_index.value].undo_stack.push(name)

  const found = all_stage_layers.value[layer_index.value].redo_revs[name]
  if (!found) console.log('revision not found')
  else stage_layer.value?.addChild(found)

  delete all_stage_layers.value[layer_index.value].redo_revs[name]
  stage_layer.value?.update()
}

function saveRevision() {
  const hash = sha256(new Date().toString()).toString()
  const layer_objects: Array<{ key: string; revs: ObjectId[] }> = []

  all_stage_layers.value.forEach((layer) => {
    // NOTE: children order affects z-order, so we keep the current order when
    // computing the revision key.
    const rev = (layer.stage_layer?.children?.map((x) => String(x.id)) ?? []) as ObjectId[]
    // ハッシュを作成してレイヤーのキーとする
    const layerKey = sha256(`${layer.index}:${rev.join(',')}`).toString()
    layer_objects.push({ key: layerKey, revs: rev })
    head_hash.value[layer.index] = layerKey
  })

  all_revisions.value.push({
    hash,
    layer_revs: layer_objects
  })

  scheduleDagRender()
}

function hasKey<T>(small: T[], big: T[]) {
  const b = new Set(big)
  return small.every((x) => b.has(x))
}

/**
 * リビジョンの構成からDAG描画する
 * - Node: a revision (hash) for the *selected* drawing layer
 * - Edge: parent -> child, where parent is the "closest" previous snapshot
 *   whose `revs` is a subset of the child's `revs`.
 */
function buildDagDataForLayer(layerIdx: number): DagNodeDatum[] {
  // 同じキーは1つにまとめる
  const nodeById = new Map<string, DagNodeDatum>()
  const orderedIds: string[] = []

  // IMPORTANT:
  // If a layer was created later, older revisions don't contain data for that
  // layer. In that case we should *not* fabricate nodes using `rev.hash`,
  // otherwise the new layer will incorrectly show the same number of nodes as
  // other layers.
  const revisions = all_revisions.value
    .map((rev, index) => {
      const layer = rev.layer_revs[layerIdx]
      if (!layer?.key) return undefined
      return {
        id: layer.key,
        revs: (layer.revs ?? []) as ObjectId[],
        index
      }
    })
    .filter((x): x is { id: string; revs: ObjectId[]; index: number } => Boolean(x))

  for (const Rev of revisions) {
    const existing = nodeById.get(Rev.id)
    if (!existing) {
      nodeById.set(Rev.id, {
        id: Rev.id,
        parentIds: [],
        revs: Rev.revs,
        index: Rev.index
      })
      orderedIds.push(Rev.id)
    } else {
      // Keep the latest revs/index for checkout, but don't add a new node.
      existing.revs = Rev.revs
      existing.index = Rev.index
    }
  }

  // Build edges using *unique nodes only*.
  // If we build edges from the raw revision list, then revisiting the same
  // snapshot id later can create back-edges and cycles, which breaks d3-dag.
  for (const id of orderedIds) {
    nodeById.get(id)!.parentIds = []
  }

  for (let i = 0; i < orderedIds.length; i++) {
    const curId = orderedIds[i]
    const curNode = nodeById.get(curId)!

    let bestParent: DagNodeDatum | undefined
    for (let j = 0; j < i; j++) {
      const candId = orderedIds[j]
      const candNode = nodeById.get(candId)!
      if (candNode.revs.length === curNode.revs.length) continue
      if (!hasKey(candNode.revs, curNode.revs)) continue

      if (!bestParent) {
        bestParent = candNode
        continue
      }

      if (
        candNode.revs.length > bestParent.revs.length ||
        (candNode.revs.length === bestParent.revs.length && candNode.index > bestParent.index)
      ) {
        bestParent = candNode
      }
    }

    if (!bestParent && i > 0) bestParent = nodeById.get(orderedIds[i - 1])

    if (bestParent && bestParent.id !== curNode.id) {
      curNode.parentIds.push(bestParent.id)
    }
  }

  return orderedIds.map((id) => nodeById.get(id)!)
}

function renderDagForSelectedLayer() {
  const containerEl = document.querySelector<HTMLDivElement>('#dag_div')
  const svgEl = document.querySelector<SVGSVGElement>('#dag')
  if (!svgEl) return

  const svg = d3.select(svgEl)
  svg.selectAll('*').remove()

  const data = buildDagDataForLayer(layer_index.value)
  if (data.length === 0) return

  let dag: any
  try {
    dag = d3dag.dagStratify()(data)
  } catch (e) {
    console.error('renderDagForSelectedLayer: failed to build DAG', e, data)
    return
  }

  const nodeWidth = THUMB_SIZE
  const nodeHeight = THUMB_SIZE
  // Layout spacing between nodes (in addition to node visual size)
  const nodeGapX = 24
  const nodeGapY = 28
  const margin = 10

  const layout = d3dag
    .sugiyama()
    // nodeSize controls the distance between node centers.
    // Add a small gap to avoid nodes/edges feeling cramped.
    .nodeSize(() => [nodeWidth + nodeGapX, nodeHeight + nodeGapY])

  const { dag: laidOut, width, height } = layout(dag)

  // NOTE:
  // Previously we relied on `viewBox` + CSS `width/height: 100%`, which causes
  // the whole graph to scale down when it becomes larger than the container.
  // That makes each node thumbnail smaller and hard to see.
  //
  // To keep node size readable, we will instead *grow the SVG itself* to the
  // required pixel size (and let the container scroll).
  // We'll compute the final required size after all elements are rendered.

  const g = svg.append('g').attr('transform', `translate(${margin * 2}, ${margin})`)

  const line = d3
    .line()
    // Use straight lines (no spline smoothing)
    .curve(d3.curveLinear)
    .x((d: any) => d.x)
    .y((d: any) => d.y)

  g.append('g')
    .attr('fill', 'none')
    .attr('stroke', '#999')
    .attr('stroke-width', 2)
    .selectAll('path')
    .data(laidOut.links())
    .join('path')
    .attr('d', (link: any) => line(link.points))

  const hasChild = new Set<string>()
  for (const l of laidOut.links()) {
    const src = (l as any)?.source
    if (src?.id) hasChild.add(String(src.id))
  }
  const isLeaf = (node: any) => !hasChild.has(String(node?.id))
  const baseScaleForNode = (node: any) => (isLeaf(node) ? 1 : 0.75)

  const nodeG = g
    .append('g')
    .selectAll('g')
    .data(laidOut.descendants())
    .join('g')
    .attr('transform', (node: any) => {
      const s = baseScaleForNode(node)
      return `translate(${node.x}, ${node.y}) scale(${s})`
    })

  nodeG
    .style('cursor', 'pointer')
    .on('click', (_event: any, node: any) => {
      const layerIdx = layer_index.value
      const datum = node?.data as DagNodeDatum | undefined
      if (!datum) return

      head_hash.value[layerIdx] = datum.id
      // Derive revs from the revision store to avoid any mismatch between the
      // DAG datum and the latest stored revision content.
      const revs = getRevsForLayerKey(layerIdx, datum.id)
      checkoutLayerToRevs(layerIdx, revs)
      renderDagForSelectedLayer()
    })
    .on('mouseenter', (_event: any, node: any) => {
      if (isLeaf(node)) return
      d3.select(_event.currentTarget)
        .interrupt()
        .transition()
        .duration(120)
        .attr('transform', `translate(${node.x}, ${node.y}) scale(1)`)
    })
    .on('mouseleave', (_event: any, node: any) => {
      if (isLeaf(node)) return
      d3.select(_event.currentTarget)
        .interrupt()
        .transition()
        .duration(120)
        .attr('transform', `translate(${node.x}, ${node.y}) scale(0.75)`)
    })

  nodeG
    .append('image')
    .attr('x', -nodeWidth / 2)
    .attr('y', -nodeHeight / 2)
    .attr('width', nodeWidth)
    .attr('height', nodeHeight)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    // Some browsers still require xlink:href
    .attr('href', (node: any) => {
      const datum = node?.data as DagNodeDatum
      return getOrCreateThumbnail(layer_index.value, String(datum.id), datum.revs) ?? ''
    })
    .attr('xlink:href', (node: any) => {
      const datum = node?.data as DagNodeDatum
      return getOrCreateThumbnail(layer_index.value, String(datum.id), datum.revs) ?? ''
    })

  const overlayHeight = 20
  nodeG
    .append('rect')
    .attr('x', -nodeWidth / 2)
    .attr('y', -nodeHeight / 2)
    .attr('width', nodeWidth)
    .attr('height', overlayHeight)
    .attr('rx', 4)
    .attr('fill', 'rgba(0,0,0,0.35)')

  nodeG
    .append('text')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('font-size', 11)
    .attr('font-weight', 600)
    .attr('fill', '#fff')
    .attr('x', 0)
    .attr('y', -nodeHeight / 2 + overlayHeight / 2)
    .text((node: any) => String(node.id).slice(0, 7))

  nodeG
    .append('rect')
    .attr('x', -nodeWidth / 2)
    .attr('y', -nodeHeight / 2)
    .attr('width', nodeWidth)
    .attr('height', nodeHeight)
    .attr('rx', 4)
    .attr('fill', 'none')
    .attr('stroke', (node: any) => {
      return head_hash.value[layer_index.value] === node.id ? '#ff6600' : '#333'
    })
    .attr('stroke-width', 1.5)

  const layers = new Map<number, number>()
  for (const n of laidOut.descendants()) {
    const layer = n.layer
    const y = n.y
    if (typeof layer === 'number' && !layers.has(layer)) layers.set(layer, y)
  }
  const layerEntries = [...layers.entries()].sort((a, b) => a[0] - b[0])
  g.append('g')
    .selectAll('text')
    .data(layerEntries)
    .join('text')
    .attr('x', -8)
    .attr('y', (d: Array<number>) => d[1])
    .attr('text-anchor', 'end')
    .attr('dominant-baseline', 'central')
    .attr('font-size', 10)
    .attr('fill', '#666')
    .text((d: Array<number>) => `L${d[0]}`)

  const gNode = g.node()
  if (!gNode) return

  let bbox: DOMRect
  try {
    bbox = gNode.getBBox()
  } catch (e) {
    console.warn('renderDagForSelectedLayer: getBBox failed, fallback to layout size', e)
    bbox = new DOMRect(0, 0, width + margin * 4, height + margin * 2)
  }
  const pad = margin * 2

  const minW = containerEl?.clientWidth ?? 360
  const minH = containerEl?.clientHeight ?? 800

  const contentW = Math.ceil(bbox.width + pad * 2)
  const contentH = Math.ceil(bbox.height + pad * 2)
  const svgW = Math.max(minW, contentW)
  const svgH = Math.max(minH, contentH)

  const vbX = Math.floor(bbox.x - pad)
  const vbY = Math.floor(bbox.y - pad)

  svg
    .attr('width', svgW)
    .attr('height', svgH)
    .attr('viewBox', `${vbX} ${vbY} ${svgW} ${svgH}`)
    .attr('preserveAspectRatio', 'xMinYMin meet')
}

function changeLayerIndex() {
  layer_index.value = layer_index.value < all_stage_layers.value.length - 1 ? layer_index.value + 1 : 0
}

function handleChangeLayer() {
  changeLayerIndex()
  stage_layer.value = selectLayer()
}

function onTick() {
  stage.value?.update?.()
  stage_layer.value?.update?.()
}

function handleKeydown(event: KeyboardEvent) {
  if (event.ctrlKey) {
    handleUndo()
  } else if (event.key === 'r') {
    handleRedo()
  } else if (event.key === 's') {
    saveRevision()
  } else if (event.key === 'l') {
    handleChangeLayer()
  }
}

onMounted(async () => {
  const mod = await import('@createjs/easeljs')
  easljs = mod

  stage.value = new easljs.Stage('drawingCanvas') as EaselStageLike

  await addLayer()

  stage_layer.value = selectLayer()

  stage.value.addEventListener('stagemousedown', handleDownListener)
  document.addEventListener('keydown', handleKeydown, false)

  easljs.Ticker.timingMode = easljs.Ticker.RAF
  easljs.Ticker.addEventListener('tick', onTick)

  scheduleDagRender()
})

// レイヤー切り替えるとDAG再描画
watch(layer_index, () => {
  scheduleDagRender()
})

onBeforeUnmount(() => {
  if (stage.value) {
    stage.value.removeEventListener('stagemousedown', handleDownListener)
    stage.value.removeEventListener('stagemousemove', handleMoveListener)
    stage.value.removeEventListener('stagemouseup', handleUpListener)
  }
  document.removeEventListener('keydown', handleKeydown, false)
  if (easljs?.Ticker) easljs.Ticker.removeEventListener('tick', onTick)
})
</script>

<style>
.container {
  margin: 0 auto;
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
}

.title {
  font-family: 'Quicksand', 'Source Sans Pro', -apple-system, BlinkMacSystemFont,
    'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-weight: 500;
  font-size: 72px;
  color: #35495e;
  letter-spacing: 10px;
}

.subtitle {
  font-weight: 300;
  font-size: 36px;
  color: #526488;
  word-spacing: 5px;
  padding-bottom: 15px;
}

.links {
  padding-top: 15px;
}

.span_selected {
  text-decoration: underline;
}

canvas {
  position: absolute;
  left: 0;
}

#work_area {
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

#canvas_holder {
  position: relative;
  margin: 10px;
  border: 1px solid #ddd;
  width: 960px;
  height: 800px
}

#dag_div {
  /* Allow scrolling when the DAG becomes larger than the allocated area. */
  width: auto;
  height: 800px;
  margin: 10px;
  display: flex;
  align-items: stretch;
  overflow: auto;
}

#dag {
  border: 1px solid #ddd;
  background: #fafafa;
  /* Sized dynamically via JS (width/height attributes). */
  display: block;
}

#layers {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
  margin: 10px 0;
}

.layer_card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 8px;
  cursor: pointer;
}

.layer_card:focus {
  outline: none;
}

.layer_card_selected {
  border-color: #0d6efd;
  box-shadow: 0 0 0 2px rgba(13, 110, 253, 0.35);
}

.layer_card_label {
  font-size: 12px;
  font-weight: 600;
  color: #333;
}

.layer_card_preview {
  width: 120px;
  height: 100px;
  border: 1px solid #eee;
  background: #fafafa;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.layer_card_preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.layer_card_preview_placeholder {
  font-size: 11px;
  color: #888;
}

.revisions_header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}

.revisions_title {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.revisions_toolbar {
  flex: 0 0 auto;
}

.operation_hint {
  color: #666;
}
</style>
