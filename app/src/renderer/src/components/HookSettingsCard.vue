<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { HookSettings } from '@shared/api'
import { errText, gvs, toast } from '../store'

const s = ref<HookSettings | null>(null)
const saving = ref(false)
onMounted(async () => { try { s.value = await gvs('hookSettings') } catch (e) { toast(errText(e), 'err') } })
async function save() {
  if (!s.value) return
  saving.value = true
  try { s.value = await gvs('saveHookSettings', s.value); toast('已保存下载钩子', 'ok') } catch (e) { toast(errText(e), 'err') } finally { saving.value = false }
}
const EVENTS = [{ key: 'start', label: '开始下载时' }, { key: 'complete', label: '下载完成时' }] as const
</script>

<template>
  <section v-if="s" class="card hooks-card">
    <h2 class="h2s">下载钩子</h2>
    <p class="sd">每集开始 / 完成时可以弹系统通知，或在后台运行一条命令（不阻塞下载）。可用占位符：
      <code>{file}</code> <code>{dir}</code> <code>{title}</code> <code>{episode}</code> <code>{ed2k}</code>，例如 <code>rclone copy "{file}" remote:</code>。值里的引号和 &amp; | ; 等符号会被替换，模板里请自己给路径加引号。</p>
    <div v-for="e in EVENTS" :key="e.key" class="srow col">
      <div class="sl"><span class="st">{{ e.label }}</span></div>
      <label class="tg"><input v-model="s[e.key].notify" type="checkbox" />系统通知</label>
      <input v-model="s[e.key].command" class="cmd mono" :placeholder="e.key === 'complete' ? 'rclone copy &quot;{file}&quot; remote:剧集/{title}' : '可留空'" :aria-label="`${e.label}运行的命令`" spellcheck="false" />
    </div>
    <div class="srow">
      <div class="sl"><span class="st">命令超时</span><span class="sd">超过后强制结束；输出保存在日志里，下载列表上可看到结果。</span></div>
      <div class="sc"><input v-model.number="s.timeoutSec" type="number" min="5" max="86400" class="num mono" aria-label="命令超时（秒）" /> 秒</div>
    </div>
    <div class="srow">
      <div class="sl"><span class="st">完成后计算 ed2k</span><span class="sd">后台线程计算 ed2k 链接并记入下载历史；命令里用到 <code>{ed2k}</code> 时会自动计算。</span></div>
      <div class="sc"><label class="tg"><input v-model="s.ed2k" type="checkbox" />自动计算</label></div>
    </div>
    <div class="srow end"><button type="button" class="btn primary sm" :disabled="saving" @click="save"><span v-if="saving" class="spin" />保存</button></div>
  </section>
</template>

<style scoped>
.hooks-card { margin-top: 14px; }
.col { flex-direction: column; align-items: stretch; gap: 8px; }
.tg { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
.cmd { width: 100%; height: 34px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); color: inherit; padding: 0 10px; font-size: 12.5px; }
.num { width: 90px; height: 30px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); color: inherit; padding: 0 8px; }
code { font-family: var(--font-mono); font-size: 12px; padding: 0 4px; border-radius: 4px; background: color-mix(in srgb, var(--ink) 8%, transparent); }
.end { justify-content: flex-end; }
</style>
