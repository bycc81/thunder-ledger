<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import type { SettlementMemberDetails, SettlementResultMember } from '../api'
import { formatDateTime } from '../utils/dateTime'

const props = defineProps<{
  mode?: 'preview' | 'confirmed'
  show: boolean
  member: { id: string; username: string } | null
  expected: { costTotal: string; costShare: string }
  result?: SettlementResultMember
  profitTotal?: string
  details: SettlementMemberDetails | null
  loading: boolean
  error: string
}>()
const emit = defineEmits<{ 'update:show': [value: boolean]; retry: []; inventory: [productId: string] }>()
const panel = ref<HTMLElement>()
const body = ref<HTMLElement>()
const closeButton = ref<HTMLButtonElement>()
const titleId = `settlement-details-${useId()}`
let returnFocus: HTMLElement | null = null
const close = () => emit('update:show', false)
const confirmed = computed(() => props.mode === 'confirmed')
const legacy = computed(() => props.details?.snapshotStatus === 'legacy')
const cents = (value: string) => Math.round(Number(value) * 100)
const money = (value: string | null | undefined) => value == null ? '缺少分摊记录' : `¥${Number(value).toFixed(2)}`
const sourceId = (record: SettlementMemberDetails['transactions'][number]) => `${record.source === 'sale' ? 'sale' : 'quick-sale'}-${record.id}`
const mismatch = computed(() => {
  if (!props.details) return false
  const totals = props.details.totals
  return cents(totals.costTotal) !== cents(props.expected.costTotal) || cents(totals.costShare) !== cents(props.expected.costShare)
    || Boolean(props.result && (['purchasesPaid', 'expensesPaid', 'salesReceived'] as const).some((key) => cents(totals[key]) !== cents(props.result![key])))
})
const costRecords = computed(() => props.details?.transactions.filter((record) => record.costShare === null || cents(record.costShare) !== 0 || props.details?.issues.some((issue) => issue.source === record.source && issue.saleId === record.id)) ?? [])
const paymentRecords = computed(() => props.details?.transactions.filter((record) => record.purchasesPaid === null || cents(record.purchasesPaid) !== 0) ?? [])
const receiptRecords = computed(() => props.details?.transactions.filter((record) => record.sellerUserId === props.member?.id) ?? [])
const allocations = (record: SettlementMemberDetails['transactions'][number], type: 'payer' | 'burden') => record.allocations.filter((row) => row.type === type)
const expenseRelation = (expense: SettlementMemberDetails['expenses'][number]) => props.details?.transactions.find((record) => record.source === (expense.saleId ? 'sale' : 'quick_sale') && record.id === (expense.saleId || expense.quickSaleId))?.productName
function focusOpened() {
  void nextTick(() => {
    panel.value?.querySelectorAll<HTMLDetailsElement>('.categories > details').forEach((node, index) => { node.open = index === 0 })
    panel.value?.querySelectorAll<HTMLDetailsElement>('.source').forEach((node) => { node.open = false })
    closeButton.value?.focus({ preventScroll: true }); if (body.value) body.value.scrollTop = 0
  })
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); close(); return }
  if (event.key !== 'Tab' || !panel.value) return
  const nodes = [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled),summary,a[href],[tabindex="0"]')].filter((node) => node.getClientRects().length > 0)
  const first = nodes[0], last = nodes[nodes.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
watch(() => props.show, (show) => {
  if (show) { returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; focusOpened() }
}, { immediate: true })
function closed() { if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }) }
</script>

