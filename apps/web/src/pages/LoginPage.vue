<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { isAxiosError } from 'axios';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { api } from '../api';
import { clearServiceDiagnostics, serviceDiagnosticProblem, serviceDiagnosticReport, serviceDiagnosticSummary } from '../service-diagnostics';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const waking = ref(false);
const wakeMessage = ref('服务未响应时，点击尝试唤醒。');
let wakeController: AbortController | undefined;
const pageController = new AbortController();
const refreshingCaptcha = ref(false);
const diagnosticFeedback = ref('');
const diagnosticReport = ref<HTMLTextAreaElement>();
const healthUrl = `${String(api.defaults.baseURL).replace(/\/$/, '')}/healthz`;
// Keep in sync with the production origin documented in functions/api/[[path]].ts.
const originHealthUrl = 'https://thunder-ledger-api.onrender.com/api/healthz';

async function copyDiagnostics() {
  try {
    await navigator.clipboard.writeText(serviceDiagnosticReport.value);
    diagnosticFeedback.value = '诊断信息已复制，可保存到备忘录。';
  } catch {
    diagnosticReport.value?.focus();
    diagnosticReport.value?.select();
    diagnosticFeedback.value = '无法自动复制，已选中报告，请长按复制。';
  }
}

function clearDiagnostics() {
  clearServiceDiagnostics();
  diagnosticFeedback.value = '本机诊断记录已清除。';
}

async function refreshCaptcha() {
  if (waking.value || refreshingCaptcha.value) return;
  refreshingCaptcha.value = true;
  try { await auth.loadCaptcha(pageController.signal); }
  finally { refreshingCaptcha.value = false; }
}

function waitForRetry(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

async function wakeService() {
  if (waking.value || auth.loading || refreshingCaptcha.value) return;
  waking.value = true;
  const controller = new AbortController();
  wakeController = controller;
  const deadline = Date.now() + 120_000;
  try {
    for (let attempt = 0; attempt < 4 && !controller.signal.aborted; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      wakeMessage.value = `正在尝试连接服务（${attempt + 1}/4），请稍候…`;
      let retryDelay = (attempt + 1) * 10_000;
      try {
        const { data } = await api.get('/healthz', {
          signal: controller.signal,
          timeout: Math.min(15_000, remaining),
        });
        if (data?.status !== 'ok') throw new Error('Invalid health response');
        wakeMessage.value = '服务已响应，正在刷新验证码…';
        const loaded = await auth.loadCaptcha(controller.signal);
        if (!controller.signal.aborted) {
          wakeMessage.value = loaded ? '服务已连接，验证码已刷新，请继续登录。' : '服务已响应，但验证码加载失败，请稍后刷新验证码。';
        }
        return;
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isAxiosError(error)) {
          const retryAfter = error.response?.headers['retry-after'];
          if (retryAfter) {
            const seconds = Number(retryAfter);
            const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(retryAfter)) - Date.now();
            if (Number.isFinite(delay)) retryDelay = Math.max(retryDelay, delay);
          }
        }
      }
      if (attempt === 3 || Date.now() + retryDelay >= deadline) break;
      wakeMessage.value = `${serviceDiagnosticProblem()}；将在 ${Math.ceil(retryDelay / 1000)} 秒后重试，请勿重复点击。`;
      await waitForRetry(retryDelay, controller.signal);
    }
    if (!controller.signal.aborted) wakeMessage.value = `暂时无法连接服务：${serviceDiagnosticProblem()}。请展开连接诊断，保留记录后检查。`;
  } finally {
    waking.value = false;
    wakeController = undefined;
  }
}

onBeforeUnmount(() => {
  wakeController?.abort();
  pageController.abort();
});

onMounted(() => {
  if (!auth.captchaImage) void refreshCaptcha();
});

