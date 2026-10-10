# 生产化准备清单（持续更新）

> 当前状态：已补生产化骨架，尚未达到可直接承载正式业务的生产验收状态。
> 外部连接、身份组、业务规则、域名和密钥均保留占位符。本地试点数据不会自动同步企业源系统。

## 1. 代码已具备的保护

- 运行环境隔离：本地默认 SQLite + AUTH_MODE=disabled，只监听 127.0.0.1；生产配置缺项时拒绝启动。
- 身份与权限入口：生产要求在可信反向代理之后，使用企业 OIDC/SAML 身份网关注入 X-Auth-Request-*；服务端按角色控制模块写操作。当前不是原生 OIDC 客户端，也未实现项目级/数据级授权。
- 关键请求审计：记录用户、角色、HTTP 方法、路径、状态、请求 ID、来源 IP 和 UA；不记录请求正文。仍需安全团队确认保存期限、防篡改和访问策略。
- 数据库门禁：生产要求 PostgreSQL 与 alembic_version；Web 进程不在启动时自动建生产表。正式 schema 变更必须通过经过审查的 Alembic migration。
- 健康状态与日志：提供 /health/live、/health/ready、请求日志、请求 ID 和可选 Prometheus 指标。
- Excel 导入保护：上传大小、工作表数量、列数、ZIP 条目数量、解压体积、压缩比限制；文件名与存储路径校验；上传文件按保留期清理；超过预览上限明确提示并禁止部分导入。
- 幂等与 DCP 基础规则：问题行指纹不依赖 Excel 行号/Sheet 名；确认批次使用 PostgreSQL 行锁保护并发重复确认；每个项目 DCP gate 唯一；DCP 顺序规则需要业务选定后才允许生产配置。
- 部署骨架：Dockerfile 使用非 root 用户；Compose 隔离 PostgreSQL、应用、OIDC 代理和 Nginx TLS 入口；应用容器不直接发布到宿主机端口；备份任务使用只读 PostgreSQL 备份角色，同时归档上传文件目录、检查归档列表并计算 SHA-256（完整恢复仍需演练）。
- 自动测试：CI 覆盖现有 API、DCP、身份/RBAC、Excel 安全与语法。CI 通过不能替代安全、性能或灾备验收。

## 2. 上线前必须填写的真实信息

| 占位项 | 提供方 | 不提供时的处理 |
|---|---|---|
| SERVER_NAME、TLS 证书与可信入口网络 | IT/运维 | 不能对外发布 |
| OIDC_ISSUER_URL、OIDC_CLIENT_ID、密钥、企业邮箱域、已批准 oauth2-proxy 镜像 tag | IT/身份平台 | 认证网关不能启动 |
| AUTH_ADMIN_GROUPS、AUTH_QUALITY_GROUPS、AUTH_PM_GROUPS、AUTH_ENGINEERING_GROUPS、AUTH_VIEWER_GROUPS 对应真实 IdP 组名 | 各系统 owner/IT | 生产应用拒绝启动 |
| PostgreSQL 主机、数据库、最小权限账号、DB_PASSWORD、TLS 要求 | DBA | 不能启动生产模式 |
| DCP_GATE_POLICY（sequential 或 independent） | PMO/DCP 负责人 | 生产应用拒绝启动 |
| IMPORT_DEDUPE_POLICY（content 或 row_instance） | 质量数据负责人 | 生产应用拒绝启动；须确认相同内容是重复问题还是独立事件 |
| BOM_POLICY_VERSION、规则文档、替代料批准条件、规格匹配阈值 | 工程/标准化负责人 | 不能用于正式 BOM 放行 |
| QMS / PLM / problem-hub / pm-platform 的测试与生产地址、API 文档、服务账号、字段映射、限流、幂等键 | 各系统 owner | 只显示“待接入”，不伪装已连接 |
| 模型网关、模型名、密钥、超时/重试/限流/脱敏/保留规则 | AI 平台与安全团队 | 保持规则引擎；不启用模型功能 |
| 数据保留、RPO/RTO、异地备份、恢复演练频率 | DBA/业务负责人 | 不通过灾备验收 |
| 正式测试样本和业务验收标准 | 质量、PMO、工程 | 不可宣称业务验收通过 |

凭证只通过受控 Secret Manager 或部署环境注入。不要将真实 .env、密钥、数据库密码、token 或生产数据提交到 Git。备份角色的密码也须使用受控密钥管理，且至少 24 位，仅使用英文字母、数字、点、下划线和连字符。

## 3. 首次部署（先在测试环境演练）

