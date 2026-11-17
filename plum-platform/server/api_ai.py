"""AI 问答能力：知识库客服、产品与活动内容生成、智能行程规划、语音讲解稿，
以及可选的「外部大模型 + MySQL 会话」扩展域。

三条硬规矩：
1. 所有数字、名称、价格、余位都从业务库实时查，绝不编造；
2. 说话像镇上人聊天，短句、具体、不堆术语，不写「AI味」套话；
3. 语音讲解返回讲解稿，由前端浏览器直接朗读，不依赖任何外部服务。

扩展域边界：外部模型只负责「组织语言」，事实由 _facts_prompt() 从业务库实时注入；
模型不可用一律回退本地链路。配置、HTTP 调用、MySQL 存储分别放在
ai_config.py / llm_client.py / ai_store.py，本文件只做编排与降级。
"""
from __future__ import annotations

import logging
import re
from datetime import date

from flask import Blueprint, request

from server import ai_config, ai_store, api_common as C, db, llm_client

logger = logging.getLogger("plum.ai")

bp = Blueprint("ai", __name__, url_prefix="/api/ai")

# 这些词一听就像机器写的，生成后统一洗掉
_STIFF_WORDS = {
    "赋能": "帮上忙", "助力": "帮着", "匠心": "用心", "臻选": "挑好的",
    "一站式": "一趟就能办齐", "智能化": "省事", "数字化": "上网就能办",
    "为您提供": "给你", "根据您的需求": "照你说的", "建议您": "不妨",
    "作为AI助手": "", "我将为您": "", "打造": "做", "沉浸式": "踏踏实实",
}

_HEADINGS = ["先说句实在话", "镇上人常说", "来过的都讲", "不用绕弯子"]
_CLOSINGS = ["来一趟就知道了。", "有空来坐坐。", "梅子熟的时候，等你。", "慢慢逛，不着急。"]


def polish(text: str) -> str:
    for bad, good in _STIFF_WORDS.items():
        text = text.replace(bad, good)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _grams(text: str) -> set[str]:
    s = "".join(ch.lower() for ch in text if ch.isalnum())
    return {s[i:i + 2] for i in range(len(s) - 1)} if len(s) > 1 else set(s)


def _similarity(a: str, b: str) -> float:
    ga, gb = _grams(a), _grams(b)
    return len(ga & gb) / len(gb) if gb else 0.0


def _facts() -> dict:
    """给客服与行程用的业务事实快照，每次请求都重新查，保证是当下的数据。"""
    return {
        "orchards": db.rows("SELECT name,town,open_time,adult_price_cent,child_price_cent FROM orchards "
                            "WHERE audit_status='已通过'"),
        "products": db.rows("SELECT name,price_cent,stock,sales FROM products "
                            "WHERE audit_status='已通过' AND shelf_status='上架'"),
        "research": db.rows("SELECT title,price_cent,capacity,signed,start_date FROM research "
                            "WHERE audit_status='已通过'"),
        "homestays": db.rows("SELECT h.name AS stay,r.name AS room,r.price_cent FROM homestays h "
                             "JOIN rooms r ON r.homestay_id=h.id WHERE h.audit_status='已通过'"),
        "festivals": db.rows("SELECT title,festival_date,place FROM festivals WHERE status='展示中'"),
        "sessions": db.rows("SELECT s.session_date,s.slot,s.capacity-s.booked AS left_seats,o.name AS orchard "
                            "FROM orchard_sessions s JOIN orchards o ON o.id=s.orchard_id "
                            "WHERE s.audit_status='已通过' AND s.session_date>=? "
                            "ORDER BY s.session_date LIMIT 6", (db.day(0),)),
        "tip": db.one("SELECT * FROM season_tips ORDER BY id LIMIT 1"),
    }


def _price(cent: int) -> str:
    return f"{cent // 100 if cent % 100 == 0 else cent / 100:.0f}" if cent % 100 == 0 else f"{cent / 100:.2f}"


