import axios from 'axios';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api', withCredentials: true });
api.interceptors.response.use(undefined, (error) => {
  if (error.response?.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }
  return Promise.reject(error);
});

export type ProductImage = { assetId: string; position: number; url: string | null };
export type Product = { id: string; name: string; description: string | null; referencePrice: string | null; firstImage: string | null; images: ProductImage[]; createdAt: string; updatedAt: string };
export type InventoryItem = { productId: string; productName: string; availableQuantity: number; totalCost: string; purchaseCount: number };
export type PurchaseCostShare = { userId: string; username: string; amount: string };
export type InventoryPurchase = { id: string; productId: string; channelId: string; quantity: number; totalCost: string; occurredAt: string; sourceUrl: string | null; note: string | null; channelName: string; payerUserId: string; payerUsername: string; costShares: PurchaseCostShare[]; hasSales?: boolean; hasInventoryAdjustments?: boolean; corrections?: Array<{ id: string; reason: string; createdAt: string; createdByUsername: string }> };
export type InventoryAdjustment = { id: string; quantity: number; consumedCost: string; reason: string; createdAt: string; createdByUsername: string };
export type InventoryDetail = InventoryItem & { purchases: InventoryPurchase[]; adjustments: InventoryAdjustment[] };
export type ManualChannel = { id: string; name: string };
export type Sale = { id: string; productId: string; productName: string; quantity: number; totalPrice: string; consumedCost: string; salesChannel: string | null; feeMode: 'percentage' | 'amount' | null; feeRate: number | null; serviceFee: string; receivedAmount: string; sellerUserId: string; sellerUsername: string; occurredAt: string; note: string | null; createdAt: string; reversalReason: string | null; reversedAt: string | null; settled: boolean };
export type Expense = { id: string; saleId: string | null; type: 'shipping' | 'custom'; name: string; amount: string; payerUserId: string; payerUsername: string; occurredAt: string; note: string | null; createdAt: string; reversalReason: string | null; reversedAt: string | null; settled: boolean };
export type SettlementMember = { id: string; username: string };
export type SettlementSale = { id: string; productId: string; productName: string; quantity: number; totalPrice: string; consumedCost: string; serviceFee: string; sellerUserId: string; sellerUsername: string; occurredAt: string };
export type SettlementExpense = { id: string; saleId: string | null; name: string; amount: string; payerUserId: string; payerUsername: string; occurredAt: string };
export type SettlementResultMember = { userId: string; username: string; costShare: string; costRecovery: string; salesReceived: string; purchasesPaid: string; expensesPaid: string; profitPercentage: number; profitAmount: string; net: string; direction: 'receivable' | 'payable' | 'settled' };
export type SettlementPreview = { saleTotal: string; serviceFeeTotal: string; expenseTotal: string; costTotal: string; profitTotal: string; isLoss: boolean; members: SettlementResultMember[]; transfers: Array<{ payerUserId: string; payerUsername: string; payeeUserId: string; payeeUsername: string; amount: string }> };
export type SettlementSummary = { id: string; confirmedAt: string; profitTotal: string; saleCount: number };
export type SettlementAdjustmentSummary = { id: string; settlementBillId?: string; status: 'pending' | 'confirmed'; createdAt: string; oldCost: string; newCost: string };
export type SettlementIndex = { unsettledSaleCount: number; canManage: boolean; bills: SettlementSummary[]; adjustments: SettlementAdjustmentSummary[] };
export type SettlementDetail = SettlementPreview & { id: string; confirmedAt: string; sales: SettlementSale[]; expenses: SettlementExpense[]; adjustments: SettlementAdjustmentSummary[] };
export type SettlementAdjustmentDetail = { id: string; settlementBillId: string; status: 'pending' | 'confirmed'; canManage: boolean; createdAt: string; confirmedAt: string | null; oldCost: string; newCost: string; members: Array<{ userId: string; username: string; oldCost: string; newCost: string; oldPaid: string; newPaid: string; netDelta: string; direction: 'receivable' | 'payable' | 'settled' }>; transfers: Array<{ payerUserId: string; payerUsername: string; payeeUserId: string; payeeUsername: string; amount: string }> };
export type ReportType = 'inventory' | 'sales' | 'profit' | 'members' | 'unsettled';
export type ReportSummary = { key: string; label: string; value: string };
export type ReportResult = { reportType: ReportType; workspaceId: string; batchId: string | null; from: string | null; to: string | null; generatedAt: string; summary: ReportSummary[]; rows: Array<Record<string, string | number | boolean | null>> };
export type AuditResponse = { items: Array<{ id: string; action: string; entity_type: string; entity_id: string | null; actor_username?: string | null; created_at: string }>; total: number; page: number; pageSize: number };

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
