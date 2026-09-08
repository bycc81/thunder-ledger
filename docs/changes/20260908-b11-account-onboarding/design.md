# B1.1 技术设计：注册与账号管理

## 结论

基于现有 `users`、`invitations` 和工作区成员模型补齐受邀注册、已有账号加入工作区、系统账号管理和本人改密码。邀请人设置用户名，注册链接只携带一次性凭证；受邀人只设置密码。实施后不开放自由注册，且密码、哈希和完整注册链接均不进入操作记录。

## 风险等级

`L2`。本轮涉及密码、登录会话、系统管理员权限和用户状态。

## 产品与 UX 输入

- 产品与 UX 定义：[product-ux.md](product-ux.md)，已确认。
- HTML 原型：[prototype/index.html](prototype/index.html)，已确认。
- `data-ai-id` 注册表：[data-ai-id-registry.md](data-ai-id-registry.md)。

## 当前实现与缺口

- 已有 `POST /api/auth/register`，但需要调用方提供邀请凭证和用户名；没有预览接口与注册页面。
- 已有成员邀请接口和成员列表，但邀请结果只返回原始凭证；无法把已有账号直接加入工作区。
- `users.status` 已支持 `active/disabled`，但无账号管理接口和会话失效版本。
- 登录 JWT 未绑定用户会话版本；改密码或停用后已签发 JWT 仍可使用到过期。

## 页面/API 契约

### 页面与数据

| 页面区域 | 原型/业务 ID | 展示或编辑字段 | 数据来源 | 权限 | 交互结果 |
|---|---|---|---|---|---|
| 注册页 | `register-page` | 受邀用户名、密码、确认密码 | 邀请预览/注册接口 | 持有有效凭证 | 注册后转登录 |
| 添加成员 | `member-add-dialog` | 方式、用户名、角色、注册链接 | 邀请/加入接口 | 当前工作区 owner/admin | 创建链接或立即刷新成员 |
| 修改密码 | `password-change-dialog` | 当前密码、新密码、确认密码 | 本人密码接口 | 已登录数据库用户 | 更换当前登录令牌 |
| 账号管理 | `account-management-page` | 用户名、状态、创建时间 | 系统账号列表 | 系统管理员 | 开通、停用/恢复、重置密码 |

### 操作与接口边界

| 操作 | 入口 ID | 前置条件 | 接口 | 成功结果 | 失败反馈 | 二次确认 |
|---|---|---|---|---|---|---|
| 查看注册链接信息 | `register-invitation` | 有有效凭证 | `POST /auth/register/preview` | 返回锁定用户名 | 链接无效或过期 | 否 |
| 完成注册 | `register-submit` | 有效邀请、两次密码一致 | `POST /auth/register` | 新账号、个人空间和目标成员关系 | 密码/链接/用户名错误 | 否 |
| 邀请新账号 | `member-add-submit` | owner/admin，用户名未注册 | `POST /workspaces/:id/invitations` | 一次性返回注册链接 | 用户名已存在或字段错误 | 否 |
| 加入已有账号 | `member-add-submit` | owner/admin，用户名已注册 | `POST /workspaces/:id/members/by-username` | 刷新成员 | 未找到账号或字段错误 | 否 |
| 修改本人密码 | `password-change-submit` | 当前密码正确 | `POST /auth/password` | 返回新的登录令牌 | 当前密码或新密码无效 | 否 |
| 获取账号列表 | `account-list` | 系统管理员 | `GET /admin/accounts` | 账号与状态列表 | 无权限 | 否 |
| 开通账号 | `account-create-submit` | 系统管理员 | `POST /admin/accounts` | 新账号及个人空间 | 同名或密码无效 | 否 |
| 停用/恢复账号 | `account-status-confirm` | 系统管理员，目标为普通账号且非本人 | `PATCH /admin/accounts/:id/status` | 状态刷新，会话失效 | 受保护账号或无权限 | 是 |
| 重置密码 | `account-password-reset-submit` | 系统管理员，目标为普通账号 | `POST /admin/accounts/:id/password-reset` | 所有旧会话失效 | 密码无效或无权限 | 否 |

