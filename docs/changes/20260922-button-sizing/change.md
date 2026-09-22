# Vant 按钮尺寸统一

风险等级：L1（跨页面视觉规范调整，不改业务逻辑、接口或数据）。

## 目标与范围

- 统一 Vant 按钮为紧凑操作 36px、次级操作 40px、主操作 44px、确认/危险操作 44px。
- 将既有 34px、38px、42px 的 Vant 按钮覆盖收敛到上述规格。
- 普通 Vant 按钮默认使用 44px；`size="small"`（Vant 的 `van-button--small`）统一为 36px。
- 仅使用全局角色类：`tl-button--compact`、`tl-button--secondary`、`tl-button--primary`、`tl-button--confirm`；页面样式不得自行设置 Vant 按钮高度。

| 类 | 视觉高度 | 使用场景 |
| --- | --- | --- |
| `tl-button--compact` | 36px | 列表行内操作、字段旁快捷操作、轻量工具 |
| `tl-button--secondary` | 40px | 页头创建/刷新、分页、轮播控制 |
| `tl-button--primary` | 44px | 查询、保存、提交、底部主操作 |
| `tl-button--confirm` | 44px | 弹层最终确认与危险操作 |

未标注角色的普通 Vant 按钮按 44px 主操作处理；`size="small"` 按 36px 紧凑操作处理。

## 验收

- 主操作、保存/提交、确认/危险操作保持 44px。
- 列表行内、快捷操作保持 36px；页头次级操作保持 40px。
- 现有 `data-ai-id`、按钮文案、权限和业务行为不变。
