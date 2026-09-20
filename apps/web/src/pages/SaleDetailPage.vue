<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type SaleDetail } from '../api';
import { formatDateTime } from '../utils/dateTime';

const route = useRoute();
const router = useRouter();
const batchId = computed(() => String(route.params.id));
const saleId = computed(() => String(route.params.saleId));
const detail = ref<SaleDetail | null>(null);
const loading = ref(true);
const error = ref('');
const notFound = ref(false);

const status = computed(() => detail.value?.reversalReason ? '已撤销' : detail.value?.settlement ? '已结账' : '待结账');
const statusType = computed(() => detail.value?.reversalReason ? 'default' : detail.value?.settlement ? 'success' : 'warning');
const feeLabel = computed(() => {
  if (!detail.value?.feeMode) return '平台手续费';
  if (detail.value.feeMode === 'percentage') return `平台手续费（按比例 ${detail.value.feeRate?.toFixed(2) ?? '0.00'}%）`;
  return '平台手续费（按金额）';
});

async function load() {
  loading.value = true;
  error.value = '';
  notFound.value = false;
  try {
    detail.value = (await api.get<SaleDetail>(`/batches/${batchId.value}/sales/${saleId.value}`)).data;
  } catch (requestError: unknown) {
    if ((requestError as { response?: { status?: number } }).response?.status === 404) notFound.value = true;
    else error.value = '销售详情加载失败，请重试';
  } finally {
    loading.value = false;
  }
}

function backToTransactions() {
  void router.push(`/batches/${batchId.value}/transactions`);
}

function openSettlement() {
  if (detail.value?.settlement) void router.push(`/batches/${batchId.value}/settlements/${detail.value.settlement.id}`);
}

onMounted(load);
</script>

