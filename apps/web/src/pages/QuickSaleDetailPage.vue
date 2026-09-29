<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import { useRoute, useRouter } from 'vue-router';
import { api, type QuickSaleDetail } from '../api';
import { formatDateTime } from '../utils/dateTime';

const route = useRoute();
const router = useRouter();
const batchId = computed(() => String(route.params.id));
const quickSaleId = computed(() => String(route.params.quickSaleId));
const detail = ref<QuickSaleDetail | null>(null);
const loading = ref(true);
const error = ref('');
const notFound = ref(false);
const showReverse = ref(false);
const reverseReason = ref('');
const reversing = ref(false);

const status = computed(() => detail.value?.reversalReason ? '已撤销' : detail.value?.settlement ? '已结账' : '待结账');
const statusType = computed(() => detail.value?.reversalReason ? 'default' : detail.value?.settlement ? 'success' : 'warning');
const summaryName = computed(() => detail.value?.displayName || detail.value?.items.map((item) => item.name).join(' + ') || '快速售出');
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
    detail.value = (await api.get<QuickSaleDetail>(`/batches/${batchId.value}/quick-sales/${quickSaleId.value}`)).data;
  } catch (requestError: unknown) {
    if ((requestError as { response?: { status?: number } }).response?.status === 404) notFound.value = true;
    else error.value = '快速售出详情加载失败，请重试';
  } finally {
    loading.value = false;
  }
}

function backToList() {
  void router.push(`/batches/${batchId.value}/transactions`);
}

function openSettlement() {
  if (detail.value?.settlement) void router.push(`/batches/${batchId.value}/settlements/${detail.value.settlement.id}`);
}

