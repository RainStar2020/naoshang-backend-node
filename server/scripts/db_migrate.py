#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
脑商AI · 数据库迁移 / 验证脚本
功能：
  1) 依据 sql/schema.sql 在 data/brain_biz.db 建立「空表 + 外键连接」的正式库（交付物）。
  2) 若 data/db.json 存在（后端运行时快照），把其灌入一个【临时】库，
     开启 PRAGMA foreign_keys=ON，执行 foreign_key_check + 逐表外键交叉校验，
     输出连接性报告；临时库验证后删除，保证交付的 brain_biz.db 始终保持空表。
  3) 打印每张表的字段 ↔ JSON 来源 映射，便于核对设计。

用法：python scripts/db_migrate.py
依赖：仅 Python 标准库（sqlite3 / json / pathlib）。
"""

import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # E:\脑商ai\server
SCHEMA = ROOT / "sql" / "schema.sql"
DATA = ROOT / "data"
DB_JSON = DATA / "db.json"
DELIVERED = DATA / "brain_biz.db"
TMP = DATA / "_verify_brain_biz.db"


def _ms_to_text(ms):
    """毫秒时间戳 → 'YYYY-MM-DD HH:MM:SS' 本地时间文本；空值返回 None。"""
    if ms in (None, ""):
        return None
    try:
        return datetime.fromtimestamp(float(ms) / 1000).strftime("%Y-%m-%d %H:%M:%S")
    except (TypeError, ValueError, OSError):
        return None


def build_schema(conn: sqlite3.Connection):
    sql = SCHEMA.read_text(encoding="utf-8")
    conn.executescript(sql)
    conn.commit()


def deliver_empty():
    if DELIVERED.exists():
        DELIVERED.unlink()
    conn = sqlite3.connect(str(DELIVERED))
    conn.execute("PRAGMA foreign_keys = ON;")
    build_schema(conn)
    conn.close()
    print(f"[交付] 已生成空表库：{DELIVERED}（{DELIVERED.stat().st_size} 字节，外键已定义）")


# ───────────────── 把 db.json 灌入临时库做连接性验证 ─────────────────
def safe(d, *keys, default=None):
    for k in keys:
        if not isinstance(d, dict):
            return default
        d = d.get(k, default)
    return d


def iso(v):
    """毫秒时间戳 / ISO 串 → ISO 8601 字符串（TEXT 类型时间列用；PG 迁移必需）"""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        import datetime as _dt
        return _dt.datetime.utcfromtimestamp(v / 1000).strftime("%Y-%m-%d %H:%M:%S")
    return str(v)


def populate(conn: sqlite3.Connection, snap: dict):
    users = snap.get("users", {})
    orders = snap.get("orders", [])
    commissions = snap.get("commissions", [])
    quota = snap.get("quotaLedger", {})
    agents = snap.get("regionalAgents", [])
    costores = snap.get("coStores", [])
    hist = snap.get("uplineHistory", [])
    settings = snap.get("settings")
    experience = snap.get("experience", [])
    promo_tasks = snap.get("promotionTasks", [])
    free_log = snap.get("freeUpgradeLog", [])
    invite_codes = snap.get("inviteCodes", [])
    wechat_tickets = snap.get("wechatTickets", [])
    allocations = snap.get("allocations", [])
    # ── 2026-10-27 补齐：此前未迁移的业务集合（缺失会导致数据丢失）──
    activation_codes = snap.get("activationCodes", [])
    coupons = snap.get("coupons", [])
    assets = snap.get("assets", [])
    jobs = snap.get("jobs", [])
    learning_progress = snap.get("learningProgress", [])
    skus = snap.get("skus", [])
    stock_ledger = snap.get("stockLedger", [])
    columns = snap.get("columns", [])
    activity_prices = snap.get("activityPrices", [])
    quotes = snap.get("quotes", [])
    allocation_quotes = snap.get("allocationQuotes", [])

    # users（v2 主表；partners 为兼容视图）
    for uid, u in users.items():
        conn.execute(
            """INSERT OR REPLACE INTO users
               (id,seq,display_id,name,phone,tier,is_founding,upline_id,team_vip,annual_fee_paid,
                entitlement_state,entitlement_paid_at,entitlement_expires_at,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (uid, u.get("seq"), u.get("display_id"), u.get("name", ""), u.get("phone", ""),
             u.get("tier", "none"), u.get("is_founding", "none"), u.get("upline_id"),
             u.get("teamVip", 0), 1 if u.get("annual_fee_paid", True) else 0,
             u.get("entitlement_state", "active"),
             u.get("entitlement_paid_at"), u.get("entitlement_expires_at"), u.get("created_at")),
        )

    # ── 系统账号（虚拟主体）────────────────────────────────────────
    # HQ（总部）/ DIVIDEND（分红池）/ admin（后台操作人）是合法的归属方与操作人，
    # 但不在 db.users 里。commissions.owner_id、stock_ledger.operator_id 等有
    # REFERENCES users(id) 外键，迁移 PG 前必须补上对应行，否则外键失败、数据丢失。
    # 注意：users.seq / display_id / phone 均为 UNIQUE，各取唯一值。
    existing_user_ids = set(users.keys())
    SYSTEM_USERS = [
        {"id": "HQ", "name": "总部", "tier": "system", "seq": 900001,
         "display_id": "HQ", "phone": "sys-hq"},
        {"id": "DIVIDEND", "name": "分红池", "tier": "system", "seq": 900002,
         "display_id": "DIVIDEND", "phone": "sys-dividend"},
        {"id": "admin", "name": "总部后台", "tier": "system", "seq": 900003,
         "display_id": "ADMIN", "phone": "sys-admin"},
    ]
    for su in SYSTEM_USERS:
        if su["id"] in existing_user_ids:
            continue
        conn.execute(
            """INSERT OR REPLACE INTO users
               (id,seq,display_id,name,phone,tier,is_founding,upline_id,team_vip,annual_fee_paid,
                entitlement_state,entitlement_paid_at,entitlement_expires_at,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (su["id"], su["seq"], su["display_id"], su["name"], su["phone"],
             su["tier"], "none", None, 0, 0, "active", None, None,
             iso(0) or "1970-01-01 00:00:00"),
        )

    # members（孩子档案：编号/会员等级）
    mcount = 0
    for m in snap.get("members", []):
        try:
            conn.execute(
                """INSERT OR REPLACE INTO members
                   (id,user_id,name,grade_code,grade_label,gender_code,gender_label,avatar_asset_id,
                    avatar_url,store_id,activated,member_level,member_seq,display_id,
                    unlocked_levels,unlocked_columns,training,idempotency_key,version,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (m.get("id"), m.get("userId"), m.get("name", ""), m.get("gradeCode", ""),
                 m.get("gradeLabel", ""), m.get("genderCode", ""), m.get("genderLabel", ""),
                 m.get("avatarAssetId"), m.get("avatarUrl"), m.get("storeId"),
                 1 if m.get("activated") else 0, m.get("memberLevel", "normal"),
                 m.get("memberSeq"), m.get("display_id"),
                 json.dumps(m.get("unlockedLevels", []), ensure_ascii=False),
                 json.dumps(m.get("unlockedColumns", []), ensure_ascii=False),
                 json.dumps(m.get("training", {}), ensure_ascii=False),
                 m.get("idempotencyKey"), m.get("version", 1), m.get("createdAt")),
            )
            mcount += 1
        except Exception as e:
            print(f"    ! members 跳过 {m.get('id')}: {e}")

    # counters（全局序号计数器，随快照回填）
    for name in ("userSeq", "memberSeq", "seq"):
        if name in snap:
            conn.execute("INSERT OR REPLACE INTO counters (name,value) VALUES (?,?)",
                         (name, snap.get(name)))

    # orders
    ocount = 0
    for o in orders:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO orders
                   (id,buyer_id,seller_id,package_tier,old_tier,quota_count,vip_credit,
                    actual_paid,seller_cost,supply_spread,store_fee,hq_fee,region_code,status,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                # package_tier 为 NOT NULL：升档单取 packageTier；产品单没有该字段，
                # 用买家合伙人档位（vip/angel/private/cofounder）兜底，代理档位用 vip 占位。
                (o.get("id"), o.get("buyer_id"), o.get("seller_id"),
                 o.get("packageTier") or (o.get("level") if o.get("level") in ("vip", "angel", "private", "cofounder") else "vip"),
                 o.get("oldTier"), o.get("quotaCount", 1), o.get("vipCredit", 1),
                 o.get("actual_paid", o.get("actualPaid", 0)), o.get("sellerCost", 0), o.get("supply_spread", 0),
                 o.get("store_fee", 0), o.get("hq_fee", 0), o.get("regionCode"),
                 o.get("status", "paid"), o.get("created_at")),
            )
            ocount += 1
        except Exception as e:
            print(f"    ! orders 跳过 {o.get('id')}: {e}")

    # -- 合店费单补登为 orders 行 -------------------------------------
    # costore 佣金用 ref_order_id = 合店费单 id（如 cs_16），但合店费单只存在
    # co_stores 表、不在 orders 表 -> commissions.ref_order_id 的外键
    # REFERENCES orders(id) 会在 PG 上失败。此处把合店费单补成 type='costore' 的订单行。
    for cs in costores:
        cid = cs.get("id")
        if not cid:
            continue
        try:
            conn.execute(
                """INSERT OR REPLACE INTO orders
                   (id,buyer_id,seller_id,package_tier,old_tier,quota_count,vip_credit,
                    actual_paid,seller_cost,supply_spread,store_fee,hq_fee,region_code,channel,
                    store_id,status,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                # buyer_id 有外键且 NOT NULL：合店费单的 owner 必须是真实用户，
                # 否则补登的订单行会破坏外键；owner 缺失时用 HQ（系统账号）兜底。
                (cid, cs.get("owner_id") or "HQ", cs.get("promoter_id") or None,
                 "vip", None, 1, 0,
                 cs.get("monthly_fee", 698), 0, 0, 0, 0,
                 cs.get("store_id"), "partner", cs.get("store_id"),
                 "paid", cs.get("created_at") or cs.get("joinDate")),
            )
            ocount += 1
        except Exception as e:
            print(f"    ! orders 跳过合店费单 {cid}: {e}")

    # commissions

    ccount = 0
    for c in commissions:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO commissions
                   (id,owner_id,type,subtype,period,base_amount,rate,amount,ref_order_id,status,note,formula,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (c.get("id"), c.get("owner_id"), c.get("type"), c.get("subtype"), c.get("period"),
                 c.get("base_amount", 0), c.get("rate"), c.get("amount", 0), c.get("ref_order_id"),
                 c.get("status", "pending"), c.get("note"), c.get("formula"), c.get("created_at")),
            )
            ccount += 1
        except Exception as e:
            print(f"    ! commissions 跳过 {c.get('id')}: {e}")

    # quota_ledger(标准余额) + quota_activity_batches(活动批次) + quota_transactions(流水)
    # ⚠️ 对齐 sql/schema.sql：
    #   quota_ledger(user_id, standard) —— 只有标准余额列，活动名额在 quota_activity_batches
    #   quota_transactions(id, user_id, op, kind, used_standard, used_activity, amount, ref, operator_id, created_at)
    for uid_, bal in quota.items():
        if isinstance(bal, (int, float)):
            # 兼容旧快照：纯数字 = 标准余额
            standard, activity = int(bal), []
        else:
            standard = int(bal.get("standard", 0) or 0)
            activity = bal.get("activity", []) or []
        conn.execute("INSERT OR REPLACE INTO quota_ledger (user_id,standard) VALUES (?,?)",
                     (uid_, standard))
        if standard > 0:
            conn.execute("""INSERT INTO quota_transactions
                            (user_id,op,kind,used_standard,used_activity,amount,ref)
                            VALUES (?,?,?,?,?,?,?)""",
                         (uid_, "issue", "standard", 0, 0, standard, "seed"))
        for i, act in enumerate(activity):
            qty = int(act.get("qty", 0) or 0)
            obtained = act.get("obtainedAt")
            expire = act.get("expireAt")
            conn.execute("""INSERT INTO quota_activity_batches
                            (user_id,qty,obtained_at,expire_at) VALUES (?,?,?,?)""",
                         (uid_, qty,
                          _ms_to_text(obtained), _ms_to_text(expire)))
            conn.execute("""INSERT INTO quota_transactions
                            (user_id,op,kind,used_standard,used_activity,amount,ref)
                            VALUES (?,?,?,?,?,?,?)""",
                         (uid_, "issue", "activity", 0, 0, qty, "seed"))

    # regional_agents
    for a in agents:
        conn.execute(
            """INSERT OR REPLACE INTO regional_agents
               (id,user_id,region_type,region_code,price_tier,referrer_id,granted_tier,appointed_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (a.get("id"), a.get("partner_id"), a.get("region_type"), a.get("region_code"),
             a.get("price_tier", 0), a.get("referrer_id"), a.get("granted_tier"), a.get("appointed_at")),
        )

    # co_stores + co_store_owners（规范化展开 owners 数组）
    for cs in costores:
        conn.execute(
            """INSERT OR REPLACE INTO co_stores
               (id,owner_id,promoter_id,store_manager_id,store_id,monthly_fee,owner_count,join_date,created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (cs.get("id"), cs.get("owner_id"), cs.get("promoter_id"), cs.get("storeManagerId"),
             cs.get("store_id"), cs.get("monthly_fee", 698), cs.get("ownerCount", 1),
             cs.get("joinDate"), cs.get("created_at")),
        )
        owners = cs.get("owners") or cs.get("partners") or []
        for ow in owners:
            pid = ow.get("id") if isinstance(ow, dict) else ow
            perf = ow.get("performance", 0) if isinstance(ow, dict) else 0
            if pid:
                conn.execute(
                    "INSERT OR IGNORE INTO co_store_owners (co_store_id,user_id,performance) VALUES (?,?,?)",
                    (cs.get("id"), pid, perf),
                )

    # upline_history
    for h in hist:
        conn.execute(
            """INSERT INTO upline_history (user_id,old_upline,new_upline,action,at)
               VALUES (?,?,?,?,?)""",
            (h.get("partnerId"), h.get("oldUpline"), h.get("newUpline"), h.get("action"), h.get("at")),
        )

    # payments（支付单）
    pcount = 0
    for pay in snap.get("payments", []):
        try:
            conn.execute(
                """INSERT OR REPLACE INTO payments
                   (id,biz_type,biz_id,user_id,amount,channel,subject,status,transaction_id,
                    idempotency_key,pay_params,meta,notify_raw,note,created_at,paid_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (pay.get("id"), pay.get("bizType"), pay.get("bizId"), pay.get("userId"),
                 pay.get("amount", 0), pay.get("channel"), pay.get("subject", ""),
                 pay.get("status", "CREATED"), pay.get("transactionId"), pay.get("idempotencyKey"),
                 json.dumps(pay.get("payParams", {}), ensure_ascii=False),
                 json.dumps(pay.get("meta", {}), ensure_ascii=False),
                 json.dumps(pay.get("notifyRaw"), ensure_ascii=False) if pay.get("notifyRaw") else None,
                 pay.get("note"), pay.get("createdAt"), pay.get("paidAt")),
            )
            pcount += 1
        except Exception as e:
            print(f"    ! payments 跳过 {pay.get('id')}: {e}")

    # P0-1 经验值流水
    for e in experience:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO experience_ledger
                   (id,user_id,tab,event,title,points,price,ref_id,meta,occurred_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (e.get("id"), e.get("userId"), e.get("tab", "promotion"), e.get("event"),
                 e.get("title"), e.get("points", 0), e.get("price", 0), e.get("refId"),
                 json.dumps(e.get("meta", {}), ensure_ascii=False), e.get("occurredAt")),
            )
        except Exception as ex:
            print(f"    ! experience_ledger 跳过 {e.get('id')}: {ex}")

    # P0-2 晋升任务
    for t in promo_tasks:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO promotion_tasks
                   (id,user_id,start_tier,valid_until,valid_months,targets,status,
                    achieved_at,granted_tier,claimed_at,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (t.get("id"), t.get("userId"), t.get("startTier"), t.get("validUntil"),
                 t.get("validMonths", 12), json.dumps(t.get("targets", []), ensure_ascii=False),
                 t.get("status", "ONGOING"), t.get("achievedAt"), t.get("grantedTier"),
                 t.get("claimedAt"), t.get("createdAt")),
            )
        except Exception as ex:
            print(f"    ! promotion_tasks 跳过 {t.get('id')}: {ex}")

    # 拉人免费升档触发日志
    for g in free_log:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO free_upgrade_log
                   (id,user_id,from_tier,to_tier,rule,trigger_ref,note,created_at)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (g.get("id"), g.get("userId"), g.get("fromTier"), g.get("toTier"),
                 g.get("rule"), g.get("triggerRef"), g.get("note"), g.get("createdAt")),
            )
        except Exception as ex:
            print(f"    ! free_upgrade_log 跳过 {g.get('id')}: {ex}")

    # P1-8 两套邀请码
    for ic in invite_codes:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO invite_codes
                   (code,type,owner_id,created_at,expires_at,max_use,used_by,status)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (ic.get("code"), ic.get("type", "register"), ic.get("ownerId"),
                 ic.get("createdAt"), ic.get("expiresAt"), ic.get("maxUse", 0),
                 json.dumps(ic.get("usedBy", []), ensure_ascii=False),
                 ic.get("status", "active")),
            )
        except Exception as ex:
            print(f"    ! invite_codes 跳过 {ic.get('code')}: {ex}")

    # P2-2 微信授权票据
    for wt in wechat_tickets:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO wechat_tickets
                   (id,openid,ticket,mode,used,expires_at,created_at)
                   VALUES (?,?,?,?,?,?,?)""",
                (wt.get("id"), wt.get("openid"), wt.get("ticket"), wt.get("mode", "mock"),
                 1 if wt.get("used") else 0, wt.get("expiresAt"), wt.get("createdAt")),
            )
        except Exception as ex:
            print(f"    ! wechat_tickets 跳过 {wt.get('id')}: {ex}")

    # 分配意愿（P0-9）：db.json 里是一条「聚合对象」（含 rows 数组），
    # schema 里是「规范化表」（每行一个收款人）→ 必须按 rows 展开，
    #   否则整条分配记录无法入库（分配提点链路的历史数据会丢失）。
    #   kind 归一化：内部 'inspect' → 对外 'inspection'（schema CHECK 约束）
    for al in allocations:
        rows = al.get("rows") or []
        if not rows:
            rows = [{}]
        for idx, row in enumerate(rows):
            try:
                kind = al.get("kind") or "sales"
                kind = "inspection" if kind == "inspect" else kind
                # idempotency_key 是 UNIQUE：只有首行带，后续行留空
                idem = al.get("idempotencyKey") if idx == 0 else None
                conn.execute(
                    """INSERT OR REPLACE INTO allocations
                       (id,entry_id,user_id,target_id,beneficiary_name,kind,percent,amount,
                        status,operation_id,idempotency_key,created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (f"{al.get('id')}-{idx}", al.get("entryId"),
                     al.get("operatorId") or al.get("userId"),
                     row.get("targetId"), row.get("name", ""), kind,
                     row.get("percent", 0), row.get("amount", 0),
                     al.get("status", "PENDING_SETTLEMENT"),
                     f"op-{al.get('id')}", idem, iso(al.get("createdAt"))),
                )
            except Exception as ex:
                print(f"    ! allocations 跳过 {al.get('id')}[{idx}]: {ex}")

    # settings（整段存为一条）
    if settings:
        conn.execute("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)",
                     ("app_settings", json.dumps(settings, ensure_ascii=False)))

    # P2-5 后台可调配置（app_settings 表，与 store.js DEFAULT_SETTINGS 对齐）
    if settings:
        conn.execute("INSERT OR REPLACE INTO app_settings (id,payload) VALUES (?,?)",
                     ("default", json.dumps(settings, ensure_ascii=False)))

    # ═══════════════════════════════════════════════════════════════
    # 2026-10-27 补齐：此前完全缺失的灌库逻辑
    # ═══════════════════════════════════════════════════════════════

    # 激活码（已发放的码；缺失会让用户无法激活已购内容）
    for ac in activation_codes:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO activation_codes
                   (code,target_type,target_id,max_uses,uses,status,expires_at,used_by,
                    channel,store_id,issued_by,issued_to,batch_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (ac.get("code"), ac.get("targetType", "fs"), ac.get("targetId"),
                 ac.get("maxUses", 1), ac.get("uses", 0), ac.get("status", "active"),
                 ac.get("expiresAt", 0),
                 json.dumps(ac.get("usedBy", []), ensure_ascii=False),
                 ac.get("channel", "admin"), ac.get("storeId"), ac.get("issuedBy"),
                 ac.get("issuedTo"), ac.get("batchId")),
            )
        except Exception as ex:
            print(f"    ! activation_codes 跳过 {ac.get('code')}: {ex}")

    # 优惠券
    for cp in coupons:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO coupons
                   (id,user_id,title,discount_amount,threshold_text,scope_label,status,expires_at,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (cp.get("id"), cp.get("userId"), cp.get("title", ""),
                 cp.get("discountAmount", 0), cp.get("thresholdText", ""),
                 cp.get("scopeLabel", ""), cp.get("status", "available"),
                 cp.get("expiresAt", 0), iso(cp.get("createdAt"))),
            )
        except Exception as ex:
            print(f"    ! coupons 跳过 {cp.get('id')}: {ex}")

    # 素材（头像 / 海报 / 二维码）
    for at in assets:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO assets
                   (id,user_id,purpose,file_name,mime_type,size,status,preview_url,fail_reason,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (at.get("id"), at.get("userId"), at.get("purpose", ""),
                 at.get("fileName", ""), at.get("mimeType", ""), at.get("size", 0),
                 at.get("status", "PENDING"), at.get("previewUrl"), at.get("failReason"),
                 iso(at.get("createdAt"))),
            )
        except Exception as ex:
            print(f"    ! assets 跳过 {at.get('id')}: {ex}")

    # 合成任务
    for jb in jobs:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO jobs
                   (id,type,material_id,qr_asset_id,user_id,status,message,download_url,
                    share_url,idempotency_key,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (jb.get("id"), jb.get("type", "POSTER_RENDER"), jb.get("materialId"),
                 jb.get("qrAssetId"), jb.get("userId"), jb.get("status", "queued"),
                 jb.get("message"), jb.get("downloadUrl"), jb.get("shareUrl"),
                 jb.get("idempotencyKey"), iso(jb.get("createdAt"))),
            )
        except Exception as ex:
            print(f"    ! jobs 跳过 {jb.get('id')}: {ex}")

    # 学习进度（账号级）
    for lp in learning_progress:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO learning_progress
                   (member_id,level_id,chapter_id,position_seconds,duration_seconds,completed,updated_at)
                   VALUES (?,?,?,?,?,?,?)""",
                (lp.get("memberId"), lp.get("levelId"), lp.get("chapterId"),
                 lp.get("positionSeconds", 0), lp.get("durationSeconds", 0),
                 1 if lp.get("completed") else 0, lp.get("updatedAt", 0)),
            )
        except Exception as ex:
            print(f"    ! learning_progress 跳过: {ex}")

    # SKU 目录（须先于 stock_ledger，后者有外键指向 skus）
    for sk in skus:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO skus
                   (id,product_id,label,list_price,stock,updated_at)
                   VALUES (?,?,?,?,?,?)""",
                (sk.get("id"), sk.get("productId", ""), sk.get("label", ""),
                 sk.get("listPrice", 0), sk.get("stock", 0), sk.get("updatedAt", 0)),
            )
        except Exception as ex:
            print(f"    ! skus 跳过 {sk.get('id')}: {ex}")

    # 库存台账
    for sl in stock_ledger:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO stock_ledger
                   (id,sku_id,delta,reason,order_id,operator_id,at,balance_after)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (sl.get("id"), sl.get("skuId"), sl.get("delta", 0), sl.get("reason", ""),
                 sl.get("orderId"), sl.get("operatorId"), sl.get("at", 0),
                 sl.get("balanceAfter", 0)),
            )
        except Exception as ex:
            print(f"    ! stock_ledger 跳过 {sl.get('id')}: {ex}")

    # 专栏（正文与章节以 JSON 存储）
    for col in columns:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO "columns"
                   (id,title,summary,cover_url,price,fulfillment_type,requires_member,
                    price_presentation,checkout_notice,content,chapters)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (col.get("id"), col.get("title", ""), col.get("summary", ""),
                 col.get("coverUrl"), col.get("price", 0),
                 col.get("fulfillmentType", "ACTIVATION_CODE"),
                 1 if col.get("requiresMember") else 0,
                 col.get("pricePresentation", "single"), col.get("checkoutNotice"),
                 json.dumps(col.get("content", {}), ensure_ascii=False),
                 json.dumps(col.get("chapters", []), ensure_ascii=False)),
            )
        except Exception as ex:
            print(f"    ! columns 跳过 {col.get('id')}: {ex}")

    # 商品活动价
    for ap in activity_prices:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO activity_prices (product_id,amount,note,updated_at)
                   VALUES (?,?,?,?)""",
                (ap.get("productId"), ap.get("amount", 0), ap.get("note"), ap.get("updatedAt", 0)),
            )
        except Exception as ex:
            print(f"    ! activity_prices 跳过 {ap.get('productId')}: {ex}")

    # 报价单
    for qt in quotes:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO quotes
                   (id,scene,user_id,amount,breakdown,items,meta,rule_version,
                    issued_at,expires_at,consumed,consumed_at,consumed_ref)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (qt.get("id"), qt.get("scene", "checkout"), qt.get("userId"),
                 qt.get("amount", 0),
                 json.dumps(qt.get("breakdown", {}), ensure_ascii=False),
                 json.dumps(qt.get("items", []), ensure_ascii=False),
                 json.dumps(qt.get("meta", {}), ensure_ascii=False),
                 qt.get("ruleVersion", 1), qt.get("issuedAt", 0), qt.get("expiresAt", 0),
                 1 if qt.get("consumed") else 0, qt.get("consumedAt"), qt.get("consumedRef")),
            )
        except Exception as ex:
            print(f"    ! quotes 跳过 {qt.get('id')}: {ex}")

    # 分配意愿报价单
    for aq in allocation_quotes:
        try:
            conn.execute(
                """INSERT OR REPLACE INTO allocation_quotes
                   (id,entry_id,user_id,kind,targets,entry_amount,rows,total_percent,
                    total_amount,expires_at,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (aq.get("id"), aq.get("entryId"), aq.get("userId"), aq.get("kind", "sales"),
                 json.dumps(aq.get("targets", []), ensure_ascii=False),
                 aq.get("entryAmount", 0),
                 json.dumps(aq.get("rows", []), ensure_ascii=False),
                 aq.get("totalPercent", 0), aq.get("totalAmount", 0),
                 aq.get("expiresAt", 0), aq.get("createdAt", 0)),
            )
        except Exception as ex:
            print(f"    ! allocation_quotes 跳过 {aq.get('id')}: {ex}")

    conn.commit()
    return dict(users=len(users), members=mcount, orders=ocount, commissions=ccount,
                quota_ledger=len(quota), agents=len(agents), costores=len(costores),
                upline_history=len(hist), payments=pcount,
                experience=len(experience), promotion_tasks=len(promo_tasks),
                free_upgrade_log=len(free_log), invite_codes=len(invite_codes),
                wechat_tickets=len(wechat_tickets), allocations=len(allocations),
                activation_codes=len(activation_codes), coupons=len(coupons),
                assets=len(assets), jobs=len(jobs), learning_progress=len(learning_progress),
                skus=len(skus), stock_ledger=len(stock_ledger), columns=len(columns),
                activity_prices=len(activity_prices), quotes=len(quotes),
                allocation_quotes=len(allocation_quotes))


