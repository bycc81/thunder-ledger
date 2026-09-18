<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { showFailToast, showSuccessToast } from 'vant'
import { useRoute, useRouter } from 'vue-router'
import { api, type SettlementExpense, type SettlementMember, type SettlementPreview, type SettlementSale } from '../api'
import { formatDateTime } from '../utils/dateTime'

const route = useRoute()
const router = useRouter()
const batchId = computed(() => String(route.params.id))
const members = ref<SettlementMember[]>([])
const sales = ref<SettlementSale[]>([])
const expenses = ref<SettlementExpense[]>([])
const selectedSales = ref<string[]>([])
const selectedExpenses = ref<string[]>([])
const costs = ref<Record<string, string>>({})
const costTotal = ref('0.0')
const profits = ref<Record<string, string>>({})
const step = ref(1)
const preview = ref<SettlementPreview | null>(null)
const currentPreview = computed(() => preview.value as SettlementPreview)
const loading = ref(true)
const error = ref('')
const submitting = ref(false)
const showConfirm = ref(false)

const selectedSaleSet = computed(() => new Set(selectedSales.value))

function equalProfits() {
  const base = Math.floor(100 / members.value.length)
  let rest = 100 - base * members.value.length
  for (const member of members.value) profits.value[member.id] = String(base + (rest-- > 0 ? 1 : 0))
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await api.get<{ members: SettlementMember[]; sales: SettlementSale[]; expenses: SettlementExpense[] }>(`/batches/${batchId.value}/settlements/draft`)
    members.value = data.members
    sales.value = data.sales
    expenses.value = data.expenses
    equalProfits()
  } catch {
    error.value = '结算草稿加载失败，请返回后重试'
  } finally {
    loading.value = false
  }
}

function selectAll() {
  selectedSales.value = sales.value.map((sale) => sale.id)
}

function clearAll() {
  selectedSales.value = []
}

function isExpenseSelected(expense: SettlementExpense) {
  return expense.saleId ? selectedSaleSet.value.has(expense.saleId) : selectedExpenses.value.includes(expense.id)
}

function updateExpense(expense: SettlementExpense, checked: boolean) {
  if (expense.saleId) return
  selectedExpenses.value = checked ? [...new Set([...selectedExpenses.value, expense.id])] : selectedExpenses.value.filter((id) => id !== expense.id)
}

function payload() {
  const automaticExpenses = expenses.value.filter((expense) => expense.saleId && selectedSaleSet.value.has(expense.saleId)).map((expense) => expense.id)
  return {
    saleIds: selectedSales.value,
    expenseIds: [...new Set([...selectedExpenses.value, ...automaticExpenses])],
    profitShares: members.value.map((member) => ({ userId: member.id, percentage: Number(profits.value[member.id] ?? '') }))
  }
}

function cleanProfit(memberId: string) {
  const value = (profits.value[memberId] ?? '').replace(/[^\d.]/g, '')
  const [whole = '', decimal] = value.split('.')
  profits.value[memberId] = decimal === undefined ? whole.slice(0, 3) : `${whole.slice(0, 3)}.${decimal.slice(0, 2)}`
}

function profitBasisPoints(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return Number.NaN
  return Math.round(Number(value) * 100)
}

async function next() {
  if (step.value === 1) {
    if (!selectedSales.value.length) {
      showFailToast('请至少选择一笔销售')
      return
    }
    submitting.value = true
    try {
      const { data } = await api.post<{ costTotal: string; costShares: Array<{ userId: string; amount: string }> }>(`/batches/${batchId.value}/settlements/recommendation`, { saleIds: selectedSales.value })
      costTotal.value = data.costTotal
      for (const share of data.costShares) costs.value[share.userId] = share.amount
      step.value = 2
    } catch (requestError: unknown) {
      showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || '成本计算失败')
    } finally {
      submitting.value = false
    }
    return
  }
  if (step.value === 2) {
    const total = members.value.reduce((sum, member) => sum + profitBasisPoints(profits.value[member.id] ?? ''), 0)
    if (total !== 10000) {
      showFailToast('利润比例合计必须是 100%')
      return
    }
    submitting.value = true
    try {
      preview.value = (await api.post<SettlementPreview>(`/batches/${batchId.value}/settlements/preview`, payload())).data
      step.value = 3
    } catch (requestError: unknown) {
      showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || '账单预览失败')
    } finally {
      submitting.value = false
    }
    return
  }
  showConfirm.value = true
}

