<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { showFailToast, showSuccessToast } from 'vant'
import { useRoute, useRouter } from 'vue-router'
import { api, type Expense, type QuickSale, type Sale } from '../api'
import { useWorkspaceStore, type BatchMember } from '../stores/workspace'
import { formatDateTime } from '../utils/dateTime'
import AppBottomNavigation from '../components/AppBottomNavigation.vue'
import AppMultiSelect from '../components/AppMultiSelect.vue'
const route = useRoute()
const router = useRouter()
const store = useWorkspaceStore()
const batchId = computed(() => String(route.params.id))
const tab = ref<'sales' | 'expenses'>('sales')
const sales = ref<Sale[]>([])
const quickSales = ref<QuickSale[]>([])
const expenses = ref<Expense[]>([])
const members = ref<BatchMember[]>([])
const keyword = ref('')
const selectedMemberIds = ref<string[]>([])
type RecordStatus = 'pending' | 'settled' | 'reversed'
type StatusFilter = RecordStatus | 'all'
const statusOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: 'pending', label: '待结账' }, { value: 'settled', label: '已结账' },
  { value: 'reversed', label: '已撤销' }, { value: 'all', label: '全部' }
]
const saleStatus = ref<StatusFilter>('pending')
const expenseStatus = ref<StatusFilter>('pending')
function recordStatus(record: { reversalReason: string | null; settled: boolean }): RecordStatus {
  return record.reversalReason ? 'reversed' : record.settled ? 'settled' : 'pending'
}
function matchesStatus(record: { reversalReason: string | null; settled: boolean }, status: StatusFilter) {
  return status === 'all' || recordStatus(record) === status
}
function statusLabel(status: StatusFilter) { return statusOptions.find((option) => option.value === status)?.label || '' }
const visibleExpenses = computed(() => expenses.value.filter((expense) => matchesStatus(expense, expenseStatus.value))
  .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id)))
