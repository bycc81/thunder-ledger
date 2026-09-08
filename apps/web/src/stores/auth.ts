import { ref } from 'vue';
import { defineStore } from 'pinia';
import { api } from '../api';

export const useAuthStore = defineStore('auth', () => {
  const username = ref('');
  const password = ref('');
  const captchaId = ref('');
  const captchaImage = ref('');
  const captchaCode = ref('');
  const loading = ref(false);
  const restoring = ref(true);
  const loggedIn = ref(false);
  const isSystemAdmin = ref(false);
  const error = ref('');

  async function loadCaptcha() {
    try {
      const { data } = await api.get<{ captchaId: string; image: string }>('/auth/captcha');
      captchaId.value = data.captchaId;
      captchaImage.value = data.image;
      captchaCode.value = '';
    } catch {
      error.value = '验证码加载失败';
    }
  }

  async function restore() {
    if (!localStorage.getItem('accessToken')) {
      restoring.value = false;
      await loadCaptcha();
      return;
    }
    try {
      const { data } = await api.get<{ username?: string; superAdmin?: boolean }>('/auth/session');
      if (data.username) username.value = data.username;
      isSystemAdmin.value = Boolean(data.superAdmin);
      loggedIn.value = true;
    } catch {
      localStorage.removeItem('accessToken');
      await loadCaptcha();
    } finally {
      restoring.value = false;
    }
  }

  async function login() {
    if (loading.value) return false;
    error.value = '';
    if (!captchaId.value || !/^\d{4}$/.test(captchaCode.value)) {
      error.value = '请输入四位数字验证码';
      return false;
    }
    loading.value = true;
    try {
      const { data } = await api.post<{ accessToken: string }>('/auth/login', {
        username: username.value,
        password: password.value,
        captchaId: captchaId.value,
        captchaCode: captchaCode.value,
      });
      localStorage.setItem('accessToken', data.accessToken);
      await restore();
      return true;
    } catch (e: any) {
      error.value = e?.response?.status === 429 ? '登录过于频繁，请稍后再试' : '用户名、密码或验证码错误';
      await loadCaptcha();
      return false;
    } finally {
      loading.value = false;
    }
  }

  function logout() {
    localStorage.removeItem('accessToken');
    username.value = '';
    password.value = '';
    loggedIn.value = false;
    isSystemAdmin.value = false;
    void loadCaptcha();
  }

  return { username, password, captchaId, captchaImage, captchaCode, loading, restoring, loggedIn, isSystemAdmin, error, loadCaptcha, restore, login, logout };
});