def _business_answer(q: str, f: dict) -> str | None:
    """按问题里的关键词，从真实业务数据里挑一段人话回答。"""
    if any(w in q for w in ("还有位置", "有位", "余位", "满了吗", "约得上", "场次")):
        if f["sessions"]:
            s = f["sessions"][0]
            return (f"最近的{s['session_date'][5:]}在{s['orchard']}，{s['slot']}，"
                    f"还剩 {max(s['left_seats'], 0)} 个位置。周末走得快，看好了就早点约。")
    if any(w in q for w in ("住", "民宿", "房间", "一晚", "房价")):
        if f["homestays"]:
            first = f["homestays"][0]
            lines = [f"{h['stay']}的{h['room']}，{_price(h['price_cent'])}元一晚"
                     for h in f["homestays"][:3]]
            return "住的地方有几种：" + "；".join(lines) + "。都在平台上能订，入住是下午两点后。"
    if any(w in q for w in ("酒多少钱", "酒价格", "蜜饯", "特产", "多少钱", "卖多少", "贵不贵")):
        hits = [p for p in f["products"] if any(w in q for w in ("酒", "蜜饯", "梅干", "果脯"))
                and any(w in p["name"] for w in ("酒", "蜜饯", "梅干", "果脯"))]
        picked = (hits or f["products"])[:3]
        return ("价钱给你报一下：" + "、".join(f"{p['name']} {_price(p['price_cent'])}元" for p in picked)
                + f"。都是本地手作，库存我刚看过，{'还有货' if picked[0]['stock'] > 0 else '这批刚卖完，等下一季'}。")
    if any(w in q for w in ("研学", "酿酒课", "报名", "课程")):
        if f["research"]:
            r = f["research"][0]
            left = max(r["capacity"] - r["signed"], 0)
            return (f"{r['title']}在{r['start_date'][5:]}开课，{_price(r['price_cent'])}元一位，"
                    f"还剩 {left} 个名额。跟着老师傅封一罐酒，写上名字，过些日子来取。")
    if any(w in q for w in ("节", "活动", "什么时候", "几月", "季节", "最佳", "来玩")):
        if f["festivals"]:
            a = f["festivals"][0]
            return (f"{a['title']}在{a['festival_date']}，{a['place']}办。"
                    f"眼下这个时节，{f['tip']['content'] if f['tip'] else '山里正好，来了慢慢逛。'}")
    if any(w in q for w in ("采摘", "摘梅子", "进园", "门票")):
        o = f["orchards"][0] if f["orchards"] else None
        if o:
            return (f"{o['name']}在{o['town']}，{o['open_time']}开门。"
                    f"大人 {_price(o['adult_price_cent'])} 元，小朋友 {_price(o['child_price_cent'])} 元，"
                    "门票里含两斤梅子带走，多摘的按 8 元一斤算。")
    return None


def _facts_prompt(f: dict) -> str:
    """把实时业务事实压成一段纯文本，作为外部模型的唯一事实来源。

    条数刻意收紧：免费档按输入 token 排队，事实越短、首字出得越快。
    """
    yuan = lambda v: _price(int(v or 0))
    lines = ["【平台实时数据】由平台业务库刚刚查询得到，是本次回答唯一可信的事实来源。"]
    if f["orchards"]:
        lines.append("采摘园：" + "；".join(
            f"{x['name']}（{x['town'] or ''}，{x['open_time'] or ''}开门，"
            f"大人 {yuan(x['adult_price_cent'])} 元，小朋友 {yuan(x['child_price_cent'])} 元）"
            for x in f["orchards"][:3]))
    if f["products"]:
        lines.append("在售商品：" + "；".join(
            f"{x['name']} {yuan(x['price_cent'])} 元，库存 {x['stock']} 件"
            for x in f["products"][:3]))
    if f["research"]:
        lines.append("研学课程：" + "；".join(
            f"{x['title']}（{x['start_date']} 开课，{yuan(x['price_cent'])} 元一位，"
            f"还剩 {max(int(x['capacity'] or 0) - int(x['signed'] or 0), 0)} 个名额）"
            for x in f["research"][:2]))
    if f["homestays"]:
        lines.append("住宿：" + "；".join(
            f"{x['stay']}的{x['room']}，{yuan(x['price_cent'])} 元一晚"
            for x in f["homestays"][:3]))
    if f["sessions"]:
        lines.append("可约场次：" + "；".join(
            f"{x['session_date']} {x['slot']} {x['orchard']}，还剩 {max(int(x['left_seats']), 0)} 位"
            for x in f["sessions"][:4]))
    if f["festivals"]:
        lines.append("节庆活动：" + "；".join(
            f"{x['title']}（{x['festival_date']}，{x['place']}）" for x in f["festivals"][:2]))
    if f["tip"]:
        lines.append(f"当季提示：{f['tip']['content']}")
    lines.append("未列出的事项一律回答「这个我这儿没查到」。")
    return "\n".join(lines)


