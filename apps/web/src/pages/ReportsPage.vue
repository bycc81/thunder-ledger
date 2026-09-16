<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRouter } from 'vue-router';
import { api, type ReportResult, type ReportType } from '../api';
import MobileShell from '../layouts/MobileShell.vue';
import { useWorkspaceStore } from '../stores/workspace';
import { formatDateTime } from '../utils/dateTime';

type Page = 'overview' | 'products' | 'batches' | 'members' | 'audit' | 'profile';
const router = useRouter();
const store = useWorkspaceStore();
const reportType = ref<ReportType>('sales');
const batchId = ref('');
const from = ref('');
const to = ref('');
const result = ref<ReportResult | null>(null);
const loading = ref(false);
const exporting = ref(false);
const error = ref('');
const permissionDenied = ref(false);
const showWorkspace = ref(false);
const showExport = ref(false);

const reportOptions = [
  { text: '销售报表', value: 'sales' },
  { text: '库存报表', value: 'inventory' },
  { text: '利润报表', value: 'profit' },
  { text: '成员贡献', value: 'members' },
  { text: '待结算', value: 'unsettled' },
];
const currentReportLabel = computed(() => reportOptions.find((item) => item.value === reportType.value)?.text ?? '报表');
const canQuery = computed(() => Boolean(store.selectedWorkspaceId) && !loading.value && !exporting.value);

