<script setup lang="ts">
// 编辑: one setting value in a framed box. The ref is bound to the shell's
// `edit` ref and the shell focuses the field on scene change.
import { computed, ref } from 'vue-termui'
import { Box, Input, Text } from 'vue-termui'
import { ink } from '../lib/rows.ts'
import { c } from '../lib/theme.ts'
import type { Snapshot } from '../bridge.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
}>()

const bodyW = computed(() => props.width)
const edit = defineModel<string>('edit', { required: true })

const editField = ref<{ $el?: { focus?: () => void } } | null>(null)

/** The shell focuses the field on scene change. */
function focus(): void {
  const fn = editField.value?.$el?.focus
  if (typeof fn === 'function') fn.call(editField.value!.$el)
}

defineExpose({ focus })

const boxW = computed(() => Math.max(30, Math.min(72, bodyW.value - 2)))
const fieldW = computed(() => boxW.value - 4)

/** What the field expects, for the fields where the format is not obvious. */
const FIELD_HINTS: Record<string, string> = {
  下载目录: '绝对路径，例如 D:\\GVS',
  下载线程: '1–16（路并发）',
  'Hami TV Cookie': '仅本次 POST 提交，不写客户端配置；支持 Header 或 Netscape 文本',
  'Hami 手机号（确认发码）': '先执行 Hami Web 准备；回车即明确同意向此号码发一次短信',
  'Hami 短信码': '六位数字，保留前导零；提交后清空输入',
  'mewatch profile': 'profileId，可选空格加 PIN（仅本次提交）',
  '腾讯 Cookie': '整段粘贴浏览器 Cookie',
  '抖音 Cookie': '整段粘贴浏览器 Cookie',
  发布组: '留空则用默认前缀',
  'TMDB Key': 'TMDB v3 API Key',
}
const hint = computed(() => FIELD_HINTS[props.state.editField ?? ''] ?? '')
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <Text
      :content="ink(c.text, state.editField || '编辑', true)"
      :height="1"
      :width="bodyW"
      :truncate="true"
    />
    <Text
      :content="ink(c.faint, '回车保存 · esc 取消')"
      :height="1"
      :width="bodyW"
      :truncate="true"
    />
    <Box
      :width="boxW"
      :height="3"
      :marginTop="1"
      :border="true"
      borderStyle="rounded"
      :borderColor="c.accent"
      :backgroundColor="c.sunken"
      :paddingLeft="1"
      :paddingRight="1"
    >
      <Input
        ref="editField"
        v-model="edit"
        autofocus
        :backgroundColor="c.sunken"
        :focusedBackgroundColor="c.sunken"
        :textColor="c.text"
        :placeholderColor="c.faint"
        :width="fieldW"
      />
    </Box>
    <Text
      v-if="hint"
      :content="ink(c.faint, hint)"
      :height="1"
      :marginTop="1"
      :width="bodyW"
      :truncate="true"
    />
  </Box>
</template>
