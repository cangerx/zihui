<template>
  <div class="h-full flex flex-col bg-surface-1">
    <!-- 顶部 -->
    <div class="h-12 flex-shrink-0 flex items-center gap-3 px-4 border-b border-surface-3 bg-surface-0">
      <button class="ewei-chip" @click="goBack">← 返回</button>
      <h2 class="text-sm font-semibold text-text-primary flex-1">新增商品</h2>
      <p v-if="progressText" class="text-[11px] text-primary-600">{{ progressText }}</p>
      <p v-else-if="error" class="text-[11px] text-error">{{ error }}</p>
      <button class="btn-primary !py-1.5 !px-5 text-xs disabled:opacity-50" :disabled="submitting" @click="submit">
        {{ submitting ? '创建中…' : '创建商品' }}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div class="max-w-[860px] mx-auto p-5 space-y-5">
        <!-- 基本信息 -->
        <section class="bg-surface-0 border border-surface-3 rounded-xl p-4 space-y-3">
          <h3 class="text-xs font-semibold text-text-tertiary">基本信息</h3>
          <label class="block">
            <span class="text-xs font-medium text-text-secondary">商品标题 <span class="text-error">*</span></span>
            <input v-model="form.title" class="ewei-input w-full" placeholder="如：手工蛋糕礼盒" />
          </label>
          <div class="grid grid-cols-3 gap-3">
            <label class="block">
              <span class="text-xs font-medium text-text-secondary">商品类型</span>
              <select v-model.number="form.type" class="ewei-input w-full">
                <option :value="1">实体商品</option>
                <option :value="2">虚拟商品</option>
                <option :value="18">称重商品</option>
              </select>
            </label>
            <label class="block">
              <span class="text-xs font-medium text-text-secondary">上下架</span>
              <select v-model.number="form.status" class="ewei-input w-full">
                <option :value="1">上架销售</option>
                <option :value="2">上架隐藏</option>
                <option :value="0">放入仓库</option>
              </select>
            </label>
            <label class="block">
              <span class="text-xs font-medium text-text-secondary">单位{{ form.type === 18 ? '（称重必填）' : '' }}</span>
              <input v-model="form.unit" class="ewei-input w-full" :placeholder="form.type === 18 ? '如：斤' : '如：件'" />
            </label>
          </div>
        </section>

        <!-- 商品图 -->
        <section class="bg-surface-0 border border-surface-3 rounded-xl p-4 space-y-3">
          <div class="flex items-center gap-2">
            <h3 class="text-xs font-semibold text-text-tertiary flex-1">商品图（第一张为主图）<span class="text-error">*</span></h3>
            <button class="ewei-chip" @click="openPicker({ kind: 'gallery' })">选图 / 添加</button>
          </div>
          <div v-if="!gallery.length" class="text-[11px] text-text-tertiary py-3">还没有图片，点「选图 / 添加」从 AI 生成 / 图库 / 本地文件 选择</div>
          <div v-else class="flex flex-wrap gap-2">
            <div v-for="(g, i) in gallery" :key="g.localPath" class="relative w-20 h-20 rounded-lg overflow-hidden border border-surface-3 group">
              <img :src="g.previewUrl" class="w-full h-full object-cover" alt="" />
              <span v-if="i === 0" class="absolute bottom-0 inset-x-0 bg-primary-600/85 text-white text-[9px] text-center py-0.5">主图</span>
              <div class="absolute top-0 right-0 flex">
                <button v-if="i !== 0" class="w-4 h-4 bg-black/55 text-white text-[9px] leading-4" title="设为主图" @click="setMain(i)">★</button>
                <button class="w-4 h-4 bg-black/55 text-white text-[9px] leading-4" title="移除" @click="gallery.splice(i, 1)">×</button>
              </div>
            </div>
          </div>
        </section>

        <!-- 分类 -->
        <section class="bg-surface-0 border border-surface-3 rounded-xl p-4 space-y-3">
          <h3 class="text-xs font-semibold text-text-tertiary">商品分类（可选）</h3>
          <div v-if="!categories.length" class="text-[11px] text-text-tertiary">该店未开启商品分类，可跳过</div>
          <div v-else class="flex flex-wrap gap-1.5">
            <button
              v-for="c in flatCategories"
              :key="c.id"
              type="button"
              class="px-2.5 py-1 rounded-md text-[11px] border transition-colors"
              :class="form.categoryIds.includes(c.id) ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-3 text-text-secondary hover:bg-surface-2'"
              @click="toggleCategory(c.id)"
            >{{ c.label }}</button>
          </div>
        </section>

        <!-- 规格与价格 -->
        <section class="bg-surface-0 border border-surface-3 rounded-xl p-4 space-y-3">
          <div class="flex items-center gap-2">
            <h3 class="text-xs font-semibold text-text-tertiary flex-1">规格与价格</h3>
            <label class="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
              <input v-model="form.hasOption" type="checkbox" class="rounded" />
              多规格（SKU）
            </label>
          </div>

          <!-- 单规格 -->
          <div v-if="!form.hasOption" class="grid grid-cols-3 gap-3">
            <label class="block">
              <span class="text-xs font-medium text-text-secondary">价格 <span class="text-error">*</span></span>
              <input v-model="form.price" type="number" min="0" step="0.01" class="ewei-input w-full" placeholder="0.00" />
            </label>
            <label class="block">
              <span class="text-xs font-medium text-text-secondary">库存 <span class="text-error">*</span></span>
              <input v-model="form.stock" type="number" min="0" class="ewei-input w-full" placeholder="0" />
            </label>
            <label class="block">
              <span class="text-xs font-medium text-text-secondary">原价（划线价，可选）</span>
              <input v-model="form.originalPrice" type="number" min="0" step="0.01" class="ewei-input w-full" placeholder="0.00" />
            </label>
            <label class="block">
              <span class="text-xs font-medium text-text-secondary">商品编码</span>
              <input v-model="form.goodsCode" class="ewei-input w-full" />
            </label>
            <label class="block">
              <span class="text-xs font-medium text-text-secondary">条形码</span>
              <input v-model="form.productSn" class="ewei-input w-full" />
            </label>
          </div>

          <!-- 多规格 SKU 编辑器 -->
          <div v-else class="space-y-3">
            <div v-for="(grp, gi) in specGroups" :key="grp.tempId" class="border border-surface-3 rounded-lg p-3 space-y-2">
              <div class="flex items-center gap-2">
                <input v-model="grp.name" class="ewei-input flex-1" placeholder="规格名，如：尺寸 / 颜色" />
                <button class="ewei-chip-danger" @click="removeGroup(gi)">删除规格</button>
              </div>
              <div class="flex flex-wrap gap-2">
                <div v-for="(it, ii) in grp.items" :key="it.tempId" class="flex items-center gap-1 bg-surface-1 border border-surface-3 rounded-md px-1.5 py-1">
                  <button class="w-7 h-7 rounded overflow-hidden border border-surface-3 bg-surface-2 flex items-center justify-center text-[8px] text-text-tertiary" title="规格图(可选)" @click="openPicker({ kind: 'specItem', gi, ii })">
                    <img v-if="it.image" :src="it.image.previewUrl" class="w-full h-full object-cover" alt="" />
                    <span v-else>图</span>
                  </button>
                  <input v-model="it.name" class="bg-transparent text-xs w-20 outline-none" placeholder="规格值" />
                  <button class="text-text-tertiary hover:text-error text-xs leading-none" @click="grp.items.splice(ii, 1)">×</button>
                </div>
                <button class="ewei-chip" @click="grp.items.push({ tempId: uid('it'), name: '', image: null })">+ 规格值</button>
              </div>
            </div>
            <button class="ewei-chip" @click="addGroup">+ 添加规格</button>

            <!-- SKU 表 -->
            <div v-if="skuList.length" class="border border-surface-3 rounded-lg overflow-hidden">
              <table class="w-full text-xs">
                <thead class="bg-surface-2 text-text-secondary">
                  <tr>
                    <th class="text-left px-2 py-1.5 font-medium">规格</th>
                    <th class="px-2 py-1.5 font-medium w-12">图</th>
                    <th class="px-2 py-1.5 font-medium w-20">价格</th>
                    <th class="px-2 py-1.5 font-medium w-16">库存</th>
                    <th class="px-2 py-1.5 font-medium w-20">原价</th>
                    <th class="px-2 py-1.5 font-medium w-24">编码</th>
                    <th class="px-2 py-1.5 font-medium w-12">隐藏</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in skuList" :key="row.key" class="border-t border-surface-2">
                    <td class="px-2 py-1 text-text-primary">{{ row.labels }}</td>
                    <td class="px-2 py-1">
                      <button class="w-8 h-8 mx-auto block rounded overflow-hidden border border-surface-3 bg-surface-2 text-[8px] text-text-tertiary" @click="openPicker({ kind: 'sku', key: row.key })">
                        <img v-if="row.image" :src="row.image.previewUrl" class="w-full h-full object-cover" alt="" />
                        <span v-else>图</span>
                      </button>
                    </td>
                    <td class="px-1 py-1"><input v-model="row.price" type="number" min="0" step="0.01" class="ewei-input w-full !px-1.5" placeholder="0" /></td>
                    <td class="px-1 py-1"><input v-model="row.stock" type="number" min="0" class="ewei-input w-full !px-1.5" placeholder="0" /></td>
                    <td class="px-1 py-1"><input v-model="row.originalPrice" type="number" min="0" step="0.01" class="ewei-input w-full !px-1.5" placeholder="0" /></td>
                    <td class="px-1 py-1"><input v-model="row.goodsCode" class="ewei-input w-full !px-1.5" /></td>
                    <td class="px-1 py-1 text-center"><input v-model="row.hidden" type="checkbox" class="rounded" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="text-[11px] text-text-tertiary">添加规格名 + 规格值后，自动生成 SKU 组合表</p>
          </div>
        </section>
      </div>
    </div>

    <!-- 选图弹窗 -->
    <EweiImagePicker
      v-if="picker"
      :multiple="picker.kind === 'gallery'"
      :title="picker.kind === 'gallery' ? '选择商品图（可多选）' : '选择图片'"
      scope-key="ewei:create:picker"
      @confirm="onPick"
      @close="picker = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EweiImagePicker from './EweiImagePicker.vue'
