# 大邑䢺江镇青梅产业农商文旅综合平台

一颗梅子，从山上到桌上。摘梅、酿酒、住店、赶集，都在这一个平台里。

本项目是一份**开箱即跑的完整交付**：一个 Python 服务同时提供数据接口、游客 H5、商户 H5 工作台、PC 管理后台，并附带可直接导入微信开发者工具的游客小程序工程。所有业务数据落在同一个 SQLite 库里，三端看到的永远是同一本账。小程序默认内置模拟数据，**不启动服务也能独立跑通全部页面**。

---

## 一、快速开始

### 环境要求

| 项目 | 要求 |
| --- | --- |
| Python | 3.10 及以上（需加入 PATH） |
| 依赖 | 默认仅 `Flask==3.0.3`，由启动脚本自动安装；可选 AI 扩展多一个纯 Python 的 `PyMySQL==1.1.1` |
| 数据库 | 业务数据用 Python 自带 SQLite，无需安装数据库服务；可选 AI 问答会话存 MySQL（见第六节） |
| 前端 | 纯 HTML/CSS/JS，无需 Node、无需构建、无需打包 |
| 浏览器 | Chrome / Edge 等现代浏览器 |
| 小程序（可选） | 微信开发者工具，导入 `mp-weixin/` 即可；默认用内置模拟数据 |

默认不接外部模型服务、外部地图服务或第三方组件，因此**开箱即跑不需要任何访问凭据或配置项**。若要启用外部大模型问答与 MySQL 会话存储，见「六、外部大模型问答（可选扩展）」；不启用时本项目仍是零外部依赖、断网可跑。

### 一键启动

**Windows**：双击项目根目录下的 `start.bat`。脚本会自动安装依赖、建库、灌入基准数据、启动服务并打开浏览器。

**任意平台**：在项目根目录执行

```bash
python start.py
```

启动参数：

| 命令 | 作用 |
| --- | --- |
| `python start.py` | 正常启动，保留已有数据 |
| `python start.py --reset` | 重建基准数据后再启动（回到演示初始状态） |
| `python start.py --port 9000` | 改用 9000 端口（小程序切到 `local` 环境时，同步改 `mp-weixin/config/index.js` 里的 `baseUrl`） |
| `python start.py --no-browser` | 不自动打开浏览器 |
| `python start.py --reset --port 9000` | 参数可组合 |

服务默认监听 `0.0.0.0:8080`，`Ctrl+C` 停止。

### 访问地址

| 入口 | 地址 | 形态 |
| --- | --- | --- |
| 门户导航页（角色入口） | http://127.0.0.1:8080/ | PC 桌面 |
| 消费者 PC 站 | http://127.0.0.1:8080/consumer | PC 桌面 |
| 商户 PC 工作台 | http://127.0.0.1:8080/biz | PC 桌面 |
| PC 管理后台 | http://127.0.0.1:8080/admin | PC 桌面 |
| 游客 H5 | http://127.0.0.1:8080/visitor | 手机 |
| 商户 H5 工作台 | http://127.0.0.1:8080/merchant | 手机 |
| 健康检查 | http://127.0.0.1:8080/health | 接口 |

> 各端登录态按命名空间独立保存，同一浏览器可以同时登录消费者、商户与管理员，互不顶号；PC 站在小屏下会提示切到对应 H5。

### 演示账号

| 角色 | 账号 | 口令 | 入口 |
| --- | --- | --- | --- |
| 平台管理员 | `admin` | `admin123` | `/admin` |
| 青梅合作社商户 | `farmer01` | `merchant123` | `/biz`、`/merchant` |
| 梅香居民宿商户 | `stay01` | `merchant123` | `/biz`、`/merchant` |
| 游客 | `tourist01` | `tourist123` | `/consumer`、`/visitor`、小程序登录页 |

账号数据由 `server/db.py` 在首次启动时写入，仅供本地演示；口令以不可逆摘要存储。小程序 `mock` 环境内置了同名账号，不依赖数据库。

### 验收

服务启动后另开一个终端：

```bash
python tests/smoke_test.py
```

脚本会重建基准数据，逐项验证三端登录、首页聚合、采摘预约与核销、研学报名、民宿预订、商城下单支付发货、打卡集章、AI 四项能力、三类审核、活动发布、数据看板、越权与非法入参等边界条件，最后打印通过数并给出退出码（0 为全通过）。当前结果：**45 项全部通过**。