function expenseTransaction(expense: Expense) {
  if (expense.saleId) {
    const sale = sales.value.find((value) => value.id === expense.saleId)
    return `关联普通销售：${sale?.displayName || sale?.productName || '销售记录'}`
  }
  if (expense.quickSaleId) return `关联快速售出：${quickSales.value.find((value) => value.id === expense.quickSaleId)?.displayName || '快速售出记录'}`
  return '独立费用'
}
const memberOptions = computed(() => members.value.map((member) => ({ value: member.id, label: member.username })))
const hasFilters = computed(() => Boolean(keyword.value.trim() || selectedMemberIds.value.length || saleStatus.value !== 'pending'))
type SaleRecord = (Sale & { source: 'sale' }) | QuickSale
const visibleSales = computed(() => {
  const search = keyword.value.trim().toLowerCase()
  const memberIds = new Set(selectedMemberIds.value)
  const records: SaleRecord[] = [
    ...sales.value.map((sale) => ({ ...sale, source: 'sale' as const })),
    ...quickSales.value
  ]
  return records.filter((sale) => {
    const names = sale.source === 'sale'
      ? [sale.productName, sale.productGroupName, sale.variantName, sale.displayName]
      : [sale.displayName]
    return matchesStatus(sale, saleStatus.value) && (!search || names.some((name) => name?.toLowerCase().includes(search)))
      && (!memberIds.size || memberIds.has(sale.sellerUserId))
  }).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)
    || Date.parse(b.createdAt) - Date.parse(a.createdAt)
    || a.source.localeCompare(b.source)
    || a.id.localeCompare(b.id))
})
function clearFilters() {
  keyword.value = ''
  selectedMemberIds.value = []
  saleStatus.value = 'pending'
}
const loading = ref(true)
const error = ref('')
const showReverse = ref(false)
const reverseType = ref<'sale' | 'expense' | 'quickSale'>('sale')
const reverseId = ref('')
const reverseReason = ref('')
const reversing = ref(false)
const canEdit = computed(() => {
  const b = store.batches.find((x) => x.id === batchId.value)
  return Boolean(b && (b.role === 'owner' || b.role === 'editor' || store.canManageWorkspace))
})
async function load() {
  loading.value = true
  error.value = ''
  try {
    const [s, qs, e, m] = await Promise.all([
      api.get<Sale[]>(`/batches/${batchId.value}/sales`),
      api.get<QuickSale[]>(`/batches/${batchId.value}/quick-sales`),
      api.get<Expense[]>(`/batches/${batchId.value}/expenses`),
      api.get<BatchMember[]>(`/batches/${batchId.value}/members`)
    ])
    sales.value = s.data
    quickSales.value = qs.data
    expenses.value = e.data
    members.value = m.data
  } catch {
    error.value = '交易记录加载失败，请重试'
  } finally {
    loading.value = false
  }
}
function openSale(saleId: string) {
  void router.push(`/batches/${batchId.value}/transactions/sales/${saleId}`)
}
function openQuickSale(id: string) {
  void router.push(`/batches/${batchId.value}/quick-sales/${id}`)
}
function openRecord(sale: SaleRecord) {
  if (sale.source === 'sale') openSale(sale.id)
  else openQuickSale(sale.id)
}
const reverseTitle = computed(() => (reverseType.value === 'sale' ? '撤销销售' : reverseType.value === 'quickSale' ? '撤销快速售出' : '撤销其他费用'))
function ask(type: 'sale' | 'expense' | 'quickSale', id: string) {
  reverseType.value = type
  reverseId.value = id
  reverseReason.value = ''
  showReverse.value = true
}
async function reverse() {
  if (!reverseReason.value.trim()) { showFailToast('请填写撤销原因'); return false }
  reversing.value = true
  try {
    const { data } = await api.post<{ reversedExpenseCount?: number }>(
      `/batches/${batchId.value}/${reverseType.value === 'quickSale' ? 'quick-sales' : reverseType.value === 'sale' ? 'sales' : 'expenses'}/${reverseId.value}/reversals`,
      { reason: reverseReason.value.trim() }
    )
    showReverse.value = false
    showSuccessToast(data.reversedExpenseCount ? `已撤销，并撤销 ${data.reversedExpenseCount} 笔关联费用` : '已撤销')
    await load()
    return true
  } catch (e: unknown) {
    showFailToast((e as { response?: { data?: { message?: string } } }).response?.data?.message || '撤销失败')
    return false
  } finally {
    reversing.value = false
  }
}
function beforeReverseClose(action: string) {
  if (reversing.value) return false
  return action === 'confirm' ? reverse() : true
}
onMounted(async () => {
  if (!store.workspaces.length) await store.load()
  await load()
})
</script>
<template>
  <div class="transaction-page" data-ai-id="transaction-page">
    <van-nav-bar title="交易" left-text="返回" left-arrow data-ai-id="transaction-back" @click-left="router.push(`/batches/${batchId}`)" />
    <div v-if="loading" class="state"><van-loading /></div>
    <van-empty v-else-if="error" :description="error" data-ai-id="transaction-error">
      <van-button type="primary" data-ai-id="transaction-retry" @click="load">重试</van-button>
    </van-empty>
    <main v-else class="content">
      <div class="tabs" data-ai-id="transaction-tabs">
        <button data-ai-id="transaction-sales-tab" :class="{ active: tab === 'sales' }" @click="tab = 'sales'">销售</button><button data-ai-id="transaction-expenses-tab" :class="{ active: tab === 'expenses' }" @click="tab = 'expenses'">其他费用</button>
      </div>
      <section v-if="tab === 'sales'" class="sale-list" data-ai-id="sale-list">
        <header>
          <span style="display: flex; gap: 6px"
            ><van-button
              v-if="canEdit"
              class="tl-button--secondary"
              type="primary"
              data-ai-id="sale-create-entry"
              @click="router.push(`/batches/${batchId}/transactions/sales/new`)"
              >普通销售</van-button
            ><van-button v-if="canEdit" class="tl-button--secondary" type="primary" data-ai-id="quick-sale-create-entry" @click="router.push(`/batches/${batchId}/quick-sales/new`)"
              >快速售出</van-button
            ></span
          >
        </header>
        <div class="sale-filters" data-ai-id="transaction-sale-filters">
          <div data-ai-id="transaction-product-keyword">
            <van-search v-model="keyword" placeholder="输入商品名称关键词" aria-label="商品名称关键词" clearable />
          </div>
          <AppMultiSelect
            v-model="selectedMemberIds"
            class="member-filter"
            :options="memberOptions"
            label="售出人员"
            placeholder="全部人员"
            count-unit="人"
            hint="可多选，未选择时显示全部人员"
            empty-text="本批次暂无人员"
            ai-id="transaction-member-filter"
            empty-ai-id="transaction-members-empty"
          />
          <div class="status-filter" data-ai-id="transaction-sale-status-section">
            <label for="transaction-sale-status">记录状态</label>
            <select id="transaction-sale-status" v-model="saleStatus" data-ai-id="transaction-sale-status-filter"><option v-for="option in statusOptions" :key="option.value" :value="option.value" :data-ai-id="`transaction-sale-status-option-${option.value}`">{{ option.label }}</option></select>
          </div>
        </div>
        <div class="filter-summary" data-ai-id="transaction-filter-summary">
          <span role="status">共 {{ visibleSales.length }} 笔 · {{ statusLabel(saleStatus) }} · 售出时间倒序</span>
          <button v-if="hasFilters" class="clear-filters" data-ai-id="transaction-clear-filters" @click="clearFilters">清除筛选</button>
        </div>
        <van-empty v-if="!visibleSales.length" :description="hasFilters ? '没有符合筛选条件的销售记录' : '暂无待结账销售记录'" data-ai-id="transaction-sales-empty" />
        <article
          v-for="sale in visibleSales"
          :key="`${sale.source}-${sale.id}`"
          class="item sale-item"
          tabindex="0"
          role="button"
          :aria-label="`查看${sale.displayName || (sale.source === 'sale' ? sale.productName : '')}销售详情`"
          :data-ai-id="`${sale.source === 'sale' ? 'sale' : 'quick-sale'}-item-${sale.id}`"
          @click="openRecord(sale)"
          @keydown.enter.self="openRecord(sale)"
          @keydown.space.self.prevent="openRecord(sale)"
        >
          <div v-if="sale.source === 'sale'" class="item-main">
            <strong>{{ sale.displayName || sale.productName }} · ¥{{ sale.totalPrice }}</strong>
            <span>{{ sale.sellerUsername }} 实收 ¥{{ sale.receivedAmount }} · {{ sale.quantity }} 件</span>
            <small>手续费 ¥{{ sale.serviceFee }}{{ sale.salesChannel ? ` · ${sale.salesChannel}` : '' }} · {{ formatDateTime(sale.occurredAt) }}</small>
          </div>
          <div v-else class="item-main">
            <strong>{{ sale.displayName }} · {{ sale.quantity }} 件</strong>
            <span>{{ sale.sellerUsername }} 实收 ¥{{ sale.receivedAmount }}</span>
            <small>{{ sale.salesChannel ? `${sale.salesChannel} · ` : '' }}{{ formatDateTime(sale.occurredAt) }}</small>
          </div>
          <van-tag type="primary" plain class="source-tag" :title="sale.source === 'sale' ? '普通销售' : '快速售出'" :aria-label="sale.source === 'sale' ? '普通销售' : '快速售出'" :data-ai-id="`${sale.source === 'sale' ? 'sale' : 'quick-sale'}-source-${sale.id}`">{{ sale.source === 'sale' ? '普' : '快' }}</van-tag>
          <div class="item-side item-side--quick-sale">
            <van-tag v-if="sale.reversalReason" type="default" class="status-tag status-tag--reversed" :data-ai-id="`${sale.source === 'sale' ? 'sale' : 'quick-sale'}-status-${sale.id}`">已撤销</van-tag>
            <van-tag v-else-if="sale.settled" type="success" class="status-tag status-tag--settled" :data-ai-id="`${sale.source === 'sale' ? 'sale' : 'quick-sale'}-status-${sale.id}`">已结账</van-tag>
            <van-tag v-else type="warning" class="status-tag status-tag--pending" :data-ai-id="`${sale.source === 'sale' ? 'sale' : 'quick-sale'}-status-${sale.id}`">待结账</van-tag>
            <button v-if="canEdit && recordStatus(sale) === 'pending'" class="reverse" :title="sale.source === 'sale' ? '撤销销售' : '撤销快速售出'" :data-ai-id="`${sale.source === 'sale' ? 'sale' : 'quick-sale'}-reversal-${sale.id}`" @click.stop="ask(sale.source === 'sale' ? 'sale' : 'quickSale', sale.id)">撤销</button>
          </div>
        </article>
      </section>
      <section v-else class="expense-list" data-ai-id="expense-list">
        <header>
          <span>记录本批次额外发生的支出，例如邮费、包装材料费等。</span
          ><van-button v-if="canEdit" size="small" type="primary" data-ai-id="expense-create-entry" @click="router.push(`/batches/${batchId}/transactions/expenses/new`)">记录</van-button>
        </header>
        <div class="expense-filters">
          <div class="status-filter" data-ai-id="transaction-expense-status-section"><label for="transaction-expense-status">记录状态</label><select id="transaction-expense-status" v-model="expenseStatus" data-ai-id="transaction-expense-status-filter"><option v-for="option in statusOptions" :key="option.value" :value="option.value" :data-ai-id="`transaction-expense-status-option-${option.value}`">{{ option.label }}</option></select></div>
        </div>
        <div class="filter-summary" data-ai-id="transaction-expense-summary"><span role="status">共 {{ visibleExpenses.length }} 笔 · {{ statusLabel(expenseStatus) }} · 发生时间倒序</span></div>
        <van-empty v-if="!visibleExpenses.length" :description="`暂无${expenseStatus === 'all' ? '' : statusLabel(expenseStatus)}其他费用记录`" data-ai-id="transaction-expense-empty" />
        <article v-for="expense in visibleExpenses" :key="expense.id" class="item" :data-ai-id="`expense-item-${expense.id}`">
          <div class="item-main">
            <strong>{{ expense.name }} · ¥{{ expense.amount }}</strong
            ><span>{{ expense.payerUsername }} 付款</span>
            <small :data-ai-id="`expense-occurred-at-${expense.id}`">{{ formatDateTime(expense.occurredAt) }}</small>
            <small :data-ai-id="`expense-transaction-${expense.id}`">{{ expenseTransaction(expense) }}</small>
          </div>
          <div class="item-side item-side--expense">
            <van-tag v-if="expense.reversalReason" type="default" class="status-tag status-tag--reversed" :data-ai-id="`expense-status-${expense.id}`">已撤销</van-tag
            ><van-tag v-else-if="expense.settled" type="success" class="status-tag status-tag--settled" :data-ai-id="`expense-status-${expense.id}`">已结账</van-tag
            ><van-tag v-else type="warning" class="status-tag status-tag--pending" :data-ai-id="`expense-status-${expense.id}`">待结账</van-tag>
            <button v-if="canEdit && recordStatus(expense) === 'pending'" class="reverse" title="撤销其他费用" :data-ai-id="`expense-reversal-${expense.id}`" @click="ask('expense', expense.id)">撤销</button>
          </div>
        </article>
      </section>
    </main>
    <van-dialog v-model:show="showReverse" :title="reverseTitle" show-cancel-button data-ai-id="transaction-reversal-dialog" :before-close="beforeReverseClose" :confirm-button-loading="reversing" :cancel-button-disabled="reversing"
      ><p v-if="reverseType !== 'expense'" class="reversal-notice" data-ai-id="transaction-reversal-notice">撤销后会恢复关联库存，并同步撤销本笔销售尚未撤销的关联其他费用。已纳入账单的销售或关联费用不能撤销。</p><van-field v-model="reverseReason" label="撤销原因" type="textarea" rows="2" data-ai-id="transaction-reversal-reason" /></van-dialog
    ><AppBottomNavigation />
  </div>