import { useEweiStore } from '@/stores/ewei'

const route = useRoute()
const router = useRouter()
const store = useEweiStore()
const ewei = () => (window as any).api.ewei
const connectorId = route.params.connectorId as string

let _seq = 0
function uid(p = 'x'): string {
  _seq += 1
  return `${p}_${Date.now().toString(36)}_${_seq}`
}

type Img = { localPath: string; previewUrl: string }

const form = reactive({
  title: '',
  type: 1,
  status: 1,
  unit: '',
  price: '',
  stock: '',
  originalPrice: '',
  goodsCode: '',
  productSn: '',
  hasOption: false,
  categoryIds: [] as number[],
})

// 商品图
const gallery = ref<Img[]>([])
function setMain(i: number): void {
  const [g] = gallery.value.splice(i, 1)
  gallery.value.unshift(g)
}

// 分类
const categories = ref<any[]>([])
const flatCategories = computed(() => {
  const out: { id: number; label: string }[] = []
  const walk = (arr: any[], depth: number): void => {
    for (const c of arr) {
      out.push({ id: c.id, label: '　'.repeat(depth) + c.name })
      if (c.children?.length) walk(c.children, depth + 1)
    }
  }
  walk(categories.value, 0)
  return out
})
function toggleCategory(id: number): void {
  const i = form.categoryIds.indexOf(id)
  if (i >= 0) form.categoryIds.splice(i, 1)
  else form.categoryIds.push(id)
}