还可用真实浏览器做一次界面巡检（需要本机 Chrome 或 Edge；仅巡检需要额外安装 `websocket-client`，启动项目不需要）：

```bash
python -m pip install websocket-client
python tests/ui_audit.py
```

它会打开门户、后台、游客 H5、商户工作台共 8 个场景，检查控制台异常、接口失败、破图与可疑占位文本，并把截图写到 `docs/screenshots/`。当前结果：**8 个场景全部干净**。

两个 PC 站另有独立巡检：

```bash
python tests/pc_audit.py
```

它走门户、消费者站 5 个页面、商户工作台 3 个页面与后台看板，额外检查 900px 宽度下是否横向溢出，并验证三端会话互不顶号；截图写到 `docs/screenshots/pc_*.png`。当前结果：**22 个场景全部干净**。

小程序可单独做离线验收（只需 Node，不需要启动服务或开发者工具）：

```bash
node tests/mp_weixin_smoke.js
```

脚本用最小 `wx` 实现加载小程序真实模块，检查工程结构、页面完整性、WXML 事件绑定，并跑通登录、首页、分页、详情、下单支付、预约、集章、缓存、故障注入与 401 广播。当前结果：**23 项全部通过**。

---

## 二、目录结构

```
plum-platform/
├── start.bat                  Windows 一键启动（装依赖 → 起服务 → 开浏览器）
├── start.py                   跨平台一键启动，支持 --reset / --port / --no-browser
├── requirements.txt           唯一依赖 Flask==3.0.3
├── README.md                  本文件
├── docs/
│   ├── 开发任务书.md           功能清单、接口、状态机、边界条件、输入输出、验收标准
│   ├── 目录与运行说明.md       逐文件说明、安装步骤、小程序导入、故障排查
│   └── screenshots/           界面巡检生成的 8 张三端 + 12 张 PC 端截图（PNG）
├── server/                    后端（Flask + SQLite）
│   ├── __init__.py
│   ├── app.py                 应用装配、四组 API、静态托管、统一异常与日志
│   ├── db.py                  21 张业务表、基准数据、金额与查询助手
│   ├── api_common.py          统一响应、校验、会话、分页、幂等、操作日志
│   ├── state_machine.py       订单 / 预约 / 审核 / 上下架四组统一状态机
│   ├── api_business.py        游客端与公共业务接口 `/api`
│   ├── api_merchant.py        商户工作台接口 `/api/merchant`
│   ├── api_admin.py           PC 后台接口 `/api/admin`
│   ├── api_ai.py              本地 AI 四项能力 + 外部模型编排 `/api/ai`
│   ├── ai_config.py           可选扩展域：配置读取、数值钳制、密钥脱敏
│   ├── llm_client.py          可选扩展域：OpenAI 兼容调用，仅用标准库 urllib
│   └── ai_store.py            可选扩展域：MySQL 会话/消息/日志，失败降级内存
├── web/                       全部页面（纯静态，无构建）
│   ├── index.html             PC 门户：三张 PC 入口 + 移动端入口 + 按端登录态
│   ├── consumer.html          消费者 PC 站：顶部横排导航 + 桌面双栏
│   ├── biz.html               商户 PC 工作台：侧栏 + 顶栏 + 数据表格
│   ├── visitor.html           游客 H5
│   ├── merchant.html          商户 H5 工作台
│   ├── admin.html             PC 管理后台
│   └── assets/
│       ├── common.css         统一设计令牌（颜色、图片比例、表格、图表、后台框架）
│       ├── common.js          请求封装、按端隔离的会话、通用组件、SVG 图表、hash 路由
│       ├── pc.css             PC 桌面层：侧栏/顶栏、数据表格、主从详情、表单、弹层、断点
│       ├── pc.js              PC 组件层：面包屑、分页、表格、表单校验、弹层/抽屉、角色守卫
│       ├── consumer.js        消费者站：列表分页、详情、购物车下单、我的、集章、AI 抽屉
│       ├── biz.js             商户工作台：概览、场次、房态、商品、订单发货、统一核销
│       ├── visitor.js         游客 H5 全部页面逻辑
│       ├── merchant.js        商户 H5 工作台逻辑
│       └── admin.js           PC 后台逻辑
├── mp-weixin/                 游客小程序工程（原生框架，可直接导入开发者工具）
│   ├── project.config.json    工程配置（开发者工具测试号，已关闭域名校验）
│   ├── app.json               5 个页面 + 3 个 tabBar + 全局窗口配置
│   ├── app.js                 全局环境、401 统一跳转、tab 间参数与数据版本
│   ├── app.wxss               统一设计系统、图片占位、表单、弹层、点位图
│   ├── sitemap.json           索引配置
│   ├── config/index.js        环境中心：mock / local / lan，超时、分页、缓存时长
│   ├── utils/
│   │   ├── request.js         可替换传输层、会话头、统一解包、重试、401 广播
│   │   ├── auth.js            会话存取、7 天有效期、角色校验、登录守卫
│   │   └── cache.js           TTL 缓存、清理（可保留收藏）、容量统计
│   ├── services/api.js        业务接口集中定义、图片补全、分页对齐、幂等号
│   ├── mock/data.js           园区/商品/研学/民宿/订单/账号等本地模拟数据
│   ├── mock/server.js         本地模拟服务端：分页、鉴权、幂等、故障注入
│   └── pages/
│       ├── index/             首页：轮播、点位图、节庆、好物、AI 问答、下拉刷新
│       ├── list/              列表页：四门类、分类筛选、搜索、分页触底加载
│       ├── detail/            详情页：多类型、收藏、下单/预约/报名/订房
│       ├── mine/              个人中心：单据、集章、收藏、环境与缓存管理
│       └── login/             登录页：真实登录请求、角色校验、演示账号
├── assets/                    33 张统一规格图片（18 PNG + 15 WebP）
├── tests/
│   ├── smoke_test.py          接口端到端验收（45 项）
│   ├── ui_audit.py            三端界面巡检与截图（可选，8 个场景）
│   ├── pc_audit.py            PC 桌面巡检与截图（22 个场景，含会话隔离与 900px 溢出检查）
│   └── mp_weixin_smoke.js     小程序离线验收（23 项，不需要开发者工具与服务）
├── tools/
│   ├── verify_ai_qa.py        AI 扩展域离线验收（56 项，不需网络/MySQL/服务）
│   ├── init_ai_db.py          一键建 MySQL 库表
│   ├── verify_map.py          三端地图锚点验收
│   └── verify_mp_images.js    手机端图片链路验收
├── deploy/                    开机自启动与简化部署（Windows bat/ps1 + Linux systemd）
├── sql/ai_qa.sql              AI 问答域 MySQL 建表脚本（4 张表）
├── ai.env.example             AI 扩展域配置模板（复制为 ai.env 后填写）
├── requirements-ai.txt        可选依赖：Flask + PyMySQL==1.1.1
├── docs/AI问答系统说明.md      外部大模型接入、配置项、职责边界、部署与排错
└── data/                      SQLite 数据库文件 plum.db（首次启动自动生成）
```

