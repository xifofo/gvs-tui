<script setup lang="ts">
/** 必填连接字段；验证和凭据存储全部由主进程的独立模块负责。 */
import type { PlutoFishInput, PlutoFishView } from '@shared/api'
defineProps<{ state?: PlutoFishView; disabled?: boolean }>()
const model = defineModel<PlutoFishInput>({ required: true })
</script>

<template>
  <fieldset class="plutofish" :disabled="disabled">
    <legend>PlutoFish</legend>
    <label class="field strong-label">服务地址
      <input v-model="model.url" class="input strong mono" placeholder="https://plutofish.example" autocomplete="off" required />
    </label>
    <label class="field strong-label">发布端密钥
      <span v-if="state?.hasKey && model.url.replace(/\/+$/, '') === state.url" class="dim">已保存密钥，留空继续使用；更换服务地址须重新填写。</span>
      <input v-model="model.key" class="input strong mono" type="password" placeholder="输入 PlutoFish 发布端密钥" autocomplete="off" :required="!state?.hasKey || model.url.replace(/\/+$/, '') !== state.url" />
    </label>
    <span v-if="state?.status === 'checking'" class="dim" role="status">正在验证 PlutoFish…</span>
    <span v-else-if="state?.status === 'verified'" class="verified" role="status">PlutoFish 已验证：{{ state.identity?.name }}</span>
    <span v-else-if="state?.error" class="error-box" role="alert">{{ state.error }}</span>
    <span v-if="state?.uploadNotice" class="dim" role="status">{{ state.uploadNotice }}</span>
  </fieldset>
</template>

<style scoped>
.plutofish { border: 0; border-top: 1px solid var(--line); padding: 16px 0 0; margin: 6px 0 0; display: grid; gap: 14px; min-width: 0; }
legend { padding: 0 8px 0 0; font-weight: 700; }
.field { display: grid; gap: 6px; }
.verified { color: var(--ok); font-size: 13px; }
</style>
