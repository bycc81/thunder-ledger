# 已确认账单明细定位登记

保留 settlement-detail-page、settlement-detail-member-results、settlement-detail-member-result-{userId}、settlement-detail-member-details-{userId}；最后一个由details改为打开面板的button。

复用公共面板的 settlement-member-details-*，完整定义见[前序需求登记](../20261012-settlement-member-details/data-ai-id-registry.md)。

新增 settlement-member-details-snapshot-notice：已确认/历史账单明细来源及缺失提示。动态ID只使用数据库UUID与固定来源枚举，不拼接用户输入，不用ID做CSS。

| ID | 区域/控件 |
| --- | --- |
| settlement-detail-navigation | 顶部账单导航 |
| settlement-detail-loading | 账单加载状态 |
| settlement-detail-error | 账单加载失败 |
| settlement-detail-retry | 账单加载重试 |
| settlement-detail-content | 已确认账单主体 |
