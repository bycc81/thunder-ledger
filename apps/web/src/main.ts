import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import {
  Button,
  Cell,
  CellGroup,
  Dialog,
  DropdownItem,
  DropdownMenu,
  Empty,
  Field,
  Form,
  Icon,
  Loading,
  NavBar,
  Popover,
  Popup,
  Picker,
  Radio,
  RadioGroup,
  Search,
  Tabbar,
  TabbarItem,
  Tag,
} from 'vant';
import 'vant/lib/index.css';
import './styles/base.css';
import App from './App.vue';
import LoginPage from './pages/LoginPage.vue';
import RegisterPage from './pages/RegisterPage.vue';
import WorkspacePage from './pages/WorkspacePage.vue';
import WorkspaceManagementPage from './pages/WorkspaceManagementPage.vue';
import BatchesPage from './pages/BatchesPage.vue';
import BatchDetailPage from './pages/BatchDetailPage.vue';
import MembersPage from './pages/MembersPage.vue';
import OperationRecordsPage from './pages/OperationRecordsPage.vue';
import ProfilePage from './pages/ProfilePage.vue';
import ProductsPage from './pages/ProductsPage.vue';
import ProductDetailPage from './pages/ProductDetailPage.vue';
import ProductFormPage from './pages/ProductFormPage.vue';
import InventoryPage from './pages/InventoryPage.vue';
import PurchaseFormPage from './pages/PurchaseFormPage.vue';
import TransactionsPage from './pages/TransactionsPage.vue';
import TransactionFormPage from './pages/TransactionFormPage.vue';
import SaleDetailPage from './pages/SaleDetailPage.vue';
import AccountManagementPage from './pages/AccountManagementPage.vue';
import SettlementPage from './pages/SettlementPage.vue';
import SettlementCreatePage from './pages/SettlementCreatePage.vue';
import SettlementDetailPage from './pages/SettlementDetailPage.vue';
import SettlementAdjustmentDetailPage from './pages/SettlementAdjustmentDetailPage.vue';
import ReportsPage from './pages/ReportsPage.vue';
import { useAuthStore } from './stores/auth';
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/workspace' },
    { path: '/login', component: LoginPage },
    { path: '/register', component: RegisterPage },
    { path: '/workspace', component: WorkspacePage, meta: { requiresAuth: true } },
    { path: '/workspace/manage', component: WorkspaceManagementPage, meta: { requiresAuth: true } },
    { path: '/batches', component: BatchesPage, meta: { requiresAuth: true } },
    { path: '/batches/:id', component: BatchDetailPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/inventory', component: InventoryPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/inventory/purchases/new', component: PurchaseFormPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/inventory/purchases/:purchaseId/edit', component: PurchaseFormPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/inventory/:productId', component: InventoryPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/transactions', component: TransactionsPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/transactions/sales/new', component: TransactionFormPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/transactions/sales/:saleId', component: SaleDetailPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/transactions/expenses/new', component: TransactionFormPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/settlements', component: SettlementPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/settlements/new', component: SettlementCreatePage, meta: { requiresAuth: true } },
    { path: '/batches/:id/settlements/:settlementId', component: SettlementDetailPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/settlement-adjustments/:adjustmentId', component: SettlementAdjustmentDetailPage, meta: { requiresAuth: true } },
    { path: '/members', component: MembersPage, meta: { requiresAuth: true } },
    { path: '/audit', component: OperationRecordsPage, meta: { requiresAuth: true } },
    { path: '/reports', component: ReportsPage, meta: { requiresAuth: true } },
    { path: '/profile', component: ProfilePage, meta: { requiresAuth: true } },
    { path: '/accounts', component: AccountManagementPage, meta: { requiresAuth: true } },
    { path: '/products', component: ProductsPage, meta: { requiresAuth: true } },
    { path: '/products/new', component: ProductFormPage, meta: { requiresAuth: true } },
    { path: '/products/:id', component: ProductDetailPage, meta: { requiresAuth: true } },
    { path: '/products/:id/edit', component: ProductFormPage, meta: { requiresAuth: true } },
  ],
});
const pinia = createPinia();
let authRestored = false;
router.beforeEach(async (to) => {
  const auth = useAuthStore(pinia);
  if (!authRestored) {
    await auth.restore();
    authRestored = true;
  }
  if (to.meta.requiresAuth && !auth.loggedIn) return { path: '/login', query: { redirect: to.fullPath } };
  if ((to.path === '/login' || to.path === '/register') && auth.loggedIn) return '/workspace';
  return true;
});
const app = createApp(App).use(pinia).use(router);
[Button, Cell, CellGroup, Dialog, DropdownItem, DropdownMenu, Empty, Field, Form, Icon, Loading, NavBar, Picker, Popover, Popup, Radio, RadioGroup, Search, Tabbar, TabbarItem, Tag].forEach((component) => app.use(component));

window.addEventListener('auth:expired', async () => {
  const auth = useAuthStore(pinia);
  if (!auth.loggedIn) return;
  await auth.logout();
  await router.replace({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } });
});

async function bootstrap() {
  await router.isReady();
  app.mount('#app');
}

void bootstrap();
