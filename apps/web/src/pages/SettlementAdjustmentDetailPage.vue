<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { showFailToast, showSuccessToast } from 'vant'
import { useRoute, useRouter } from 'vue-router'
import { api, type SettlementAdjustmentDetail } from '../api'
const route = useRoute()
const router = useRouter()
const batchId = computed(() => String(route.params.id))
const adjustmentId = computed(() => String(route.params.adjustmentId))
const detail = ref<SettlementAdjustmentDetail | null>(null)
const loading = ref(true)
const confirming = ref(false)
const error = ref('')
function amountChange(oldValue: string, newValue: string): string {
  const change = Math.round((Number(newValue) - Number(oldValue)) * 10) / 10
  if (change > 0) return `+${change.toFixed(1)}`
  if (change < 0) return change.toFixed(1)
  return '0.0'
}
function signedAmount(value: string): string {
  const amount = Number(value)
  if (amount > 0) return `+${amount.toFixed(1)}`
  if (amount < 0) return `-${Math.abs(amount).toFixed(1)}`
  return '0.0'
}
function payableAmount(value: string): string {
  return Math.abs(Number(value)).toFixed(1)
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    detail.value = (await api.get<SettlementAdjustmentDetail>(`/batches/${batchId.value}/settlement-adjustments/${adjustmentId.value}`)).data
  } catch {
    error.value = '调整单加载失败，请重试'
  } finally {
    loading.value = false
  }
}
async function confirm() {
  confirming.value = true
  try {
    await api.post(`/batches/${batchId.value}/settlement-adjustments/${adjustmentId.value}/confirm`)
    showSuccessToast('调整单已确认')
    await load()
  } catch {
    showFailToast('确认失败，请刷新后重试')
  } finally {
    confirming.value = false
  }
}
onMounted(load)
</script>
<template>
  <div class="adjustment-page" data-ai-id="settlement-adjustment-detail-page">
    <van-nav-bar title="结算调整单" left-text="返回" left-arrow @click-left="router.push(`/batches/${batchId}/settlements`)" />
    <div v-if="loading" class="state"><van-loading /></div>
    <van-empty v-else-if="error" :description="error"><van-button size="small" type="primary" @click="load">重试</van-button></van-empty>
    <main v-else-if="detail" class="content">
      <p class="muted">关联原账单 · {{ detail.status === 'pending' ? '待确认' : '已确认' }}</p>
      <section class="card impact-card" data-ai-id="settlement-adjustment-impact-summary">
        <small>更正影响</small>
        <strong>受影响销售成本 ¥{{ detail.oldCost }} → ¥{{ detail.newCost }}</strong>
        <p class="impact-change">成本差额 <b>{{ signedAmount(amountChange(detail.oldCost, detail.newCost)) }}</b></p>
        <span class="impact-note">上述内容仅用于计算本次调整，不代表新增采购付款；实际转账请以“转账建议”为准。</span>
      </section>
      <h2>成员差额</h2>
      <section class="list" data-ai-id="settlement-adjustment-member-list">
        <div v-for="member in detail.members" :key="member.userId" class="row">
          <span
            ><strong>{{ member.username }}</strong
            ><small>成本承担 ¥{{ member.oldCost }} → ¥{{ member.newCost }}（{{ signedAmount(amountChange(member.oldCost, member.newCost)) }}）</small
            ><small>采购付款分摊 ¥{{ member.oldPaid }} → ¥{{ member.newPaid }}（{{ signedAmount(amountChange(member.oldPaid, member.newPaid)) }}）</small></span
          ><b :class="member.direction">{{ member.direction === 'receivable' ? '应收 +' : member.direction === 'payable' ? '应付 ' : '' }}¥{{ member.direction === 'payable' ? payableAmount(member.netDelta) : member.direction === 'receivable' ? payableAmount(member.netDelta) : '0.0' }}</b>
        </div>
      </section>
      <h2>转账建议</h2>
      <section class="list" data-ai-id="settlement-adjustment-transfer-list">
        <van-empty v-if="!detail.transfers.length" description="无需转账" />
        <div v-for="transfer in detail.transfers" :key="`${transfer.payerUserId}-${transfer.payeeUserId}`" class="row">
          <span>{{ transfer.payerUsername }} 向 {{ transfer.payeeUsername }}</span
          ><b>¥{{ transfer.amount }}</b>
        </div>
      </section>
      <van-button v-if="detail.status === 'pending' && detail.canManage" block type="primary" :loading="confirming" data-ai-id="settlement-adjustment-confirm" @click="confirm">确认调整单</van-button>
      <p v-else-if="detail.status === 'pending'" class="readonly" data-ai-id="settlement-adjustment-readonly">只读权限 · 当前角色只能查看调整单。</p>
    </main>
  </div>
</template>
<style scoped>
.adjustment-page {
  min-height: 100vh;
  background: #f5f7fb;
}
.adjustment-page :deep(.van-nav-bar) {
  position: sticky;
  top: 0;
  z-index: 2;
}
.content {
  box-sizing: border-box;
  width: 100%;
  overflow-x: hidden;
  padding: 20px 16px 32px;
}
.muted,
small {
  color: #71809a;
  font-size: 12px;
}
.card,
.list {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  border-radius: 10px;
  background: #fff;
}
.card {
  padding: 14px;
}
.card small,
.card strong {
  display: block;
}
.card strong {
  margin-top: 7px;
  font-size: 19px;
}
.impact-change {
  margin: 10px 0 0;
  color: #475569;
  font-size: 13px;
  line-height: 1.45;
}
.impact-change b {
  font-weight: 600;
}
.impact-note {
  display: block;
  margin-top: 8px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.content h2 {
  margin: 24px 0 9px;
  font-size: 17px;
}
.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  box-sizing: border-box;
  width: 100%;
  min-height: 62px;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid #e4e8f0;
}
.row:last-child {
  border: 0;
}
.row span {
  min-width: 0;
}
.row strong,
.row small {
  display: block;
}
.row small {
  margin-top: 4px;
  line-height: 1.45;
}
.row b {
  white-space: nowrap;
  font-size: 13px;
}
.receivable {
  color: #15803d;
}
.payable {
  color: #b42318;
}
.content :deep(.van-button) {
  min-height: 44px;
  margin-top: 24px;
}
.readonly {
  margin: 24px 0 0;
  color: #71809a;
  font-size: 13px;
  text-align: center;
}
.state {
  display: grid;
  min-height: 60vh;
  place-items: center;
}
</style>