1. 复制 .env.example 为受控部署配置并填写必填项；真实凭证只放安全的部署环境中。
2. 填写 OIDC_ISSUER_URL、OIDC_CLIENT_ID、OIDC_CLIENT_SECRET、OIDC_EMAIL_DOMAINS、OAUTH2_PROXY_COOKIE_SECRET、OAUTH2_PROXY_IMAGE、SERVER_NAME 和 TLS 证书。
3. 确认 IdP 返回 groups claim，并验证 Nginx 会覆盖客户端传入的 X-Auth-Request-*。只允许 Nginx 访问应用，禁止直接暴露应用和数据库端口。
   同时手动将 `deploy/nginx.conf` 中的 `server_name workbench.example.invalid` 替换为真实域名，并把匹配该域名的证书放到 `deploy/tls/fullchain.pem` 和 `deploy/tls/privkey.pem`；当前只是路径占位，不包含企业证书签发/续期配置。
4. 先明确当前 SQLite 试点数据是否需要保留。**当前没有自动 SQLite→PostgreSQL 数据迁移工具**，如需保留台账/批次/上传附件，必须单独制定并验证转换、条数对账和回滚方案；不要仅修改 DATABASE_URL 后就认为数据已迁移。由 DBA 确认生产库、网络和 TLS 策略。演练迁移：docker compose -f docker-compose.production.yml run --rm migrate。
5. 测试环境先启动并验证：docker compose -f docker-compose.production.yml up -d db migrate app auth-proxy nginx。验证登录、角色权限、健康检查和外部系统状态页。
6. 先为备份目录创建权限受控的宿主机持久化目录（容器备份进程 UID/GID 为 10001；例如创建目录后执行 sudo chown 10001:10001 ./backups 并设置 700 权限）。在 Compose 的 ops profile 下运行备份任务：docker compose -f docker-compose.production.yml --profile ops run --rm backup。它会一起备份 PostgreSQL 和上传文件目录；再在隔离环境做完整恢复演练并记录恢复时间。归档列表检查成功并不等于已证明可恢复。
7. 配置日志收集、告警、磁盘/DB 容量监控、证书续期、漏洞扫描、备份告警与回滚责任人。

配置模板不会自动创建企业身份应用、TLS 证书、防火墙规则或数据库凭证。 PostgreSQL 初始化脚本 deploy/postgres-init/01-backup-role.sh 仅在空数据卷首次创建数据库时自动执行；如果数据库卷已存在，请由 DBA 手动执行 docker compose -f docker-compose.production.yml exec -T db bash /docker-entrypoint-initdb.d/01-backup-role.sh，核对备份角色权限后再启用备份任务。

## 4. 备份、恢复与发布要求

- 备份目录应位于独立持久化卷/对象存储；配置异地副本、加密、最小权限和生命周期。
- 由业务和运维签字确认 RPO（可容忍的数据丢失量）与 RTO（恢复时限），当前均为待确认。
- 每次发布前运行全量自动测试、备份数据库、检查迁移，再升级；失败时停止发布。
- 回滚优先通过已验证的应用镜像回退或前向兼容 migration；禁止对正式数据执行未经审核的 destructive downgrade。
- 完整恢复演练需验证 PostgreSQL、上传文件、环境配置/密钥恢复、审计日志、身份登录和核心业务用例。
- /metrics 默认关闭且 Nginx 外网禁止访问；若启用，只能由受控内网监控网络抓取。

## 5. 明确尚未实现的能力

- 企业身份：已具备可信代理身份读取、角色映射和启动门禁；IdP、组名、回调/会话策略仍需企业环境配置并做安全验收。
- 数据级权限：当前是模块/路由角色，不含项目归属、组织、区域、行级数据授权。
- 业务系统同步：状态页只报告 endpoint 是否配置；adapter_implemented=false 代表 QMS、PLM、problem-hub、pm-platform 真实适配器尚未实现。
- 问题闭环：本地问题经验主要是导入与台账；整改责任流转、审批、关闭/重开与源系统写回需按真实 QMS 流程实现。
- AI 识别：当前只使用规则引擎；模型网关变量仅为占位，尚未实现模型适配器、提示词版本、评估集、证据引用或敏感信息脱敏链路。
- BOM 合规：当前使用本地物料档案与确定性规则；相似件/替代件候选不是工程等效判断，未连接 PLM，不能用于量产放行。
- 业务规则：DCP 顺序/独立策略可配置；风险等级与项目进度仍由操作者维护，不代表 PMO 已批准算法。
- 性能与安全认证：仍需真实并发压测、依赖/CVE 扫描、渗透测试、恢复演练、用户验收与可观测性验收。

## 6. 发布验收记录（待补）

- 旧 SQLite 数据处理决策/对账记录：待填写\n- 业务验收负责人：待填写
- 安全/身份审批单：待填写
- DBA 迁移审批与恢复演练记录：待填写
- 生产域名/环境/发布窗口：待填写
- RPO / RTO / 保留期：待填写
- 性能目标（并发、响应时间、批量导入规模）：待填写
- 回滚负责人、通知渠道与回滚演练日期：待填写
- QMS / PLM / PM / 模型接口文档版本：待填写
