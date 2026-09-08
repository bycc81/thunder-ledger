# `data-ai-id` 注册表：B2 商品资料与图片

本实例遵循 [`docs/standards/frontend/data-ai-id-guidelines.md`](../../standards/frontend/data-ai-id-guidelines.md)。ID 以稳定业务语义命名；重复商品项仅使用将来的稳定商品主键，不使用商品名称、用户输入或随机值。

| ID | 类型 | 所在区域 | 用途 |
|---|---|---|---|
| `product-list-page` | 页面根 | 商品列表 | 当前工作区商品列表定位 |
| `quick-products` | 控件 | 工作区概览快捷操作 | 从当前工作区进入商品列表 |
| `nav-products` | 控件 | 底部主导航 | 进入商品模块并高亮当前页 |
| `product-list-header` | 区域 | 页面标题 | 商品标题和主操作区域 |
| `product-create` | 控件 | 页面标题右侧 | 进入新建商品页面 |
| `product-search` | 输入框 | 搜索区 | 按名称关键词搜索 |
| `product-search-clear` | 控件 | 搜索区 | 清除当前关键词 |
| `product-list` | 区域 | 商品列表 | 商品重复项容器 |
| `product-item-{productId}` | 列表项 | 商品列表 | 打开指定商品详情 |
| `product-list-cover-{productId}` | 图片 | 商品列表项 | 指定商品的第一张图片 |
| `product-list-no-image-{productId}` | 状态区 | 商品列表项 | 指定商品的无图占位 |
| `product-list-loading` | 状态区 | 商品列表 | 列表加载状态 |
| `product-list-empty` | 状态区 | 商品列表 | 无商品状态 |
| `product-search-empty` | 状态区 | 商品列表 | 搜索无结果状态 |
| `product-search-empty-clear` | 控件 | 搜索无结果状态 | 从搜索空态清除关键词 |
| `product-list-error` | 状态区 | 商品列表 | 列表加载失败状态 |
| `product-list-retry` | 控件 | 错误状态 | 重试加载商品列表 |
| `product-list-readonly-notice` | 状态区 | 商品列表 | viewer 列表只读说明 |
| `product-detail-page` | 页面根 | 商品详情 | 指定商品详情定位 |
| `product-detail-topbar` | 区域 | 商品详情顶部 | 返回列表 |
| `product-detail-images` | 区域 | 商品详情内容 | 商品图片轮播或无图占位 |
| `product-detail-image-{assetId}` | 图片 | 商品详情轮播 | 当前展示的指定商品图片 |
| `product-image-carousel-index` | 状态标记 | 商品详情轮播 | 当前图片序号 |
| `product-image-carousel-previous` | 控件 | 商品详情轮播 | 查看上一张图片 |
| `product-image-carousel-next` | 控件 | 商品详情轮播 | 查看下一张图片 |
| `product-image-preview` | 弹层 | 商品详情 | 图片全屏预览根节点 |
| `product-image-preview-close` | 控件 | 图片全屏预览 | 关闭图片预览 |
| `product-image-preview-current` | 图片 | 图片全屏预览 | 当前正在预览的图片 |
| `product-image-preview-index` | 状态标记 | 图片全屏预览 | 当前图片序号 |
| `product-image-preview-previous` | 控件 | 图片全屏预览 | 查看上一张图片 |
| `product-image-preview-next` | 控件 | 图片全屏预览 | 查看下一张图片 |
| `product-detail-content` | 区域 | 商品详情内容 | 名称、描述和参考价 |
| `product-edit` | 控件 | 商品详情 | 进入编辑商品页面 |
| `product-detail-readonly-notice` | 状态区 | 商品详情 | viewer 详情只读说明 |
| `product-form-page` | 页面根 | 新建/编辑商品 | 商品表单定位 |
| `product-form-topbar` | 区域 | 商品表单顶部 | 返回或取消 |
| `product-form` | 区域 | 商品表单 | 商品字段容器 |
| `product-name` | 输入框 | 商品表单 | 商品名称 |
| `product-image-section` | 区域 | 商品表单 | 商品图片管理区域 |
| `product-image-add` | 控件 | 商品图片管理区域 | 选择并添加图片 |
| `product-image-input` | 输入框 | 商品图片管理区域 | 原生多图选择器 |
| `product-image-list` | 区域 | 商品图片管理区域 | 图片缩略图网格 |
| `product-image-item-{assetId}` | 列表项 | 图片缩略图网格 | 指定商品图片 |
| `product-image-first-{assetId}` | 状态标记 | 图片缩略图网格 | 当前第一张图片标记 |
| `product-image-move-first-{assetId}` | 控件 | 图片缩略图网格 | 将图片移到第一张 |
| `product-image-remove-{assetId}` | 危险操作 | 图片缩略图网格 | 请求解除图片关联 |
| `product-image-uploading` | 状态区 | 图片缩略图网格 | 图片上传中状态 |
| `product-image-upload-error` | 状态区 | 图片缩略图网格 | 图片上传失败状态 |
| `product-image-retry-{assetId}` | 控件 | 图片缩略图网格 | 重试失败图片 |
| `product-image-remove-confirm` | 弹窗 | 商品图片管理 | 移除图片关联确认根节点 |
| `product-image-remove-cancel` | 控件 | 移除图片确认弹窗 | 继续保留图片 |
| `product-image-remove-confirm-action` | 控件 | 移除图片确认弹窗 | 确认解除图片关联 |
| `product-description` | 输入框 | 商品表单 | 商品描述 |
| `product-reference-price` | 输入框 | 商品表单 | 商品参考价 |
| `product-form-cancel` | 控件 | 商品表单底部 | 取消或返回来源 |
| `product-form-submit` | 控件 | 商品表单底部 | 提交新建或编辑 |
| `product-form-name-error` | 状态区 | 商品名称字段 | 名称必填错误 |
| `product-form-price-error` | 状态区 | 商品参考价字段 | 金额格式错误 |
| `product-form-saving` | 状态区 | 商品表单 | 保存中状态 |
| `product-discard-confirm` | 弹层 | 商品表单 | 放弃未保存变更确认根节点 |
| `product-discard-cancel` | 控件 | 放弃确认弹层 | 继续编辑 |
| `product-discard-confirm-action` | 控件 | 放弃确认弹层 | 放弃变更并返回 |
| `product-success-toast` | 状态区 | 全局反馈 | 创建或保存成功反馈 |

## 原型专用状态演示

下列 ID 仅用于 `prototype/index.html` 展示状态，后续实现不作为正式业务入口；正式页面仍必须呈现相同状态。

| ID | 类型 | 所在区域 | 用途 |
|---|---|---|---|
| `prototype-state-controls` | 区域 | 商品列表 | 状态演示控制区 |
| `prototype-show-loading` | 控件 | 状态演示控制区 | 展示 Loading |
| `prototype-show-empty` | 控件 | 状态演示控制区 | 展示 Empty |
| `prototype-show-error` | 控件 | 状态演示控制区 | 展示 Error |
| `prototype-reset-state` | 控件 | 状态演示控制区 | 返回默认列表 |
| `prototype-role-toggle` | 控件 | 商品列表 | 切换编辑者/查看者原型视图 |