// 多规格
type SpecItem = { tempId: string; name: string; image: Img | null }
type SpecGroup = { tempId: string; name: string; items: SpecItem[] }
const specGroups = ref<SpecGroup[]>([])
function addGroup(): void {
  specGroups.value.push({ tempId: uid('sp'), name: '', items: [{ tempId: uid('it'), name: '', image: null }] })
}
function removeGroup(gi: number): void {
  specGroups.value.splice(gi, 1)
}

type SkuRow = {
  key: string
  labels: string
  specTempIds: string[]
  price: string
  stock: string
  originalPrice: string
  goodsCode: string
  productSn: string
  image: Img | null
  hidden: boolean
}
const skuList = ref<SkuRow[]>([])
function cartesian(groups: SpecGroup[]): SpecItem[][] {
  const valid = groups.filter((g) => g.items.length)
  if (!valid.length) return []
  let combos: SpecItem[][] = [[]]
  for (const g of valid) {
    const next: SpecItem[][] = []
    for (const combo of combos) for (const it of g.items) next.push([...combo, it])
    combos = next
  }
  return combos
}
function rebuildSku(): void {
  if (!form.hasOption) {
    skuList.value = []
    return
  }
  const combos = cartesian(specGroups.value)
  const prev = new Map(skuList.value.map((r) => [r.key, r]))
  skuList.value = combos.map((combo) => {
    const key = combo.map((it) => it.tempId).join(',')
    const labels = combo.map((it) => it.name || '?').join(' / ')
    const specTempIds = combo.map((it) => it.tempId)
    const old = prev.get(key)
    if (old) return { ...old, labels, specTempIds }
    return { key, labels, specTempIds, price: '', stock: '', originalPrice: '', goodsCode: '', productSn: '', image: null, hidden: false }
  })
}
// 规格结构（组名/项 tempId+名）变化即重算 SKU 表，保留已填值
watch(
  () => [form.hasOption, JSON.stringify(specGroups.value.map((g) => ({ n: g.name, items: g.items.map((i) => [i.tempId, i.name]) })))],
  rebuildSku,
  { immediate: true },
)

