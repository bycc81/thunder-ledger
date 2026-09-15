<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type SettlementDetail } from '../api'
import { formatDateTime } from '../utils/dateTime'
const route = useRoute()
const router = useRouter()
const batchId = computed(() => String(route.params.id))
const settlementId = computed(() => String(route.params.settlementId))
const detail = ref<SettlementDetail | null>(null)
const loading = ref(true)
const error = ref('')
async function load() {
  loading.value = true
  error.value = ''
  try {
    detail.value = (await api.get<SettlementDetail>(`/batches/${batchId.value}/settlements/${settlementId.value}`)).data
  } catch {
    error.value = '账单详情加载失败，请重试'
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>
<template>
  <div class="settlement-detail-page" data-ai-id="settlement-detail-page">
    <van-nav-bar title="账单详情" left-text="返回" left-arrow @click-left="router.push(`/batches/${batchId}/settlements`)" />
    <div v-if="loading" class="state"><van-loading /></div>
    <van-empty v-else-if="error" :description="error"><van-button type="primary" size="small" @click="load">重试</van-button></van-empty>
    <main v-else-if="detail" class="content">
      <p class="muted">已确认 · {{ formatDateTime(detail.confirmedAt) }}</p>
      <div class="summary">
        <div>
          <small>销售额</small><strong>¥{{ detail.saleTotal }}</strong>
        </div>
        <div>
          <small>费用</small><strong>¥{{ detail.expenseTotal }}</strong>
        </div>
        <div>
          <small>商品成本</small><strong>¥{{ detail.costTotal }}</strong>
        </div>
        <div>
          <small>本次{{ detail.isLoss ? '亏损' : '利润' }}</small
          ><strong :class="{ loss: detail.isLoss }">¥{{ detail.profitTotal }}</strong>
        </div>
      </div>
      <h2>参与人结果</h2>
      <section class="list">
        <article v-for="member in detail.members" :key="member.userId" class="row">
          <div>
            <strong>{{ member.username }}</strong
            ><small>承担成本 ¥{{ member.costShare }} · 采购付款 ¥{{ member.purchasesPaid }} · 利润 {{ member.profitPercentage }}%（¥{{ member.profitAmount }}）</small>
          </div>
          <b :class="member.direction">{{
            member.direction === 'receivable' ? `应收 ¥${member.net}` : member.direction === 'payable' ? `应付 ¥${member.net.replace('-', '')}` : '已结清'
          }}</b>
        </article>
      </section>
      <h2>转账建议</h2>
      <section class="list">
        <van-empty v-if="!detail.transfers.length" description="无需转账" />
        <div v-for="transfer in detail.transfers" :key="`${transfer.payerUserId}-${transfer.payeeUserId}`" class="row">
          <span>{{ transfer.payerUsername }} 给 {{ transfer.payeeUsername }}</span
          ><b>¥{{ transfer.amount }}</b>
        </div>
      </section>
      <h2>关联调整单</h2>
      <section class="list" data-ai-id="settlement-bill-adjustments">
        <van-empty v-if="!detail.adjustments.length" description="暂无关联调整单" /><button
          v-for="item in detail.adjustments"
          :key="item.id"
          class="row adjustment-link"
          :data-ai-id="`settlement-adjustment-${item.id}`"
          @click="router.push(`/batches/${batchId}/settlement-adjustments/${item.id}`)"
        >
          <span>调整单 · {{ item.status === 'pending' ? '待确认' : '已确认' }}</span
          ><b>¥{{ item.oldCost }} → ¥{{ item.newCost }}</b>
        </button>
      </section>
      <h2>纳入销售</h2>
      <section class="list">
        <div v-for="sale in detail.sales" :key="sale.id" class="row">
          <div>
            <strong>{{ sale.productName }} · {{ sale.quantity }} 件</strong><small>{{ formatDateTime(sale.occurredAt) }} · {{ sale.sellerUsername }} 收款</small>
          </div>
          <b>¥{{ sale.totalPrice }}</b>
        </div>
      </section>
    </main>
  </div>
</template>
<style scoped>
.settlement-detail-page {
  min-height: 100vh;
  background: #f5f7fb;
}
.settlement-detail-page :deep(.van-nav-bar) {
  position: sticky;
  top: 0;
  z-index: 2;
}
.content {
  padding: 20px 16px 32px;
}
.muted {
  margin: 0 0 14px;
  color: #71809a;
  font-size: 12px;
}
.summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  overflow: hidden;
  border-radius: 10px;
  background: #e4e8f0;
}
.summary div {
  padding: 12px;
  background: #fff;
}
.summary small,
.summary strong {
  display: block;
}
.summary small {
  color: #71809a;
  font-size: 12px;
}
.summary strong {
  margin-top: 6px;
  font-size: 17px;
}
.content h2 {
  margin: 24px 0 9px;
  font-size: 17px;
}
.list {
  overflow: hidden;
  border-radius: 10px;
  background: #fff;
}
.row {
  display: flex;
  width: 100%;
  min-height: 62px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid #e4e8f0;
  background: #fff;
  color: #172033;
  text-align: left;
  font: inherit;
}
.row:last-child {
  border: 0;
}
.row div {
  min-width: 0;
}
.row strong,
.row small {
  display: block;
}
.row small {
  margin-top: 5px;
  color: #71809a;
  font-size: 12px;
  line-height: 1.45;
}
.row b {
  white-space: nowrap;
  font-size: 13px;
}
.loss,
.payable {
  color: #b42318;
}
.receivable {
  color: #15803d;
}
.state {
  display: grid;
  min-height: 60vh;
  place-items: center;
}
</style>
