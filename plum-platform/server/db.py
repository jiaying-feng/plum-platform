"""数据层：SQLite 建表、基准数据、通用查询助手。

设计要点：
- 零外部依赖，首次启动自动建库并灌入基准数据；
- 金额一律以「分」为整数存储，杜绝浮点误差；
- 所有业务实体的状态字段由 state_machine.py 统一约束；
- 基准数据按启动日相对生成（确定性、非随机），保证近 7 日看板始终有数据。
"""
from __future__ import annotations

import hashlib
import os
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.getenv("PLUM_DB_PATH", str(ROOT / "data" / "plum.db")))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, nickname TEXT NOT NULL,
  phone TEXT, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT '启用',
  password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS merchants (
  id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT NOT NULL, contact TEXT,
  phone TEXT, address TEXT, audit_status TEXT NOT NULL DEFAULT '待审核',
  audit_note TEXT DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, sort INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT '启用');
CREATE TABLE IF NOT EXISTS orchards (
  id INTEGER PRIMARY KEY, merchant_id INTEGER, name TEXT NOT NULL, town TEXT,
  address TEXT, lng REAL, lat REAL, open_time TEXT, adult_price_cent INTEGER,
  child_price_cent INTEGER, intro TEXT, image TEXT, audit_status TEXT NOT NULL DEFAULT '已通过');
CREATE TABLE IF NOT EXISTS orchard_sessions (
  id INTEGER PRIMARY KEY, orchard_id INTEGER, session_date TEXT NOT NULL,
  slot TEXT NOT NULL, capacity INTEGER NOT NULL, booked INTEGER NOT NULL DEFAULT 0,
  audit_status TEXT NOT NULL DEFAULT '已通过', audit_note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT '可预约');
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, user_id INTEGER,
  session_id INTEGER, orchard_id INTEGER, visit_date TEXT, slot TEXT,
  people INTEGER, contact TEXT, phone TEXT, amount_cent INTEGER,
  status TEXT NOT NULL DEFAULT '待核销', checkin_code TEXT UNIQUE,
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS research (
  id INTEGER PRIMARY KEY, merchant_id INTEGER, title TEXT NOT NULL,
  start_date TEXT, end_date TEXT, price_cent INTEGER, capacity INTEGER,
  signed INTEGER NOT NULL DEFAULT 0, intro TEXT, image TEXT,
  audit_status TEXT NOT NULL DEFAULT '已通过', status TEXT NOT NULL DEFAULT '报名中');
CREATE TABLE IF NOT EXISTS research_signups (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, user_id INTEGER,
  research_id INTEGER, people INTEGER, contact TEXT, phone TEXT,
  amount_cent INTEGER, status TEXT NOT NULL DEFAULT '待核销',
  checkin_code TEXT UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS homestays (
  id INTEGER PRIMARY KEY, merchant_id INTEGER, name TEXT NOT NULL, town TEXT,
  address TEXT, intro TEXT, image TEXT, audit_status TEXT NOT NULL DEFAULT '已通过');
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY, homestay_id INTEGER, name TEXT NOT NULL,
  capacity INTEGER, price_cent INTEGER, stock INTEGER, image TEXT);
CREATE TABLE IF NOT EXISTS homestay_bookings (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, user_id INTEGER,
  homestay_id INTEGER, room_id INTEGER, check_in TEXT, check_out TEXT,
  guests INTEGER, contact TEXT, phone TEXT, amount_cent INTEGER,
  status TEXT NOT NULL DEFAULT '待核销', checkin_code TEXT UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, merchant_id INTEGER, category_id INTEGER,
  name TEXT NOT NULL, subtitle TEXT, price_cent INTEGER NOT NULL,
  stock INTEGER NOT NULL, sales INTEGER NOT NULL DEFAULT 0,
  image TEXT, intro TEXT, audit_status TEXT NOT NULL DEFAULT '已通过',
  audit_note TEXT DEFAULT '', shelf_status TEXT NOT NULL DEFAULT '上架');
CREATE TABLE IF NOT EXISTS cart (
  id INTEGER PRIMARY KEY, user_id INTEGER, product_id INTEGER, quantity INTEGER,
  UNIQUE(user_id, product_id));
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, order_no TEXT UNIQUE NOT NULL, user_id INTEGER,
  amount_cent INTEGER NOT NULL, receiver TEXT, phone TEXT, address TEXT,
  status TEXT NOT NULL DEFAULT '待支付', request_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER,
  name TEXT, price_cent INTEGER, quantity INTEGER);