完整的逐文件说明见 `docs/目录与运行说明.md`。

---

## 三、三端如何打通

| 环节 | 游客端 | 商户工作台 | PC 后台 |
| --- | --- | --- | --- |
| 采摘预约 | 挑场次 → 拿核销码 | 排场次 → 到场核销 | 审场次 → 看预约走势 |
| 农特商城 | 加购 → 下单 → 支付 | 改价库存 → 发货 | 审商品 → 看销售额 |
| 研学 / 民宿 | 报名 / 预订 → 拿码 | 同一入口核销 | 发活动 → 看汇总 |
| 状态流转 | 四组状态机只有一份实现，三端与小程序读取同一个库 | | |

技术约定：

- **一套库**：`data/plum.db`，21 张表；金额一律以「分」为整数存储，对外统一转成两位小数字符串。
- **一套接口**：`/api`、`/api/merchant`、`/api/admin`、`/api/ai` 四组 Blueprint；统一响应 `{"code":200,"msg":"success","data":...}`。
- **一套会话、按端隔离**：登录返回会话标识，后续请求放在 `X-Session-Id` 请求头，四组 Blueprint 的契约完全一致。Web 端由 `common.js` 按访问路径写入各自的 `plum_<端>_sid` / `plum_<端>_user`，消费者站、商户工作台、后台与两个 H5 可以同时登录、互不顶号；门户只用 `Session.all()` 只读列出已登录身份。小程序会话独立保存在 `wx.setStorageSync` 并强制校验「游客」角色。前端守卫之外，后端 `require_login(*roles)` 始终是最终防线。
- **一套状态机**：`server/state_machine.py`，非法迁移统一返回 409，重复操作返回 409/422。
- **一次核销**：采摘预约、研学报名、民宿预订三类业务共用 `CK` 开头的核销码，商户工作台一个输入框全部核销。
- **统一图表**：后台看板接口返回 `{labels, series:[{name,data}]}`，前端 `Charts.draw` 用同一套 SVG 画布渲染柱状/折线图，尺寸、配色、字号完全一致。
- **统一图片**：`.img-16-9` / `.img-4-3` / `.img-1-1` 三种比例，统一 `object-fit: cover`、统一占位图；小程序 `app.wxss` 使用同样的比例和配色，`mock` 环境用纯 CSS 渐变占位块，不加载任何外部图片。