// 选图弹窗目标
type PickerTarget = { kind: 'gallery' } | { kind: 'specItem'; gi: number; ii: number } | { kind: 'sku'; key: string }
const picker = ref<PickerTarget | null>(null)
function openPicker(t: PickerTarget): void {
  picker.value = t
}
function onPick(picks: Img[]): void {
  const t = picker.value
  if (!t) return
  if (t.kind === 'gallery') {
    const seen = new Set(gallery.value.map((g) => g.localPath))
    for (const p of picks) if (!seen.has(p.localPath)) gallery.value.push(p)
  } else if (t.kind === 'specItem') {
    const it = specGroups.value[t.gi]?.items[t.ii]
    if (it) it.image = picks[0] || null
  } else if (t.kind === 'sku') {
    const row = skuList.value.find((r) => r.key === t.key)
    if (row) row.image = picks[0] || null
  }
  picker.value = null
}

// 提交
const submitting = ref(false)
const error = ref('')
const progressText = ref('')
let unsub: (() => void) | null = null

async function submit(): Promise<void> {
  error.value = ''
  if (!form.title.trim()) return (error.value = '请填写商品标题')
  if (!gallery.value.length) return (error.value = '请至少选择 1 张主图')
  if (form.hasOption) {
    if (!specGroups.value.length || specGroups.value.some((g) => !g.name.trim() || !g.items.length || g.items.some((i) => !i.name.trim())))
      return (error.value = '请完善规格名与规格值')
    if (!skuList.value.length) return (error.value = '请添加 SKU')
    if (skuList.value.some((r) => r.price === '' || r.stock === '')) return (error.value = '请填写每个 SKU 的价格与库存')
  } else {
    if (form.price === '') return (error.value = '请填写商品价格')
    if (form.stock === '') return (error.value = '请填写商品库存')
  }

  const payload: any = {
    title: form.title.trim(),
    type: form.type,
    status: form.status,
    unit: form.unit,
    galleryImages: gallery.value.map((g) => g.localPath),
    categoryIds: form.categoryIds.slice(),
    hasOption: form.hasOption,
  }
  if (form.hasOption) {
    payload.specs = specGroups.value.map((g) => ({
      tempId: g.tempId,
      title: g.name.trim(),
      items: g.items.map((it) => ({ tempId: it.tempId, title: it.name.trim(), image: it.image?.localPath })),
    }))
    payload.options = skuList.value.map((r) => ({
      specTempIds: r.specTempIds,
      title: r.labels,
      price: r.price,
      stock: r.stock,
      originalPrice: r.originalPrice,
      goodsCode: r.goodsCode,
      productSn: r.productSn,
      image: r.image?.localPath,
      hidden: r.hidden,
    }))
  } else {
    payload.price = form.price
    payload.stock = form.stock
    payload.originalPrice = form.originalPrice
    payload.goodsCode = form.goodsCode
    payload.productSn = form.productSn
  }

  submitting.value = true
  try {
    await ewei().invoke('addGoods', connectorId, payload)
    store.clearCreateDraft(connectorId) // 创建成功，清空草稿
    router.push(`/ewei/${connectorId}/goods`)
  } catch (e: any) {
    error.value = e?.message || '创建失败'
  } finally {
    submitting.value = false
    progressText.value = ''
  }
}