- 请求只传用户名、角色、密码或邀请凭证；不接受前端传入系统管理员标记、账号状态之外的任意用户字段。
- 邀请链接格式为 `/register#token=...`。凭证在 URL 片段中，页面服务器、反向代理和 Referer 默认收不到它；前端读取后仅通过 HTTPS 请求正文发送。
- `GET /admin/accounts` 不返回密码、密码哈希、会话版本或邀请凭证；账号列表只含 `id`、`username`、`status`、`createdAt`、`isSystemAdmin`。
- 密码规则：去除首尾空格后 8–64 位；用户名去除首尾空格后 1–120 位、全局唯一。
- 密码变更、密码重置、停用和恢复均递增 `users.session_version`；JWT 携带该版本，后续请求必须匹配。
- 错误码：`INVITATION_INVALID`、`USERNAME_EXISTS`、`ACCOUNT_NOT_FOUND`、`CURRENT_PASSWORD_INVALID`、`PASSWORD_INVALID`、`ACCOUNT_PROTECTED`、`FORBIDDEN`。

## 方案与影响范围

- 新迁移 `009_account_session_version.sql`：为 `users` 增加默认值为 0 的 `session_version`；不改变已有账号、工作区或邀请数据。
- 后端：在 `access.ts` 实现参数校验、邀请预览、已有账号加入、账号管理、密码变更与会话版本校验；在 `app.ts` 的登录和会话恢复中读取并签发会话版本。
- 前端：新增 `RegisterPage.vue`、`AccountManagementPage.vue`；扩展登录/成员/我的/路由与认证状态。
- 操作记录：使用 `account.create`、`account.status.update`、`account.password.reset`、`account.password.change`、`member.add.existing`；metadata 只存角色或状态，不存凭证和密码。

## 风险、备份与回滚

- 权限：所有账号管理接口先调用认证，再明确检查系统管理员；不能靠隐藏入口保障。工作区加入接口必须检查当前工作区 owner/admin。
- 密码：使用现有 bcrypt，响应、错误、操作记录和日志不含密码、哈希或完整邀请凭证。
- 会话：会话版本让旧 JWT 在下一次请求（包括恢复登录状态）失效；本人改密码后立即替换为新令牌。
- 兼容：数据库不可用时，启动管理员可临时使用旧格式令牌；数据库恢复后，所有账号（含系统管理员）均使用带会话版本的数据库令牌。
- 前端启动：先通过 `/auth/session` 恢复用户名和系统管理员标记，再显示受保护页面；无效登录令牌转到登录页，不能以默认用户名替代实际登录用户。
- 迁移：执行前备份生产数据库；迁移仅加带默认值字段，可回滚应用到旧版本，默认不删除字段。
- 链接：邀请凭证只返回创建人一次；页面不把凭证写入 localStorage。泄露链接在过期或使用前仍可被使用，当前没有撤销邀请功能，留作后续能力。

## 验收标准

- 新账号只能由有效邀请链接注册，邀请人设置用户名，注册后自动加入工作区并建立个人空间。
- 已注册账号可被工作区 owner/admin 直接加入；编辑者/viewer 和跨工作区用户不能调用该接口。
- 系统管理员可开通、停用、恢复、重置普通账号；普通用户和被保护账号操作被拒绝。
- 改密码、重置密码和停用后的旧 JWT 会在下一次请求被拒绝；本人改密码后当前会话保持可用。
- 密码、哈希、完整邀请凭证不出现在 API 结果、操作记录或页面中。

## 开发任务绑定

- 注册页和邀请预览：对应“受邀注册”需求与“新用户加入协作工作区”场景。
- 成员添加方式：对应“已有账号加入成员”需求与其场景。
- 账号管理与密码修改：对应“系统账号管理”需求与其场景。
- 会话版本与测试：对应本设计的安全边界与验收标准。