async function submit() {
  if (waking.value || refreshingCaptcha.value) return;
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
    <van-form data-ai-id="login-form" @submit="submit">
      <van-cell-group inset>
        <van-field v-model="auth.username" label="用户名" autocomplete="username" data-ai-id="login-username" />
        <van-field v-model="auth.password" label="密码" type="password" autocomplete="current-password" data-ai-id="login-password" />
        <van-field v-model="auth.captchaCode" label="验证码" maxlength="4" placeholder="四位数字" data-ai-id="login-captcha">
          <template #button>
            <button v-if="auth.captchaImage" type="button" class="captcha-refresh" aria-label="刷新验证码" :disabled="waking || refreshingCaptcha || auth.loading" data-ai-id="login-captcha-refresh" @click="refreshCaptcha">
              <img :src="auth.captchaImage" alt="验证码" class="captcha" data-ai-id="login-captcha-image" />
            </button>
            <van-button v-else plain native-type="button" :disabled="waking || auth.loading" :loading="refreshingCaptcha" data-ai-id="login-captcha-refresh" @click="refreshCaptcha">刷新</van-button>
          </template>
        </van-field>
      </van-cell-group>
      <p v-if="auth.error" class="login-error" data-ai-id="login-error">{{ auth.error }}</p>
      <van-button block type="primary" native-type="submit" :loading="auth.loading" :disabled="waking || refreshingCaptcha" data-ai-id="login-submit">登录</van-button>
    </van-form>
    <section class="service-wakeup" aria-label="服务连接" data-ai-id="login-service-wakeup">
      <van-button class="wakeup-button" plain type="primary" native-type="button" :loading="waking" loading-text="唤醒中…" :disabled="waking || auth.loading || refreshingCaptcha" data-ai-id="login-service-wakeup-button" @click="wakeService">唤醒服务</van-button>
      <p v-if="wakeMessage" role="status" aria-live="polite" data-ai-id="login-service-wakeup-status">{{ wakeMessage }}</p>
      <details class="service-diagnostics" data-ai-id="login-service-diagnostics">
        <summary data-ai-id="login-service-diagnostics-toggle">连接诊断与排查</summary>
        <p role="status" data-ai-id="login-service-diagnostics-summary">{{ serviceDiagnosticSummary }}</p>
        <p>先复制故障记录，再打开后端直连检查，最多等待一分钟。显示 {"status":"ok"} 后返回刷新验证码。仍报错时截图保存，并切换 Wi-Fi / 移动网络对比；持续失败请检查 Render 状态与日志。</p>
        <div class="diagnostic-actions">
          <a :href="healthUrl" target="_blank" rel="noopener noreferrer" data-ai-id="login-service-health-link">网站接口检查</a>
          <a :href="originHealthUrl" target="_blank" rel="noopener noreferrer" data-ai-id="login-service-origin-health-link">后端直连检查</a>
          <button type="button" data-ai-id="login-service-diagnostics-copy" @click="copyDiagnostics">复制诊断信息</button>
          <button type="button" data-ai-id="login-service-diagnostics-clear" @click="clearDiagnostics">清除记录</button>
        </div>
        <p>记录仅保存在本机，最近24小时最多30条，恢复或刷新后仍保留。未包含账号、密码或验证码。</p>
        <textarea ref="diagnosticReport" :value="serviceDiagnosticReport" readonly aria-label="连接诊断报告，可长按复制" data-ai-id="login-service-diagnostics-report" />
        <p v-if="diagnosticFeedback" role="status" data-ai-id="login-service-diagnostics-feedback">{{ diagnosticFeedback }}</p>
      </details>
    </section>
  </main>
</template>

<style scoped>
.login-page { display:flex; flex-direction:column; width:min(100%,480px); min-height:100vh; min-height:100dvh; margin:0 auto; padding:72px 16px max(16px, env(safe-area-inset-bottom)); background:#f5f7fb; }
.login-brand { display:flex; align-items:center; justify-content:center; gap:10px; color:#172033; font-size:16px; }
.login-mark { display:grid; width:36px; height:36px; place-items:center; border-radius:9px; background:#3657c8; color:#fff; font-size:13px; font-weight:800; }
h1 { margin:28px 0 22px; color:#172033; font-size:24px; text-align:center; }
.van-button { margin-top:20px; min-height:44px; }
.captcha { width:88px; height:34px; object-fit:contain; cursor:pointer; }
.captcha-refresh { display:flex; align-items:center; justify-content:center; min-width:88px; min-height:44px; padding:0; border:0; background:transparent; cursor:pointer; }
.captcha-refresh:disabled { cursor:default; opacity:.6; }
.service-wakeup { display:flex; flex-direction:column; align-items:flex-end; margin-top:auto; padding-top:24px; padding-bottom:44px; }
.service-wakeup p { max-width:280px; margin:6px 8px 0; color:#596579; font-size:13px; line-height:1.6; text-align:right; }
.service-wakeup .wakeup-button { margin-top:0; padding:0 12px; border:1px solid #bcc7e6; border-radius:6px; background:#fff; font-size:13px; }
.service-diagnostics { width:100%; margin-top:6px; color:#596579; font-size:13px; }
.service-diagnostics summary { display:list-item; min-height:44px; padding:12px 8px; cursor:pointer; text-align:right; }
.service-diagnostics p { max-width:none; margin:8px 0; text-align:left; }
.diagnostic-actions { display:flex; flex-wrap:wrap; gap:4px 12px; }
.diagnostic-actions a, .diagnostic-actions button { display:inline-flex; align-items:center; min-height:44px; padding:4px 0; border:0; background:transparent; color:#3657c8; font:inherit; cursor:pointer; text-decoration:underline; }
.service-diagnostics textarea { display:block; width:100%; min-height:180px; padding:8px; border:1px solid #bcc7e6; border-radius:4px; background:#fff; color:#172033; font-size:12px; line-height:1.6; resize:vertical; }
.login-error { margin:12px 16px 0; color:#b42318; font-size:13px; }
</style>