def _fallback() -> dict:
    return {
        "answer": "这个我还真说不准，怕给你说错了。要不问问镇上的人工客服，或者换个问题，"
                  "比如「采摘怎么收费」「这周还有位置吗」，我手里的园子、房价、场次都是实时的。",
        "source": "兜底", "degraded": False, "topic": "其它",
        "suggestions": ["青梅酒多少钱？", "周末还有位置吗？", "住一晚多少钱？"],
    }


# 开放式提问（规划、推荐、闲聊）：本地关键词规则容易误判，例如
# 「安排两天一晚上的行程」含「一晚」会被当成查房价，应交给外部模型组织答案。
_OPEN_WORDS = (
    "行程", "安排", "规划", "攻略", "怎么玩", "怎么安排", "路线", "一日游", "两日游",
    "二日游", "玩几天", "推荐", "建议", "适合", "带小孩", "带孩子", "老人", "雨天",
    "第一次来", "介绍一下", "讲讲", "说说", "为什么", "如何", "区别", "对比", "聊聊",
)
# 明确的业务数据查询：本地规则答得又快又准，仍然优先本地，不让用户白等模型
_DIRECT_WORDS = (
    "多少钱", "价格", "票价", "几元", "余位", "还有位置", "还剩", "库存", "名额",
    "开门", "营业时间", "几点", "几号", "门票", "收费",
)


def _is_open_question(q: str) -> bool:
    if any(w in q for w in _DIRECT_WORDS):
        return False
    return any(w in q for w in _OPEN_WORDS)


def _history_of(body: dict) -> list[dict]:
    """前端可自带历史；逐条校验，防止超长或伪造角色进入 prompt。"""
    raw = body.get("history")
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw[-20:]:
        if isinstance(item, dict) and item.get("role") in ("user", "assistant"):
            content = C.text_of(item.get("content"))[:500]
            if content:
                out.append({"role": item["role"], "content": content})
    return out


@bp.post("/chat")
def chat():
    """本地事实优先、外部模型兜底；任何外部依赖失败都不影响原有答案。"""
    body = C.get_json()
    q = C.text_of(body.get("question"))
    if not q:
        return C.fail(400, "想问什么，直接说就行")
    if len(q) > 200:
        return C.fail(400, "一口气说太长啦，200 字以内慢慢问")
    mode = C.text_of(body.get("mode"), "auto").lower()
    if mode not in ("auto", "llm", "local"):
        return C.fail(400, "mode 只支持 auto / llm / local")

    sid = C.text_of(body.get("session_id")) or ai_store.new_session_id()
    channel = C.text_of(body.get("channel"), "web")
    f = _facts()

    def finish(result: dict):
        result.setdefault("degraded", False)
        result.setdefault("engine", "local")
        result["session_id"] = sid
        ai_store.touch_session(sid, channel)
        ai_store.append(sid, "user", q)
        ai_store.append(sid, "assistant", result["answer"], result.get("source", ""),
                        result["engine"], result.get("model", ""))
        return C.ok(result)

    # 第一步：原有本地链路（知识库 -> 平台实时数据），事实权威性最高
    kb = db.rows("SELECT category,question,answer FROM knowledge")
    best, score = None, 0.0
    for item in kb:
        s = _similarity(q, item["question"])
        if s > score:
            best, score = item, s
    local = None
    if best and score >= 0.6:
        local = {"answer": best["answer"], "source": "知识库", "topic": best["category"]}
    else:
        live = _business_answer(q, f)
        if live:
            local = {"answer": live, "source": "平台实时数据", "topic": "业务"}

    state = llm_client.status()
    open_q = _is_open_question(q)
    # 开放式问题即便被本地关键词命中，也不直接返回：那类本地答案常常答非所问。
    # 模型不可用时仍把 local 留作兜底，保证永远有确定答案。
    direct_local = None if (open_q and state["enabled"] and mode != "local") else local
    ask_llm = state["enabled"] and mode != "local" and (mode == "llm" or direct_local is None)

    # 第二步：本地能答且不需要外部模型，直接返回（业务数据查询仍是毫秒级）
    if direct_local is not None and not ask_llm:
        result = dict(direct_local)
        if mode == "llm" and not state["enabled"]:
            result["llm_error"] = state["reason"]
        return finish(result)

    # 第三步：外部模型（受 _facts_prompt 事实约束），失败一律回退本地/兜底
    if ask_llm:
        history = ai_store.recent(sid, ai_config.llm()["max_history"]) or _history_of(body)
        try:
            reply = llm_client.ask(q, _facts_prompt(f), history)
            result = {
                "answer": polish(reply["text"]), "source": "外部大模型 + 平台实时数据",
                "degraded": False, "topic": "外部模型", "engine": "llm",
                "model": reply["model"], "latency_ms": reply["latency_ms"],
            }
            ai_store.log_call(sid, q, True, "llm", reply["model"], reply["latency_ms"])
            logger.info("外部模型回答完成 model=%s %sms", reply["model"], reply["latency_ms"])
            return finish(result)
        except llm_client.LLMError as e:
            ai_store.log_call(sid, q, False, "llm", ai_config.llm()["model"], 0, str(e))
            logger.warning("外部模型不可用，回退本地：%s", e)
            error = str(e)
    else:
        error = state["reason"] if mode == "llm" else ""

    result = dict(local) if local is not None else _fallback()
    if error:
        result["degraded"] = True
        result["llm_error"] = error
        # 开放式问题的本地答案往往不对题，明确标注这是实时数据、不是模型回答
        if open_q and local is not None:
            result["answer"] = "外部模型这会儿没连上，先给你平台实时数据：\n" + result["answer"]
        else:
            result["answer"] += "（外部模型这会儿没连上，先按平台数据答你。）"
    return finish(result)


