# 移动端参考矩阵

## 目的

本矩阵固定 ThunderLedger 移动端迁移时的外部参考边界。参考项目用于工程和交互决策，不作为业务页面、视觉样式或文案的复制来源。

| 项目 | 参考内容 | 不复制内容 |
|---|---|---|
| [vue-zone/vue3-vant-mobile](https://github.com/vue-zone/vue3-vant-mobile) | Vue/Vite 目录、路由、登录壳、NavBar、TabBar、基础状态组织 | 首页业务、主题颜色、文案和图片 |
| [xiangshu233/vue3-vant4-mobile](https://github.com/xiangshu233/vue3-vant4-mobile) | 登录、工作台、权限反馈和设置入口的交互模式 | 仪表盘数据、业务模块和页面布局细节 |
| [fantastic-mobile/basic](https://github.com/fantastic-mobile/basic) | 页面容器、滚动、KeepAlive、路由守卫和移动端工程约定 | 视觉主题、示例页面和非 Vant 组件 |
| Vant 4 | Button、Cell、Form、Dialog、Popup、Tag、Empty、Loading 等组件 | 不再引入 Element Plus 或第二套 UI 组件库 |

## 使用规则

1. 迁移开始时固定仓库地址和版本，后续只针对具体工程问题查阅相关文件。
2. 允许选择性移植通用工程代码；复制 MIT 文件时保留许可证声明，并在技术设计中记录来源。
3. 业务页面必须依据 ThunderLedger 自己的 Product/UX 文档和原型实现。
4. 外部参考不得改变当前工作区上下文、权限规则、批次字段和操作记录范围。

## 版本与文件门禁

本矩阵当前只有仓库地址和借鉴范围，未记录远端 commit；由于当前环境无法取得 GitHub 远端 SHA，暂不将其作为实现放行依据。进入 Vue 重构前必须补充每个项目的 commit、具体文件路径、借鉴点和许可证核对结果；仅有项目链接或“参考其风格”不视为完成。