<template>
  <van-popup :show="show" position="bottom" round teleport="body" class="member-details-popup" :style="{ height: '90dvh' }" data-ai-id="settlement-member-details-popup" @update:show="emit('update:show', $event)" @opened="focusOpened" @closed="closed">
    <section ref="panel" class="panel" role="dialog" aria-modal="true" :aria-labelledby="titleId" @keydown="keydown">
      <header class="panel-header"><div><h2 :id="titleId">{{ member?.username }} · 结算明细</h2><p>{{ result ? '本次结果与组成记录' : '成本承担与来源' }}</p></div><button ref="closeButton" type="button" aria-label="关闭个人明细" data-ai-id="settlement-member-details-close" @click="close">×</button></header>
      <div ref="body" class="panel-body" data-ai-id="settlement-member-details-body">
        <div v-if="loading" class="state" role="status" data-ai-id="settlement-member-details-loading"><van-loading />正在加载个人明细…</div>
        <div v-else-if="error" class="state" role="alert" data-ai-id="settlement-member-details-error"><p>{{ error }}</p><p class="muted">{{ confirmed ? '已确认账单金额保持不变。' : '已有选择、利润比例和结果保持不变。' }}</p><van-button type="primary" size="small" data-ai-id="settlement-member-details-retry" @click="emit('retry')">重试</van-button></div>
        <template v-else-if="details">
          <p v-if="confirmed" :class="legacy ? 'notice' : 'category-note'" :role="legacy ? 'status' : undefined" data-ai-id="settlement-member-details-snapshot-notice">{{ details.notice || '明细已在账单确认时保存，不随后续采购更正或库存变化而改变。' }}</p>
          <section class="person-summary" data-ai-id="settlement-member-details-summary">
            <template v-if="result"><p class="muted">{{ result.direction === 'receivable' ? '本次应收' : result.direction === 'payable' ? '本次应付' : '已结清' }}</p><strong class="big" :class="result.direction">{{ money(result.direction === 'payable' ? result.net.replace('-', '') : result.net) }}</strong><div class="formula" data-ai-id="settlement-member-details-formula"><div><span>利润分成</span><b>{{ money(result.profitAmount) }}</b></div><div><span>＋ 成本返还</span><b>{{ money(result.costRecovery) }}</b></div><div><span>＋ 其他费用垫付</span><b>{{ money(result.expensesPaid) }}</b></div><div><span>－ 已收销售款</span><b>{{ money(result.salesReceived) }}</b></div><p class="muted">{{ confirmed ? '以上为账单确认时结果，弹窗只展示组成，不重新计算。' : '以上为当前账单预览结果，弹窗只展示组成，不重新计算。' }}</p></div></template>
            <template v-else><p class="muted">本次承担商品成本</p><strong class="big">{{ money(expected.costShare) }}</strong><p class="muted">来自本次已选销售，包含筛选外已选记录。</p></template>
          </section>
          <p v-if="mismatch" role="alert" class="notice" data-ai-id="settlement-member-details-mismatch">明细与当前结果不一致，请返回重新核对。原金额保持不变。<br>当前承担成本 {{ money(expected.costShare) }}；明细合计 {{ money(details.totals.costShare) }}。</p>
          <div v-if="details.issues.length" role="alert" class="notice" data-ai-id="settlement-member-details-missing"><p v-for="(issue, index) in details.issues" :key="`${issue.source}:${issue.saleId}:${index}`">{{ details.transactions.find((record) => record.source === issue.source && record.id === issue.saleId)?.productName }}：{{ issue.message }}</p></div>
          <p v-if="!details.transactions.length && !details.expenses.length" class="empty" data-ai-id="settlement-member-details-empty">暂无可展示的组成记录。</p>
          <div v-else class="categories">
            <details open data-ai-id="settlement-member-details-cost"><summary><span>成本承担</span><b>{{ money(details.totals.costShare) }}</b></summary><div class="category-content"><p class="category-note">{{ legacy ? '以下为账单内销售。未保存逐笔个人分摊，无法确定各笔本人承担金额。' : confirmed ? '本人承担的组成销售，金额来自账单确认时保存的分摊记录。' : '本人承担的组成销售，包含筛选外已选记录。金额来自已有分摊记录。' }}</p><p v-if="!costRecords.length" class="empty">本次没有由你承担的商品成本。</p>
              <article v-for="record in costRecords" :key="sourceId(record)" class="transaction" :data-ai-id="`settlement-member-details-cost-record-${sourceId(record)}`"><h3><span class="tag">{{ record.source === 'sale' ? '普通销售' : '快速售出' }}</span>{{ record.productName }}</h3><p class="meta">{{ formatDateTime(record.occurredAt) }} · 售出 {{ record.quantity }} 件</p><div class="detail-line"><span>本笔商品成本</span><b>{{ money(record.cost) }}</b></div><div class="detail-line emphasis"><span>本人承担</span><b>{{ money(record.costShare) }}</b></div>
                <details class="source" :data-ai-id="`settlement-member-details-source-${sourceId(record)}`"><summary>查看成本来源 ›</summary><div class="source-box">
                  <template v-if="record.source === 'sale'"><h4>普通销售 · 移动平均成本</h4><p>本笔成本来自已保存的库存销售成本，不指定某一笔采购。</p><div class="detail-line"><span>已记录销售成本</span><b>{{ money(record.cost) }}</b></div><p class="muted">未保存当时库存余额，不推算销售前数量或均价。当前库存明细仅作参考。</p><button v-if="record.productId" type="button" class="inventory-link" :data-ai-id="`settlement-member-details-inventory-${sourceId(record)}`" @click="emit('inventory', record.productId)">{{ confirmed ? '查看当前库存参考' : '查看库存明细' }} ›</button></template>
                  <template v-else><h4>快速售出 · 填写成本</h4><p v-if="legacy" class="muted">此历史账单未保存快速售出商品项。</p><p>结算采用商品项填写的本单成本。库存消耗成本是参考记录，两者可以不同。</p><div v-for="item in record.quickItems" :key="item.id" class="source-item" :data-ai-id="`settlement-member-details-quick-item-${item.id}`"><strong>{{ item.name }} · {{ item.quantity }} 件</strong><div class="detail-line"><span>填写的本单成本</span><b>{{ money(item.cost) }}</b></div><p v-if="!item.consumptions.length" class="muted">未关联库存。</p><div v-for="consumption in item.consumptions" :key="consumption.id" class="consumption" :data-ai-id="`settlement-member-details-consumption-${consumption.id}`"><p>{{ consumption.productName }} · 关联 {{ consumption.quantity }} 件</p><div class="detail-line"><span>已记录库存消耗成本</span><b>{{ money(consumption.consumedCost) }}</b></div></div></div><p class="muted">个人分摊仅保存到整单层级，不推算逐商品项个人分摊。</p></template>
                  <h4>本笔承担分摊</h4><p v-if="!allocations(record, 'burden').length" class="muted">暂无分摊记录。</p><div v-for="row in allocations(record, 'burden')" :key="row.userId" class="detail-line"><span>{{ row.username }}</span><b>{{ money(row.amount) }}</b></div><h4>本笔采购付款归属</h4><p v-if="!allocations(record, 'payer').length" class="muted">暂无付款归属记录。</p><div v-for="row in allocations(record, 'payer')" :key="row.userId" class="detail-line"><span>{{ row.username }}</span><b>{{ money(row.amount) }}</b></div>
                </div></details>
              </article>
            </div></details>
            <details data-ai-id="settlement-member-details-payments"><summary><span>采购付款归属</span><b>{{ money(details.totals.purchasesPaid) }}</b></summary><div class="category-content"><p class="category-note">本次销售成本对应的付款分摊，不是批次全部采购付款。不额外加入应收/应付公式，付款人和承担人可能不同。</p><p v-if="!paymentRecords.length" class="empty">本次没有归属你的采购付款金额。</p><article v-for="record in paymentRecords" :key="sourceId(record)" class="transaction" :data-ai-id="`settlement-member-details-payment-record-${sourceId(record)}`"><h3>{{ record.productName }}</h3><p class="meta">{{ formatDateTime(record.occurredAt) }} · {{ record.source === 'sale' ? '普通销售' : '快速售出' }}</p><div class="detail-line"><span>本人付款归属</span><b>{{ money(record.purchasesPaid) }}</b></div></article></div></details>
            <details data-ai-id="settlement-member-details-expenses"><summary><span>费用垫付</span><b>{{ money(details.totals.expensesPaid) }}</b></summary><div class="category-content"><p v-if="!details.expenses.length" class="empty">本次没有由你垫付的费用。</p><article v-for="expense in details.expenses" :key="expense.id" class="transaction" :data-ai-id="`settlement-member-details-expense-record-${expense.id}`"><h3>{{ expense.name }}</h3><p class="meta">{{ formatDateTime(expense.occurredAt) }} · {{ expenseRelation(expense) ? `关联 ${expenseRelation(expense)}` : '未关联销售' }}</p><div class="detail-line"><span>本人垫付</span><b>{{ money(expense.amount) }}</b></div></article></div></details>
            <details data-ai-id="settlement-member-details-receipts"><summary><span>已收销售款</span><b>{{ money(details.totals.salesReceived) }}</b></summary><div class="category-content"><p class="category-note">成交金额扣除平台手续费后的本人收款。</p><p v-if="!receiptRecords.length" class="empty">本次没有由你收取的销售款。</p><article v-for="record in receiptRecords" :key="sourceId(record)" class="transaction" :data-ai-id="`settlement-member-details-receipt-record-${sourceId(record)}`"><h3>{{ record.productName }}</h3><p class="meta">{{ formatDateTime(record.occurredAt) }}</p><div class="detail-line"><span>成交金额</span><b>{{ money(record.totalPrice) }}</b></div><div class="detail-line"><span>平台手续费</span><b>{{ money(record.serviceFee) }}</b></div><div class="detail-line emphasis"><span>本人实收</span><b>{{ money(record.netReceipt) }}</b></div></article></div></details>
            <details v-if="result" data-ai-id="settlement-member-details-profit"><summary><span>利润分成</span><b>{{ money(result.profitAmount) }}</b></summary><div class="category-content"><div class="transaction"><div class="detail-line"><span>本次{{ Number(profitTotal) < 0 ? '净亏损' : '净利润' }}</span><b>{{ money(profitTotal) }}</b></div><div class="detail-line"><span>本人利润比例</span><b>{{ result.profitPercentage }}%</b></div><div class="detail-line emphasis"><span>实际分配金额</span><b>{{ money(result.profitAmount) }}</b></div><p class="meta">{{ confirmed ? '以账单确认时结果为准，分币尾差不在弹窗重新计算。' : '以已有预览结果为准，分币尾差不在弹窗重新计算。' }}</p></div></div></details>
          </div>
        </template>
      </div>
    </section>
  </van-popup>
