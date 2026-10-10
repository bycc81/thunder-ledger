<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string[]
  options: Array<{ value: string; label: string; disabled?: boolean }>
  label: string
  countUnit?: string
  placeholder?: string
  hint?: string
  emptyText?: string
  disabled?: boolean
  aiId?: string
  emptyAiId?: string
}>(), {
  countUnit: '项',
  placeholder: '请选择',
  hint: '可多选',
  emptyText: '暂无可选项',
  disabled: false
})
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()
const show = ref(false)
const draftValues = ref<string[]>([])
const trigger = ref<HTMLButtonElement>()
const panel = ref<HTMLDivElement>()
const panelWidth = ref(240)
const panelDomId = `multi-select-${useId()}`
const displayValue = computed(() => props.modelValue.length
  ? props.modelValue.map((value) => props.options.find((option) => option.value === value)?.label || '已选项').join('、')
  : props.placeholder)
const draftSet = computed(() => new Set(draftValues.value))
const aiId = (suffix: string) => props.aiId ? `${props.aiId}-${suffix}` : undefined

function toggle() {
  if (props.disabled) return
  if (!show.value) {
    draftValues.value = [...props.modelValue]
    panelWidth.value = trigger.value?.getBoundingClientRect().width || 240
  }
  show.value = !show.value
}
function close(restoreFocus = false) {
  show.value = false
  if (restoreFocus) void nextTick(() => trigger.value?.focus())
}
function apply() {
  if (props.disabled) return
  emit('update:modelValue', [...draftValues.value])
  close(true)
}
function dismiss(event: PointerEvent) {
  const target = event.target
  if (target instanceof Node && !trigger.value?.contains(target) && !panel.value?.contains(target)) close()
}
watch(show, (opened) => {
  if (opened) document.addEventListener('pointerdown', dismiss)
  else document.removeEventListener('pointerdown', dismiss)
})
watch(() => props.disabled, (disabled) => { if (disabled) close() })
watch(() => props.modelValue, (value) => { if (show.value) draftValues.value = [...value] }, { deep: true })
onBeforeUnmount(() => document.removeEventListener('pointerdown', dismiss))
</script>

<template>
  <div class="multi-select" :data-ai-id="props.aiId">
    <span class="select-label">{{ label }}</span>
    <div class="select-control" :data-ai-id="aiId('dropdown')">
      <van-popover v-model:show="show" class="multi-select-popover" placement="bottom-start" trigger="manual" :show-arrow="false" :overlay="false" :offset="[0, 6]">
        <template #reference>
          <button ref="trigger" class="select-trigger" :class="{ 'select-trigger--open': show }" type="button" role="combobox" :aria-label="label" aria-haspopup="dialog" :aria-controls="panelDomId" :aria-expanded="show" :disabled="disabled" @click="toggle" @keydown.esc.stop="close(true)">
            <span class="select-value" :data-ai-id="aiId('trigger')">{{ displayValue }}</span>
            <span v-if="modelValue.length > 1" class="select-count">{{ modelValue.length }} {{ countUnit }}</span>
            <van-icon name="arrow-down" class="select-arrow" />
          </button>
        </template>
        <div :id="panelDomId" ref="panel" class="select-panel" :style="{ width: `${panelWidth}px` }" role="dialog" :aria-label="`选择${label}`" :data-ai-id="aiId('panel')" @keydown.esc.stop="close(true)">
          <p v-if="hint" class="select-hint">{{ hint }}</p>
          <van-checkbox-group v-model="draftValues" class="select-options" :data-ai-id="aiId('options')">
            <van-checkbox v-for="option in options" :key="option.value" :name="option.value" :disabled="option.disabled" shape="square" class="select-option" :class="{ 'select-option--selected': draftSet.has(option.value) }" :data-ai-id="aiId(`option-${option.value}`)">{{ option.label }}</van-checkbox>
          </van-checkbox-group>
          <van-empty v-if="!options.length" :description="emptyText" image-size="60" :data-ai-id="emptyAiId || aiId('empty')" />
          <div class="select-actions">
            <van-button plain :data-ai-id="aiId('reset')" @click="draftValues = []">重置</van-button>
            <van-button type="primary" :data-ai-id="aiId('apply')" @click="apply">确定</van-button>
          </div>
        </div>
      </van-popover>
    </div>
  </div>
</template>

<style scoped>
.multi-select {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}
.select-label {
  flex-shrink: 0;
  color: #536178;
  font-size: 14px;
  line-height: 20px;
}
.select-control {
  min-width: 0;
  flex: 1;
}
.select-control :deep(.van-popover__wrapper) {
  display: block;
}
.select-trigger {
  display: flex;
  width: 100%;
  min-height: 44px;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid #dce2eb;
  border-radius: 6px;
  background: #fff;
  color: #35435b;
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.select-trigger--open,
.select-trigger:focus-visible {
  border-color: var(--van-primary-color);
  outline: none;
  box-shadow: 0 0 0 2px rgb(54 87 200 / 10%);
}
.select-trigger:disabled {
  background: #f5f7fa;
  color: #8993a7;
  cursor: not-allowed;
}
.select-value {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.select-count {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 4px;
  background: #eef2ff;
  color: var(--van-primary-color);
  font-size: 12px;
}
.select-arrow {
  flex-shrink: 0;
  color: #8993a7;
  transition: transform .15s;
}
.select-trigger--open .select-arrow {
  transform: rotate(180deg);
}
.select-panel {
  display: flex;
  max-width: calc(100vw - 32px);
  max-height: min(360px, 50vh);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #e0e5ed;
  border-radius: 6px;
  background: #fff;
}
.select-hint {
  margin: 0;
  padding: 10px 12px 6px;
  color: #71809a;
  font-size: 12px;
  line-height: 1.5;
}
.select-options {
  overflow-y: auto;
  min-height: 0;
  flex: 1;
  padding: 4px;
}
.select-option {
  min-height: 44px;
  padding: 8px 10px;
  border-radius: 4px;
}
.select-option:hover,
.select-option--selected {
  background: #f0f4ff;
}
.select-option :deep(.van-checkbox__label) {
  overflow-wrap: anywhere;
  font-size: 14px;
}
.select-actions {
  display: grid;
  flex-shrink: 0;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid #edf0f5;
}
.select-actions :deep(.van-button) {
  border-radius: 5px;
}
</style>
