<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-6 pointer-events-none">
    <div class="bg-surface-0 rounded-2xl shadow-[0_10px_50px_rgba(0,0,0,0.18)] w-[560px] max-w-[95vw] max-h-[90vh] flex flex-col pointer-events-auto">
      <div class="flex items-center justify-between px-5 py-3 border-b border-surface-2">
        <h3 class="text-sm font-semibold text-text-primary">模板分类管理</h3>
        <button class="text-text-tertiary hover:text-text-primary" @click="emit('close')">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-5 text-xs space-y-4">
        <!-- 新建表单 -->
        <div class="p-3 border border-surface-3 rounded-lg">
          <p class="text-text-secondary mb-2">{{ editing ? '编辑分类' : '新建分类' }}</p>
          <div class="grid grid-cols-2 gap-2">
            <label class="block">
              <span class="text-text-tertiary">名称 *</span>
              <input v-model="draft.name" maxlength="50" class="mt-0.5 w-full px-2 py-1.5 border border-surface-3 rounded bg-surface-0 outline-none focus:ring-1 focus:ring-primary-500" placeholder="例如：人像 / 商品 / 海报" />
            </label>
            <label class="block">
              <span class="text-text-tertiary">排序</span>
              <input v-model.number="draft.sort_order" type="number" min="0" class="mt-0.5 w-full px-2 py-1.5 border border-surface-3 rounded bg-surface-0 outline-none focus:ring-1 focus:ring-primary-500" />
            </label>
          </div>
          <label class="block mt-2">
            <span class="text-text-tertiary">描述</span>
            <PromptTextarea
              v-model="draft.description"
              title="编辑分类描述"
              :height="64"
              :max-length="500"
              placeholder="可选"
              input-class="text-xs"
            />
          </label>
          <label class="flex items-center gap-1.5 mt-2">
            <input type="checkbox" v-model="draft.is_visible" />
            <span class="text-text-secondary">显示该分类</span>
          </label>
          <div class="mt-3 flex justify-end gap-2">
            <button v-if="editing" class="px-2.5 py-1 text-text-secondary border border-surface-3 rounded hover:bg-surface-1" @click="cancelEdit">取消编辑</button>
            <button class="px-2.5 py-1 text-white bg-primary-600 hover:bg-primary-700 rounded disabled:opacity-50" :disabled="saving" @click="save">{{ editing ? '保存修改' : '新建' }}</button>
          </div>
        </div>

        <!-- 现有分类列表 -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <p class="text-text-secondary">现有分类（{{ categories.length }}）</p>
          </div>
          <div v-if="!categories.length" class="p-3 text-center text-text-tertiary bg-surface-2 rounded-lg">尚未创建任何分类</div>
          <div v-else class="space-y-2">
            <div v-for="cat in categories" :key="cat.id" class="flex items-start gap-3 p-3 border border-surface-3 rounded-lg">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-text-primary font-medium truncate">{{ cat.name }}</span>
                  <span v-if="!cat.is_visible" class="text-[10px] px-1.5 py-0.5 bg-surface-2 text-text-tertiary rounded">隐藏</span>
                  <span class="text-[10px] text-text-tertiary">排序 {{ cat.sort_order }}</span>
                </div>
                <p v-if="cat.description" class="mt-0.5 text-text-tertiary line-clamp-2">{{ cat.description }}</p>
              </div>
              <div class="flex flex-col gap-1.5">
                <button class="px-2 py-0.5 text-text-secondary border border-surface-3 rounded hover:bg-surface-1" @click="startEdit(cat)">编辑</button>
                <button class="px-2 py-0.5 text-error border border-surface-3 rounded hover:bg-error/10" @click="askDelete(cat)">删除</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-end px-5 py-3 border-t border-surface-2">
        <button class="px-3 py-1.5 text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-1" @click="emit('close')">关闭</button>
      </div>
    </div>

    <ConfirmDialog
      :visible="!!pendingDelete"
      title="删除分类"
      :message="pendingDelete ? `确定要删除分类「${pendingDelete.name}」吗？该分类下的所有模板（含本地封面、参考图、反推源图）会一并删除，操作不可恢复。` : ''"
      confirm-text="删除"
      cancel-text="取消"
      @cancel="pendingDelete = null"
      @confirm="doDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  useCreativeTemplateStore,
  type CreativeTemplateCategory,
} from '@/stores/creative-templates'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import PromptTextarea from '@/components/PromptTextarea.vue'

const props = defineProps<{
  categories: CreativeTemplateCategory[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'changed'): void
}>()

const store = useCreativeTemplateStore()

interface DraftForm {
  name: string
  description: string
  sort_order: number
  is_visible: boolean
}

const defaultDraft = (): DraftForm => ({ name: '', description: '', sort_order: 0, is_visible: true })

const draft = ref<DraftForm>(defaultDraft())
const editing = ref<CreativeTemplateCategory | null>(null)
const saving = ref(false)
const pendingDelete = ref<CreativeTemplateCategory | null>(null)

function startEdit(cat: CreativeTemplateCategory): void {
  editing.value = cat
  draft.value = {
    name: cat.name,
    description: cat.description || '',
    sort_order: cat.sort_order || 0,
    is_visible: !!cat.is_visible,
  }
}

function cancelEdit(): void {
  editing.value = null
  draft.value = defaultDraft()
}

async function save(): Promise<void> {
  if (!draft.value.name.trim()) {
    alert('请填写分类名称')
    return
  }
  saving.value = true
  try {
    if (editing.value) {
      await store.updateCategory(editing.value.id, {
        name: draft.value.name.trim(),
        description: draft.value.description.trim(),
        sort_order: draft.value.sort_order || 0,
        is_visible: draft.value.is_visible,
      })
    } else {
      await store.createCategory({
        name: draft.value.name.trim(),
        description: draft.value.description.trim(),
        sort_order: draft.value.sort_order || 0,
        is_visible: draft.value.is_visible,
      })
    }
    cancelEdit()
    emit('changed')
  } catch (e: unknown) {
    alert((e instanceof Error ? e.message : String(e)) || '保存失败')
  } finally {
    saving.value = false
  }
}

function askDelete(cat: CreativeTemplateCategory): void {
  pendingDelete.value = cat
}

async function doDelete(): Promise<void> {
  const target = pendingDelete.value
  pendingDelete.value = null
  if (!target) return
  await store.deleteCategory(target.id)
  if (editing.value?.id === target.id) cancelEdit()
  emit('changed')
}

watch(
  () => props.categories,
  () => {
    if (editing.value && !props.categories.find((c) => c.id === editing.value!.id)) {
      cancelEdit()
    }
  },
)
</script>
