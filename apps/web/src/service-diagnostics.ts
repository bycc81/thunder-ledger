import { computed, ref } from 'vue';
import { isAxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

const storageKey = 'thunderledger-service-diagnostics-v1';
const maxAge = 24 * 60 * 60 * 1000;
const endpoints = ['/healthz', '/auth/captcha', '/auth/session'] as const;
const headerNames = ['x-render-routing', 'cf-ray', 'retry-after', 'content-type'] as const;
type Endpoint = typeof endpoints[number];
type Result = 'ok' | 'signed-out' | 'render-limited' | 'http-error' | 'invalid-response' | 'timeout' | 'network';
type Entry = { time: number; endpoint: Endpoint; elapsed: number; status?: number; result: Result; headers: Partial<Record<typeof headerNames[number], string>> };
const results: Result[] = ['ok', 'signed-out', 'render-limited', 'http-error', 'invalid-response', 'timeout', 'network'];
const descriptions: Record<Result, string> = {
  ok: '响应正常',
  'signed-out': '尚未登录（正常）',
  'render-limited': 'Render 正在限制休眠唤醒请求，请等待后再试',
  'http-error': '请求被拒绝或服务异常，需结合响应头排查来源',
  'invalid-response': '返回内容异常，可能是平台启动页或拦截页',
  timeout: '请求等待超时，尚不能确定是启动慢还是网络问题',
  network: '未收到可读取的响应，请检查网络；跨域请求也可能被浏览器阻止',
};

// Persist only this explicit schema; never store request headers or response bodies.
function readEntries(): Entry[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.flatMap((item): Entry[] => {
      if (!item || typeof item !== 'object' || !Number.isFinite(item.time) || item.time < Date.now() - maxAge || item.time > Date.now()
        || !endpoints.includes(item.endpoint) || !results.includes(item.result) || !Number.isFinite(item.elapsed) || item.elapsed < 0) return [];
      const headers: Entry['headers'] = {};
      for (const name of headerNames) {
        if (typeof item.headers?.[name] === 'string') headers[name] = item.headers[name].slice(0, 160);
      }
      return [{ time: item.time, endpoint: item.endpoint, elapsed: Math.round(item.elapsed),
        status: Number.isInteger(item.status) && item.status >= 100 && item.status <= 599 ? item.status : undefined,
        result: item.result, headers }];
    }).sort((a, b) => b.time - a.time).slice(0, 30);
  } catch { return []; }
}

export const serviceDiagnostics = ref<Entry[]>(readEntries());
const started = new WeakMap<InternalAxiosRequestConfig, number>();

export function startServiceRequest(config: InternalAxiosRequestConfig) {
  if (config.method?.toLowerCase() === 'get' && endpoints.includes(config.url as Endpoint)) started.set(config, performance.now());
  return config;
}

export function recordServiceResponse(response?: AxiosResponse, error?: unknown) {
  const axiosError = isAxiosError(error) ? error : undefined;
  const config = response?.config ?? axiosError?.config;
  if (!config || !started.has(config)) return;
  const elapsed = Math.max(0, Math.round(performance.now() - started.get(config)!));
  started.delete(config);
  if (config.signal?.aborted || axiosError?.code === 'ERR_CANCELED') return;
  response ??= axiosError?.response;
  const endpoint = config.url as Endpoint;
  const headers: Entry['headers'] = {};
  for (const name of headerNames) {
    const value = response?.headers[name];
    if (typeof value === 'string') headers[name] = value.slice(0, 160);
  }
  let result: Result;
  if (!response) result = ['ECONNABORTED', 'ETIMEDOUT'].includes(axiosError?.code ?? '') ? 'timeout' : 'network';
  else if (response.status === 429 && headers['x-render-routing'] === 'hibernate-rate-limited') result = 'render-limited';
  else if (response.status === 401 && endpoint === '/auth/session') result = 'signed-out';
  else if (response.status !== 200) result = 'http-error';
  else {
    const data = response.data;
    const valid = endpoint === '/healthz' ? data?.status === 'ok'
      : endpoint === '/auth/session' ? data?.authenticated === true
      : typeof data?.captchaId === 'string' && Boolean(data.captchaId) && typeof data?.image === 'string' && data.image.startsWith('data:image/');
    result = valid ? 'ok' : 'invalid-response';
  }
  serviceDiagnostics.value = [{ time: Date.now(), endpoint, elapsed, status: response?.status, result, headers },
    ...serviceDiagnostics.value.filter(entry => entry.time >= Date.now() - maxAge)].slice(0, 30);
  try { localStorage.setItem(storageKey, JSON.stringify(serviceDiagnostics.value)); } catch { /* Storage may be unavailable; in-memory diagnostics still work. */ }
}

export const serviceDiagnosticSummary = computed(() => {
  const entry = serviceDiagnostics.value.find(item => item.result !== 'signed-out');
  if (!entry) return '尚无连接检查记录。';
  return `最近请求 ${entry.endpoint}：${entry.status ? `HTTP ${entry.status}：` : ''}${descriptions[entry.result]}${entry.result === 'ok' ? '；下方仍保留之前的故障记录。' : '。'}`;
});

export function serviceDiagnosticProblem() {
  const entry = serviceDiagnostics.value[0];
  return entry && !['ok', 'signed-out'].includes(entry.result) ? descriptions[entry.result] : '服务暂未响应';
}

export const serviceDiagnosticReport = computed(() => [
  'ThunderLedger 服务连接诊断（最近24小时，最多30条，新记录在前）',
  '仅记录请求结果与诊断响应头，不包含账号、密码、验证码或会话凭据。',
  ...serviceDiagnostics.value.map(entry => [
    `${new Date(entry.time).toISOString()} GET ${entry.endpoint} ${entry.status ? `HTTP ${entry.status}` : '无HTTP响应'} ${entry.elapsed}ms`,
    descriptions[entry.result],
    ...headerNames.flatMap(name => entry.headers[name] ? [`${name}: ${entry.headers[name]}`] : []),
  ].join('\n')),
].join('\n\n'));

export function clearServiceDiagnostics() {
  serviceDiagnostics.value = [];
  try { localStorage.removeItem(storageKey); } catch { /* Memory can still be cleared. */ }
}