</template>
<style scoped>
.transaction-page {
  min-height: 100vh;
  padding-bottom: 66px;
  background: #f7f9fc;
}
.content {
  padding: 16px;
}
.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin-bottom: 14px;
  overflow: hidden;
  border: 1px solid #dfe5ee;
  border-radius: 9px;
  background: #fff;
}
.tabs button,
.reverse {
  min-height: 44px;
  border: 0;
  background: transparent;
  font: inherit;
}
.tabs button {
  color: #61708a;
}
.tabs button.active {
  background: #eef2ff;
  color: #3657c8;
  font-weight: 600;
}
.content header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  color: #71809a;
  font-size: 12px;
}
.expense-list > header > span { min-width:0; flex:1; }
.expense-list > header > .van-button { flex:0 0 auto; min-width:44px; min-height:44px; white-space:nowrap; }
.sale-list > header {
  justify-content: flex-end;
}
.sale-filters {
  margin-top: 10px;
  overflow: hidden;
  border: 1px solid #edf0f5;
  border-radius: 10px;
  background: #fff;
}
.sale-filters :deep(.van-search) {
  padding: 10px 12px;
}
.sale-filters :deep(.van-search__content) {
  min-height: 44px;
}
.member-filter {
  padding: 0 12px 12px;
}
.filter-summary {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #71809a;
  font-size: 12px;
}
.clear-filters {
  min-height: 44px;
  border: 0;
  padding: 0 8px;
  background: transparent;
  color: #3657c8;
  font: inherit;
}
.item {
  position: relative;
  display: flex;
  min-height: 82px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
  padding: 12px;
  border: 1px solid #edf0f5;
  border-radius: 10px;
  background: #fff;
}
.sale-item {
  min-height: 0;
  padding-top: 6px;
  padding-bottom: 6px;
  cursor: pointer;
}
.sale-item:focus-visible {
  outline: 2px solid #3657c8;
  outline-offset: 2px;
}
.item-main {
  min-width: 0;
  flex: 1;
}
.item-side {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  min-width: 62px;
}
.item-side--quick-sale {
  min-width: 44px;
  padding-top: 12px;
  flex-direction: column;
  align-items: flex-end;
  gap: 0;
}
.sale-item > .source-tag {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 20px;
  height: 18px;
  margin: 0;
  padding: 0;
  border-radius: 3px;
  font-size: 11px;
  line-height: 1;
}
.item strong,
.item span,
.item small {
  display: block;
}
.item-main > strong {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
.item span,
.item small {
  margin-top: 4px;
  color: #71809a;
  font-size: 12px;
}
.item-side :deep(.status-tag) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  height: 22px;
  padding: 0 7px;
  border: 0;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}
