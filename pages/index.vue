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
          </div>
        </div>
      </div>

      <div id="layers">
        <span v-for="(layer, idx) in all_stage_layers" :key="idx" @click="selectLayerOnClick(layer)">
          <span v-if="idx === layer_index" class="span_selected">
            レイヤー {{ idx }}
          </span>
          <span v-else>
            レイヤー {{ idx }}
          </span>
        </span>
      </div>

      <div id="work_area">
        <div id="canvas_holder">
          <canvas id="layer1" width="960" height="800"></canvas>
          <canvas id="layer2" width="960" height="800"></canvas>
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

function setLayerColor() {
  const el = document.querySelector<HTMLInputElement>('#inputColor')
  if (!el) return '#000000'
  all_stage_layers.value[layer_index.value].color = el.value
  return all_stage_layers.value[layer_index.value].color
}

function selectLayer() {
  return all_stage_layers.value[layer_index.value].stage_layer
}

function selectLayerOnClick(layer: Layer) {
  layer_index.value = all_stage_layers.value.indexOf(layer)
  stage_layer.value = selectLayer()
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
  if (!layer) return

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
    const rev = layer.stage_layer.children.map((x: any) => x.id)
    // ハッシュを作成してレイヤーのキーとする
    const layerKey = sha256(`${layer.index}:${rev.join(',')}`).toString()
    layer_objects.push({ key: layerKey, revs: rev })
    head_hash.value[layer.index] = layerKey
  })

  all_revisions.value.push({
    hash,
    layer_revs: layer_objects
  })

  renderDagForSelectedLayer()
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

  const nodeWidth = 80
  const nodeHeight = 44
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

  nodeG
    .append('rect')
    .attr('x', -nodeWidth / 2)
    .attr('y', -nodeHeight / 2)
    .attr('width', nodeWidth)
    .attr('height', nodeHeight)
    .attr('rx', 8)
    .attr('fill', '#fff')
    .attr('stroke', (node: any) => {
      return head_hash.value[layer_index.value] === node.id ? '#ff6600' : '#333'
    })
    .attr('stroke-width', 1)

  nodeG
    .append('text')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('font-size', 12)
    .attr('fill', '#111')
    .text((node: any) => {
      const short = String(node.id).slice(0, 7)
      const revCount = node.data?.revs?.length ?? 0
      return `${short}  (+${revCount})`
    })

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
  stage.value.update()
  stage_layer.value.update()
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
  // Import on client only (EaselJS depends on DOM APIs)
  const mod = await import('@createjs/easeljs')
  easljs = (mod as any).default ?? mod

  stage.value = new easljs.Stage('drawingCanvas')

  const layer_size = 2
  for (let index = 0; index < layer_size; index++) {
    all_stage_layers.value.push({
      index,
      stage_layer: new easljs.Stage(`layer${index + 1}`),
      color: '#000000',
      undo_stack: [],
      redo_stack: [],
      redo_revs: {},
      objectsById: {}
    })
    head_hash.value.push('')
  }

  stage_layer.value = all_stage_layers.value[layer_index.value].stage_layer

  stage.value.addEventListener('stagemousedown', handleDown)
  document.addEventListener('keydown', handleKeydown, false)

  easljs.Ticker.timingMode = easljs.Ticker.RAF
  easljs.Ticker.addEventListener('tick', onTick)

  renderDagForSelectedLayer()
})

// レイヤー切り替えるとDAG再描画
watch(layer_index, () => {
  renderDagForSelectedLayer()
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
