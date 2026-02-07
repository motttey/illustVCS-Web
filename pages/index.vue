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

type Layer = {
  index: number
  stage_layer: any
  color: string
  undo_stack: string[]
  redo_stack: string[]
  redo_revs: Record<string, any>
  objectsById: Record<string, any>
  name?: string
}

type Revision = {
  hash: string
  layer_revs: Array<{ key: string; revs: any[] }>
}

const layer_index = ref(0)
const head_hash = ref(Array<string>())

const stage: any = ref(null)
const stage_layer: any = ref(null)
const all_stage_layers = ref<Layer[]>([])
const new_shape: any = ref(null)
const surface_layer_shape: any = ref(null)
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

type DagNodeDatum = {
  id: string
  parentIds: string[]
  revs: any[]
  index: number
}

let easljs: any

function getLatestRevsForLayer(layerIdx: number) {
  const headId = head_hash.value[layerIdx]
  if (!headId) return []

  for (let i = all_revisions.value.length - 1; i >= 0; i--) {
    const rev = all_revisions.value[i]
    const layer = rev.layer_revs[layerIdx]
    if (layer?.key === headId) return layer.revs ?? []
  }
  return []
}

function getLayerPreviewForLayer(layerIdx: number) {
  const headId = head_hash.value[layerIdx]
  if (!headId) return ''
  const revs = getLatestRevsForLayer(layerIdx)
  return getOrCreateLayerPreview(layerIdx, headId, revs) ?? ''
}

type CacheRef = { value: Record<string, string> }

