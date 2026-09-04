# 技术设计：B1 移动端工作台

## 状态

Product/UX 原型已确认，进入实现。当前采用单一移动端入口，复用现有认证、权限和工作区 API。

## 风险等级

`L2`：涉及认证、权限、路由入口和整套前端界面迁移；本阶段不修改后端数据结构。

## 实现边界

- 在 `apps/web` 内使用 Vue 3、Vue Router、Pinia 和 Vant 4。
- 复用现有 API、认证会话和工作区范围参数。
- 公共业务组件提供 `aiId?: string` 并输出 `data-ai-id`。
- 技术设计必须引用已确认的 `product-brief.md`、`ux-spec.md` 和原型。
- 参考实现采用 `vue-zone/vue3-vant-mobile` 的移动端壳思路、`xiangshu233/vue3-vant4-mobile` 的登录/权限交互思路和 `fantastic-mobile/basic` 的页面容器思路；不复制其业务页面。
- 通过 `data-ai-id` 固定页面区域、交互控件、弹窗、列表项和危险操作的自动化定位契约。
