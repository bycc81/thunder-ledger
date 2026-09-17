// Cloudflare Pages Function: 代理 /api/* 到后端 API 源站，避免 pages.dev 与后端不同域名导致的跨站 Cookie 问题。
//
// 环境变量（Cloudflare Pages 生产环境设置）：
//   API_ORIGIN=https://thunder-ledger-api.onrender.com
//
// 转发规则：
// - 请求路径保持 /api/...
// - 保留请求方法、请求体、大部分请求头
// - 保留响应头和 Cookie（Set-Cookie），客户端会将其视为同源 Cookie
// - 502 表示后端不可达

type Env = {
  API_ORIGIN?: string;
};

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  const origin = env.API_ORIGIN?.replace(/\/$/, '');
  if (!origin) {
    return new Response('API_ORIGIN is not configured', { status: 502 });
  }

  const path = Array.isArray(params.path) ? params.path.join('/') : 'healthz';
  const upstream = `${origin}/api/${path}`;

  const url = new URL(request.url);
  const upstreamUrl = new URL(upstream);
  upstreamUrl.search = url.search;

  const headers = new Headers(request.headers);
  // 删除可能影响代理层的 Host 头，由浏览器端源站连接重新设置
  headers.delete('host');
  // 让后端拿到真实来源，用于 CORS 和审计日志
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.slice(0, -1));

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const body = await request.arrayBuffer();
    init.body = body;
  }

  const upstreamResponse = await fetch(upstreamUrl.toString(), init);

  const responseHeaders = new Headers(upstreamResponse.headers);
  // 移除可能导致浏览器冲突的传输头
  responseHeaders.delete('transfer-encoding');
  responseHeaders.delete('connection');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
};