function renderRevisionToTempCanvas(layerIdx: number, revIds: any[]) {
  const layer = all_stage_layers.value[layerIdx]
  if (!layer || !easljs || !layer.stage_layer) return undefined

  const baseCanvas = layer.stage_layer?.canvas as HTMLCanvasElement | undefined
  const srcW = baseCanvas?.width ?? 960
  const srcH = baseCanvas?.height ?? 800

  const tempCanvas = document.createElement('canvas')
  tempCanvas.width = srcW
  tempCanvas.height = srcH
  const tempStage = new easljs.Stage(tempCanvas)

  const ids = (revIds ?? []).map((x) => String(x))
  for (const id of ids) {
    const orig = layer.objectsById[id]
    if (!orig) continue
    // EaselJS display objects can only belong to one parent, so clone
    const cloned = orig.clone?.(true) ?? orig
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

function getOrCreateThumbnail(layerIdx: number, revisionId: string, revIds: Array<string>) {
  const cacheKey = `${layerIdx}:${revisionId}`
  return getOrCreateRenderedDataUrl(thumbnailByLayerAndRevisionId, cacheKey, () => {
    const rendered = renderRevisionToTempCanvas(layerIdx, revIds)
    if (!rendered) return undefined
    const { tempCanvas, srcW, srcH } = rendered

    // Keep original aspect ratio (contain) inside a square thumbnail
    return toContainDataUrl(tempCanvas, srcW, srcH, THUMB_SIZE, THUMB_SIZE)
  })
}

function getOrCreateLayerPreview(layerIdx: number, revisionId: string, revIds: any[]) {
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

  all_stage_layers.value[index].stage_layer = new easljs.Stage(canvasId)

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
    ;(window as any).requestIdleCallback(cb, { timeout: 200 })
  } else {
    setTimeout(cb, 0)
  }
}

function handleMove(event: any) {
  new_shape.value.graphics.lineTo(event.stageX, event.stageY)
}

function handleUp(event: any) {
  new_shape.value.graphics.lineTo(event.stageX, event.stageY)
  new_shape.value.graphics.endStroke()

  stage.value.removeEventListener('stagemousemove', handleMove)
  stage.value.removeEventListener('stagemouseup', handleUp)

  stage.value.update()
  stage_layer.value.update()

  all_stage_layers.value[layer_index.value].undo_stack.push(surface_layer_shape.value.name)
}

function handleDown(event: any) {
  new_shape.value = new easljs.Shape()
  new_shape.value.name = new_shape.value.id.toString()

  new_shape.value.graphics.beginStroke('black')
  new_shape.value.graphics.moveTo(event.stageX, event.stageY)
  stage.value.addChild(new_shape.value)

  surface_layer_shape.value = new_shape.value
  surface_layer_shape.value.graphics.beginStroke(setLayerColor())
  surface_layer_shape.value.name = new_shape.value.id.toString()
  stage_layer.value.addChild(surface_layer_shape.value)

  all_stage_layers.value[layer_index.value].objectsById[String(surface_layer_shape.value.id)] =
    surface_layer_shape.value

  stage.value.addEventListener('stagemousemove', handleMove)
  stage.value.addEventListener('stagemouseup', handleUp)
}

function checkoutLayerToRevs(layerIdx: number, revIds: any[]) {
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
  all_stage_layers.value[layer_index.value].redo_revs[name] = stage_layer.value.getChildByName(name)

  stage_layer.value.removeChild(stage_layer.value.getChildByName(name))
  stage_layer.value.update()
}

function handleRedo() {
  if (all_stage_layers.value[layer_index.value].redo_stack.length === 0) return
  const name = all_stage_layers.value[layer_index.value].redo_stack.pop()!
  all_stage_layers.value[layer_index.value].undo_stack.push(name)

  const found = all_stage_layers.value[layer_index.value].redo_revs[name]
  if (!found) console.log('revision not found')
  else stage_layer.value.addChild(found)

  delete all_stage_layers.value[layer_index.value].redo_revs[name]
  stage_layer.value.update()
}

function saveRevision() {
  const hash = sha256(new Date().toString()).toString()
  const layer_objects: Array<{ key: string; revs: any[] }> = []

  all_stage_layers.value.forEach((layer) => {
    const rev = layer.stage_layer?.children?.map((x: any) => x.id) ?? []
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

  const revisions = all_revisions.value.map((rev, index) => {
    const layer = rev.layer_revs[layerIdx]
    return {
      id: layer?.key ?? rev.hash,
      revs: (layer?.revs ?? []) as any[],
      index
    }
  })

  for (const Rev of revisions) {
    if (!nodeById.has(Rev.id)) {
      nodeById.set(Rev.id, {
        id: Rev.id,
        parentIds: [],
        revs: Rev.revs,
        index: Rev.index
      })
      orderedIds.push(Rev.id)
    }
  }

  // 最新のノードから親の候補を探して接続していく
  for (let i = 0; i < revisions.length; i++) {
    const curRev = revisions[i]
    const curNode = nodeById.get(curRev.id)!

    let bestParentRev: (typeof revisions)[number] | undefined
    for (let j = 0; j < i; j++) {
      const candRev = revisions[j]
      if (candRev.id === curRev.id) continue
      if (candRev.revs.length === curRev.revs.length) continue
      if (!hasKey(candRev.revs, curRev.revs)) continue

      if (!bestParentRev) {
        bestParentRev = candRev
        continue
      }

      if (
        candRev.revs.length > bestParentRev.revs.length ||
        (candRev.revs.length === bestParentRev.revs.length && candRev.index > bestParentRev.index)
      ) {
        bestParentRev = candRev
      }
    }

    if (!bestParentRev && i > 0) bestParentRev = revisions[i - 1]

    if (bestParentRev && bestParentRev.id !== curRev.id) {
      if (!curNode.parentIds.includes(bestParentRev.id)) curNode.parentIds.push(bestParentRev.id)
    }
  }

  return orderedIds.map((id) => nodeById.get(id)!)
}

function renderDagForSelectedLayer() {
  const svgEl = document.querySelector<SVGSVGElement>('#dag')
  if (!svgEl) return

  const svg = d3.select(svgEl)
  svg.selectAll('*').remove()

  const data = buildDagDataForLayer(layer_index.value)
  if (data.length === 0) return

  const dag = d3dag.dagStratify()(data)

  const nodeWidth = THUMB_SIZE
  const nodeHeight = THUMB_SIZE
  const margin = 10

  const layout = d3dag
    .sugiyama()
    .nodeSize(() => [nodeWidth, nodeHeight])

  const { dag: laidOut, width, height } = layout(dag)

  svg
    .attr('viewBox', `${0} ${0} ${width + margin * 2} ${height + margin * 2}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')

  const g = svg.append('g').attr('transform', `translate(${margin*2}, ${margin})`)

  const line = d3
    .line()
    .curve(d3.curveCatmullRom)
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

  const nodeG = g
    .append('g')
    .selectAll('g')
    .data(laidOut.descendants())
    .join('g')
    .attr('transform', (node: any) => `translate(${node.x}, ${node.y})`)

  nodeG
    .style('cursor', 'pointer')
    .on('click', (_event: any, node: any) => {
      const layerIdx = layer_index.value
      const datum = node?.data as DagNodeDatum | undefined
      if (!datum) return

      head_hash.value[layerIdx] = datum.id
      checkoutLayerToRevs(layerIdx, datum.revs)
      renderDagForSelectedLayer()
    })

  // Thumbnail image
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
  easljs = (mod as any).default ?? mod

  stage.value = new easljs.Stage('drawingCanvas')

  await addLayer()

  stage_layer.value = selectLayer()

  stage.value.addEventListener('stagemousedown', handleDown)
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
    stage.value.removeEventListener('stagemousedown', handleDown)
    stage.value.removeEventListener('stagemousemove', handleMove)
    stage.value.removeEventListener('stagemouseup', handleUp)
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
  display: block;
  font-weight: 300;
  font-size: 100px;
  color: #35495e;
  letter-spacing: 1px;
}

.subtitle {
  font-weight: 300;
  font-size: 42px;
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
  width: auto;
  max-width: 200px;
  height: 800px;
  margin: 10px;
  display: flex;
  align-items: stretch;
}

#dag {
  border: 1px solid #ddd;
  background: #fafafa;
  width: 100%;
  height: 100%;
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