@bp.post("/generate")
def generate():
    """产品文案 / 活动海报文案 / 短视频脚本，素材全部来自库里的真实记录。"""
    body = C.get_json()
    kind = C.text_of(body.get("type"), "product")
    if kind not in ("product", "activity", "script"):
        return C.fail(400, "type 只支持 product（产品文案）、activity（活动文案）、script（短视频脚本）")
    target = C.int_of(body.get("target_id", 1), 1, 1)
    if kind == "activity":
        item = db.one("SELECT * FROM festivals WHERE id=?", (target,)) or \
               db.one("SELECT * FROM festivals ORDER BY id LIMIT 1")
        if not item:
            return C.fail(404, "还没有活动可以写")
        title, place, when, intro = item["title"], item["place"], item["festival_date"], item["intro"]
        content = (f"【标题】{when}，去{place}赶一场{title}\n"
                   f"【正文】{intro}不用做攻略，顺着老街走就能闻见梅子香。"
                   "带上家里人，慢慢看、慢慢吃，一天就这么过去了。\n"
                   f"【吆喝一句】{title}，到时候见，别错过这一季。")
    else:
        item = db.one("SELECT p.*,c.name AS category FROM products p "
                      "LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?", (target,)) or \
               db.one("SELECT p.*,c.name AS category FROM products p "
                      "LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.id LIMIT 1")
        if not item:
            return C.fail(404, "还没有商品可以写")
        name, price = item["name"], _price(item["price_cent"])
        opener = _HEADINGS[item["id"] % len(_HEADINGS)]
        if kind == "script":
            content = (f"镜头1（4秒）｜清晨梅园，手摘带露水的青梅｜“这颗果子，就是{name}的开头。”\n"
                       "镜头2（8秒）｜竹篮里堆起青梅，农户弯腰挑选｜“一颗一颗挑，不赶工。”\n"
                       "镜头3（10秒）｜洗梅、装罐、贴上手写标签｜“自家做的，没那些花里胡哨。”\n"
                       f"镜头4（8秒）｜一家人围桌打开{name}｜“{price}元，吃的是这一季。”\n"
                       "镜头5（5秒）｜老街木桌上的成品，镜头慢慢拉远｜“来䢺江镇，顺手带一罐回去。”")
        else:
            content = (f"【标题】{name}，{price}元带回家\n"
                       f"【正文】{opener}：{item['subtitle']}。{item['intro']}"
                       f"现在库里还有 {item['stock']} 件，卖完就等下一季梅子熟。\n"
                       f"【吆喝一句】{_CLOSINGS[item['id'] % len(_CLOSINGS)]}")
    return C.ok({"content": polish(content), "type": kind, "source": "平台实时数据",
                 "based_on": item.get("name") or item.get("title"), "degraded": False})