---

## 四、本地 AI：说人话，说真话

四项能力全部读取平台业务库的**实时**数据，不接外部模型，不编造价格、余位和名称：

| 能力 | 接口 | 数据来源 |
| --- | --- | --- |
| 知识库客服 | `POST /api/ai/chat` | 知识库问答 + 园区 / 场次 / 商品 / 民宿实时查询 |
| 产品与活动文案 | `POST /api/ai/generate` | 商品、节庆表真实名称与价格 |
| 智能行程规划 | `POST /api/ai/itinerary` | 园区、研学、民宿、时令提示 |
| 语音讲解稿 | `POST /api/ai/tts` | 园区或打卡点真实介绍、开放时间、票价 |

文案会洗掉「赋能、助力、一站式」这类机械套话，改用镇上人说话的短句。H5 端用浏览器自带语音合成朗读讲解稿，小程序端展示同一份讲解稿全文（小程序没有浏览器语音能力，所以只展示文本）。`mock` 环境的 AI 答案同样取自 `mock/data.js` 的模拟业务数据，不是写死的占位文案。

以上四项默认全本地、零外部依赖。另有可选的「外部大模型 + MySQL 会话」扩展域：默认关闭，启用后由外部模型组织语言、平台实时数据提供事实，失败自动回退本地答案；详见「六、外部大模型问答（可选扩展）」与 `docs/AI问答系统说明.md`。

---

## 五、小程序导入

小程序默认是 **`mock` 环境**：`mock/server.js` 在小程序进程内按真实后端契约返回数据，因此**不需要启动 Python 服务**，导入即可跑通登录、列表分页、下单、预约、集章等全部流程。

1. 微信开发者工具 → 「导入项目」→ 目录选择 `mp-weixin/`。`project.config.json` 已填 AppID `wxcc4cd9c826fa3e71`；若该 AppID 不属于当前微信账号，或账号没有这个小程序开发者权限，请换成自己的 AppID，或改用开发者工具的「测试号」再预览。
2. 点「编译」。首页直接出数据；「我的」页点「去登录」，用 `tourist01 / tourist123`（登录页有一键填入按钮）。
3. 想连真实后端：先运行 `start.bat` 或 `python start.py`，然后在「我的 → 设置 → 数据源」切到 `local`（`http://127.0.0.1:8080`）。切换后业务代码零改动，`mock/server.js` 不再被调用。
4. `local` / `lan` 模式下，在「详情 → 本地设置」勾选**不校验合法域名、web-view、TLS 版本以及 HTTPS 证书**（本地 HTTP 服务必须）。
5. 真机预览：在「我的 → 设置 → 改局域网地址」填电脑的局域网 IP（例如 `http://192.168.1.8:8080`），再把数据源切到 `lan`，手机与电脑连同一 Wi-Fi。
6. 验收错误处理：「我的 → 设置 → 故障注入」可模拟 401 / 500 / 网络断开 / 慢网络，用来检查自动跳登录、重试与错误态。

也可以在代码里固定环境：改 `mp-weixin/config/index.js`，或运行时调用 `require('./config/index.js').setEnv('local')`。所有接口都在 `services/api.js` 里定义，页面不拼 URL、不感知环境。

首页「青梅园点位」采用包内本地高保真地形底图（`mp-weixin/images/map_base.jpg`，由 `tools/gen_map_base.py` 离线生成），叠加 CSS 点位、地名注记、图例、比例尺与指北针。底图随小程序包分发，不调用任何在线地图服务、不需要地图凭据，`mock` 断网环境同样正常显示。底图标定锚点见 `mp-weixin/pages/index/index.js` 的 `PIN_ANCHORS`，改动后运行 `python tools/verify_map.py` 校验。