function goBack(): void {
  router.push(`/ewei/${connectorId}/goods`)
}

// ===== 表单草稿持久化（切走再回来不丢）=====
let saveTimer: ReturnType<typeof setTimeout> | null = null
function snapshot(): any {
  return {
    form: JSON.parse(JSON.stringify(form)),
    gallery: JSON.parse(JSON.stringify(gallery.value)),
    specGroups: JSON.parse(JSON.stringify(specGroups.value)),
    skuList: JSON.parse(JSON.stringify(skuList.value)),
  }
}
function flushDraft(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  store.setCreateDraft(connectorId, snapshot())
}
function isEmptyDraft(): boolean {
  return !form.title.trim() && !gallery.value.length && !specGroups.value.length && form.price === '' && form.stock === ''
}
watch([form, gallery, specGroups, skuList], () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (isEmptyDraft()) store.clearCreateDraft(connectorId)
    else store.setCreateDraft(connectorId, snapshot())
  }, 400)
}, { deep: true })

onMounted(async () => {
  // 还原草稿（先 specGroups 再 skuList：SKU 重算 watch 会以已还原的 skuList 为 prev 保留各 SKU 值）
  const draft = store.getCreateDraft(connectorId)
  if (draft) {
    if (draft.form) Object.assign(form, draft.form)
    gallery.value = draft.gallery || []
    specGroups.value = draft.specGroups || []
    skuList.value = draft.skuList || []
  }
  try {
    categories.value = (await ewei().invoke('listGoodsCategories', connectorId)) || []
  } catch {
    categories.value = []
  }
  unsub = ewei().onProgress((d: any) => {
    if (!d) return
    if (d.phase === 'uploading') progressText.value = d.message || '上传图片…'
    else if (d.phase === 'saving') progressText.value = d.message || '创建中…'
    else progressText.value = ''
  })
})
onBeforeUnmount(() => {
  if (unsub) unsub()
  if (!submitting.value) flushDraft() // 切走前保存最新草稿（创建中除外，成功后已清空）
})
</script>

<style scoped>
.ewei-input {
  @apply mt-1.5 px-3 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500;
}
.ewei-chip {
  @apply px-2.5 py-1 rounded-md text-[11px] border border-surface-3 text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed;
}
.ewei-chip-danger {
  @apply px-2.5 py-1 rounded-md text-[11px] border border-surface-3 text-red-600 hover:bg-red-50 transition-colors;
}
</style>