async function reverse() {
  if (!reverseReason.value.trim()) return showFailToast('请填写撤销原因');
  reversing.value = true;
  try {
    await api.post(`/batches/${batchId.value}/quick-sales/${quickSaleId.value}/reversals`, { reason: reverseReason.value.trim() });
    showReverse.value = false;
    showSuccessToast('已撤销');
    await load();
  } catch (requestError: unknown) {
    showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || '撤销失败');
  } finally {
    reversing.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="quick-sale-detail-page" data-ai-id="quick-sale-detail-page">
    <van-nav-bar title="快速售出详情" left-text="返回" left-arrow data-ai-id="quick-sale-detail-topbar" @click-left="backToList" />
    <div v-if="loading" class="page-state"><van-loading>正在加载</van-loading></div>
    <van-empty v-else-if="notFound" description="记录不存在或无权查看"><van-button type="primary" size="small" @click="backToList">返回交易</van-button></van-empty>
    <van-empty v-else-if="error" :description="error"><van-button type="primary" size="small" data-ai-id="quick-sale-detail-retry" @click="load">重试</van-button></van-empty>

    <main v-else-if="detail" class="content">
      <section class="summary" data-ai-id="quick-sale-detail-summary">
        <div>
          <van-tag :type="statusType" class="summary-status" data-ai-id="quick-sale-detail-status">{{ status }}</van-tag>
          <van-tag type="primary" plain class="source-tag" data-ai-id="quick-sale-detail-source">快速售出</van-tag>
          <h1>{{ summaryName }}</h1>
          <p>{{ formatDateTime(detail.occurredAt) }} 成交</p>
        </div>
        <strong>¥{{ detail.totalPrice }}</strong>
      </section>

      <h2>收款</h2>
      <section class="list" data-ai-id="quick-sale-detail-payment">
        <div class="row"><span>成交总价</span><b>¥{{ detail.totalPrice }}</b></div>
        <div class="row"><span>{{ feeLabel }}</span><b class="negative">-¥{{ detail.serviceFee }}</b></div>
        <div class="row"><span>实际收款</span><b class="positive">¥{{ detail.receivedAmount }}</b></div>
        <div class="row"><span>卖出人</span><b>{{ detail.sellerUsername }}</b></div>
        <div class="row"><span>销售渠道</span><b>{{ detail.salesChannel || '未填写' }}</b></div>
        <div class="row"><span>成交时间</span><b>{{ formatDateTime(detail.occurredAt) }}</b></div>
      </section>

      <h2>成本</h2>
      <section class="list" data-ai-id="quick-sale-detail-cost">
        <div class="row"><span>本单成本（结算口径）</span><b>¥{{ detail.consumedCost }}</b></div>
        <div class="row"><span>库存账消耗成本（系统）</span><b>¥{{ detail.inventoryConsumedCost }}</b></div>
        <div class="row"><span>毛利（未扣其他费用）</span><b :class="Number(detail.grossProfit) < 0 ? 'negative' : 'positive'">¥{{ detail.grossProfit }}</b></div>
      </section>

      <h2>商品明细</h2>
      <section data-ai-id="quick-sale-detail-items">
        <article v-for="item in detail.items" :key="item.id" class="item-row" :data-ai-id="`quick-sale-detail-item-${item.id}`">
          <div class="item-main">
            <strong>{{ item.name }}</strong>
            <small v-if="item.consumptions.length">关联库存：{{ item.consumptions.map((entry) => `${entry.productName} ×${entry.quantity}`).join('、') }}</small>
            <small v-else>未关联库存</small>
          </div>
          <div class="item-summary">
            <span>数量 <b>{{ item.quantity }} 件</b></span>
            <span>本单成本 <b>¥{{ item.cost }}</b></span>
          </div>
        </article>
      </section>

      <h2>关联费用</h2>
      <section class="list" data-ai-id="quick-sale-detail-expenses">
        <van-empty v-if="!detail.expenses.length" description="无关联费用" />
        <div v-for="expense in detail.expenses" :key="expense.id" class="row">
          <span>{{ expense.name }} · {{ expense.payerUsername }} 支付</span><b>¥{{ expense.amount }}</b>
        </div>
      </section>

      <h2>备注</h2>
      <p class="note" data-ai-id="quick-sale-detail-note">{{ detail.note || '无备注' }}</p>

      <section v-if="detail.reversalReason" class="reversal" data-ai-id="quick-sale-detail-reversal">
        <h2>撤销信息</h2>
        <div class="list">
          <div class="row"><span>撤销原因</span><b>{{ detail.reversalReason }}</b></div>
        </div>
      </section>

      <section class="settlement" data-ai-id="quick-sale-detail-settlement">
        <h2>结算</h2>
        <button v-if="detail.settlement && !detail.reversalReason" class="settlement-link" type="button" data-ai-id="quick-sale-detail-settlement-open" @click="openSettlement">
          <span><strong>已结账</strong><small>{{ formatDateTime(detail.settlement.confirmedAt) }} 纳入阶段账单</small></span>
          <van-icon name="arrow" />
        </button>
        <div v-else class="settlement-status">
          <span>{{ detail.reversalReason ? '已撤销不参与结算' : '待结账' }}</span>
          <small>{{ detail.reversalReason ? '已保留撤销记录' : '尚未纳入阶段账单' }}</small>
        </div>
      </section>

      <div v-if="!detail.reversalReason && !detail.settlement" class="footer">
        <van-button block type="danger" :loading="reversing" data-ai-id="quick-sale-detail-reverse" @click="showReverse = true">撤销这笔售出</van-button>
      </div>
    </main>

    <van-dialog v-model:show="showReverse" title="撤销快速售出" show-cancel-button :show-confirm-button="false" data-ai-id="quick-sale-reverse-dialog">
      <template #default>
        <div class="reverse-form"><van-field v-model="reverseReason" label="撤销原因" type="textarea" rows="2" placeholder="请填写原因" /></div>
      </template>
      <template #footer>
        <div class="dialog-actions">
          <van-button plain @click="showReverse = false">取消</van-button>
          <van-button type="danger" :loading="reversing" data-ai-id="quick-sale-reverse-confirm" @click="reverse">确认撤销</van-button>
        </div>
      </template>
    </van-dialog>
  </div>
</template>

<style scoped>
.quick-sale-detail-page { min-height: 100vh; padding-bottom: 24px; background: #f5f7fb; }
.content { padding: 20px 16px 32px; }
.summary { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px; border-radius: 12px; background: #fff; box-shadow: 0 1px 0 #e4e8f0; }
.summary :deep(.summary-status) { margin-right: 8px; }.summary :deep(.source-tag) { margin: 0; }.summary h1 { margin: 8px 0 4px; font-size: 21px; line-height: 1.35; }
.summary p { margin: 0; color: #71809a; font-size: 12px; }
.summary > strong { font-size: 21px; white-space: nowrap; }
h2 { margin: 24px 0 9px; font-size: 17px; }
.list { overflow: hidden; border-radius: 10px; background: #fff; box-shadow: 0 1px 0 #e4e8f0; }
.row { display: flex; min-height: 54px; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-bottom: 1px solid #edf0f5; }
.row:last-child { border-bottom: 0; }
.row > span { flex: 1; color: #62708a; }
.row b { max-width: 58%; overflow-wrap: anywhere; text-align: right; font-size: 13px; }
.positive { color: #168246; }
.negative { color: #b42318; }
.item-row { display: flex; min-height: 70px; align-items: center; gap: 12px; padding: 10px 12px; margin: 8px 0; border-radius: 10px; background: #fff; box-shadow: 0 1px 0 #e4e8f0; }
.item-main { min-width: 0; flex: 1; }
.item-row strong, .item-row small { display: block; }
.item-row strong { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
.item-row small { margin-top: 4px; color: #71809a; font-size: 12px; }
.item-summary { display: grid; flex: 0 0 96px; gap: 5px; color: #71809a; font-size: 12px; text-align: right; }
.item-summary span { white-space: nowrap; }
.item-summary b { margin-left: 4px; color: #1f2a44; font-size: 13px; }
.note { margin: 0; padding: 12px; border-radius: 10px; background: #fff; color: #536078; white-space: pre-wrap; box-shadow: 0 1px 0 #e4e8f0; }
.settlement-link { display: flex; width: 100%; min-height: 58px; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 0; border-radius: 10px; background: #edf1ff; color: #2949aa; text-align: left; font: inherit; }
.settlement-link small { display: block; margin-top: 3px; color: #536bb4; font-size: 12px; }
.settlement-status { padding: 12px; border-radius: 10px; background: #fff; box-shadow: 0 1px 0 #e4e8f0; }
.settlement-status span, .settlement-status small { display: block; }
.settlement-status small { margin-top: 4px; color: #71809a; font-size: 12px; }
.reversal h2 { color: #b42318; }
.footer { margin-top: 24px; }
.footer :deep(.van-button) { min-height: 44px; }
.dialog-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 12px; }
.dialog-actions :deep(.van-button) { min-height: 44px; }
.page-state { display: grid; min-height: 60vh; place-items: center; }
</style>