async function confirm() {
  submitting.value = true
  try {
    const { data } = await api.post<{ id: string }>(`/batches/${batchId.value}/settlements`, payload())
    showConfirm.value = false
    showSuccessToast('账单已确认')
    await router.replace(`/batches/${batchId.value}/settlements/${data.id}`)
  } catch (requestError: unknown) {
    showFailToast((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || '确认账单失败')
  } finally {
    submitting.value = false
  }
}

function back() {
  if (step.value > 1) {
    step.value -= 1
    return
  }
  void router.push(`/batches/${batchId.value}/settlements`)
}

onMounted(load)
</script>

<template>
  <div class="settlement-create-page" data-ai-id="settlement-create-page">
    <van-nav-bar title="创建账单" left-text="返回" left-arrow @click-left="back" />
    <div v-if="loading" class="state"><van-loading /></div>
    <van-empty v-else-if="error" :description="error"><van-button type="primary" size="small" @click="load">重试</van-button></van-empty>
    <main v-else class="content">
      <div class="steps"><strong :class="{ active: step === 1 }">1 选择</strong><strong :class="{ active: step === 2 }">2 利润</strong><strong :class="{ active: step === 3 }">3 预览</strong></div>
      <section v-if="step === 1">
        <header class="section-head"><h2>本次销售</h2><div><button class="text-button" data-ai-id="settlement-sales-select-all" @click="selectAll">全选</button><button class="text-button" data-ai-id="settlement-sales-clear" @click="clearAll">清空</button></div></header>
        <div class="list" data-ai-id="settlement-sales-list">
          <label v-for="sale in sales" :key="sale.id" class="choice-row" :data-ai-id="`settlement-sale-${sale.id}`"><input v-model="selectedSales" type="checkbox" :value="sale.id"><span><strong>{{ sale.productName }} · {{ sale.quantity }} 件</strong><small>{{ formatDateTime(sale.occurredAt) }} · {{ sale.sellerUsername }} 收款</small></span><b>¥{{ sale.totalPrice }}</b></label>
        </div>
        <header class="section-head"><h2>本次费用</h2></header>
        <div class="list" data-ai-id="settlement-expenses-list">
          <label v-for="expense in expenses" :key="expense.id" class="choice-row" :class="{ disabled: expense.saleId && !selectedSaleSet.has(expense.saleId) }" :data-ai-id="`settlement-expense-${expense.id}`"><input type="checkbox" :checked="isExpenseSelected(expense)" :disabled="Boolean(expense.saleId)" @change="updateExpense(expense, ($event.target as HTMLInputElement).checked)"><span><strong>{{ expense.name }} ¥{{ expense.amount }}</strong><small>{{ expense.payerUsername }} 支付 · {{ expense.saleId ? '已关联销售' : '未关联销售' }}</small></span></label>
        </div>
      </section>
      <section v-else-if="step === 2">
        <h2>确认利润比例</h2>
        <p class="muted">成本承担和实际付款人根据采购记录与商品移动平均成本自动计算，结算时不能修改。</p>
        <div class="list" data-ai-id="settlement-auto-cost-breakdown">
          <div class="cost-total"><span>本次商品成本</span><strong>¥{{ costTotal }}</strong></div>
          <div v-for="member in members" :key="member.id" class="readonly-row" :data-ai-id="`settlement-cost-share-${member.id}`"><span>{{ member.username }} 承担成本</span><b>¥{{ costs[member.id] || '0.0' }}</b></div>
        </div>
        <header class="section-head"><h2>本次利润怎么分</h2></header>
        <div class="list" data-ai-id="settlement-profit-allocation">
          <label v-for="member in members" :key="member.id" class="field-row">{{ member.username }}<span class="percent"><van-field v-model="profits[member.id]" type="text" inputmode="decimal" input-align="right" :data-ai-id="`settlement-profit-share-${member.id}`" @update:model-value="cleanProfit(member.id)" />%</span></label>
        </div>
      </section>
      <section v-else-if="preview !== null">
        <h2>账单预览</h2>
        <div class="summary" data-ai-id="settlement-preview"><div><small>销售额</small><strong>¥{{ currentPreview.saleTotal }}</strong></div><div><small>平台手续费</small><strong>¥{{ currentPreview.serviceFeeTotal }}</strong></div><div><small>费用</small><strong>¥{{ currentPreview.expenseTotal }}</strong></div><div><small>商品成本</small><strong>¥{{ currentPreview.costTotal }}</strong></div><div><small>本次{{ currentPreview.isLoss ? '亏损' : '利润' }}</small><strong :class="{ loss: currentPreview.isLoss }">¥{{ currentPreview.profitTotal }}</strong></div></div>
        <h2 class="result-title">本次结果</h2>
        <div class="list"><article v-for="member in currentPreview.members" :key="member.userId" class="result-row"><div><strong>{{ member.username }}</strong><small>承担成本 ¥{{ member.costShare }} · 成本返还 ¥{{ member.costRecovery }} · 收款 ¥{{ member.salesReceived }} · 采购付款 ¥{{ member.purchasesPaid }} · 垫付 ¥{{ member.expensesPaid }} · 利润 {{ member.profitPercentage }}%（¥{{ member.profitAmount }}）</small></div><b :class="member.direction">{{ member.direction === 'receivable' ? `应收 ¥${member.net}` : member.direction === 'payable' ? `应付 ¥${member.net.replace('-', '')}` : '已结清' }}</b></article></div>
        <h2 class="result-title">转账建议</h2>
         <div class="list transfer-list" data-ai-id="settlement-preview-transfers"><van-empty v-if="!currentPreview.transfers.length" description="无需转账" /><div v-for="transfer in currentPreview.transfers" :key="`${transfer.payerUserId}-${transfer.payeeUserId}`" class="transfer-row" :data-ai-id="`settlement-transfer-${transfer.payerUserId}-${transfer.payeeUserId}`"><div class="transfer-route"><strong>{{ transfer.payerUsername }}</strong><span>转给</span><strong>{{ transfer.payeeUsername }}</strong></div><b>¥{{ transfer.amount }}</b></div></div>
      </section>
    </main>
    <footer v-if="!loading && !error" class="footer"><van-button block type="primary" :loading="submitting" :disabled="submitting" @click="next">{{ step === 3 ? '确认账单' : '下一步' }}</van-button></footer>
    <van-dialog v-model:show="showConfirm" title="确认账单" show-cancel-button :confirm-button-text="submitting ? '确认中' : '确认账单'" :confirm-button-disabled="submitting" data-ai-id="settlement-confirm-dialog" @confirm="confirm"><p class="dialog-note">确认后，本次选择的销售、费用和利润比例会锁定，不能再次结账。确认继续？</p><template #footer><div class="dialog-actions"><van-button plain :disabled="submitting" @click="showConfirm = false">取消</van-button><van-button type="primary" :loading="submitting" data-ai-id="settlement-confirm" @click="confirm">确认账单</van-button></div></template></van-dialog>
  </div>
</template>

<style scoped>
.settlement-create-page{min-height:100vh;padding-bottom:80px;background:#f5f7fb}.settlement-create-page :deep(.van-nav-bar){position:sticky;top:0;z-index:2}.content{padding:16px}.steps{display:flex;justify-content:space-between;margin:2px 0 18px;color:#8993a7;font-size:12px}.steps .active{color:#3657c8}.section-head{display:flex;align-items:center;justify-content:space-between;margin:18px 0 8px}.content h2{margin:0;font-size:17px}.text-button{min-height:36px;border:0;background:transparent;color:#3657c8;font:inherit}.list{overflow:hidden;border-radius:10px;background:#fff}.choice-row,.field-row,.result-row{display:flex;min-height:62px;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #e4e8f0}.choice-row:last-child,.field-row:last-child,.result-row:last-child{border:0}.choice-row input{width:20px;height:20px;accent-color:#3657c8}.choice-row span,.result-row div{min-width:0;flex:1}.choice-row strong,.choice-row small,.result-row strong,.result-row small{display:block}.choice-row small,.result-row small,.muted{margin-top:5px;color:#71809a;font-size:12px;line-height:1.45}.choice-row b{white-space:nowrap;font-size:14px}.choice-row.disabled{opacity:.48}.field-row{min-height:62px;justify-content:space-between}.readonly-row{display:flex;min-height:52px;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #e4e8f0}.readonly-row:last-child{border:0}.readonly-row b{font-size:14px}.cost-total{display:flex;justify-content:space-between;padding:12px;border-bottom:1px solid #e4e8f0;color:#536078}.cost-total strong{color:#172033}.field-row :deep(.van-cell){width:116px;height:38px;min-height:38px;padding:0 10px;border:1px solid #cfd6e2;border-radius:8px}.field-row :deep(.van-field__body),.field-row :deep(.van-field__control){height:36px;min-height:36px;line-height:36px;font-size:16px}.percent{display:flex;width:124px;align-items:center;gap:4px}.percent :deep(.van-cell){width:100px}.summary{display:grid;grid-template-columns:1fr 1fr;gap:1px;overflow:hidden;border-radius:10px;background:#e4e8f0}.summary div{padding:12px;background:#fff}.summary small,.summary strong{display:block}.summary small{color:#71809a;font-size:12px}.summary strong{margin-top:6px;font-size:17px}.loss,.payable{color:#b42318}.receivable{color:#15803d}.result-title{margin:22px 0 8px!important}.result-row b{white-space:nowrap;font-size:13px}.transfer-list :deep(.van-empty){padding:20px 12px}.transfer-row{display:grid;grid-template-columns:minmax(0,1fr) auto;min-height:62px;align-items:center;gap:12px;padding:10px 12px;border-bottom:1px solid #e4e8f0}.transfer-row:last-child{border:0}.transfer-route{display:flex;min-width:0;align-items:center;gap:7px;flex-wrap:wrap;color:#536078;font-size:13px}.transfer-route strong{color:#172033;font-size:14px;overflow-wrap:anywhere}.transfer-row b{white-space:nowrap;color:#3657c8;font-size:14px}.footer{position:fixed;right:0;bottom:0;left:0;z-index:3;max-width:430px;margin:auto;padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1px solid #e4e8f0;background:#fff}.footer :deep(.van-button){min-height:44px}.dialog-note{margin:0;padding:0 16px;color:#536078;line-height:1.5}.dialog-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px}.dialog-actions :deep(.van-button){min-height:44px}.state{display:grid;min-height:60vh;place-items:center}
</style>