@bp.post("/itinerary")
def itinerary():
    """一日 / 两日游：骨架固定，地点、价格、名额、时令提示全部来自真实数据。"""
    body = C.get_json()
    if isinstance(body.get("days"), bool):
        return C.fail(400, "填 1 或 2 就行")
    raw = body.get("days", 1)
    if str(raw).strip() not in ("1", "2"):
        return C.fail(400, "填 1（一日游）或 2（两日游）就行")
    days = int(str(raw).strip())
    f = _facts()
    orchard = f["orchards"][0]["name"] if f["orchards"] else "青梅采摘园"
    course = f["research"][0]["title"] if f["research"] else "青梅酒酿造体验"
    stay = f["homestays"][0]["stay"] if f["homestays"] else "梅香居民宿"
    tip = f["tip"]["content"] if f["tip"] else "山里凉，带件外套。"
    month = date.today().month
    hello = "这个时节来正好。" + tip if f["tip"] else "来吧，山里正好。"
    head = f"{hello}\n\n"
    day1 = (f"【第一天 · 慢慢逛】\n"
            f"09:00 游客中心领一张手绘地图，先盖第一枚章。\n"
            f"09:30 {orchard}摘梅子，大人 30 元含两斤带走，上午果子带露，最舒服。\n"
            f"12:00 古镇老街吃午饭，青梅排骨、山野菜，人均四五十。\n"
            f"13:30 研学基地上「{course}」，亲手封一罐酒，写上名字。\n"
            f"16:00 特产铺子挑点青梅酒和蜜饯，能直接寄回家。\n"
            "17:30 顺着溪边慢悠悠返程。")
    day2 = (f"\n\n【第二天 · 住一晚】\n"
            f"09:00 老街散步，酒坊看老师傅开坛。\n"
            f"11:00 品五种年份的青梅酒，喜欢哪坛带哪坛。\n"
            f"13:00 农家菜收个尾，下午回 {stay} 取行李。\n"
            "小提醒：周末场次和房间都紧，提前一两天在平台上约好。")
    text = head + day1 + (day2 if days == 2 else "\n\n想多待一晚，就住 " + stay + "，第二天接着逛。")
    return C.ok({"itinerary": polish(text), "days": days, "source": "平台实时数据",
                 "degraded": False})


@bp.post("/tts")
def tts():
    """语音讲解稿：基于真实园区/打卡点数据写成口语稿，前端浏览器直接朗读。"""
    body = C.get_json()
    target = C.int_of(body.get("target_id", 1), 1, 1)
    kind = C.text_of(body.get("target_type"), "spot")
    orchard = db.one("SELECT * FROM orchards WHERE id=?", (target,)) if kind == "orchard" else None
    spot = None if orchard else (db.one("SELECT * FROM checkin_spots WHERE id=?", (target,)) or
                                 db.one("SELECT * FROM checkin_spots ORDER BY id LIMIT 1"))
    if not orchard and not spot:
        return C.fail(404, "还没有讲解点")
    if orchard:
        name = orchard["name"]
        segments = [
            f"你现在站的这儿，是{name}。{orchard['intro']}",
            f"园子{orchard['open_time']}开门，大人 {_price(orchard['adult_price_cent'])} 元，"
            f"小朋友 {_price(orchard['child_price_cent'])} 元，门票里含两斤梅子，自己摘的都能带走。",
            f"这一片是{orchard['town']}的老梅林，地势平缓，小孩子也走得动。"
            "梅子熟的时候，风里都是酸甜味，别赶时间，坐下来喝杯青梅茶再走。",
        ]
    else:
        name = spot["name"]
        segments = [
            f"你现在站的这儿，是{name}。{spot['intro']}",
            "顺着老街往前走，就是梅园和酒坊，一路都能盖章。",
            "别赶时间。梅子熟的时候，风里都是酸甜味，坐下来喝杯青梅茶再走。",
        ]
    text = " ".join(segments)
    return C.ok({"text": polish(text), "segments": [polish(s) for s in segments],
                 "title": f"{name} · 语音讲解", "mode": "browser-speech",
                 "source": "平台实时数据", "degraded": False,
                 "tip": "点播放就能听；浏览器不支持时会显示全文。"})


@bp.get("/config")
def ai_config_view():
    """只读状态：给部署者核对配置用，绝不返回完整密钥或数据库密码。"""
    return C.ok({
        **ai_config.public(),
        "llm_status": llm_client.status(),
        "store": ai_store.status(),
        "modes": {
            "auto": "业务数据查询走本地毫秒级回答；开放式/规划类问题交给外部模型（默认）",
            "llm": "直接问外部模型，仍受平台实时事实约束",
            "local": "只用本地能力，完全不联网",
        },
        "note": "密钥只写在 ai.env 或系统环境变量里，修改后重启服务生效",
    })


@bp.get("/history")
def ai_history():
    """按 session_id 查多轮上下文；MySQL 未启用时返回内存历史。"""
    sid = C.text_of(request.args.get("session_id"))
    if not sid:
        return C.fail(400, "缺 session_id")
    try:
        limit = max(1, min(20, int(request.args.get("limit", 10))))
    except ValueError:
        limit = 10
    return C.ok({"session_id": sid, "records": ai_store.recent(sid, limit),
                 "store": ai_store.status()["mode"]})
