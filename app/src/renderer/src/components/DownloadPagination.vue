<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ page: number; totalPages: number; groupCount: number; pageSize: number }>()
const emit = defineEmits<{ 'update:page': [page: number]; 'update:pageSize': [size: number] }>()
const pageSizes = [10, 20, 50]
const numbers = computed(() => {
  const pages = new Set([1, props.totalPages])
  for (let n = Math.max(1, props.page - 2); n <= Math.min(props.totalPages, props.page + 2); n++) pages.add(n)
  const sorted = [...pages].sort((a, b) => a - b)
  const result: Array<number | 'ellipsis'> = []
  for (const n of sorted) {
    const last = result.at(-1)
    if (typeof last === 'number' && n - last > 1) result.push('ellipsis')
    result.push(n)
  }
  return result
})

function resize(event: Event) {
  const size = Number((event.target as HTMLSelectElement).value)
  if (pageSizes.includes(size)) emit('update:pageSize', size)
}
</script>

<template>
  <nav class="pagination" aria-label="下载任务分页">
    <div class="summary muted small">
      <span>共 {{ groupCount }} 组 · 第 {{ page }} / {{ totalPages }} 页</span>
      <label class="size">每页
        <select :value="pageSize" aria-label="每页任务组数" @change="resize">
          <option v-for="size in pageSizes" :key="size" :value="size">{{ size }} 组</option>
        </select>
      </label>
    </div>
    <div class="buttons">
      <button type="button" class="btn sm" :disabled="page <= 1" @click="emit('update:page', page - 1)">上一页</button>
      <template v-for="(number, index) in numbers" :key="number === 'ellipsis' ? `gap-${index}` : number">
        <span v-if="number === 'ellipsis'" class="ellipsis muted" aria-hidden="true">…</span>
        <button v-else type="button" class="btn sm number" :class="{ on: number === page }" :aria-label="`第 ${number} 页`" :aria-current="number === page ? 'page' : undefined" @click="emit('update:page', number)">{{ number }}</button>
      </template>
      <button type="button" class="btn sm" :disabled="page >= totalPages" @click="emit('update:page', page + 1)">下一页</button>
    </div>
  </nav>
</template>

<style scoped>
.pagination { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.summary { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; font-size: 13px; }
.size { display: inline-flex; align-items: center; gap: 8px; }
.size select { height: 36px; padding: 0 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); cursor: pointer; }
.buttons { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.number { min-width: 36px; padding: 0 10px; }
.number.on { background: var(--ink); color: var(--paper); border-color: var(--ink); font-weight: 700; }
.ellipsis { min-width: 20px; text-align: center; }
</style>