<template>
  <div class="sale-detail-page" data-ai-id="sale-detail-page">
    <van-nav-bar title="销售详情" left-text="返回" left-arrow data-ai-id="sale-detail-topbar" @click-left="backToTransactions" />
    <div v-if="loading" class="page-state" data-ai-id="sale-detail-loading"><van-loading>正在加载销售详情</van-loading></div>
    <van-empty v-else-if="notFound" description="销售记录不存在或无权查看" data-ai-id="sale-detail-not-found"><van-button type="primary" size="small" @click="backToTransactions">返回交易</van-button></van-empty>
    <van-empty v-else-if="error" :description="error" data-ai-id="sale-detail-error"><van-button type="primary" size="small" data-ai-id="sale-detail-retry" @click="load">重试</van-button></van-empty>
    <main v-else-if="detail" class="content">
      <section class="summary" data-ai-id="sale-detail-summary">
        <div>
          <van-tag :type="statusType" data-ai-id="sale-detail-status">{{ status }}</van-tag>
          <h1>{{ detail.productName }} · {{ detail.quantity }} 件</h1>
          <p>{{ formatDateTime(detail.occurredAt) }} 成交</p>
        </div>
        <strong>¥{{ detail.totalPrice }}</strong>
      </section>

      <h2>收款</h2>
      <section class="list" data-ai-id="sale-detail-payment">
        <div class="row"><span>成交总价</span><b>¥{{ detail.totalPrice }}</b></div>
        <div class="row"><span>{{ feeLabel }}</span><b class="negative">-¥{{ detail.serviceFee }}</b></div>
        <div class="row"><span>实际收款</span><b class="positive">¥{{ detail.receivedAmount }}</b></div>
        <div class="row"><span>卖出人</span><b>{{ detail.sellerUsername }}</b></div>
        <div class="row"><span>销售渠道</span><b>{{ detail.salesChannel || '未填写' }}</b></div>
        <div class="row"><span>成交时间</span><b>{{ formatDateTime(detail.occurredAt) }}</b></div>
      </section>

      <h2>成本</h2>
      <section class="list" data-ai-id="sale-detail-cost">
        <div class="row"><span>销售成本</span><b>¥{{ detail.consumedCost }}</b></div>
        <div class="row"><span>销售毛利（未扣其他费用）</span><b :class="Number(detail.grossProfit) < 0 ? 'negative' : 'positive'">¥{{ detail.grossProfit }}</b></div>
      </section>

      <h2>关联其他费用</h2>
      <section class="list" data-ai-id="sale-detail-expenses">
        <van-empty v-if="!detail.expenses.length" description="无关联其他费用" />
        <article v-for="expense in detail.expenses" :key="expense.id" class="expense-row" :data-ai-id="`sale-detail-expense-${expense.id}`">
          <div><strong>{{ expense.name }} · ¥{{ expense.amount }}</strong><small>{{ expense.payerUsername }} 支付 · {{ formatDateTime(expense.occurredAt) }}{{ expense.reversalReason ? ` · 撤销原因：${expense.reversalReason}` : '' }}</small></div>
          <van-tag v-if="expense.reversalReason" type="default">已撤销</van-tag>
        </article>
      </section>

      <h2>备注</h2>
      <p class="note" data-ai-id="sale-detail-note">{{ detail.note || '无备注' }}</p>

      <section v-if="detail.reversalReason" class="reversal" data-ai-id="sale-detail-reversal">
        <h2>撤销信息</h2>
        <div class="list"><div class="row"><span>撤销原因</span><b>{{ detail.reversalReason }}</b></div><div class="row"><span>撤销时间</span><b>{{ detail.reversedAt ? formatDateTime(detail.reversedAt) : '--' }}</b></div></div>
      </section>

      <section class="settlement" data-ai-id="sale-detail-settlement">
        <h2>结算</h2>
        <button v-if="detail.settlement && !detail.reversalReason" class="settlement-link" type="button" data-ai-id="sale-detail-settlement-open" @click="openSettlement"><span><strong>已结账</strong><small>{{ formatDateTime(detail.settlement.confirmedAt) }} 纳入阶段账单</small></span><van-icon name="arrow" /></button>
        <div v-else class="settlement-status"><span>{{ detail.reversalReason ? '已撤销销售不参与结算' : '待结账' }}</span><small>{{ detail.reversalReason ? '已保留撤销记录' : '尚未纳入阶段账单' }}</small></div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.sale-detail-page { min-height:100vh; padding-bottom:24px; background:#f5f7fb; }
.sale-detail-page :deep(.van-nav-bar) { position:sticky; top:0; z-index:2; }
.content { padding:20px 16px 32px; }
.summary { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:16px; border-radius:12px; background:#fff; box-shadow:0 1px 0 #e4e8f0; }
.summary h1 { margin:8px 0 4px; font-size:21px; line-height:1.35; }
.summary p { margin:0; color:#71809a; font-size:12px; }
.summary > strong { flex:0 0 auto; font-size:21px; white-space:nowrap; }
h2 { margin:24px 0 9px; font-size:17px; }
.list { overflow:hidden; border-radius:10px; background:#fff; box-shadow:0 1px 0 #e4e8f0; }
.row,.expense-row { display:flex; min-height:54px; align-items:center; justify-content:space-between; gap:12px; padding:10px 12px; border-bottom:1px solid #edf0f5; }
.row:last-child,.expense-row:last-child { border-bottom:0; }
.row > span { flex:1; color:#62708a; }
.row b { max-width:58%; overflow-wrap:anywhere; text-align:right; font-size:13px; }
.positive { color:#168246; }.negative { color:#b42318; }
.expense-row > div { min-width:0; }.expense-row strong,.expense-row small { display:block; }.expense-row small { margin-top:4px; color:#71809a; font-size:12px; }
.note { margin:0; padding:12px; border-radius:10px; background:#fff; color:#536078; white-space:pre-wrap; box-shadow:0 1px 0 #e4e8f0; }
.settlement-link { display:flex; width:100%; min-height:58px; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border:0; border-radius:10px; background:#edf1ff; color:#2949aa; text-align:left; font:inherit; }.settlement-link small { display:block; margin-top:3px; color:#536bb4; font-size:12px; }
.settlement-status { padding:12px; border-radius:10px; background:#fff; box-shadow:0 1px 0 #e4e8f0; }.settlement-status span,.settlement-status small { display:block; }.settlement-status small { margin-top:4px; color:#71809a; font-size:12px; }
.page-state { display:grid; min-height:60vh; place-items:center; }
</style>
