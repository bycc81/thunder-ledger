<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();
const active = computed(() => {
  if (route.path.startsWith('/batches')) return 'batches';
  if (route.path.startsWith('/audit')) return 'audit';
  if (route.path.startsWith('/profile')) return 'profile';
  return 'workspace';
});

function navigate(value: string) {
  void router.push({ workspace: '/workspace', batches: '/batches', audit: '/audit', profile: '/profile' }[value] ?? '/workspace');
}
</script>

<template>
  <van-tabbar :model-value="active" fixed data-ai-id="bottom-navigation" @change="navigate">
    <van-tabbar-item name="workspace" icon="home-o" data-ai-id="nav-workspace">工作区</van-tabbar-item>
    <van-tabbar-item name="batches" icon="orders-o" data-ai-id="nav-batches">批次</van-tabbar-item>
    <van-tabbar-item name="audit" icon="notes-o" data-ai-id="nav-audit">操作记录</van-tabbar-item>
    <van-tabbar-item name="profile" icon="contact" data-ai-id="nav-profile">我的</van-tabbar-item>
  </van-tabbar>
</template>
