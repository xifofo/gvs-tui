<script setup lang="ts">
const props = withDefaults(defineProps<{ w?: number | string; h?: number | string; r?: number | string }>(), {
  w: '100%',
  h: 16,
  r: 6,
})
/** 数字和纯数字字符串都当 px，其它（100%、auto…）原样用 */
const px = (v: number | string) => (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v)) ? `${Number(v)}px` : String(v))
</script>

<template>
  <span class="sk" :style="{ width: px(props.w), height: px(props.h), borderRadius: px(props.r) }" aria-hidden="true" />
</template>
