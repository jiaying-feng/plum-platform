# 外部大模型问答系统 · 部署与职责边界

> 适用版本：在「开箱即跑」的 Flask + SQLite 交付基础上新增的**可选 AI 扩展域**。
> 不创建 `ai.env` 时，外部模型与 MySQL 全部关闭，原有链路一行都不走新代码路径，断网照常可跑。

---

## 0. 一句话结论

复制一份配置模板、填接口地址与密钥、双击一个 bat，即可让「小梅」调用外部大模型；
模型不可用会自动退回本地答案；开机自启动只需再双击一个 bat。全程不用 Docker、不用 K8s、不用 ORM、不用消息队列。

---

## 1. 模块职责边界（最重要）

| 域 | 文件 | 唯一职责 | 数据源 | 联网 | 出问题时 |
| --- | --- | --- | --- | --- | --- |
| **业务域（既有）** | `server/db.py`、`api_business.py`、`api_merchant.py`、`api_admin.py` | 21 张业务表、状态机、订单/预约/核销 | SQLite `data/plum.db` | 否 | 与扩展域无关，完全不受影响 |
| **本地 AI 域（既有）** | `server/api_ai.py` 的 `_facts()` / `_business_answer()` / 知识库匹配 | 提供**权威事实**：价格、余位、名称、日期 | 业务库实时查询 | 否 | 始终是最终兜底 |
| **配置域（新增）** | `server/ai_config.py` | 读 `ai.env` / 环境变量、数值钳制、密钥脱敏 | 文件 + 环境变量 | 否 | 缺配置 = 扩展域关闭 |
| **外部模型域（新增）** | `server/llm_client.py` | 只做「组装请求 → HTTP 调用 → 解析 → 归一化错误」 | 外部 LLM API | 是（可选） | 抛 `LLMError`，由编排层回退 |
| **编排层（既有文件扩展）** | `server/api_ai.py` 的 `chat()` | 决定「本地答 / 问模型 / 回退」，生成事实约束文本，写会话 | 前三者 | 视模式 | 任何外部异常都不外抛 |
| **会话存储域（新增）** | `server/ai_store.py`、`sql/ai_qa.sql` | 存问答会话、消息、调用日志；提供多轮上下文 | MySQL | 可选 | 自动降级为进程内内存历史 |
| **前端展示域（改）** | `web/assets/visitor.js`、`common.css`、`mp-weixin/pages/index/index.wxml`、`app.wxss` | 搜索栏排版、模式切换、来源标注 | 后端接口 | 否 | 不影响业务页面 |
| **部署域（新增）** | `deploy/*`、`tools/init_ai_db.py` | 依赖安装、建库、开机自启 | — | 首次可选 | 可完全卸载 |

### 边界约定

1. **事实与措辞分离**：外部大模型只负责「把话说顺」，所有数字、名称、价格、余位由 `api_ai._facts_prompt()` 从业务库实时取出后写进 `system` 消息，并明确要求「不许推算、不许补全、数据里没有就答没查到」。模型不直连数据库、不执行 SQL、不调用业务接口。
2. **MySQL 只存问答域数据**：`ai_sessions` / `ai_messages` / `ai_call_logs` / `ai_settings` 四张表。业务表仍在 SQLite，避免迁移 21 张表破坏既有 45 项端到端验收，也保住「零依赖、双击即跑」。若将来要全站统一到 MySQL，属于独立改造，不影响本扩展域接口契约。
3. **密钥单向流动**：密钥只出现在 `ai.env` / 系统环境变量 → `ai_config` → HTTP 请求头。不写入 MySQL、不进日志、不进前端；`GET /api/ai/config` 只返回「已配置 / 未配置」和 `sk-t***7890` 形式的提示。
4. **失败不扩散**：模型超时、401、限流、响应畸形、MySQL 断连，全部被吞掉并降级；`/api/ai/chat` 永远返回 200 + 一个确定答案，只是 `degraded=true` + `llm_error` 说明原因。
5. **默认关闭**：`LLM_ENABLED=0`、`MYSQL_ENABLED=0`。关闭时 `chat()` 的返回与改造前一致（只多一个 `session_id` / `engine` 字段，老前端忽略即可）。

---

## 2. 数据流

