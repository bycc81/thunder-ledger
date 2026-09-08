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
import AccountManagementPage from './pages/AccountManagementPage.vue';
import { useAuthStore } from './stores/auth';
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/workspace' },
    { path: '/login', component: LoginPage },
    { path: '/register', component: RegisterPage },
    { path: '/workspace', component: WorkspacePage, meta: { requiresAuth: true } },
    { path: '/batches', component: BatchesPage, meta: { requiresAuth: true } },
    { path: '/batches/:id', component: BatchDetailPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/inventory', component: InventoryPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/inventory/purchases/new', component: PurchaseFormPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/inventory/purchases/:purchaseId/edit', component: PurchaseFormPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/inventory/:productId', component: InventoryPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/transactions', component: TransactionsPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/transactions/sales/new', component: TransactionFormPage, meta: { requiresAuth: true } },
    { path: '/batches/:id/transactions/expenses/new', component: TransactionFormPage, meta: { requiresAuth: true } },
    { path: '/members', component: MembersPage, meta: { requiresAuth: true } },
    { path: '/audit', component: OperationRecordsPage, meta: { requiresAuth: true } },
    { path: '/profile', component: ProfilePage, meta: { requiresAuth: true } },
    { path: '/accounts', component: AccountManagementPage, meta: { requiresAuth: true } },
    { path: '/products', component: ProductsPage, meta: { requiresAuth: true } },
    { path: '/products/new', component: ProductFormPage, meta: { requiresAuth: true } },
    { path: '/products/:id', component: ProductDetailPage, meta: { requiresAuth: true } },
    { path: '/products/:id/edit', component: ProductFormPage, meta: { requiresAuth: true } },
  ],
});
router.beforeEach((to) => {
  if (to.meta.requiresAuth && !localStorage.getItem('accessToken')) return { path: '/login', query: { redirect: to.fullPath } };
  if ((to.path === '/login' || to.path === '/register') && localStorage.getItem('accessToken')) return '/workspace';
  return true;
});
const pinia = createPinia();
const app = createApp(App).use(pinia).use(router);
[Button, Cell, CellGroup, Dialog, DropdownItem, DropdownMenu, Empty, Field, Form, Icon, Loading, NavBar, Picker, Popover, Popup, Radio, RadioGroup, Search, Tabbar, TabbarItem, Tag].forEach((component) => app.use(component));

async function bootstrap() {
  await router.isReady();
  const auth = useAuthStore(pinia);
  await auth.restore();
  if (router.currentRoute.value.meta.requiresAuth && !auth.loggedIn) {
    await router.replace({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } });
  }
  app.mount('#app');
}

void bootstrap();
