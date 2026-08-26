<template>
  <div v-if="open" class="fixed inset-0 z-[90] flex items-center justify-center pointer-events-none">
    <div class="pointer-events-auto w-[440px] bg-surface-0 rounded-xl shadow-2xl border border-surface-3 p-5">
      <h3 class="text-sm font-semibold text-text-primary">需要安装 Python</h3>
      <p class="text-xs text-text-tertiary mt-2 leading-relaxed">
        生成 PPT 会用到本机 Python 脚本。当前电脑没有检测到可用的 Python 3。
      </p>
      <p v-if="reason" class="text-xs text-text-disabled mt-1">{{ reason }}</p>
      <p class="text-xs text-text-tertiary mt-2 leading-relaxed">{{ installHint }}</p>
      <div class="flex flex-wrap justify-end gap-2 mt-4">
        <button
          type="button"
          class="px-3 py-1.5 text-xs rounded-lg border border-surface-3 hover:bg-surface-2"
          @click="$emit('close')"
        >稍后</button>
        <button
          type="button"
          class="px-3 py-1.5 text-xs rounded-lg border border-surface-3 hover:bg-surface-2"
          :disabled="busy"
          @click="$emit('pick')"
        >选择已安装的 Python</button>
        <button
          type="button"
          class="px-3 py-1.5 text-xs rounded-lg border border-surface-3 hover:bg-surface-2"
          :disabled="busy"
          @click="$emit('recheck')"
        >重新检测</button>
        <button
          type="button"
          class="px-3 py-1.5 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700"
          @click="$emit('install')"
        >打开安装页</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ open: boolean; reason: string; installHint: string; busy?: boolean }>()
defineEmits<{ (e: 'close'): void; (e: 'recheck'): void; (e: 'install'): void; (e: 'pick'): void }>()
</script>