```
前端「问小梅」
   │ POST /api/ai/chat {question, mode, session_id}
   ▼
server/api_ai.py :: chat()
   ├─ _facts()                -> SQLite 实时查园区/商品/场次/房价/课程/节庆
   ├─ 知识库相似度 / _business_answer()   -> 能答就直接返回（engine=local）
   └─ 答不上来 或 mode=llm 且模型已启用
        ├─ _facts_prompt(f)   -> 纯文本事实快照
        ├─ ai_store.recent()  -> MySQL（或内存）最近 N 轮
        ├─ llm_client.ask()   -> POST {api_base}/chat/completions
        │     system = 事实约束 + 事实快照
        │     messages = 历史 + 当前问题
        │     model / temperature / max_tokens / stream=false
        ├─ 成功 -> polish(答案) -> engine=llm，标注 model 与耗时
        └─ 失败 -> LLMError -> 本地答案 / 原兜底文案，degraded=true
   ▼
ai_store.append()  写 user + assistant 两条；log_call() 记审计（都不影响响应）
```

---

## 3. 关键配置项

配置来源优先级：**系统环境变量 > 项目根目录 `ai.env` > 内置默认值**。改完重启服务生效（或调用 `ai_config.reload_env()`）。
模板是 `ai.env.example`，复制为 `ai.env` 后填写；`ai.env` 含密钥，不要提交版本库。

### 3.1 外部大模型（OpenAI 兼容 Chat Completions）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LLM_ENABLED` | `0` | **总开关**，`1` 才联网；关闭时零外部依赖 |
| `LLM_API_BASE` | `https://api.openai.com/v1` | **接口地址**，填到 `/v1`；客户端自动补 `/chat/completions`。填完整 URL 也不会重复拼 |
| `LLM_CHAT_PATH` | `/chat/completions` | 厂商路径不同时改这里（Azure / 自建网关） |
| `LLM_API_KEY` | 空 | **密钥**，必填；空则视为未启用 |
| `LLM_API_KEY_HEADER` | `Authorization` | 认证头名，Azure 常用 `api-key` |
| `LLM_API_KEY_PREFIX` | `Bearer` | 认证头前缀，用 `api-key` 头时留空 |
| `LLM_MODEL` | `gpt-4o-mini` | **模型名**，如 `qwen-plus`、`deepseek-chat`、`llama3` |
| `LLM_TEMPERATURE` | `0.3` | 采样温度，范围 0–2；事实型问答建议偏低 |
| `LLM_MAX_TOKENS` | `400` | 单次回答最大 token，范围 64–4096，控制成本 |
| `LLM_EXTRA_BODY` | 空 | 厂商私有请求参数，JSON 字符串，如 `{"top_p":0.9}`；解析失败自动忽略 |
| `LLM_SYSTEM_PROMPT` | 空 | 追加到 system 的补充要求（最多 300 字） |
| `LLM_TIMEOUT` | `12` | 单次超时秒数，2–60 |
| `LLM_RETRY` | `0` | 失败重试次数，0–2；失败即回退，不阻塞用户 |
| `LLM_MAX_HISTORY` | `6` | 送入模型的历史消息条数，0–20 |
| `LLM_MAX_ANSWER_CHARS` | `600` | 回答截断长度，防超长输出 |

请求体固定为：

```json
{
  "model": "<LLM_MODEL>",
  "messages": [
    {"role": "system", "content": "事实约束 + 平台实时数据"},
    {"role": "user", "content": "上一轮问题"},
    {"role": "assistant", "content": "上一轮回答"},
    {"role": "user", "content": "本次问题"}
  ],
  "temperature": 0.3,
  "max_tokens": 400,
  "stream": false
}
```

请求头：`Content-Type: application/json`、`Accept: application/json`、`<LLM_API_KEY_HEADER>: <前缀> <密钥>`。
`messages` 不允许被 `LLM_EXTRA_BODY` 覆盖，保证事实约束不被绕过。

常见 `LLM_API_BASE`：

| 服务 | 地址 | 建议模型 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| 通义千问兼容模式 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| **智谱 BigModel（推荐免费）** | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash-250414` |
| 本地 Ollama | `http://127.0.0.1:11434/v1` | `qwen2.5:7b`（`LLM_API_KEY` 随便填非空值） |

**零成本起步推荐：智谱 BigModel 的 GLM-4-Flash 系列**（官方免费模型页
`https://docs.bigmodel.cn/cn/guide/models/free/glm-4-flash-250414`，接口文档
`https://docs.bigmodel.cn/cn/guide/develop/http/introduction`）。该模型 API 长期 0 元、128K 上下文，
采用标准 `Authorization: Bearer` 认证与 `/chat/completions` 端点，与本项目默认配置完全对齐，
只需在 `ai.env` 改 4 行（`LLM_ENABLED`、`LLM_API_BASE`、`LLM_API_KEY`、`LLM_MODEL`），零代码改动：

