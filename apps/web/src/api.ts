import axios from 'axios';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(undefined, (error) => {
  if (error.response?.status === 401) {
    localStorage.removeItem('accessToken');
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }
  return Promise.reject(error);
});

export async function uploadImage(file: File): Promise<string> {
  const { data } = await api.post<{ assetId: string; objectKey: string; uploadUrl: string }>('/assets/presign', { fileName: file.name, contentType: file.type, sizeBytes: file.size });
  await axios.put(data.uploadUrl, file, { headers: { 'Content-Type': file.type } });
  await api.post('/assets/complete', { assetId: data.assetId, objectKey: data.objectKey, originalName: file.name, contentType: file.type, sizeBytes: file.size });
  const url = await api.get<{ url: string }>(`/assets/${data.assetId}/url`);
  return url.data.url;
}
