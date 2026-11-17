"""AI 问答扩展域离线验收：不需要 MySQL、不需要网络、不需要启动服务。

用法：python tools/verify_ai_qa.py
覆盖：配置脱敏、请求构造、成功/失败归一化、MySQL 降级、Flask 路由回退、
      前端搜索栏类名、部署脚本齐备性。会用一个临时 SQLite 库，不碰真实数据。
"""
from __future__ import annotations

import io
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="plum_ai_qa_"))
os.environ["PLUM_DB_PATH"] = str(TMP / "plum.db")
os.environ["PLUM_AI_ENV_FILE"] = str(TMP / "no_such.env")
for key in list(os.environ):
    if key.startswith("LLM_") or key.startswith("MYSQL_"):
        os.environ.pop(key, None)
sys.path.insert(0, str(ROOT))

from server import ai_config, ai_store, db, llm_client  # noqa: E402
from server.app import app  # noqa: E402

PASS, FAIL = 0, 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [OK]   {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


def read(rel: str) -> str:
    p = ROOT / rel
    return p.read_text(encoding="utf-8") if p.is_file() else ""


class FakeResp(io.BytesIO):
    def __init__(self, payload: bytes):
        super().__init__(payload)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def set_llm(enabled: str = "1", key: str = "sk-test-1234567890") -> None:
    os.environ["LLM_ENABLED"] = enabled
    os.environ["LLM_API_KEY"] = key
    os.environ["LLM_API_BASE"] = "https://llm.example.com/v1"
    os.environ["LLM_MODEL"] = "test-model"
    os.environ["LLM_RETRY"] = "0"
    ai_config.reload_env()


def main() -> int:
    print("=" * 62)
    print(" AI 问答扩展域离线验收")
    print("=" * 62)

    # 1 文件与脚本齐备
    print("\n1 交付文件")
    files = ["server/ai_config.py", "server/llm_client.py", "server/ai_store.py",
             "sql/ai_qa.sql", "ai.env.example", "requirements-ai.txt",
             "tools/init_ai_db.py", "deploy/run_server.bat", "deploy/autostart.ps1",
             "deploy/install_autostart.bat", "deploy/uninstall_autostart.bat",
             "deploy/plum.service", "deploy/install_service.sh"]
    check("新增文件齐备（13 个）", all((ROOT / f).is_file() for f in files),
          str([f for f in files if not (ROOT / f).is_file()]))
    sql = read("sql/ai_qa.sql")
    check("MySQL 建表脚本含 4 张表", all(t in sql for t in
          ("ai_sessions", "ai_messages", "ai_call_logs", "ai_settings")))

    # 2 配置与密钥
    print("\n2 配置与密钥")
    ai_config.reload_env()
    check("默认关闭外部模型", not ai_config.flag("LLM_ENABLED"))
    check("默认关闭 MySQL", not ai_config.flag("MYSQL_ENABLED"))
    cfg = ai_config.llm()
    check("Chat Completions URL 自动拼接",
          cfg["url"] == "https://api.openai.com/v1/chat/completions", cfg["url"])
    os.environ["LLM_API_KEY"] = "sk-test-1234567890"
    ai_config.reload_env()
    public = json.dumps(ai_config.public(), ensure_ascii=False)
    check("配置视图不泄露完整密钥", "sk-test-1234567890" not in public)
    check("配置视图只给脱敏提示", "sk-t***7890" in public, ai_config.mask(os.environ["LLM_API_KEY"]))
    os.environ.pop("LLM_API_KEY", None)
    os.environ["LLM_EXTRA_BODY"] = '{"top_p":0.9}'
    ai_config.reload_env()
    check("厂商私有请求参数可解析", ai_config.llm()["extra_body"].get("top_p") == 0.9)
    os.environ.pop("LLM_EXTRA_BODY", None)
    ai_config.reload_env()

    # 3 请求构造与事实约束
    print("\n3 请求构造与事实约束")
    facts = "【平台实时数据】青梅酒 68 元，库存 120 件。"
    history = [{"role": "user", "content": "上一句"}, {"role": "assistant", "content": "上一答"}]
    msgs = llm_client.build_messages("还有货吗", facts, history)
    check("system 消息在首位且含事实", msgs[0]["role"] == "system" and facts in msgs[0]["content"])
    check("system 明确禁止编造价格余位", "不许推算" in msgs[0]["content"] and "没查到" in msgs[0]["content"])
    check("多轮历史按序进入", [m["role"] for m in msgs[1:3]] == ["user", "assistant"])
    check("当前问题在最后", msgs[-1] == {"role": "user", "content": "还有货吗"})
    bad = llm_client.build_messages("x", facts, [{"role": "system", "content": "越权"}, {"role": "user", "content": ""}])
    check("伪造角色与空消息被丢弃", len(bad) == 2)
    set_llm()
    payload = llm_client._payload(ai_config.llm(), msgs)
    check("请求参数齐全", all(k in payload for k in ("model", "messages", "temperature", "max_tokens", "stream")))
    check("stream 固定关闭", payload["stream"] is False)
    check("认证头为 Bearer", llm_client._headers(ai_config.llm())["Authorization"].startswith("Bearer "))
    set_llm("1", "")
    check("缺密钥时不启用", not llm_client.enabled())

    # 4 HTTP 成功 / 失败归一化
    print("\n4 外部模型调用与错误归一化")
    captured = {}

    def fake_ok(req, timeout=None):
        captured["raw"] = req.data
        captured["host"] = req.full_url
        return FakeResp(json.dumps({
            "model": "test-model-2026", "choices": [{"message": {"content": "还有货，青梅酒 68 元。"}}],
            "usage": {"total_tokens": 33},
        }).encode("utf-8"))

    set_llm()
    with mock.patch("server.llm_client.urllib.request.urlopen", side_effect=fake_ok):
        reply = llm_client.ask("还有货吗", facts, history)
    check("成功解析模型答案", reply["text"] == "还有货，青梅酒 68 元。", reply["text"])
    check("返回模型名与耗时", reply["model"] == "test-model-2026" and reply["latency_ms"] >= 0)
    sent = json.loads(captured["raw"].decode("utf-8"))
    check("请求发往 /chat/completions", captured["host"].endswith("/chat/completions"), captured["host"])
    check("请求体含 model 与 messages", sent["model"] == "test-model" and len(sent["messages"]) == 4)
    check("请求体不带完整密钥", "sk-test-1234567890" not in captured["raw"].decode("utf-8"))

    with mock.patch("server.llm_client.urllib.request.urlopen",
                    side_effect=llm_client.urllib.error.HTTPError(
                        "https://llm.example.com", 401, "Unauthorized", {}, io.BytesIO(b'{"error":"bad key"}'))):
        try:
            llm_client.ask("x", facts)
            check("HTTP 401 抛 LLMError", False)
        except llm_client.LLMError as e:
            check("HTTP 401 抛 LLMError", "401" in str(e), str(e))
    with mock.patch("server.llm_client.urllib.request.urlopen", side_effect=TimeoutError("slow")):
        try:
            llm_client.ask("x", facts)
            check("超时抛 LLMError", False)
        except llm_client.LLMError as e:
            check("超时抛 LLMError", "网络异常" in str(e), str(e))
    with mock.patch("server.llm_client.urllib.request.urlopen",
                    return_value=FakeResp(b"<html>not json</html>")):
        try:
            llm_client.ask("x", facts)
            check("非法 JSON 抛 LLMError", False)
        except llm_client.LLMError as e:
            check("非法 JSON 抛 LLMError", "JSON" in str(e), str(e))
    with mock.patch("server.llm_client.urllib.request.urlopen",
                    return_value=FakeResp(json.dumps({"choices": []}).encode())):
        try:
            llm_client.ask("x", facts)
            check("空响应抛 LLMError", False)
        except llm_client.LLMError as e:
            check("空响应抛 LLMError", "content" in str(e), str(e))

    # 5 MySQL 降级
    print("\n5 MySQL 存储降级")
    os.environ["MYSQL_ENABLED"] = "0"
    ai_config.reload_env()
    check("未启用时 available()=False", not ai_store.available())
    check("未启用时 status 为 memory", ai_store.status()["mode"] == "memory")
    sid = ai_store.new_session_id()
    ai_store.append(sid, "user", "在吗")
    ai_store.append(sid, "assistant", "在的")
    check("内存历史可写可读", [x["content"] for x in ai_store.recent(sid, 5)] == ["在吗", "在的"])
    ai_store.log_call(sid, "在吗", True, "llm", "m", 12)
    check("记日志在降级时不抛异常", True)

    # 6 Flask 路由（临时库，不影响项目数据）
    print("\n6 接口契约与回退")
    db.init_db(force=True)
    app.config["TESTING"] = True
    client = app.test_client()
    os.environ["LLM_ENABLED"] = "0"
    ai_config.reload_env()
    r = client.post("/api/ai/chat", json={"question": "青梅酒多少钱一瓶？"}).get_json()
    check("默认链路仍是本地答案",
          r["code"] == 200 and r["data"]["engine"] == "local"
          and r["data"]["source"] in ("知识库", "平台实时数据"), str(r["data"].get("source")))
    check("返回可续聊的 session_id", len(r["data"].get("session_id", "")) == 32)
    r2 = client.post("/api/ai/chat", json={"question": "周末还有位置吗？"}).get_json()
    check("实时场次断言保持不变", r2["data"]["source"] == "平台实时数据")
    r3 = client.post("/api/ai/chat", json={"question": "随便聊聊", "mode": "llm"}).get_json()
    check("未启用模型时显式 llm 会提示并降级",
          r3["data"]["degraded"] and "未启用" in r3["data"]["llm_error"], str(r3["data"]))
    cfg_view = client.get("/api/ai/config").get_json()["data"]
    check("配置接口可读", cfg_view["llm"]["enabled"] is False and "password" in cfg_view["mysql"])
    check("配置接口不含密钥字段值", "sk-test-1234567890" not in json.dumps(cfg_view, ensure_ascii=False))
    check("历史接口缺参报 400", client.get("/api/ai/history").get_json()["code"] == 400)
    check("历史接口可查", client.get(f"/api/ai/history?session_id={sid}").get_json()["code"] == 200)
    check("非法 mode 报 400",
          client.post("/api/ai/chat", json={"question": "x", "mode": "xxx"}).get_json()["code"] == 400)

    set_llm()
    with mock.patch("server.llm_client.urllib.request.urlopen", side_effect=fake_ok):
        r4 = client.post("/api/ai/chat", json={"question": "还有货吗", "mode": "llm"}).get_json()
        o1 = client.post("/api/ai/chat", json={"question": "安排两天一晚上的行程", "mode": "auto"}).get_json()
        d1 = client.post("/api/ai/chat", json={"question": "住一晚多少钱？", "mode": "auto"}).get_json()
    check("启用后走外部模型", r4["data"]["engine"] == "llm" and r4["data"]["model"] == "test-model-2026",
          str(r4["data"]))
    check("答案标注外部模型来源", "外部大模型" in r4["data"]["source"])
    check("开放式问题不再被本地关键词抢答", o1["data"]["engine"] == "llm", str(o1["data"]))
    check("业务数据查询仍走本地秒回", d1["data"]["engine"] == "local", str(d1["data"]))
    hist = client.get(f"/api/ai/history?session_id={r4['data']['session_id']}").get_json()
    check("会话历史含本轮问答", len(hist["data"]["records"]) == 2, str(hist["data"]))

    with mock.patch("server.llm_client.urllib.request.urlopen", side_effect=TimeoutError("down")):
        r5 = client.post("/api/ai/chat", json={"question": "还有货吗", "mode": "llm"}).get_json()
    check("模型超时自动回退本地", r5["data"]["degraded"] and r5["data"]["engine"] == "local",
          str(r5["data"]))
    check("回退仍给出确定答案", len(r5["data"]["answer"]) > 5)

    # 7 前端布局
    print("\n7 「小梅」搜索栏布局")
    css = read("web/assets/common.css")
    check("H5 样式含独立搜索栏类", all(x in css for x in
          (".ai-search {", ".ai-search-input", ".ai-search-btn", ".ai-asks", ".ai-msgs")))
    check("H5 有窄屏换行规则", "@media (max-width: 360px)" in css and "grid-template-columns: 1fr" in css)
    js = read("web/assets/visitor.js")
    check("H5 改用表单提交并带 session_id", all(x in js for x in
          ("aiForm", "session_id", "ai-mode-btn", "renderAsks")))
    check("H5 不再使用拥挤的 gap:8px 输入行", '<div style="display:flex;gap:8px"><input class="input" id="q"' not in js)
    wxml = read("mp-weixin/pages/index/index.wxml")
    check("小程序改用 ai-* 结构", all(x in wxml for x in
          ("ai-card", "ai-search-field", "ai-send", "ai-asks", "ai-answer")))
    wxss = read("mp-weixin/app.wxss")
    check("小程序有专用间距与对齐规则", all(x in wxss for x in
          (".ai-search {", ".ai-input {", ".ai-send {", ".ai-asks {", "gap: 16rpx")))

    # 8 自启动脚本
    print("\n8 自启动与部署脚本")
    ps = read("deploy/autostart.ps1")
    check("Windows 自启写入启动文件夹", "GetFolderPath('Startup')" in ps and "CreateShortcut" in ps)
    check("Windows 自启可卸载", "Remove-Item" in ps)
    check("自启动不弹浏览器", "--no-browser" in read("deploy/run_server.bat"))
    unit = read("deploy/plum.service")
    check("systemd 开机自启与自动重启", "WantedBy=multi-user.target" in unit and "Restart=always" in unit)

    print("\n" + "=" * 62)
    print(f" 通过 {PASS} 项，失败 {FAIL} 项")
    print("=" * 62)
    shutil.rmtree(TMP, ignore_errors=True)
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