.item-side :deep(.status-tag--settled) {
  background: #e7f6ed;
  color: #21864f;
}
.item-side :deep(.status-tag--reversed) {
  background: #eef0f3;
  color: #687386;
}
.reverse {
  min-width: 44px;
  padding: 0 4px;
  color: #b42318;
  font-size: 13px;
  line-height: 1.4;
}
.state {
  display: grid;
  min-height: 60vh;
  place-items: center;
}
.status-filter { display:flex; min-height:44px; align-items:center; gap:12px; padding:0 12px 12px; }
.status-filter label { flex:0 0 auto; font-size:14px; color:#536078; }
.status-filter select { flex:1; width:100%; min-width:0; min-height:44px; padding:0 10px; border:1px solid #dfe5ee; border-radius:6px; background:#fff; color:#25314c; font:inherit; font-size:14px; }
.status-filter select:focus-visible { outline:2px solid #3657c8; outline-offset:2px; }
.expense-filters { margin-top:10px; padding-top:12px; border:1px solid #edf0f5; border-radius:10px; background:#fff; }
.item-side--expense { flex-direction:column; gap:8px; }
.item-side :deep(.status-tag--pending) { background:#fff4db; color:#925900; }
.reversal-notice { margin:0; padding:12px 16px; color:#536078; font-size:13px; line-height:1.6; }
</style>
