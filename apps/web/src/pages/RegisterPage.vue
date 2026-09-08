<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRouter } from 'vue-router';
import { api } from '../api';

const router = useRouter();
const token = ref('');
const username = ref('');
const password = ref('');
const passwordConfirm = ref('');
const loading = ref(true);
const saving = ref(false);
const error = ref('');

function invitationToken() { return new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''; }
async function load() {
  token.value = invitationToken();
  if (!token.value) { error.value = '邀请链接无效或已过期'; loading.value = false; return; }
  loading.value = true; error.value = '';
  try { username.value = (await api.post<{ username: string }>('/auth/register/preview', { token: token.value })).data.username; }
  catch { error.value = '邀请链接无效或已过期'; }
  finally { loading.value = false; }
}
async function submit() {
  if (password.value.trim().length < 8 || password.value.trim().length > 64) { showFailToast('密码需要为 8–64 位'); return; }
  if (password.value !== passwordConfirm.value) { showFailToast('两次输入的密码不一致'); return; }
  saving.value = true;
  try { await api.post('/auth/register', { token: token.value, username: username.value, password: password.value }); window.history.replaceState(null, '', '/login'); showSuccessToast('注册完成，请登录'); await router.replace('/login'); }
  catch (requestError: unknown) { showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || '注册失败，请检查邀请链接'); }
  finally { saving.value = false; }
}
onMounted(load);
</script>

<template>
  <main class="register-page" data-ai-id="register-page">
    <div class="register-brand"><span>TL</span><strong>ThunderLedger</strong></div>
    <h1>完成注册</h1>
    <div v-if="loading" class="state"><van-loading /></div>
    <template v-else-if="error"><van-empty :description="error" data-ai-id="register-invitation"><van-button plain type="primary" data-ai-id="register-login-link" @click="router.replace('/login')">返回登录</van-button></van-empty></template>
    <template v-else>
      <p class="notice" data-ai-id="register-invitation">你受邀加入协作工作区。用户名由邀请人设置，只需设置登录密码。</p>
      <van-cell-group inset>
        <van-field :model-value="username" label="用户名" readonly data-ai-id="register-username" />
        <van-field v-model="password" label="设置密码" type="password" autocomplete="new-password" placeholder="8–64 位" data-ai-id="register-password" />
        <van-field v-model="passwordConfirm" label="确认密码" type="password" autocomplete="new-password" placeholder="再次输入密码" data-ai-id="register-password-confirm" />
      </van-cell-group>
      <van-button block type="primary" :loading="saving" data-ai-id="register-submit" @click="submit">完成注册</van-button>
      <van-button block plain data-ai-id="register-login-link" @click="router.replace('/login')">返回登录</van-button>
    </template>
  </main>
</template>

<style scoped>
.register-page{width:min(100%,480px);min-height:100vh;margin:0 auto;padding:56px 16px 24px;background:#f5f7fb}.register-brand{display:flex;align-items:center;justify-content:center;gap:10px;color:#172033}.register-brand span{display:grid;width:36px;height:36px;place-items:center;border-radius:9px;background:#3657c8;color:#fff;font-size:13px;font-weight:800}.register-page h1{margin:28px 0 14px;color:#172033;font-size:24px;text-align:center}.notice{margin:0 0 14px;padding:10px 12px;border-radius:8px;background:#edf1ff;color:#2949aa;font-size:13px;line-height:1.5}.register-page :deep(.van-button){min-height:44px;margin-top:12px}.state{display:grid;min-height:40vh;place-items:center}
</style>
