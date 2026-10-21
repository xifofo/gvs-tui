<script setup lang="ts">
/** 发布端本地保留时间；保存不触发 115 请求。 */
import { onMounted, ref } from 'vue'
import { errText, gvs, toast } from '../../store'

const hours = ref(24), loaded = ref(false), saving = ref(false), error = ref('')
onMounted(async () => {
  try { hours.value = (await gvs('publicationRetention')).hours; loaded.value = true }
  catch (e) { error.value = errText(e) }
})
async function save() {
  saving.value = true
  try { hours.value = (await gvs('savePublicationRetention', { hours: Number(hours.value) })).hours; error.value = ''; toast('保留时间已保存', 'ok') }
  catch (e) { error.value = errText(e) }
  finally { saving.value = false }
}
</script>

<template>
  <section class="card retention">
    <h3>本地成品保留</h3>
    <p class="muted">上传并登记资源成功后开始计时。ED2K 已保存到资源记录、且文件未被任务使用时，才会自动删除本地视频。</p>
    <form @submit.prevent="save">
      <label for="publication-retention-hours">保留时间（小时）</label>
      <div class="controls">
        <input id="publication-retention-hours" v-model.number="hours" class="input" type="number" min="0" max="8760" step="1" required :disabled="!loaded || saving" />
        <button class="btn" type="submit" :disabled="!loaded || saving">{{ saving ? '保存中…' : '保存' }}</button>
      </div>
      <span class="muted">默认 24 小时；设为 0 关闭自动删除。不会验证 ED2K 云下载是否可用。</span>
    </form>
    <p v-if="error" role="alert" class="error-box">{{ error }}</p>
  </section>
</template>

<style scoped>
.retention { margin-top: 16px; padding: 20px; display: grid; gap: 12px; }
h3, p { margin: 0; }
p, .muted { font-size: 13px; line-height: 1.6; }
form { display: grid; gap: 8px; }
.controls { display: flex; gap: 10px; align-items: center; }
input { width: 150px; max-width: 60%; }
</style>