function navigate(page: Page) { void router.push(page === 'overview' ? '/workspace' : `/${page}`); }
async function selectWorkspace(id: string) { showWorkspace.value = false; await store.select(id); batchId.value = ''; result.value = null; error.value = ''; permissionDenied.value = false; }
function queryParams() {
  return {
    workspaceId: store.selectedWorkspaceId,
    batchId: batchId.value || undefined,
    reportType: reportType.value,
    from: from.value || undefined,
    to: to.value || undefined,
  };
}
async function load() {
  if (!canQuery.value) return;
  loading.value = true; error.value = ''; permissionDenied.value = false;
  try { result.value = (await api.get<ReportResult>('/reports', { params: queryParams() })).data; }
  catch (requestError: unknown) {
    result.value = null;
    const response = requestError as { response?: { status?: number; data?: { message?: string } } };
    permissionDenied.value = response.response?.status === 403;
    error.value = response.response?.data?.message || '报表加载失败，请重试';
  }
  finally { loading.value = false; }
}
async function exportCsv() {
  exporting.value = true;
  try {
    const response = await api.get<Blob>('/reports/export', { params: queryParams(), responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `thunderledger-${reportType.value}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showExport.value = false;
    showSuccessToast('CSV 已导出');
  } catch { showFailToast('导出失败，请重试'); }
  finally { exporting.value = false; }
}
function rowEntries(row: Record<string, string | number | boolean | null>) {
  const labels: Record<string, string> = {
    batchName: '批次', productName: '商品', quantity: '数量', totalPrice: '销售额', consumedCost: '销售成本',
    grossProfit: '销售利润（未扣费用）', sellerUsername: '卖出人', occurredAt: '发生时间', settled: '已结算',
    purchaseQuantity: '采购数量', soldQuantity: '销售数量', adjustedQuantity: '减少库存', availableQuantity: '可卖数量',
    purchaseCost: '采购成本', soldCost: '销售成本', adjustedCost: '减少成本', remainingCost: '剩余成本',
    salesTotal: '销售额', expenseTotal: '费用', costTotal: '销售成本', profitTotal: '利润',
    settledSales: '已结算销售额', unsettledSales: '待结算销售额', username: '成员', salesQuantity: '销售数量',
    contribution: '贡献额', purchaseTotal: '采购支付', saleCount: '未结算销售笔数', saleTotal: '未结算销售额',
    expenseCount: '未结算费用笔数', unsettledProfit: '未结算毛利',
  };
  const hiddenKeys = new Set(['batchId', 'productId', 'saleId', 'userId', 'reportRowId']);
  return Object.entries(row).filter(([key]) => !key.endsWith('Tenths') && !hiddenKeys.has(key)).map(([key, value]) => ({
    key, label: labels[key] ?? key, value: key === 'occurredAt' && value ? formatDateTime(String(value)) : key === 'settled' ? (value ? '是' : '否') : String(value ?? '--'),
  }));
}
function summaryId(key: string) {
  return `report-summary-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}
watch([reportType, batchId, from, to], () => {
  result.value = null;
  error.value = '';
  permissionDenied.value = false;
});
onMounted(async () => { if (!store.workspaces.length) await store.load(); });
</script>

<template>
  <MobileShell page="overview" :workspace-name="store.selectedWorkspace?.name" @open-workspace="showWorkspace = true" @navigate="navigate">
    <section class="reports-page" data-ai-id="b5-report-page">
      <header class="page-heading"><div><span class="eyebrow">当前工作区</span><h1>报表</h1></div></header>
      <section class="filter-panel" data-ai-id="report-filter">
        <van-dropdown-menu>
          <van-dropdown-item v-model="reportType" :options="reportOptions" data-ai-id="report-type-selector" />
          <van-dropdown-item v-model="batchId" :options="[{ text: '全部批次', value: '' }, ...store.batches.map((batch) => ({ text: batch.name, value: batch.id }))]" data-ai-id="report-batch-selector" />
        </van-dropdown-menu>
        <div class="date-fields" data-ai-id="report-date-range">
          <input v-model="from" type="date" aria-label="开始日期">
          <span>至</span>
          <input v-model="to" type="date" aria-label="结束日期">
        </div>
        <div class="filter-actions">
          <van-button type="primary" block :loading="loading" :disabled="!canQuery" data-ai-id="report-query" @click="load">查询</van-button>
          <van-button plain block :loading="exporting" :disabled="!result || loading || exporting" data-ai-id="report-export" @click="showExport = true">导出 CSV</van-button>
        </div>
      </section>
      <div v-if="loading" class="page-state" data-ai-id="report-loading"><van-loading>正在加载报表</van-loading></div>
      <van-empty v-else-if="permissionDenied" description="当前工作区或批次无权查看报表" data-ai-id="report-permission"><van-button type="primary" size="small" @click="showWorkspace = true">切换工作区</van-button></van-empty>
      <van-empty v-else-if="error" :description="error" data-ai-id="report-error"><van-button type="primary" size="small" @click="load">重试</van-button></van-empty>
      <van-empty v-else-if="result && !result.rows.length" description="当前范围暂无数据" data-ai-id="report-empty" />
      <template v-else-if="result">
        <section class="summary" data-ai-id="report-summary">
          <div v-for="item in result.summary" :key="item.key" class="summary-item" :data-ai-id="summaryId(item.key)"><small>{{ item.label }}</small><strong>{{ item.value }}</strong></div>
        </section>
        <section class="result-section" data-ai-id="report-result-list">
          <div class="result-heading"><h2>{{ currentReportLabel }}</h2><span>{{ formatDateTime(result.generatedAt) }}</span></div>
          <article v-for="(row, index) in result.rows" :key="String(row.reportRowId ?? `${index}-${row.batchName ?? ''}`)" class="result-item" :data-ai-id="`report-result-item-${String(row.reportRowId ?? index)}`">
            <div v-for="entry in rowEntries(row)" :key="entry.key" class="result-field"><small>{{ entry.label }}</small><strong>{{ entry.value }}</strong></div>
          </article>
        </section>
      </template>
    </section>
  </MobileShell>

  <van-popup v-model:show="showWorkspace" position="bottom" round data-ai-id="workspace-picker">
    <van-cell title="切换工作区" />
    <van-cell v-for="workspace in store.workspaces" :key="workspace.id" :title="workspace.name" :label="workspace.role" is-link :data-ai-id="`workspace-option-${workspace.id}`" @click="selectWorkspace(workspace.id)" />
  </van-popup>
  <van-popup v-model:show="showExport" position="bottom" round closeable data-ai-id="report-export-dialog">
    <section class="export-sheet">
      <h2>导出报表</h2>
      <p class="dialog-copy">将导出当前报表类型和筛选范围内的数据。</p>
      <div class="export-actions">
        <van-button plain block data-ai-id="report-export-cancel" @click="showExport = false">取消</van-button>
        <van-button type="primary" block :loading="exporting" data-ai-id="report-export-confirm" @click="exportCsv">确认导出</van-button>
      </div>
    </section>
  </van-popup>
</template>

<style scoped>
.reports-page { padding-bottom:8px; }
.page-heading { margin-bottom:14px; }
.page-heading h1 { margin:0; font-size:24px; }
.eyebrow { display:block; margin-bottom:4px; color:#8993a7; font-size:11px; }
.filter-panel { display:grid; gap:10px; margin-bottom:16px; }
.filter-panel :deep(.van-dropdown-menu__bar) { height:44px; border:1px solid #d8dde8; border-radius:10px; box-shadow:none; }
.filter-panel :deep(.van-dropdown-menu) { overflow:hidden; border-radius:10px; }
.date-fields { display:flex; align-items:center; gap:8px; color:#71809a; font-size:13px; }
.date-fields input { width:100%; min-width:0; min-height:44px; padding:0 9px; border:1px solid #d8dde8; border-radius:8px; background:#fff; color:#172033; }
.filter-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.filter-actions :deep(.van-button) { min-height:44px; }
.summary { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; overflow:hidden; margin-bottom:20px; border-radius:10px; background:#e4e8f0; }
.summary-item { min-width:0; padding:12px 10px; background:#fff; }
.summary-item small,.result-field small { display:block; color:#71809a; font-size:11px; }
.summary-item strong { display:block; overflow:hidden; margin-top:5px; color:#172033; font-size:18px; text-overflow:ellipsis; white-space:nowrap; }
.result-heading { display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin-bottom:9px; }
.result-heading h2 { margin:0; font-size:17px; }
.result-heading span { color:#8993a7; font-size:11px; }
.result-item { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:8px; padding:12px; border-radius:10px; background:#fff; box-shadow:0 1px 0 #e4e8f0; }
.result-field { min-width:0; }
.result-field strong { display:block; overflow:hidden; margin-top:4px; color:#172033; font-size:13px; text-overflow:ellipsis; white-space:nowrap; }
.result-field:first-child strong { font-size:15px; }
.page-state { display:grid; min-height:45vh; place-items:center; }
.dialog-copy { margin:0; padding:0 16px 12px; color:#536078; font-size:13px; line-height:1.5; }
.export-sheet { padding:20px 16px 16px; }
.export-sheet h2 { margin:0; color:#172033; font-size:18px; }
.export-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.export-actions :deep(.van-button) { min-height:44px; }
</style>