def verify_fk(conn: sqlite3.Connection):
    conn.execute("PRAGMA foreign_keys = ON;")
    rows = conn.execute("PRAGMA foreign_key_check;").fetchall()
    return rows


def main():
    print("═" * 70)
    print("脑商AI · 数据库设计交付 + 连接性验证")
    print("═" * 70)
    deliver_empty()

    if not DB_JSON.exists():
        print(f"\n[跳过验证] 未找到 {DB_JSON}（后端尚未运行/快照未生成）。")
        print("   已交付空表库；运行后端产生 db.json 后重跑本脚本即可验证外键连接。")
        return

    snap = json.loads(DB_JSON.read_text(encoding="utf-8"))
    if TMP.exists():
        TMP.unlink()
    conn = sqlite3.connect(str(TMP))
    build_schema(conn)
    counts = populate(conn, snap)
    print("\n[灌入临时库] 各表行数：", counts)

    violations = verify_fk(conn)
    print("\n[外键校验] PRAGMA foreign_key_check 结果：",
          "✅ 无任何违规" if not violations else f"❌ 发现 {len(violations)} 处")
    for v in violations:
        print("   ", v)

    # 逐表统计 + 关键外键连通抽样
    print("\n[表清单]")
    tables = ["users", "counters", "members", "orders", "commissions", "quota_ledger",
              "quota_activity_batches", "quota_transactions", "regional_agents",
              "co_stores", "co_store_owners", "upline_history", "payments",
              "activation_codes", "settings", "app_settings", "invite_codes",
              "experience_ledger", "promotion_tasks", "free_upgrade_log",
              "wechat_tickets", "allocations",
              # 2026-10-27 补齐
              "activation_codes", "coupons", "assets", "jobs", "learning_progress",
              "skus", "stock_ledger", "columns", "activity_prices", "quotes",
              "allocation_quotes"]
    for t in tables:
        n = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"   {t:<18} {n:>6} 行")

    # 抽样：订单 buyer/seller 是否都能在 partners 中找到（连接性实证）
    orphan = conn.execute(
        """SELECT COUNT(*) FROM orders o
           LEFT JOIN users pb ON o.buyer_id = pb.id
           LEFT JOIN users ps ON o.seller_id = ps.id
           WHERE pb.id IS NULL
              OR (o.seller_id IS NOT NULL AND o.seller_id <> '' AND ps.id IS NULL)""").fetchone()[0]
    print(f"\n[连接性抽样] orders 中 buyer/seller 悬空记录：{orphan}（应为 0）")

    co_owners_orphan = conn.execute(
        """SELECT COUNT(*) FROM co_store_owners co
           LEFT JOIN co_stores cs ON co.co_store_id = cs.id
           LEFT JOIN users p ON co.user_id = p.id
           WHERE cs.id IS NULL OR p.id IS NULL""").fetchone()[0]
    print(f"[连接性抽样] co_store_owners 悬空记录：{co_owners_orphan}（应为 0）")

    conn.close()
    if TMP.exists():
        TMP.unlink()
    print(f"\n[清理] 临时验证库已删除；交付库保持空表：{DELIVERED}")
    print("═" * 70)


if __name__ == "__main__":
    main()