**手机端图片与界面**：业务图片由 `tools/build_mp_photos.py` 压缩后打包进 `mp-weixin/images/photos/`（33 张、约 750 KB），默认 `mock` 直接用包内图，不依赖 127.0.0.1、局域网或 HTTPS；远程图若加载失败，`binderror` 会自动降级到包内同名图。首页接口连不上时会回落到包内模拟数据（`api.getHomeOffline()`），界面与地图不会空白。可用 `node tools/verify_mp_images.js` 验收。

**真机预览想连真实后端**：手机与电脑连同一 Wi-Fi → 电脑防火墙放行 8080 → 「我的 → 设置 → 改局域网地址」填电脑实际局域网 IP（不要填 `127.0.0.1`）→ 数据源切 `lan` → 在手机微信里点「…」→「打开调试」跳过合法域名/HTTPS 校验。局域网 HTTP 无法配置为合法域名，正式发布需换 HTTPS 域名并在小程序后台配置 `request` / `downloadFile` 合法域名。

**三端地图**：门户 `/`、游客 H5 `/visitor`、PC 消费者站 `/consumer` 与小程序共用 `web/assets/map.js`、同一张底图和同一套 `PIN_ANCHORS`；网页端必须通过 `start.bat` 启动的 `http://127.0.0.1:8080/` 访问，直接双击 HTML（`file://`）会取不到 `/web/` 与 `/api/`。

---

## 六、外部大模型问答（可选扩展）

默认关闭；打开后「小梅」可以调用外部大模型，不打开时本项目仍是零外部依赖、断网可跑。完整说明见 `docs/AI问答系统说明.md`。

### 模块职责边界

| 模块 | 唯一职责 | 联网 |
| --- | --- | --- |
| `server/db.py` + 三组业务 API | 21 张业务表、状态机，提供实时事实 | 否 |
| `server/api_ai.py` | 编排：知识库/实时数据优先 → 外部模型兜底 → 失败回退 | 视模式 |
| `server/ai_config.py` | 读 `ai.env` / 环境变量、数值钳制、密钥脱敏 | 否 |
| `server/llm_client.py` | OpenAI 兼容 Chat Completions 调用，仅用标准库 `urllib` | 是（可选） |
| `server/ai_store.py` + `sql/ai_qa.sql` | MySQL 存会话/消息/调用日志，不可用时降级内存 | 可选 |
| `visitor.js` / `common.css` / 小程序 `index.wxml` / `app.wxss` | 搜索栏排版与答案来源标注 | 否 |
| `deploy/*` | 依赖安装、建库、开机自启动 | 否 |

**事实与措辞分离**：模型只负责组织语言，价格、余位、名称、日期全部由业务库实时查询后作为 `system` 事实注入，并强制「数据里没有就答没查到」。密钥不入库、不进日志、不回前端；MySQL 只存问答域 4 张表，不动业务表。

### 关键配置项

复制 `ai.env.example` 为 `ai.env`，至少填 `LLM_ENABLED=1`、`LLM_API_BASE`（接口地址）、`LLM_API_KEY`（密钥）、`LLM_MODEL`（模型名）；需要 MySQL 会话再填 `MYSQL_ENABLED=1`、`MYSQL_USER`、`MYSQL_PASSWORD`。请求参数固定为 `model / messages / temperature / max_tokens / stream=false`，超时、重试、历史条数、最大输出长度都可配；`LLM_EXTRA_BODY` 可追加厂商私有参数。完整配置项表格与各家接口地址示例见 `docs/AI问答系统说明.md`。

### 三步启用与开机自启动

```bash
copy ai.env.example ai.env        # 填好上面的配置
deploy\setup_ai.bat               # 装 PyMySQL + 执行 sql/ai_qa.sql 建库
start.bat                         # 启动；访问 /api/ai/config 自检
```

开机自启动：Windows 双击 `deploy/install_autostart.bat`（当前用户启动文件夹快捷方式，不需要管理员权限；用 `status_autostart.bat` / `uninstall_autostart.bat` 查看/取消）；Linux 执行 `bash deploy/install_service.sh`（systemd，自动重启）。不需要 Docker、集群或额外框架，缺省情况下一个 `python start.py` 就是全部服务端。

### 接口与验收

`POST /api/ai/chat` 新增可选 `mode`（`auto` / `llm` / `local`）、`session_id`、`history`，响应新增 `engine` / `model` / `degraded` / `llm_error`；另有 `GET /api/ai/config`（脱敏自检）与 `GET /api/ai/history`。原有四项 AI 能力与 45 项端到端验收的断言保持不变。

