<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

onMounted(() => {
  if (!auth.captchaImage) void auth.loadCaptcha();
});

async function submit() {
  if (await auth.login()) {
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/workspace';
    await router.replace(redirect.startsWith('/') ? redirect : '/workspace');
  }
}
</script>

<template>
  <main class="login-page" data-ai-id="login-page">
    <div class="login-brand" data-ai-id="login-brand"><span class="login-mark">TL</span><strong>ThunderLedger</strong></div>
    <h1>登录</h1>
    <van-form @submit="submit">
      <van-cell-group inset>
        <van-field v-model="auth.username" label="用户名" autocomplete="username" data-ai-id="login-username" />
        <van-field v-model="auth.password" label="密码" type="password" autocomplete="current-password" data-ai-id="login-password" />
        <van-field v-model="auth.captchaCode" label="验证码" maxlength="4" placeholder="四位数字" data-ai-id="login-captcha">
          <template #button>
            <img v-if="auth.captchaImage" :src="auth.captchaImage" alt="验证码" class="captcha" data-ai-id="login-captcha-image" @click="auth.loadCaptcha" />
            <van-button v-else size="small" plain native-type="button" @click="auth.loadCaptcha">刷新</van-button>
          </template>
        </van-field>
      </van-cell-group>
      <p v-if="auth.error" class="login-error" data-ai-id="login-error">{{ auth.error }}</p>
      <van-button block type="primary" native-type="submit" :loading="auth.loading" data-ai-id="login-submit">登录</van-button>
    </van-form>
  </main>
</template>

<style scoped>
.login-page { width:min(100%,480px); min-height:100vh; margin:0 auto; padding:72px 16px 24px; background:#f5f7fb; }
.login-brand { display:flex; align-items:center; justify-content:center; gap:10px; color:#172033; font-size:16px; }
.login-mark { display:grid; width:36px; height:36px; place-items:center; border-radius:9px; background:#3657c8; color:#fff; font-size:13px; font-weight:800; }
h1 { margin:28px 0 22px; color:#172033; font-size:24px; text-align:center; }
.van-button { margin-top:20px; min-height:44px; }
.captcha { width:88px; height:34px; object-fit:contain; cursor:pointer; }
.login-error { margin:12px 16px 0; color:#b42318; font-size:13px; }
</style>