</template>

<style scoped>
.panel{display:flex;flex-direction:column;height:100%;color:#172033;background:#f5f7fb}.panel-header{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;min-height:76px;background:#fff;border-bottom:1px solid #e4e8f0}.panel-header>div{min-width:0}.panel-header h2{margin:0;font-size:17px;overflow-wrap:anywhere}.panel-header p{margin:4px 0 0;color:#71809a;font-size:12px}.panel-header button{flex:none;min-width:44px;min-height:44px;border:0;border-radius:6px;background:#f2f4f8;color:#536078;font-size:23px}.panel-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:14px 16px calc(20px + env(safe-area-inset-bottom))}.person-summary{background:#fff;padding:14px;border-radius:10px;margin-bottom:12px}.big{display:block;font-size:22px;margin:4px 0}.receivable{color:#008b59}.payable{color:#c1423b}.muted,.meta{color:#71809a;font-size:12px;line-height:1.65;margin:6px 0}.formula{font-size:12px;color:#536078;line-height:1.8}.formula>div,.detail-line{display:flex;justify-content:space-between;gap:12px}.formula b,.detail-line b{white-space:nowrap}.detail-line{font-size:12px;line-height:1.65;margin-top:6px;color:#536078}.detail-line span{min-width:0;overflow-wrap:anywhere}.detail-line b{color:#172033}.emphasis b{color:#3657c8}.notice{padding:12px;border-radius:8px;background:#fff6e9;color:#8c570e;font-size:12px;line-height:1.6;margin:0 0 12px}.notice p{margin:0 0 5px}.categories>details{margin-bottom:10px;border-radius:10px;background:#fff;overflow:hidden}.categories>details>summary{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px;min-height:56px;cursor:pointer;list-style:none;font-size:14px}.categories>details>summary::before{content:'›';color:#8993a7}.categories>details[open]>summary::before{transform:rotate(90deg)}.categories>details>summary span{flex:1}.categories>details>summary b{white-space:nowrap}.categories summary::-webkit-details-marker{display:none}.category-content{padding:0 12px;border-top:1px solid #e4e8f0}.category-note{padding:12px 0;border-bottom:1px solid #e4e8f0;color:#71809a;font-size:12px;line-height:1.65;margin:0}.transaction{padding:14px 0;border-bottom:1px solid #e4e8f0}.transaction:last-child{border:0}.transaction h3{font-size:14px;line-height:1.6;overflow-wrap:anywhere;margin:0}.tag{display:inline-block;border:1px solid #cfd8f8;border-radius:3px;font-size:10px;line-height:16px;padding:0 4px;color:#3657c8;font-weight:400;margin-right:6px}.source{margin-top:8px}.source summary{display:flex;align-items:center;min-height:44px;color:#3657c8;font-size:12px;cursor:pointer;list-style:none}.source-box{padding:10px;background:#f5f7fb;border-radius:8px;font-size:12px;line-height:1.7}.source-box h4{font-size:12px;margin:10px 0 4px}.source-box h4:first-child{margin-top:0}.source-box p{margin:5px 0;color:#536078}.source-item{padding:8px 0;border-bottom:1px solid #e4e8f0}.source-item strong,.consumption p{overflow-wrap:anywhere}.inventory-link{min-height:44px;padding:0;border:0;background:transparent;color:#3657c8;font:inherit}.empty{padding:24px 8px;color:#71809a;text-align:center;font-size:13px;line-height:1.7}.state{min-height:220px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:14px;text-align:center}.state p{margin:0}.panel button{cursor:pointer}.panel button:focus-visible,.panel summary:focus-visible{outline:2px solid #3657c8;outline-offset:-2px}
</style>