```ini
LLM_ENABLED=1
LLM_API_BASE=https://open.bigmodel.cn/api/paas/v4
LLM_API_KEY=<你的智谱 API Key>
LLM_MODEL=glm-4-flash-250414
LLM_TIMEOUT=15
LLM_RETRY=0
```

免费档按模型设**并发数**限制，随账号权益等级变化且高峰期动态限流（429），不保证 SLA；模型 ID
可能换代下线，以控制台「免费模型」区为准。注册需手机号 + 实名认证，密钥只在创建时显示一次。
新用户赠送的 Token 资源包与「长期免费模型」是两回事，前者有有效期且以控制台显示为准。
需要更高并发时再切付费模型，或改用阿里云百炼 / 硅基流动（免费模型同样需实名并受速率分层限制）。

### 3.2 MySQL（AI 问答会话）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MYSQL_ENABLED` | `0` | **总开关**；`0` 时用进程内内存历史，重启清空 |
| `MYSQL_HOST` / `MYSQL_PORT` | `127.0.0.1` / `3306` | 地址与端口 |
| `MYSQL_USER` / `MYSQL_PASSWORD` | `root` / 空 | 账号口令，**不打印、不回传前端** |
| `MYSQL_DB` | `plum_ai` | 库名；`init_ai_db.py` 会自动替换建表脚本里的库名 |
| `MYSQL_CHARSET` | `utf8mb4` | 字符集 |
| `MYSQL_TIMEOUT` | `5` | 连接超时秒数，1–30 |

依赖只有一个纯 Python 驱动 `PyMySQL==1.1.1`（写在 `requirements-ai.txt`）。
外部模型调用本身**只用标准库 `urllib`**，没有 `openai` / `requests` / `langchain` / `Flask` 之外的复杂依赖。

---

## 4. 接口契约

### `POST /api/ai/chat`

| 请求字段 | 类型 | 说明 |
| --- | --- | --- |
| `question` | string，必填 | 1–200 字 |
| `mode` | string，选填 | `auto`（默认，本地优先）/ `llm`（直接问模型）/ `local`（完全不联网） |
| `session_id` | string，选填 | 后端生成后返回，原样带回即可多轮续聊 |
| `history` | array，选填 | 前端自带历史 `[{role, content}]`，逐条校验、最多 20 条 |
| `channel` | string，选填 | 渠道标记，写入会话表，如 `web` / `mp-weixin` |

**`mode=auto` 的分流规则**：明确的业务数据查询（含「多少钱 / 价格 / 还有位置 / 余位 / 几号 / 开门」等）仍由本地知识库和实时数据毫秒级回答；开放式提问（含「行程 / 安排 / 规划 / 推荐 / 怎么玩 / 适合 / 讲讲」等）会**跳过本地关键词规则**，交给外部模型组织答案，避免「安排两天一晚上的行程」因含「一晚」被误判成查房价。模型未启用或调用失败时仍回退本地答案（开放式问题会明确标注「先给你平台实时数据」）。想让每条都走模型用 `mode=llm`，但业务类问题会因此等上几秒。

响应 `data`：

| 字段 | 说明 |
| --- | --- |
| `answer` | 最终答案（本地或模型，已统一洗掉套话） |
| `source` | `知识库` / `平台实时数据` / `兜底` / `外部大模型 + 平台实时数据` |
| `topic` / `suggestions` | 分类与推荐追问 |
| `engine` | `local` / `llm` |
| `model` / `latency_ms` | 引擎为 `llm` 时给出实际模型与耗时 |
| `session_id` | 会话标识 |
| `degraded` | 是否因外部依赖失败而回退 |
| `llm_error` | 回退原因（不含密钥） |

```bash
curl -X POST http://127.0.0.1:8080/api/ai/chat ^
  -H "Content-Type: application/json" ^
  -d "{\"question\":\"周末还有位置吗？\",\"mode\":\"auto\"}"
```

### `GET /api/ai/config`

只读状态自检：`llm_status`、`store`、`env_file_exists`、脱敏后的配置。**永不返回完整密钥或数据库密码**。

### `GET /api/ai/history?session_id=xxx&limit=10`

返回 `[{role, content}]` 与当前存储模式（`mysql` / `memory`）。缺 `session_id` 返回 400。

---

## 5. 部署步骤（Windows，5 步）

