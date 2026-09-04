<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <div class="placeholder-page"><van-empty :description="`${title}页面正在按契约迁移`" /></div>
</template>

<style scoped>
.placeholder-page { width:min(100%,480px); min-height:100vh; margin:0 auto; padding-top:120px; background:#f5f7fb; }
</style>
