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
export type InventoryItem = { productId: string; productName: string; availableQuantity: number; totalCost: string; purchaseCount: number };
export type PurchaseCostShare = { userId: string; username: string; amount: string };
export type InventoryPurchase = { id: string; productId: string; channelId: string; quantity: number; totalCost: string; purchasedOn: string; sourceUrl: string | null; note: string | null; channelName: string; payerUserId: string; payerUsername: string; costShares: PurchaseCostShare[] };
export type InventoryAdjustment = { id: string; quantity: number; consumedCost: string; reason: string; createdAt: string; createdByUsername: string };
export type InventoryDetail = InventoryItem & { purchases: InventoryPurchase[]; adjustments: InventoryAdjustment[] };
export type ManualChannel = { id: string; name: string };
export type Sale = { id: string; productId: string; productName: string; quantity: number; totalPrice: string; consumedCost: string; sellerUserId: string; sellerUsername: string; occurredAt: string; note: string | null; createdAt: string; reversalReason: string | null; reversedAt: string | null };
export type Expense = { id: string; saleId: string | null; type: 'shipping' | 'custom'; name: string; amount: string; payerUserId: string; payerUsername: string; occurredAt: string; note: string | null; createdAt: string; reversalReason: string | null; reversedAt: string | null };

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