1. **准备 MySQL**（只用外部模型、不要持久化时可跳过，`MYSQL_ENABLED` 保持 `0`）：
   本机装 MySQL 5.7+/8.0 或 MariaDB 10.2+，确认服务已启动，记下账号口令。
   不需要手工建库建表，`init_ai_db.py` 会做。
2. **写配置**：把 `ai.env.example` 复制成同目录的 `ai.env`，填写
   `LLM_ENABLED=1`、`LLM_API_BASE`、`LLM_API_KEY`、`LLM_MODEL`；
   用 MySQL 再填 `MYSQL_ENABLED=1`、`MYSQL_USER`、`MYSQL_PASSWORD`。
3. **一键装依赖 + 建库**：双击 `deploy/setup_ai.bat`（等价于
   `python -m pip install -r requirements-ai.txt` + `python tools/init_ai_db.py`）。
   看到「成功：MySQL 8.x：已执行 5 条 DDL」即可。
4. **启动**：双击根目录 `start.bat`，或 `python start.py`。
5. **自检**：浏览器打开 `http://127.0.0.1:8080/api/ai/config`，
   确认 `llm_status.enabled=true`、`store.available=true`（未启用 MySQL 时为 `memory` 也正常）。
   再到 `/visitor → 问小梅`，点「问外部大模型」发一条，答案下方会标注模型名。

> 只想验证模型、不装 MySQL：第 1、3 步可跳过，`MYSQL_ENABLED=0`，会话走内存历史。
> 只想验证 MySQL、暂时没有密钥：把 `LLM_ENABLED=0`，用 `/api/ai/history` 检查落库。

Linux 把第 3、4 步换成 `bash deploy/install_service.sh`（见下一节），其余相同。

---

## 6. 开机自启动（无容器、无集群）

### Windows

| 操作 | 脚本 | 效果 |
| --- | --- | --- |
| 启用 | 双击 `deploy/install_autostart.bat` | 在**当前用户启动文件夹**放一个 `PlumPlatform.lnk`，指向 `deploy/run_server.bat`；不需要管理员权限、不改注册表、不装 Windows 服务 |
| 查看 | 双击 `deploy/status_autostart.bat` | 打印是否启用与快捷方式指向 |
| 取消 | 双击 `deploy/uninstall_autostart.bat` | 删除该 `.lnk`，项目文件与数据不动 |
| 立即启动 | 双击 `deploy/run_server.bat` | `python start.py --no-browser`，不弹浏览器 |

`run_server.bat` 每次启动会先检查 `flask`（缺才装），若存在 `ai.env` 再检查 `pymysql`（缺才装），
所以离线、无网环境也不会卡在安装步骤。窗口按 `Ctrl+C` 停止服务。

### Linux（systemd）

```bash
bash deploy/install_service.sh     # 复制 ai.env、装依赖、写 unit、enable --now
sudo systemctl status plum.service
sudo journalctl -u plum.service -f  # 或 tail -f /var/log/plum-platform.log
bash deploy/uninstall_service.sh   # 取消自启
```

unit 里 `After=network-online.target mysql.service mariadb.service`、`Restart=always`，
`EnvironmentFile` 直接读 `ai.env`，工作目录自动替换为项目实际路径。

> 自启动顺序：先保证 MySQL 服务已就绪，再启动平台；否则平台会自动降级为 `memory` 模式，
> MySQL 恢复后重启平台即可重新落库。Windows 上把 MySQL 设为「自动」服务即可。

---

## 7. 「小梅」搜索栏排版调整

| 位置 | 改造前 | 改造后 |
| --- | --- | --- |
| H5 输入行 | `display:flex;gap:8px`，输入框与「问」按钮挤在一行，无标签、无留白 | 独立 `.ai-search` 栅格：输入框 48px 高、内嵌放大镜、12px 间距、96px 宽「问一句」按钮；≤360px 自动换行、按钮占满一行 |
| H5 整体 | 消息、快捷问题、输入框三段各写死内联样式，间距 6–10px 不一 | `.ai-chat` 纵向 `gap:14px`；头像+说明卡、回答方式切换、消息区、`你可以这样问` 标签、chips、搜索栏、提示行分区清晰 |
| H5 交互 | 只有点击「问」/ 回车，无发送中状态 | `<form>` 统一提交；发送中按钮禁用并显示「想着…」，气泡显示「小梅正在翻账本…」；答案标注来源、模型名与「已回退本地」 |
| 小程序 | `gap:14rpx` 紧凑行 + `btn-sm` 小按钮 + 三个 `badge` 紧贴 | `.ai-card` 28rpx 内边距；头像+说明区；`.ai-search` 16rpx 间距、84rpx 高输入框与等高的「问一句」按钮；快捷问题独立标签行 + 14rpx 间距 chips；答案独立卡片 |
| 影响范围 | — | 全部新增 `.ai-*` 前缀类名，**不改** `.search` / `.input` / `.btn` 全局样式，其它表单零影响 |

