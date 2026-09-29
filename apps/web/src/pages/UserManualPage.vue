<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

function back() {
  if (window.history.state?.back) {
    void router.back()
    return
  }
  void router.replace('/workspace')
}
</script>

<template>
  <div class="user-manual-page" data-ai-id="user-manual-page">
    <van-nav-bar title="使用手册" data-ai-id="user-manual-topbar">
      <template #left>
        <button class="back-button" type="button" data-ai-id="user-manual-back" @click="back"><van-icon name="arrow-left" />返回</button>
      </template>
    </van-nav-bar>

    <main class="content">
      <p class="intro">先选择你要完成的操作，再查看对应步骤和不能忽略的规则。</p>

      <h2>先选对操作</h2>
      <nav class="task-list" data-ai-id="user-manual-task-nav" aria-label="操作导航">
        <a class="task" href="#workspace" data-ai-id="user-manual-task-workspace"><span><strong>工作区</strong><small>创建协作空间、切换工作区和管理成员</small></span><van-icon name="arrow" /></a>
        <a class="task" href="#batch" data-ai-id="user-manual-task-batch"><span><strong>批次</strong><small>为一次采购或合买建立独立账本</small></span><van-icon name="arrow" /></a>
        <a class="task" href="#product" data-ai-id="user-manual-task-product"><span><strong>商品</strong><small>维护商品资料、商品组和款式</small></span><van-icon name="arrow" /></a>
        <a class="task" href="#purchase" data-ai-id="user-manual-task-purchase"><span><strong>登记采购</strong><small>商品到货，录入数量、付款和成本</small></span><van-icon name="arrow" /></a>
        <a class="task" href="#sale" data-ai-id="user-manual-task-sale"><span><strong>普通销售</strong><small>卖出一个已有库存商品</small></span><van-icon name="arrow" /></a>
        <a class="task" href="#quick-sale" data-ai-id="user-manual-task-quick-sale"><span><strong>快速售出</strong><small>组合、多商品或不建商品直接卖</small></span><van-icon name="arrow" /></a>
        <a class="task" href="#expense" data-ai-id="user-manual-task-expense"><span><strong>记录费用</strong><small>登记邮费、包装费等垫付支出</small></span><van-icon name="arrow" /></a>
        <a class="task" href="#settlement" data-ai-id="user-manual-task-settlement"><span><strong>创建结算</strong><small>生成利润分配与应收应付</small></span><van-icon name="arrow" /></a>
      </nav>

      <section id="workspace" class="manual-section" data-ai-id="user-manual-workspace-batch-product">
        <h2>工作区、批次与商品</h2>
        <div class="rule-list">
          <article><b>区</b><div><strong>工作区：长期协作空间</strong><p>商品库和成员在工作区内共享。通过顶部当前工作区创建、切换或管理成员；可设置管理员、编辑者和查看者。</p></div></article>
          <article id="batch"><b>批</b><div><strong>批次：一次经营的独立账本</strong><p>建议每次共同采购或合买新建一个批次。采购、库存、交易、费用和结算都按批次隔离。</p></div></article>
          <article id="product"><b>品</b><div><strong>商品：可复用的资料库</strong><p>在“商品”页新建或编辑商品；多款式场景使用商品组，每个款式可独立采购和普通销售。</p></div></article>
        </div>
      </section>

      <section id="sale" class="manual-section" data-ai-id="user-manual-sale-compare">
        <h2>普通销售还是快速售出？</h2>
        <div class="compare-list">
          <article>
            <van-tag type="primary" plain>普通销售</van-tag>
            <h3>一个已有库存商品</h3>
            <ul><li>选择商品和数量，数量不能超过可卖库存。</li><li>保存后扣减该商品库存。</li><li>结算成本按库存成本计算。</li></ul>
          </article>
          <article>
            <van-tag type="primary" plain>快速售出</van-tag>
            <h3>一次卖多件或自由录入</h3>
            <ul><li>可添加多个商品项，商品名自由填写。</li><li>每项可不关联库存，也可多选关联库存。</li><li>结算成本以每项填写的本单成本为准。</li></ul>
          </article>
        </div>
      </section>

      <section id="quick-sale" class="manual-section" data-ai-id="user-manual-quick-sale">
        <h2>快速售出重点</h2>
        <div class="rule-list">
          <article><b>1</b><div><strong>本单成本必须填写</strong><p>每个商品项都要填写本单成本；可以填 0，但不能留空。</p></div></article>
          <article><b>2</b><div><strong>关联库存可多选</strong><p>开启关联库存后，可添加多个已有库存商品，并分别填写关联数量。</p></div></article>
          <article><b>3</b><div><strong>只扣被关联的库存</strong><p>未关联库存的商品项不会扣库存，也不会自动创建商品或采购记录。</p></div></article>
          <article><b>4</b><div><strong>数量不一致需要确认</strong><p>售出数量和关联库存数量可以不同；保存前会提示确认，系统不会自动改数。</p></div></article>
        </div>
        <p class="note">快速售出详情会同时显示“本单成本”和“库存账消耗成本”：结算使用本单成本，库存账成本用于维护剩余库存成本。</p>
      </section>

      <section id="purchase" class="manual-section" data-ai-id="user-manual-inventory-settlement">
        <h2>采购、费用与结算</h2>
        <div class="rule-list">
          <article><b>购</b><div><strong>采购形成库存</strong><p>总成本允许为 0；成本承担合计必须等于总成本。</p></div></article>
          <article id="expense"><b>费</b><div><strong>费用最多关联一种交易</strong><p>费用可关联普通销售或快速售出；关联后会随该交易自动进入结算。</p></div></article>
          <article id="settlement"><b>结</b><div><strong>结算会同时纳入两类销售</strong><p>勾选普通销售和快速售出，确认利润比例后生成锁定的阶段账单。</p></div></article>
        </div>
      </section>

      <section class="manual-section" data-ai-id="user-manual-faq">
        <h2>常见问题</h2>
        <div class="faq-list">
          <details data-ai-id="user-manual-faq-quick-sale-cost"><summary>快速售出不关联库存可以吗？</summary><p>可以。仍需填写商品名、数量、本单成本、成交总价和卖出人；不会扣库存，也不会创建商品。</p></details>
          <details data-ai-id="user-manual-faq-inventory"><summary>为什么普通销售里的可卖数量变少了？</summary><p>除普通销售和损坏/丢失外，已关联库存的未撤销快速售出也会占用并扣减可卖库存。</p></details>
          <details data-ai-id="user-manual-faq-reverse"><summary>能撤销已结账交易吗？</summary><p>不能。已结账交易不能直接撤销，需要通过既有的结算调整流程处理。</p></details>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.user-manual-page { min-height: 100vh; background: #f5f7fb; }
.user-manual-page :deep(.van-nav-bar) { position: sticky; top: 0; z-index: 2; }
.back-button { display: inline-flex; min-width: 44px; min-height: 44px; align-items: center; gap: 2px; padding: 0; border: 0; background: transparent; color: #3657c8; font: inherit; }
.content { padding: 18px 16px 32px; }
.intro { margin: 0 0 14px; color: #71809a; font-size: 13px; line-height: 1.55; }
h2 { margin: 24px 0 9px; color: #172033; font-size: 17px; }
h3 { margin: 10px 0 4px; color: #172033; font-size: 15px; }
.task-list, .rule-list, .faq-list { overflow: hidden; border-radius: 10px; background: #fff; box-shadow: 0 1px 0 #e4e8f0; }
.task { display: flex; min-height: 58px; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-bottom: 1px solid #edf0f5; color: inherit; text-decoration: none; }
.task:last-child, .rule-list article:last-child, .faq-list details:last-child { border-bottom: 0; }
.task strong, .task small { display: block; }
.task strong { margin-bottom: 3px; color: #172033; font-size: 15px; }
.task small { color: #71809a; font-size: 12px; line-height: 1.35; }
.task :deep(.van-icon) { flex: 0 0 auto; color: #8993a7; font-size: 18px; }
.compare-list { display: grid; gap: 8px; }
.compare-list article { padding: 14px; border-radius: 10px; background: #fff; box-shadow: 0 1px 0 #e4e8f0; }
.compare-list ul { margin: 9px 0 0; padding-left: 19px; color: #536078; font-size: 13px; line-height: 1.65; }
.rule-list article { display: flex; gap: 12px; padding: 12px; border-bottom: 1px solid #edf0f5; scroll-margin-top: 72px; }
.rule-list b { display: grid; width: 24px; height: 24px; flex: 0 0 auto; place-items: center; border-radius: 50%; background: #eef2ff; color: #3657c8; font-size: 12px; }
.rule-list strong { display: block; margin-bottom: 3px; color: #172033; font-size: 14px; }
.rule-list p, .faq-list p { margin: 0; color: #536078; font-size: 13px; line-height: 1.55; }
.note { margin: 10px 0 0; padding: 10px 12px; border-radius: 8px; background: #edf1ff; color: #2949aa; font-size: 13px; line-height: 1.5; }
details { border-bottom: 1px solid #edf0f5; }
summary { display: flex; min-height: 52px; align-items: center; padding: 0 12px; color: #172033; cursor: pointer; font-size: 14px; font-weight: 600; list-style: none; }
summary::after { margin-left: auto; color: #8993a7; content: '⌄'; font-size: 18px; }
details[open] summary::after { transform: rotate(180deg); }
.faq-list p { padding: 0 12px 12px; }
.back-button:focus-visible, .task:focus-visible, summary:focus-visible { outline: 2px solid #3657c8; outline-offset: -2px; }
</style>
