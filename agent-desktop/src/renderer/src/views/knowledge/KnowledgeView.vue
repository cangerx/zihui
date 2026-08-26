<template>
  <div class="h-full flex flex-col">
    <header class="page-header">
      <div class="flex items-center gap-2">
        <router-link to="/knowledge/vectors" class="btn-secondary text-sm">向量统计</router-link>
        <button class="btn-primary" @click="openCatDialog()">+ 新建分类</button>
      </div>
    </header>

    <!-- Pending vectorization warning banner -->
    <div v-if="pendingCount > 0" class="mx-6 mt-4 flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800">
      <svg class="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
      <span class="text-sm text-amber-800 dark:text-amber-300 flex-1">
        有 <b>{{ pendingCount }}</b> 个文档尚未向量化，无法用于知识检索
      </span>
      <router-link to="/knowledge/vectors" class="text-sm text-primary-600 hover:underline font-medium">前往向量化 →</router-link>
    </div>

    <div class="page-body">
      <!-- Empty state -->
      <div v-if="store.categories.length === 0" class="empty-state">
        <div class="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
          <svg class="w-8 h-8 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg>
        </div>
        <p class="text-sm font-medium text-text-secondary mb-1">暂无知识库分类</p>
        <p class="text-xs text-text-tertiary mb-4">创建知识库并导入本地文档，让数字员工按需召回可靠资料</p>
        <button class="btn-primary text-sm" @click="openCatDialog()">立即创建分类</button>
      </div>

      <!-- Categories -->
      <div class="grid grid-cols-3 gap-2">
        <router-link
          v-for="cat in store.categories"
          :key="cat.id"
          :to="`/knowledge/${cat.id}`"
          class="card px-4 py-3 hover:shadow-md transition-shadow cursor-pointer group block"
        >
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-lg bg-teal-50 dark:bg-teal-900/30 flex items-center justify-center flex-shrink-0">
              <svg class="w-3.5 h-3.5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" /></svg>
            </div>
            <span class="font-semibold text-sm text-text-primary truncate flex-1">{{ cat.name }}</span>
            <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" @click.prevent>
              <button @click="openCatDialog(cat)" class="btn-ghost text-xs px-1.5 py-0.5">编辑</button>
              <button @click="confirmDeleteCat(cat)" class="btn-danger text-xs px-1.5 py-0.5">删除</button>
            </div>
          </div>
          <div class="text-xs text-text-tertiary mt-1 truncate">{{ cat.description || '无描述' }}</div>
          <div class="flex items-center gap-2 mt-1.5 text-xs text-text-disabled">
            <span>{{ (docsByCategory[cat.id]?.length || 0) }} 个文档</span>
            <span v-if="cat.watch_paths?.length">{{ cat.watch_paths.length }} 个绑定</span>
          </div>
        </router-link>
      </div>
    </div>

    <!-- Category Dialog -->
    <div v-if="showCatForm" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="showCatForm = false">
      <div class="bg-surface-0 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.12)] w-full max-w-md p-6 space-y-4">
        <h2 class="text-base font-semibold text-text-primary">{{ editingCatId ? '编辑分类' : '新建分类' }}</h2>
        <div>
          <label class="form-label">分类名称</label>
          <input v-model="catForm.name" class="input-field" placeholder="例如: 产品手册" @keydown.enter="saveCat" />
        </div>
        <div>
          <label class="form-label">描述</label>
          <input v-model="catForm.description" class="input-field" placeholder="关于此分类的简要说明" @keydown.enter="saveCat" />
        </div>
        <div class="flex justify-end gap-3 pt-2">
          <button @click="showCatForm = false" class="btn-secondary">取消</button>
          <button @click="saveCat" class="btn-primary">{{ editingCatId ? '更新' : '创建' }}</button>
        </div>
      </div>
    </div>

    <!-- Delete Confirmation Dialog -->
    <div v-if="deleteTarget" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="deleteTarget = null">
      <div class="bg-surface-0 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.12)] w-full max-w-sm p-6">
        <h2 class="text-base font-semibold text-text-primary mb-2">确认删除</h2>
        <p class="text-sm text-text-secondary mb-5">
          确定要删除「<b>{{ deleteTarget.name }}</b>」吗？该分类下的所有文档也将被删除，此操作不可撤销。
        </p>
        <div class="flex justify-end gap-3">
          <button @click="deleteTarget = null" class="btn-secondary">取消</button>
          <button @click="executeDelete" class="btn-danger">确认删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useKnowledgeStore, type KBCategory } from '@/stores/knowledge'

const store = useKnowledgeStore()
const showCatForm = ref(false)
const editingCatId = ref<string | null>(null)
const catForm = ref({ name: '', description: '' })
const deleteTarget = ref<{ id: string; name: string } | null>(null)

const docsByCategory = computed(() => {
  const map: Record<string, any[]> = {}
  for (const doc of store.knowledgeBases) {
    if (!map[doc.category_id]) map[doc.category_id] = []
    map[doc.category_id].push(doc)
  }
  return map
})

const pendingCount = computed(() =>
  store.knowledgeBases.filter((d) => d.status === 'pending' || d.status === 'error').length
)

function openCatDialog(cat?: KBCategory) {
  if (cat) {
    editingCatId.value = cat.id
    catForm.value = { name: cat.name, description: cat.description }
  } else {
    editingCatId.value = null
    catForm.value = { name: '', description: '' }
  }
  showCatForm.value = true
}

async function saveCat() {
  try {
    if (editingCatId.value) {
      await store.updateCategory(editingCatId.value, catForm.value)
    } else {
      await store.createCategory(catForm.value)
    }
    showCatForm.value = false
  } catch (e: any) {
    console.error('saveCat error:', e)
    alert('保存失败: ' + (e?.message || e))
  }
}

function confirmDeleteCat(cat: KBCategory) {
  deleteTarget.value = { id: cat.id, name: cat.name }
}

async function executeDelete() {
  if (!deleteTarget.value) return
  try {
    await store.deleteCategory(deleteTarget.value.id)
  } catch (e: any) {
    alert('删除失败: ' + (e?.message || e))
  }
  deleteTarget.value = null
}

onMounted(async () => {
  await store.fetchCategories()
  await store.fetchKnowledgeBases()
})
</script>