---

## 8. 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `/api/ai/config` 显示 `llm_status.enabled=false` | `LLM_ENABLED=0` 或 `LLM_API_KEY` 为空 | 填 `ai.env` 后重启服务；确认环境变量没有把文件里的值覆盖成空 |
| 答案下方一直显示「已回退本地」 | 401 / 429 / 超时 / 响应格式不兼容 | 看 `llm_error` 与控制台 `外部模型不可用，回退本地`；核对密钥、模型名、`LLM_API_BASE` 路径、余额与配额；必要时把 `LLM_TIMEOUT` 调大 |
| 回答很慢（5~15 秒） | 免费档模型排队、生成 token 多；`mode=llm` 连业务查询也调模型 | 默认 `mode=auto` 下业务查询仍是毫秒级、只有开放式问题才调模型；把 `LLM_MAX_TOKENS` 调到 150 可再快些；想要稳定低延迟需换付费模型 |
| 开放式问题（行程/推荐）却答成房价表 | 旧版本地关键词把「一晚」误判为查住宿 | 已修复：`_is_open_question()` 让开放式问题跳过本地规则直接走模型；模型不可用时回退答案会明确标注「先给你平台实时数据」 |
| 模型答非所问或数字可疑 | 业务库里本来没有该数据 | 事实来自 `data/plum.db` 实时查询，先 `/health` 看表计数；prompt 已强制「数据里没有就答没查到」，不要用 `LLM_EXTRA_BODY` 覆盖 `messages` |
| `store.mode=memory` | `MYSQL_ENABLED=0`、未装 PyMySQL、或连不上 | 执行 `python -m pip install -r requirements-ai.txt`、`python tools/init_ai_db.py`；核对账号口令与防火墙 |
| `初始化失败：OperationalError 1045` | 账号口令错误 / 用户无建库权限 | 换有 `CREATE` 权限的账号，或让 DBA 先手工执行 `sql/ai_qa.sql` |
| 开机后没自动启动 | 快捷方式被安全软件拦截 / 用另一个 Windows 账户登录 | 运行 `deploy/status_autostart.bat` 确认；启动文件夹是「当前用户」级的 |
| 8080 被占用、改了文件却看不到效果 | 残留的旧 `start.py` 进程指向另一份工程副本 | 关闭所有旧窗口，只从本工程启动一次；或 `python start.py --port 9000` |
| 网页端 `/web/...` 404 | 用 `file://` 双击打开了 HTML | 必须走 `start.bat` 的 `http://127.0.0.1:8080/` |

---

## 9. 验收

```bash
python tools/verify_ai_qa.py        # 新增：56 项离线验收，不需要 MySQL / 网络 / 服务
python tests/smoke_test.py          # 既有：45 项端到端，需先启动服务
node tests/mp_weixin_smoke.js       # 既有：小程序 23 项
node tools/verify_mp_images.js      # 既有：手机端图片 14 项
python tools/verify_map.py          # 既有：三端地图
```

`verify_ai_qa.py` 覆盖：配置脱敏、URL 拼接、请求参数与事实约束、多轮历史过滤、
HTTP 成功 / 401 / 超时 / 非法 JSON / 空响应归一化、MySQL 降级、Flask 三类模式与回退、
前端 `.ai-*` 类名、自启动脚本齐备性。它使用临时 SQLite 库，不会改动项目数据。

---

## 10. 安全与成本边界

- 密钥只在 `ai.env` / 环境变量；日志与 MySQL 都不记完整 prompt、不记密钥；`/api/ai/config` 只给脱敏提示。
- 每次请求都实时查业务库，模型无法接触数据库连接、无法执行写操作，也不能替用户下单。
- `LLM_TIMEOUT` + `LLM_RETRY` + `LLM_MAX_TOKENS` + `LLM_MAX_ANSWER_CHARS` 四道闸控制时延与费用；默认不重试，失败立即回退。
- 前端 `mode=auto` 时，知识库/实时数据能答的问题**不会调用外部模型**，只有开放式问题才产生 API 费用。
- `ai.env` 请加入版本库忽略列表；生产环境建议改用系统环境变量或密钥管理服务。
