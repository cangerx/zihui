import { ref, computed, type Ref } from 'vue'
import type { Canvas, FabricObject } from 'fabric'
import {
  type ImageLayer,
  type ImageLayerType,
  isDeliverableRole,
  roleToLayerType,
  defaultLayerName,
  newLayerId
} from '@shared/image-doc'

export function useImageLayers() {
  const layers: Ref<ImageLayer[]> = ref([])
  const selectedLayerId = ref('')

  const selectedLayer = computed(() => layers.value.find(l => l.id === selectedLayerId.value) || null)

  function findObject(canvas: Canvas | null, layerId: string): FabricObject | null {
    if (!canvas) return null
    return (canvas.getObjects() as FabricObject[]).find(o => (o as any).data?.layerId === layerId) || null
  }

  function ensureObjectLayerId(obj: FabricObject, type: ImageLayerType): string {
    const data = ((obj as any).data ||= {})
    if (!data.layerId) data.layerId = newLayerId()
    if (!data.role) {
      data.role = type === 'raster' ? 'base' : type
    }
    return data.layerId as string
  }

  /** 画布对象 → 图层列表（前面 = 最上层，对齐 Photoshop） */
  function rebuild(canvas: Canvas | null) {
    if (!canvas) {
      layers.value = []
      return
    }
    const prev = new Map(layers.value.map(l => [l.id, l]))
    const counts: Record<ImageLayerType, number> = { raster: 0, text: 0, draw: 0, sticker: 0, subject: 0 }
    const next: ImageLayer[] = []
    const objects = canvas.getObjects() as FabricObject[]
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i]
      const role = (obj as any).data?.role as string | undefined
      const type = roleToLayerType(role)
      if (!type || !isDeliverableRole(role)) continue
      counts[type] += 1
      const id = ensureObjectLayerId(obj, type)
      const old = prev.get(id)
      const opacity = Math.round(((obj.opacity ?? 1) as number) * 100)
      const blendMode = ((obj as any).globalCompositeOperation as string) || 'source-over'
      next.push({
        id,
        name: old?.name || defaultLayerName(type, counts[type]),
        type,
        visible: obj.visible !== false,
        locked: old?.locked ?? (role === 'base' ? false : false),
        opacity: Number.isFinite(opacity) ? opacity : 100,
        blendMode
      })
    }
    layers.value = next
    if (selectedLayerId.value && !next.some(l => l.id === selectedLayerId.value)) {
      selectedLayerId.value = next[0]?.id || ''
    }
  }

  function applyObjectFlags(canvas: Canvas | null, drawingMode: boolean) {
    if (!canvas) return
    const byId = new Map(layers.value.map(l => [l.id, l]))
    canvas.forEachObject((obj: FabricObject) => {
      const role = (obj as any).data?.role as string | undefined
      if (!isDeliverableRole(role)) {
        if (role === 'mask' || role === 'mask-erase' || role === 'mask-shape' || role === 'crop-rect' || role === 'erase') {
          obj.selectable = false
          obj.evented = false
        }
        return
      }
      const id = (obj as any).data?.layerId as string | undefined
      const layer = id ? byId.get(id) : undefined
      const locked = !!layer?.locked
      const visible = layer ? layer.visible : obj.visible !== false
      obj.visible = visible
      if (drawingMode) {
        obj.selectable = false
        obj.evented = false
        return
      }
      obj.selectable = !locked && visible
      obj.evented = !locked && visible
      if (role === 'base' || role === 'subject') {
        obj.hasControls = !locked && visible
        obj.hasBorders = !locked && visible
        obj.lockMovementX = locked
        obj.lockMovementY = locked
        obj.lockScalingX = locked
        obj.lockScalingY = locked
        obj.lockRotation = locked
      }
    })
    canvas.requestRenderAll()
  }

  function setVisible(canvas: Canvas | null, id: string, visible: boolean) {
    const layer = layers.value.find(l => l.id === id)
    if (!layer) return
    layer.visible = visible
    const obj = findObject(canvas, id)
    if (obj) obj.visible = visible
    canvas?.requestRenderAll()
  }

  function setLocked(canvas: Canvas | null, id: string, locked: boolean, drawingMode: boolean) {
    const layer = layers.value.find(l => l.id === id)
    if (!layer) return
    layer.locked = locked
    applyObjectFlags(canvas, drawingMode)
  }

  function setOpacity(canvas: Canvas | null, id: string, opacity: number) {
    const layer = layers.value.find(l => l.id === id)
    if (!layer) return
    layer.opacity = opacity
    const obj = findObject(canvas, id)
    if (obj) obj.set({ opacity: opacity / 100 })
    canvas?.requestRenderAll()
  }

  function rename(id: string, name: string) {
    const layer = layers.value.find(l => l.id === id)
    if (!layer) return
    layer.name = name.trim() || layer.name
  }

  /** fromIndex/toIndex 均为面板顺序（0 = 最上层） */
  function reorder(canvas: Canvas | null, fromIndex: number, toIndex: number) {
    if (!canvas || fromIndex === toIndex) return
    const list = [...layers.value]
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) return
    const [moved] = list.splice(fromIndex, 1)
    list.splice(toIndex, 0, moved)
    layers.value = list
    const objects = canvas.getObjects() as FabricObject[]
    const temps = objects.filter(o => !isDeliverableRole((o as any).data?.role))
    const ordered = [...list].reverse().map(l => findObject(canvas, l.id)).filter(Boolean) as FabricObject[]
    ;[...ordered, ...temps].forEach((obj, i) => {
      canvas.moveObjectTo(obj, i)
    })
    canvas.requestRenderAll()
  }

  function selectOnCanvas(canvas: Canvas | null, id: string, drawingMode: boolean) {
    selectedLayerId.value = id
    if (!canvas || drawingMode) return
    const obj = findObject(canvas, id)
    const layer = layers.value.find(l => l.id === id)
    if (!obj || layer?.locked || layer?.visible === false) {
      canvas.discardActiveObject()
      canvas.requestRenderAll()
      return
    }
    canvas.setActiveObject(obj)
    canvas.requestRenderAll()
  }

  function syncSelectionFromCanvas(canvas: Canvas | null) {
    if (!canvas) return
    const obj = canvas.getActiveObject() as FabricObject | null
    const id = obj ? ((obj as any).data?.layerId as string | undefined) : ''
    selectedLayerId.value = id && layers.value.some(l => l.id === id) ? id : ''
  }

  return {
    layers,
    selectedLayerId,
    selectedLayer,
    findObject,
    ensureObjectLayerId,
    rebuild,
    applyObjectFlags,
    setVisible,
    setLocked,
    setOpacity,
    rename,
    reorder,
    selectOnCanvas,
    syncSelectionFromCanvas
  }
}
