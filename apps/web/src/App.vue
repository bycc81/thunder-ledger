<script setup lang="ts">
import { ref } from 'vue';
import { api, uploadImage } from './api';
const connected = ref(false);
const username = ref('admin');
const password = ref('');
const loggedIn = ref(false);
const loginError = ref('');
const imageUrl = ref('');
const imageError = ref('');
async function checkApi() {
  try { await api.get('/healthz'); connected.value = true; } catch { connected.value = false; }
}
async function login() {
  loginError.value = '';
  try { const { data } = await api.post<{ accessToken: string }>('/auth/login', { username: username.value, password: password.value }); localStorage.setItem('accessToken', data.accessToken); }
  catch { loginError.value = '用户名或密码错误'; return; }
  loggedIn.value = true;
}
async function selectImage(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  imageError.value = '';
  try { imageUrl.value = await uploadImage(file); } catch { imageError.value = '图片上传失败，请检查 R2 配置'; }
}
function logout() { localStorage.removeItem('accessToken'); loggedIn.value = false; }
</script>

<template>
  <el-container class="shell">
    <el-header><strong>ThunderLedger</strong><span>闲鱼经营管理后台</span></el-header>
    <el-main>
      <el-card v-if="!loggedIn">
        <template #header>登录</template>
        <el-form @submit.prevent="login">
          <el-form-item label="用户名"><el-input v-model="username" autocomplete="username" /></el-form-item>
          <el-form-item label="密码"><el-input v-model="password" type="password" show-password autocomplete="current-password" /></el-form-item>
          <el-button type="primary" native-type="submit">登录</el-button>
          <el-text v-if="loginError" type="danger">{{ loginError }}</el-text>
        </el-form>
      </el-card>
      <el-card v-else>
        <template #header>基础平台已就绪</template>
        <p>业务模块将在基础设施验收后单独设计。</p>
        <el-button type="primary" @click="checkApi">检查 API</el-button>
        <el-tag v-if="connected" type="success">API 正常</el-tag>
        <el-divider />
        <el-button @click="logout">退出登录</el-button>
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" @change="selectImage" />
        <el-image v-if="imageUrl" :src="imageUrl" fit="cover" style="width: 180px; height: 180px; margin-top: 16px" />
        <el-text v-if="imageError" type="danger">{{ imageError }}</el-text>
      </el-card>
    </el-main>
  </el-container>
</template>

<style scoped>
.shell { min-height: 100vh; background: #f5f7fa; }
.el-header { display: flex; align-items: center; gap: 24px; background: #fff; border-bottom: 1px solid #e4e7ed; }
.el-header span { color: #909399; }
.el-main { max-width: 1100px; width: 100%; margin: 0 auto; padding: 32px; }
.el-tag { margin-left: 12px; }
</style>
