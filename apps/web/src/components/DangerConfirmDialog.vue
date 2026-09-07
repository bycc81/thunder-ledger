<script setup lang="ts">
defineProps<{
  show: boolean;
  title: string;
  message: string;
  confirmText: string;
  aiId: string;
  loading?: boolean;
}>();

const emit = defineEmits<{
  'update:show': [value: boolean];
  confirm: [];
}>();
</script>

<template>
  <van-dialog
    :show="show"
    :title="title"
    :message="message"
    :confirm-button-text="confirmText"
    confirm-button-color="#b42318"
    show-cancel-button
    :confirm-button-disabled="loading"
    :cancel-button-disabled="loading"
    :data-ai-id="aiId"
    @update:show="emit('update:show', $event)"
    @confirm="emit('confirm')"
  />
</template>