CREATE TABLE IF NOT EXISTS festivals (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, festival_date TEXT, place TEXT,
  intro TEXT, image TEXT, status TEXT NOT NULL DEFAULT '展示中');
CREATE TABLE IF NOT EXISTS season_tips (
  id INTEGER PRIMARY KEY, month_range TEXT, title TEXT, content TEXT, tag TEXT);
CREATE TABLE IF NOT EXISTS checkin_spots (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, spot_type TEXT, intro TEXT,
  lng REAL, lat REAL, image TEXT, badge TEXT);
CREATE TABLE IF NOT EXISTS checkin_records (
  id INTEGER PRIMARY KEY, user_id INTEGER, spot_id INTEGER,
  stamp_date TEXT, created_at TEXT NOT NULL, UNIQUE(user_id, spot_id, stamp_date));
CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY, category TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operation_logs (
  id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, target TEXT,
  detail TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(visit_date);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON orchard_sessions(session_date);
"""


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def day(offset: int = 0) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()


def password_hash(raw: str) -> str:
    """不可逆摘要，仅用于本地演示账号体系。"""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def one(sql: str, args=()) -> dict | None:
    with connect() as c:
        row = c.execute(sql, args).fetchone()
        return dict(row) if row else None


def rows(sql: str, args=()) -> list[dict]:
    with connect() as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]


def execute(sql: str, args=()) -> int:
    with connect() as c:
        cur = c.execute(sql, args)
        c.commit()
        return cur.lastrowid


def money(cent: int) -> str:
    return f"{cent / 100:.2f}"


def seed(c: sqlite3.Connection) -> None:
    t = now()
    c.executemany(
        "INSERT INTO users(username,nickname,phone,role,status,password_hash,created_at) VALUES(?,?,?,?,?,?,?)",
        [
            ("admin", "镇平台管理员", "13800000000", "管理员", "启用", password_hash("admin123"), t),
            ("farmer01", "青梅园老李", "13900000001", "商户", "启用", password_hash("merchant123"), t),
            ("stay01", "梅香居民宿", "13900000002", "商户", "启用", password_hash("merchant123"), t),
            ("tourist01", "小梅", "13700000001", "游客", "启用", password_hash("tourist123"), t),
            ("tourist02", "阿青", "13700000002", "游客", "启用", password_hash("tourist123"), t),
        ],
    )
    c.executemany(
        "INSERT INTO merchants(user_id,name,contact,phone,address,audit_status,audit_note,created_at) VALUES(?,?,?,?,?,?,?,?)",
        [
            (2, "䢺江青梅合作社", "李大哥", "13900000001", "大邑县䢺江镇青梅村1组", "已通过", "", t),
            (3, "梅香居民宿", "王姐", "13900000002", "大邑县䢺江镇古镇街18号", "已通过", "", t),
            (None, "山语间农庄", "张师傅", "13900000003", "大邑县䢺江镇山语路6号", "待审核", "", t),
        ],
    )
    c.executemany(
        "INSERT INTO categories(name,sort,status) VALUES(?,?,?)",
        [("青梅鲜果", 1, "启用"), ("青梅加工", 2, "启用"), ("青梅酒水", 3, "启用"), ("文创周边", 4, "启用")],
    )

    orchard_names = ["䢺江青梅采摘园", "青梅谷生态果园", "梅香坡家庭农场", "大双路青梅园",
                     "山顶老梅林", "青梅溪畔果园"]
    towns = ["䢺江镇", "䢺江镇", "安仁镇", "䢺江镇", "西岭镇", "䢺江镇"]
    for i, name in enumerate(orchard_names):
        c.execute(
            "INSERT INTO orchards(merchant_id,name,town,address,lng,lat,open_time,adult_price_cent,"
            "child_price_cent,intro,image,audit_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (1, name, towns[i], f"大邑县{towns[i]}青梅村{i + 1}组", 103.42 + i * 0.012,
             30.58 + i * 0.008, "08:30-17:30", 3000, 1500,
             "自家果园，梅子熟了就能来摘。园里地势平缓，小孩子也走得动，摘完还能坐着喝杯青梅茶。",
             f"/assets/orchard_{i % 5 + 1:02d}.webp", "已通过" if i < 5 else "待审核"),
        )
    for oid in range(1, 7):
        for d in (1, 3, 6):
            for slot in ("上午 09:00-11:30", "下午 14:00-16:30"):
                c.execute(
                    "INSERT INTO orchard_sessions(orchard_id,session_date,slot,capacity,booked,audit_status,status) "
                    "VALUES(?,?,?,?,?,?,?)",
                    (oid, day(d), slot, 40, (oid + d) % 9, "待审核" if oid == 6 else "已通过", "可预约"),
                )

    research = [
        ("青梅酒酿造大师课", 26800, 15, "跟着老师傅选果、清洗、装罐，亲手封一罐属于自己的青梅酒。"),
        ("农耕体验亲子研学", 9800, 20, "带娃下地认青梅树、捡落果、做一枚青梅书签，半天慢慢玩。"),
        ("青梅文化一日营", 12800, 30, "逛老街、看酒坊、听镇上老人讲青梅的故事，中午吃一顿青梅宴。"),
        ("梅子蜜饯手作课", 8800, 16, "从去核到糖渍，做一罐带回家的青梅蜜饯。"),
        ("青梅摄影写生营", 15800, 12, "梅园里找光、找角度，老师带着拍一组乡村片子。"),
        ("小小酿酒师冬令营", 19800, 24, "两天一夜，认识一颗梅子从树上到酒坛的全过程。"),
    ]
    for i, (title, price, cap, intro) in enumerate(research):
        c.execute(
            "INSERT INTO research(merchant_id,title,start_date,end_date,price_cent,capacity,signed,intro,image,"
            "audit_status,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (1, title, day(7 + i * 5), day(7 + i * 5), price, cap, min(cap, 5 + i * 2), intro,
             f"/assets/research_{i % 3 + 1:02d}.webp", "已通过", "报名中"),
        )

    homestays = [("梅香居民宿", "梅园边的老院子，早上推开窗就是青梅树。"),
                 ("山语间", "半山腰的小楼，晚上能听见溪水声。"),
                 ("古镇客栈", "老街上住下，走路两分钟到青梅酒坊。"),
                 ("青梅小院", "带厨房的独门小院，适合一家人住几天。")]
    for i, (name, intro) in enumerate(homestays):
        c.execute(
            "INSERT INTO homestays(merchant_id,name,town,address,intro,image,audit_status) VALUES(?,?,?,?,?,?,?)",
            (1 if i < 2 else 2, name, "䢺江镇", f"大邑县䢺江镇民居巷{i + 1}号", intro,
             "/assets/homestay.webp" if i == 0 else f"/assets/banner_{i:02d}.webp", "已通过"),
        )
        c.executemany(
            "INSERT INTO rooms(homestay_id,name,capacity,price_cent,stock,image) VALUES(?,?,?,?,?,?)",
            [(i + 1, "梅景大床房", 2, 38000, 6, "/assets/homestay.webp"),
             (i + 1, "院子双床房", 3, 45000, 4, f"/assets/banner_{i + 1:02d}.webp")],
        )

    product_names = ["新鲜青梅果 5斤装", "古法青梅酒 500ml", "青梅蜜饯 200g", "话梅干 250g",
                     "五年陈青梅酒礼盒", "青梅酱 280g", "青梅气泡饮 6瓶装", "手作梅子糖",
                     "青梅果脯分享装", "农家青梅醋", "青梅茶包 10袋", "梅香伴手礼盒",
                     "青梅酒小坛装", "脆青梅 150g", "青梅蜂蜜膏", "梅子冰粉套装",
                     "青梅文创帆布袋", "青梅节气明信片"]
    prices = [3990, 12800, 1800, 2500, 16800, 2800, 4500, 1600, 3200, 3600, 2900,
              8800, 6800, 1500, 3300, 2600, 3900, 1200]
    for i, name in enumerate(product_names):
        c.execute(
            "INSERT INTO products(merchant_id,category_id,name,subtitle,price_cent,stock,sales,image,intro,"
            "audit_status,shelf_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (1, i % 4 + 1, name, "䢺江镇自家做的，量少，卖完等下一季", prices[i],
             120 + i * 7, 30 + i * 23, f"/assets/product_{i + 1:02d}.png",
             "本地青梅，农户手作，没有花里胡哨的添加，打开就能吃、能泡、能送人。",
             "待审核" if i in (16, 17) else "已通过", "上架" if i != 17 else "下架"),
        )

    c.executemany(
        "INSERT INTO festivals(title,festival_date,place,intro,image,status) VALUES(?,?,?,?,?,?)",
        [("青梅花开节", "每年 3 月", "青梅谷", "漫山梅花开的时候，镇上摆摄影展、赶花集，走一趟身上都是香的。", "/assets/banner_01.webp", "展示中"),
         ("青梅采摘节", "每年 6 月", "䢺江青梅采摘园", "开园头一天有采摘比赛，谁摘得又快又匀，能抱一坛青梅酒回家。", "/assets/orchard_picking.webp", "展示中"),
         ("青梅封坛会", "每年 9 月", "青梅酒坊", "跟着老师傅封一坛酒，写上自己的名字，来年再来开。", "/assets/plum_wine.webp", "展示中"),
         ("古镇青梅宴", "每年 12 月", "古镇老街", "一桌青梅做的菜，青梅排骨、梅子扣肉，街坊邻居一起吃。", "/assets/banner_04.webp", "展示中")],
    )
    c.executemany(
        "INSERT INTO season_tips(month_range,title,content,tag) VALUES(?,?,?,?)",
        [("3月—4月", "来看梅花", "山上的梅开得正好，早晚凉，带件外套。拍照趁上午光软。", "赏花"),
         ("5月—6月", "来摘梅子", "果子熟了，园区 8:30 开门，上午摘最舒服。周末记得提前约。", "采摘"),
         ("7月—8月", "来山里躲暑", "镇上比城里凉快几度，住一晚，傍晚沿溪边走走。", "避暑"),
         ("9月—12月", "来喝一坛酒", "新酒封坛，老酒开坛。酒坊可以试五种年份，慢慢品。", "品酒")],
    )
    c.executemany(
        "INSERT INTO checkin_spots(name,spot_type,intro,lng,lat,image,badge) VALUES(?,?,?,?,?,?,?)",
        [("游客中心", "打卡点", "先来领一张手绘地图，盖第一枚章。", 103.421, 30.581, "/assets/banner_01.webp", "入门章"),
         ("青梅采摘园", "采摘", "亲手摘满两斤，找园主盖章。", 103.432, 30.588, "/assets/orchard_01.webp", "采摘章"),
         ("青梅酒坊", "研学", "看一坛酒怎么酿成，盖一枚酒香章。", 103.438, 30.583, "/assets/plum_wine.webp", "酿酒章"),
         ("古镇老街", "文旅", "老街上吃完青梅排骨，别忘了盖章。", 103.445, 30.579, "/assets/banner_04.webp", "老街章"),
         ("梅香居民宿", "民宿", "住一晚，早晨在院子里盖章。", 103.451, 30.591, "/assets/homestay.webp", "住宿章"),
         ("山顶观梅台", "打卡点", "爬到最高处，集齐前面五枚可换一份伴手礼。", 103.462, 30.598, "/assets/banner_02.webp", "集齐章")],
    )

    kb = [
        ("采摘", "什么时候可以采摘青梅？", "每年5月下旬到6月中旬果子最饱满，6月上旬来最合适。园区8:30开门，17:00停止入园。"),
        ("采摘", "采摘怎么收费？", "大人30元一位，小朋友15元，门票里含两斤梅子带走；多摘的按8元一斤算。"),
        ("采摘", "周末要提前预约吗？", "平日直接来就行，周末和节假日位置紧，建议提前一两天在平台上约一场。"),
        ("采摘", "下雨天还能摘吗？", "小雨照常，园里有雨衣；遇到暴雨我们会暂停，已约的可以免费改期或者退。"),
        ("研学", "酿酒研学都做些什么？", "跟着老师傅选果、洗梅、装罐、放冰糖，最后封一罐一斤装的酒，写上名字，45天后来取。"),
        ("研学", "研学适合多大的孩子？", "5到15岁都能玩，分启蒙班和探索班，每期不超过20人，保证每个娃都动得上手。"),
        ("研学", "研学怎么报名？", "在研学页面挑好课程和日子，填人数提交就行，付完会收到核销码，到场给师傅看一眼。"),
        ("特产", "青梅酒多少钱？", "一斤装48元，两斤装88元，五年陈酿礼盒168元；自己摘的梅子委托酿一罐，只收30元加工费。"),
        ("特产", "能寄回家吗？", "能，全国顺丰包邮，酒走陆运三五天到。偏远地区补10元运费，下单后48小时内发出。"),
        ("文旅", "住哪儿方便？", "梅香居380元一晚，推开窗就是梅园；山语间450元看山，古镇客栈260元最实惠，都能在平台上订。"),
        ("文旅", "镇上有什么好吃的？", "青梅排骨、梅子扣肉、老腊肉和山野菜，老街农家乐人均四五十，梅香居的青梅宴要提前订。"),
        ("文旅", "有哪些节庆？", "3月青梅花开节看花拍照，6月采摘节有采摘比赛，9月封坛会，12月古镇青梅宴。"),
        ("订单", "订单在哪儿看？", "在「我的」里点「我的订单」，能看状态、收货信息和下单时间。"),
        ("订单", "预约怎么核销？", "到场后把「我的预约」里的核销码给商户扫一下，或者让商户在后台输码核销。"),
        ("售后", "临时来不了怎么办？", "待核销的预约可以在「我的」里取消；过了到园日期没来会自动过期，想改期可以找人工客服。"),
    ]
    c.executemany("INSERT INTO knowledge(category,question,answer) VALUES(?,?,?)", kb)

    # 演示订单 / 预约 / 报名 / 民宿预订：覆盖全部状态，供看板与核销流程使用
    statuses = ["已支付", "已发货", "已完成", "待支付", "已支付", "已完成", "已取消", "已退款", "已完成", "已支付"]
    for i in range(10):
        amount = 3990 + i * 1350
        c.execute(
            "INSERT INTO orders(order_no,user_id,amount_cent,receiver,phone,address,status,request_id,created_at) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (f"PM{(date.today() - timedelta(days=(9 - i))).strftime('%Y%m%d')}{i + 1:03d}",
             4 if i % 2 == 0 else 5, amount, "小梅", "13700000001", "四川省成都市武侯区青梅巷1号",
             statuses[i], f"seed-order-{i}", day(-(9 - i)) + " 09:20:00"),
        )
        oid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        c.execute("INSERT INTO order_items(order_id,product_id,name,price_cent,quantity) VALUES(?,?,?,?,?)",
                  (oid, i % 18 + 1, product_names[i % 18], amount, 1))
    for i in range(8):
        c.execute(
            "INSERT INTO reservations(code,user_id,session_id,orchard_id,visit_date,slot,people,contact,phone,"
            "amount_cent,status,checkin_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (f"YY{(date.today() - timedelta(days=(7 - i))).strftime('%Y%m%d')}{i + 1:03d}",
             4, i + 1, 1, day(-(7 - i)), "上午 09:00-11:30", 2 + i % 3, "小梅", "13700000001",
             6000 + i * 1500, "已核销" if i < 4 else "待核销", f"CK{i + 1:05d}", day(-(9 - i)) + " 10:00:00"),
        )
    for i in range(4):
        c.execute(
            "INSERT INTO research_signups(code,user_id,research_id,people,contact,phone,amount_cent,status,"
            "checkin_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (f"YJ2026{i + 1:04d}", 4, i + 1, 2, "小梅", "13700000001", 26800,
             "已核销" if i % 2 == 0 else "待核销", f"YJCK{i + 1:05d}", day(-(i + 1)) + " 08:30:00"),
        )
        c.execute(
            "INSERT INTO homestay_bookings(code,user_id,homestay_id,room_id,check_in,check_out,guests,contact,"
            "phone,amount_cent,status,checkin_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (f"MS2026{i + 1:04d}", 4, 1, 1, day(i + 2), day(i + 3), 2, "小梅", "13700000001", 38000,
             "待核销" if i < 2 else "已核销", f"MSCK{i + 1:05d}", day(-(i + 1)) + " 11:00:00"),
        )
    c.execute("INSERT INTO cart(user_id,product_id,quantity) VALUES(?,?,?)", (4, 2, 1))
    c.execute("INSERT INTO cart(user_id,product_id,quantity) VALUES(?,?,?)", (4, 5, 2))
    c.execute("INSERT INTO checkin_records(user_id,spot_id,stamp_date,created_at) VALUES(?,?,?,?)",
              (4, 1, day(0), t))
    c.execute("INSERT INTO checkin_records(user_id,spot_id,stamp_date,created_at) VALUES(?,?,?,?)",
              (4, 2, day(0), t))


def _ensure_columns(c: sqlite3.Connection) -> None:
    """旧库轻量升级：审核意见列后来才补，缺则自动加上，避免旧数据跑不起来。"""
    for table in ("merchants", "orchards", "orchard_sessions", "research", "homestays", "products"):
        cols = {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}
        if "audit_note" not in cols:
            c.execute(f"ALTER TABLE {table} ADD COLUMN audit_note TEXT DEFAULT ''")


def init_db(force: bool = False) -> None:
    """建库；已有数据默认不重复灌入，force=True 时重建。"""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as c:
        if force:
            # 用 DROP 重建而不是删文件：Windows 上数据库文件可能被占用，删不掉
            names = [r["name"] for r in c.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
            for name in names:
                c.execute(f'DROP TABLE IF EXISTS "{name}"')
        c.executescript(SCHEMA)
        _ensure_columns(c)
        if c.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
            seed(c)
        c.commit()
