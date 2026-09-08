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

export type ProductImage = { assetId: string; position: number; url: string | null };
export type Product = { id: string; name: string; description: string | null; referencePrice: string | null; firstImage: string | null; images: ProductImage[]; createdAt: string; updatedAt: string };

export async function uploadWorkspaceImage(workspaceId: string, file: File, onPrepared?: (assetId: string) => void): Promise<ProductImage> {
  const { data } = await api.post<{ assetId: string; objectKey: string; uploadUrl: string }>(`/workspaces/${workspaceId}/assets/presign`, { fileName: file.name, contentType: file.type, sizeBytes: file.size });
  onPrepared?.(data.assetId);
  await axios.put(data.uploadUrl, file, { headers: { 'Content-Type': file.type } });
  await api.post(`/workspaces/${workspaceId}/assets/complete`, { assetId: data.assetId, objectKey: data.objectKey, originalName: file.name, contentType: file.type, sizeBytes: file.size });
  const url = await api.get<{ url: string }>(`/workspaces/${workspaceId}/assets/${data.assetId}/url`);
  return { assetId: data.assetId, position: 0, url: url.data.url };
}

export async function deleteWorkspaceImage(workspaceId: string, assetId: string): Promise<void> {
  await api.delete(`/workspaces/${workspaceId}/assets/${assetId}`);
}