```bash
python tools/verify_ai_qa.py      # 56 项离线验收：配置脱敏、请求构造、错误归一化、回退、布局、自启动
python tests/smoke_test.py        # 45 项端到端回归（需先启动服务）
```

「小梅」搜索栏已重排：H5 与小程序都改用独立的 `.ai-*` 类，头像说明区、回答方式、消息区、快捷问题、搜索框与答案卡片分区留白，窄屏自动换行，不再拥挤；全局 `.search` / `.input` / `.btn` 未改动。

---

## 七、常见问题

| 现象 | 处理 |
| --- | --- |
| 手机扫码后界面空白或只剩几行字 | 数据源指向了不可达的 `local`（`127.0.0.1` 在手机上指手机自身）或 `lan`。先在「我的 → 设置 → 数据源」切回 `mock`；默认 `mock` 已含包内图片与离线兜底，界面必定完整 |
| 手机端图片不显示、电脑端开发者工具正常 | 真机 `wx.request` / `<image>` 会校验合法域名且要求 HTTPS，`urlCheck: false` 只在开发者工具生效。默认 `mock` 用包内 `/images/photos/`；远程图失败会自动降级到包内同名图。要连后端见上方「真机预览想连真实后端」 |
| 网页端看不到地图 | 必须通过 `start.bat` 启动的 `http://127.0.0.1:8080/` 访问；直接双击 HTML（`file://`）会取不到 `/web/` 与 `/api/`。若仍不显示，检查 8080 是否被多个残留 `start.py` 进程占用、其中某个指向的是另一份工程副本 |
| 双击 `start.bat` 闪退 | 在命令行运行 `python start.py` 看报错；多为 Python 未加入 PATH |
| 8080 端口被占用 | `python start.py --port 9000`，并在 `mp-weixin/config/index.js` 的 `ENVS.local.baseUrl` 同步改端口 |
| 页面能开但数据空白 | 打开 `/health` 看各表计数；执行 `python start.py --reset` 重建基准数据 |
| 登录后马上退回登录页 | 服务重启会清空内存会话，刷新页面重新登录即可 |
| 打开 `/consumer` 或 `/biz` 返回 404 | 服务是旧进程；新增页面路由要重启服务（`Ctrl+C` 后重新 `python start.py`） |
| PC 站切端后要重新登录 | 各端会话本就独立，正常现象；门户页能看到当前浏览器已登录的全部身份 |
| PC 站在小屏上显示挤 | 建议 1366px 以上；<768px 会给出跳转对应 H5 的引导条 |
| 小程序提示「连不上服务」 | 说明数据源已切到 `local`/`lan`：确认服务已启动、地址正确、开发者工具已勾选不校验合法域名；只想本地演示就切回 `mock` |
| 小程序「我的」显示未登录 | 点「去登录」用 `tourist01 / tourist123`；小程序不会自动登录，也不会复用 H5 的登录态 |
| 想回到干净的演示数据 | `python start.py --reset`，或直接删除 `data/plum.db` 后重启；小程序端用「我的 → 设置 → 清空缓存」 |
| 验收脚本某项失败 | 先用 `--reset` 重启服务再跑；验收脚本本身也会重置基准数据 |
| 问小梅一直不调用外部模型 | 打开 `/api/ai/config` 看 `llm_status`；多为 `LLM_ENABLED=0`、`LLM_API_KEY` 为空，或 `mode=auto` 下本地已能回答（改 `mode=llm` 可强制调用） |
| 答案显示「已回退本地」 | 看 `llm_error`：401 查密钥、429 查配额、超时调大 `LLM_TIMEOUT`、响应格式不兼容换 `LLM_API_BASE` / `LLM_CHAT_PATH` |
| `store.mode` 一直是 `memory` | `MYSQL_ENABLED=0`、未装 PyMySQL 或连不上；执行 `python -m pip install -r requirements-ai.txt` 与 `python tools/init_ai_db.py`，再重启服务 |
| 开机没有自动启动服务 | 运行 `deploy/status_autostart.bat` 确认快捷方式；启动文件夹是「当前用户」级的，换 Windows 账户需重新安装 |

更多排错与运维说明见 `docs/目录与运行说明.md`、`docs/AI问答系统说明.md`；功能边界、接口入参与验收标准见 `docs/开发任务书.md`。
