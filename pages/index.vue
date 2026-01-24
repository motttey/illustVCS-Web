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
        <ul>
          <li v-for="revision in all_revisions" :key="revision.hash">
            {{ revision.layer_revs[layer_index] }}
          </li>
        </ul>
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

      <div id="canvas_holder">
        <canvas id="layer1" width="960" height="540"></canvas>
        <canvas id="layer2" width="960" height="540"></canvas>
        <canvas id="drawingCanvas" width="960" height="540"></canvas>
      </div>

      <div id="dag_div">
        <svg id="dag"></svg>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import sha256 from 'crypto-js/sha256'

type Layer = {
  index: number
  stage_layer: any
  color: string
  undo_stack: string[]
  redo_stack: string[]
  redo_revs: Record<string, any>
  name?: string
}

type Revision = {
  hash: string
  layer_revs: Array<{ key: string; revs: any[] }>
}

const layer_index = ref(0)
const stage: any = ref(null)
const stage_layer: any = ref(null)
const all_stage_layers = ref<Layer[]>([])
const new_shape: any = ref(null)
const surface_layer_shape: any = ref(null)
const all_revisions = ref<Revision[]>([])

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

  stage.value.addEventListener('stagemousemove', handleMove)
  stage.value.addEventListener('stagemouseup', handleUp)
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
    layer_objects.push({ key: hash, revs: rev })
  })

  all_revisions.value.push({
    hash,
    layer_revs: layer_objects
  })
}

function changeLayerIndex() {
  layer_index.value = layer_index.value < all_stage_layers.value.length - 1 ? layer_index.value + 1 : 0
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
    changeLayerIndex()
    stage_layer.value = selectLayer()
  }
}

onMounted(async () => {
  const mod = await import('@createjs/easeljs/dist/easeljs.cjs')
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
      redo_revs: {}
    })
  }

  stage_layer.value = all_stage_layers.value[layer_index.value].stage_layer

  stage.value.addEventListener('stagemousedown', handleDown)
  document.addEventListener('keydown', handleKeydown, false)

  easljs.Ticker.timingMode = easljs.Ticker.RAF
  easljs.Ticker.addEventListener('tick', onTick)
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
</style>
