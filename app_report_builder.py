#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MODULE XÂY DỰNG BÁO CÁO TỔNG HỢP THEO APP (APP OVERVIEW REPORT)
- Bóc tách chi phí từng kênh quảng cáo: Facebook, Google, TikTok, Mintegral
- Tính toán 2 loại chi phí: USD từ ad network và VND (tỷ giá 26,000)
- First Open = Lượt install từ Adjust
- Doanh thu: Rev Cutoff Admob (Doanh thu D0 từ Adjust)
- Tính ROAS D0 = Rev / Total Cost (USD)
- Tạm tính PL2 = Rev - Total Cost, PL2 (VND), %PL2
- Tự động gắn tên Marketer theo Mã SP hoặc tên campaign
"""

import os
import io
import re
import csv
import json
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta

# ==================== CẤU HÌNH PHÂN CHIA MARKETER & MÃ SP ====================
MARKETER_MAP = {
    # DucTQ
    "AB148": "DucTQ",
    "AB277": "DucTQ",
    "AI PHOTO": "DucTQ",
    "AI304": "DucTQ",
    "AB305": "DucTQ",

    # TrungTT
    "AW109": "TrungTT",
    "AB261": "TrungTT",
    "AB276": "TrungTT",
    "AB266": "TrungTT",

    # QuynhNN
    "AB275": "QuynhNN",
    "AB156": "QuynhNN",
    "AB260": "QuynhNN",
    "AB268": "QuynhNN",

    # LocND
    "AB301": "LocND",
    "AW091": "LocND",
    "UN112": "LocND",

    # VanBT
    "AW005": "VanBT",
    "AB269": "VanBT",
    "AB273": "VanBT",
    "AB303": "VanBT",

    # HanNK
    "AB110": "HanNK",
    "UN113": "HanNK",

    # NhanNTT
    "AB259": "NhanNTT",
    "UN101": "NhanNTT",
    "AB006": "NhanNTT",
    "AB312": "NhanNTT",

    # QuyenNH
    "AB213": "QuyenNH",
    "AB157": "QuyenNH",
    "AB272": "QuyenNH",

    # TrangHT
    "AB270": "TrangHT",
    "AB119": "TrangHT",
    "AB262": "TrangHT",
}

USER_APP_NAMES = {
    "AB148": "AB148 Genie: AI Photo Generator",
    "AB277": "AB277 ThemeBox: Icons & Wallpapers",
    "AI PHOTO": "AI Photo ST",
    "AI304": "AI304 Short IOS",
    "AB305": "AB305 PDF",
    "AW109": "AW109 Reels Movie - Drama Video",
    "AB261": "AB261 DramaVerse – Mini Series",
    "AB276": "AB276 DramaLoom: Drama & Reels",
    "AB266": "AB266 ShortTwist: Mini Drama Reels",
    "AB275": "AB275 IPTV Max: M3U Player & Cast",
    "AB156": "AB156 Short TV: Movie Series",
    "AB260": "AB260 Storymini: Drama Shorts & Reels",
    "AB268": "AB268 ReelSnap: Short Drama & Reels",
    "AB301": "AB301 Short drama ST",
    "AW091": "AW091 Short Drama - Movies & Reels",
    "UN112": "UN112 Stream Drama & short movie",
    "AW005": "AW005 ReelShot: Short Video & Movie",
    "AB269": "AB269 Quick Drama - Short Movie",
    "AB273": "AB273 Control Widget: Control Center",
    "AB303": "AB303 Short drama ST",
    "AB110": "AB110 AI Photo Magic Editor- Gen Art",
    "UN113": "UN113 Short Dramas & Mini Series Box",
    "AB259": "AB259 ReelOne-Short Drama TV, Reels",
    "UN101": "UN101 Box Movie - Mini Dramas & Reel",
    "AB006": "AB006 MoviePrime",
    "AB312": "AB312 Short drama IG",
    "AB213": "AB213 QuickDramas- Mini Series HD",
    "AB157": "AB157 DramaNova – Short Drama Movie",
    "AB272": "AB272 DramasHub: Short Drama & TV",
    "AB270": "AB270 Short Drama - Movie Story",
    "AB119": "AB119 Mira: AI Editor & Enhance",
    "AB262": "AB262 GenArt AI : Magic Photo"
}

TRACKED_APPS = list(MARKETER_MAP.keys())

VND_RATE = 26000

# Danh sách Email Admin (xem được toàn bộ dữ liệu của tất cả mọi người trên Looker Studio)
ADMIN_EMAILS = [
    "ductq@unisoftstudio.com",
    "quyennh@unisoftstudio.com",
    "sonnm@unisoftstudio.com",
    "lienpt@unisoftstudio.com"
]

META_SPEND_FILE = "meta_spend_by_app.json"
GOOGLE_SPEND_FILE = "google_spend_by_app.json"


def extract_app_code(name):
    if not name:
        return "UNKNOWN"
    name = str(name).strip()
    m = re.search(r"([A-Za-z]{1,4}\d{2,4})", name)
    if m:
        return m.group(1).upper()
    if "AI PHOTO" in name.upper():
        return "AI PHOTO"
    parts = name.replace("-", "_").replace(" ", "_").split("_")
    for p in parts:
        p_clean = p.strip()
        if len(p_clean) >= 4 and any(c.isalpha() for c in p_clean) and any(c.isdigit() for c in p_clean):
            return p_clean.upper()
    first = name.split()[0].replace("-", "_").split("_")[0]
    return first.upper() if first else "UNKNOWN"


def to_email(val, kho=""):
    if not val:
        return ""
    s = re.sub(r"\s+", "", str(val).strip().lower())
    if not s:
        return ""
    if "@" in s:
        return s.replace("hannhk@", "hannk@")
    if s == "hannhk" or (s.startswith("han") and "nhan" not in s):
        s = "hannk"
    if s == "ductq" and str(kho).strip().upper() == "AA":
        return "ductq.f1@unisoftstudio.com"
    return f"{s}@unisoftstudio.com"


def extract_emails(val, kho=""):
    if not val:
        return []
    parts = re.split(r"[,;\n]+", str(val).strip())
    res = []
    for p in parts:
        p_clean = p.strip()
        if not p_clean:
            continue
        e = to_email(p_clean, kho=kho)
        if e and e not in res:
            res.append(e)
    return res


def resolve_marketer_email(mkt_val, kho_val="", mail_emp_val="", mail_gen_val=""):
    """
    Ưu tiên suy luận Email Marketer trực tiếp từ cột Tên Marketer (cột A bảng Validate).
    Khi người dùng đổi tên Marketer ở cột A, email sẽ lập tức đổi theo tên mới
    kể cả khi cột Mail Marketer (cột G) bên phải chưa kịp sửa.
    """
    if mkt_val and str(mkt_val).strip():
        cands = extract_emails(mkt_val, kho=kho_val)
        if cands:
            return cands[0]
    for fallback in (mail_emp_val, mail_gen_val):
        if fallback and str(fallback).strip():
            cands = extract_emails(fallback, kho=kho_val)
            if cands:
                return cands[0]
    return ""


def parse_validate_sheet(rows):
    """
    Phân tích linh hoạt dữ liệu từ sheet Validate trên Google Sheets:
    Hỗ trợ các cột: Marketer, Admin, Team Leader, Employee, Mã SP, App Name, Kho,
    cũng như Mail admin, Mail Team Leader, Mail Marketer.
    """
    if not rows or len(rows) == 0:
        return [], {}, {}, {}, {}, {}, {}

    tracked_apps = []
    marketer_map = {}
    user_app_names = {}
    admin_map = {}
    leader_map = {}
    employee_map = {}
    email_map = {}

    start_idx = 0
    first_row_str = " ".join([str(c).lower() for c in rows[0]])
    is_header = any(k in first_row_str for k in ["admin", "lead", "employ", "nhân viên", "marketer", "mã", "sp", "app", "code", "name", "tên", "mail"])

    col_admin = -1
    col_leader = -1
    col_employee = -1
    col_marketer = -1
    col_sp = -1
    col_name = -1
    col_kho = -1
    col_mail_admin = -1
    col_mail_leader = -1
    col_mail_employee = -1
    col_email = -1

    if is_header:
        start_idx = 1
        for idx, col in enumerate(rows[0]):
            c = str(col).lower().strip()
            if "mail" in c or "email" in c:
                if "admin" in c:
                    col_mail_admin = idx
                elif any(k in c for k in ["lead", "trưởng", "quản lý"]):
                    col_mail_leader = idx
                elif any(k in c for k in ["employ", "nhân viên", "marketer", "market", "pic"]):
                    col_mail_employee = idx
                else:
                    col_email = idx
            else:
                if "admin" in c:
                    col_admin = idx
                elif any(k in c for k in ["lead", "trưởng", "quản lý"]):
                    col_leader = idx
                elif any(k in c for k in ["employ", "nhân viên"]):
                    col_employee = idx
                elif any(k in c for k in ["marketer", "market", "pic", "nhân sự", "phụ trách"]):
                    col_marketer = idx
                elif any(k in c for k in ["mã", "ma sp", "code", "product"]):
                    col_sp = idx
                elif any(k in c for k in ["kho", "bm", "team"]):
                    col_kho = idx
                elif any(k in c for k in ["tên", "app", "name", "sản phẩm"]):
                    col_name = idx

    for r in rows[start_idx:]:
        if not r or not any(str(c).strip() for c in r):
            continue

        cells = [str(c).strip() for c in r]

        mail_adm = ""
        mail_lead = ""
        mail_emp = ""
        mail_gen = ""
        kho_val = ""
        mkt_val = ""
        emp_val = ""

        if col_sp != -1:
            raw_sp = cells[col_sp] if col_sp < len(cells) else ""
            sp = extract_app_code(raw_sp)
            if not sp or sp == "UNKNOWN":
                continue

            app_name = cells[col_name].strip() if col_name != -1 and col_name < len(cells) else ""
            mkt_val = cells[col_marketer].strip() if col_marketer != -1 and col_marketer < len(cells) else ""
            emp_val = cells[col_employee].strip() if col_employee != -1 and col_employee < len(cells) else ""
            leader_val = cells[col_leader].strip() if col_leader != -1 and col_leader < len(cells) else ""
            admin_val = cells[col_admin].strip() if col_admin != -1 and col_admin < len(cells) else ""
            kho_val = cells[col_kho].strip() if col_kho != -1 and col_kho < len(cells) else ""

            mail_adm = cells[col_mail_admin].strip() if col_mail_admin != -1 and col_mail_admin < len(cells) else ""
            mail_lead = cells[col_mail_leader].strip() if col_mail_leader != -1 and col_mail_leader < len(cells) else ""
            mail_emp = cells[col_mail_employee].strip() if col_mail_employee != -1 and col_mail_employee < len(cells) else ""
            mail_gen = cells[col_email].strip() if col_email != -1 and col_email < len(cells) else ""

            # Ưu tiên tuyệt đối cột Marketer (cột A) khi người dùng thay đổi tên Marketer
            employee_val = mkt_val or emp_val or (mail_emp.split("@")[0] if mail_emp else "")
            marketer_name = mkt_val or emp_val or MARKETER_MAP.get(sp, "")
            leader_display = leader_val or (mail_lead.split("@")[0] if mail_lead else "")
            admin_display = admin_val or (mail_adm.split("@")[0] if mail_adm else "DucTQ")

        else:
            # Tự động phán đoán cột theo đặc điểm dữ liệu khi không có header chuẩn
            sp = ""
            admin_display = "DucTQ"
            leader_display = ""
            employee_val = ""
            marketer_name = ""
            app_name = ""

            for c in cells:
                if "@" in c:
                    mail_gen = c.strip().lower()

            for c in cells:
                if "@" in c: continue
                candidate = extract_app_code(c)
                if candidate and candidate != "UNKNOWN" and (re.match(r"^[A-Za-z]{1,4}\d{2,4}$", candidate) or "PHOTO" in candidate):
                    sp = candidate
                    break

            if not sp or sp == "UNKNOWN":
                for c in cells:
                    if "@" in c: continue
                    if len(c) <= 10 and re.search(r"[A-Za-z]", c):
                        cand = extract_app_code(c)
                        if cand and cand != "UNKNOWN":
                            sp = cand
                            break

            if not sp or sp == "UNKNOWN":
                continue

            remaining = [c for c in cells if extract_app_code(c) != sp and "@" not in c and c]
            for c in remaining:
                if len(c.split()) == 1 and len(c) <= 15 and not employee_val:
                    employee_val = c
                elif len(c) > len(app_name):
                    app_name = c

            marketer_name = employee_val or MARKETER_MAP.get(sp, "")
            mkt_val = marketer_name

        if not admin_display:
            admin_display = "DucTQ"

        if sp and sp != "UNKNOWN":
            if sp not in tracked_apps:
                tracked_apps.append(sp)
            marketer_map[sp] = marketer_name
            admin_map[sp] = admin_display
            leader_map[sp] = leader_display
            employee_map[sp] = employee_val or marketer_name
            if app_name:
                user_app_names[sp] = app_name

            # Phân quyền Row-Level Security:
            # Ưu tiên số 1: Tính email trực tiếp từ cột Marketer (cột A) để khi đổi tên Marketer ở Validate là ăn ngay
            single_email = resolve_marketer_email(
                mkt_val or emp_val or marketer_name,
                kho_val=kho_val,
                mail_emp_val=mail_emp,
                mail_gen_val=mail_gen
            )

            if not single_email and mail_lead:
                for e in extract_emails(mail_lead, kho=kho_val):
                    if e:
                        single_email = e
                        break

            if not single_email:
                single_email = ADMIN_EMAILS[0] if ADMIN_EMAILS else "ductq@unisoftstudio.com"

            single_email = single_email.strip().lower().replace("hannhk@", "hannk@")
            if sp not in email_map:
                email_map[sp] = single_email

    return tracked_apps, marketer_map, user_app_names, admin_map, leader_map, employee_map, email_map


SHARED_APP_EMAILS = {
    "AB156": [
        "quynhnn@unisoftstudio.com",
        "hannk@unisoftstudio.com",
        "quyennh@unisoftstudio.com",
    ]
}


def get_app_email(sp_code, email_map=None, default_admin="ductq@unisoftstudio.com", account_name=""):
    """
    Trả về email được phân quyền xem cho mã sản phẩm sp_code.
    Tự động chuẩn hóa mã SP và đối chiếu với email_map từ sheet Validate.
    Hỗ trợ phân tách theo từng tài khoản quảng cáo (ví dụ AB156: TK 4, 11 -> hannk; TK 5, 10 -> quyennh; còn lại -> quynhnn).
    """
    cand = extract_app_code(str(sp_code)) if sp_code else ""
    if cand == "AB156" or (sp_code and "AB156" in str(sp_code).upper()):
        if account_name:
            acc_str = str(account_name).strip()
            if re.search(r"(?:^|[\s_\-])0?(4|11)\s*$", acc_str):
                return "hannk@unisoftstudio.com"
            if re.search(r"(?:^|[\s_\-])0?(5|10)\s*$", acc_str):
                return "quyennh@unisoftstudio.com"
        return "quynhnn@unisoftstudio.com"

    res = default_admin
    if email_map and sp_code:
        if cand and cand in email_map:
            res = email_map[cand]
        else:
            sp_upper = str(sp_code).upper()
            for k, v in email_map.items():
                if k.upper() == sp_upper or k.upper() in sp_upper:
                    res = v
                    break

    if isinstance(res, str):
        res = res.replace("hannhk@", "hannk@")
    return res


def get_app_emails(sp_code, email_map=None, default_admin="ductq@unisoftstudio.com", account_name=""):
    """
    Trả về danh sách tất cả các email được phân quyền xem cho mã sản phẩm sp_code.
    Với các app chạy chung nhiều người (như AB156: quynhnn, hannk, quyennh),
    trả về cả 3 email để khi nhân bản dòng vào bảng dữ liệu gốc (và bật Filter by email),
    cả 3 người đều xem được TẤT CẢ các account của AB156 trên mọi bảng.
    """
    cand = extract_app_code(str(sp_code)) if sp_code else ""
    if cand in SHARED_APP_EMAILS:
        return list(SHARED_APP_EMAILS[cand])
    if sp_code:
        for k, emails in SHARED_APP_EMAILS.items():
            if k in str(sp_code).upper():
                return list(emails)
    return [get_app_email(sp_code, email_map=email_map, default_admin=default_admin, account_name=account_name)]


def fetch_validate_from_sheet(webhook_url):
    """
    Kéo danh sách ứng dụng cần theo dõi trực tiếp từ sheet Validate trên Google Sheets qua Webhook.
    """
    if not webhook_url:
        return None, None, None, None, None, None, None
    for attempt in range(1, 4):
        try:
            sep = "&" if "?" in webhook_url else "?"
            url = f"{webhook_url}{sep}action=validate"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                data = json.loads(raw)
                if data.get("status") == "success" and data.get("data"):
                    return parse_validate_sheet(data["data"])
                elif data.get("status") == "error":
                    print(f"⚠️ Webhook thông báo về sheet Validate: {data.get('message')}", flush=True)
        except Exception as e:
            print(f"⚠️ [Lần {attempt}/3] Không thể đọc sheet Validate từ Webhook: {e}", flush=True)
            if attempt < 3:
                time.sleep(2)
    return None, None, None, None, None, None, None


def build_permissions_table(webhook_url):
    """
    Tạo bảng phân quyền Looker Studio (ACL) từ sheet Validate:
    headers = ['Mã SP', 'Email']
    Mỗi dòng chỉ chứa đúng 1 email cho 1 app để tương thích 100% với tính năng Filter data by viewer email.
    Khi người dùng đổi tên Marketer ở cột A của bảng Validate, hàm tự động suy luận Email Marketer mới
    từ cột A và loại bỏ email cũ ở cột G nếu cột G chưa kịp cập nhật.
    """
    headers = ['Mã SP', 'Email']
    if not webhook_url:
        return [headers]
    rows = None
    for attempt in range(1, 4):
        try:
            sep = "&" if "?" in webhook_url else "?"
            url = f"{webhook_url}{sep}action=validate"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("status") == "success" and data.get("data"):
                    rows = data["data"]
                    break
        except Exception as e:
            print(f"⚠️ [Lần {attempt}/3] build_permissions_table không thể kết nối: {e}", flush=True)
            if attempt < 3:
                time.sleep(2)

    if not rows or len(rows) <= 1:
        return [headers]

    try:
        header_row = [str(c).lower().strip() for c in rows[0]]
        col_sp = -1
        col_marketer = 0
        col_kho = -1
        col_mail_admin = -1
        col_mail_leader = -1
        col_mail_marketer = -1

        for idx, col in enumerate(header_row):
            if "mail" in col or "email" in col:
                if "admin" in col:
                    col_mail_admin = idx
                elif any(k in col for k in ["lead", "trưởng", "quản lý"]):
                    col_mail_leader = idx
                elif any(k in col for k in ["marketer", "employ", "nhân viên", "pic"]):
                    col_mail_marketer = idx
            else:
                if any(k in col for k in ["mã", "code"]) or ("sp" in col and "tên" not in col and "name" not in col):
                    if col_sp == -1:
                        col_sp = idx
                elif any(k in col for k in ["marketer", "market", "pic", "employ", "nhân viên"]):
                    col_marketer = idx
                elif any(k in col for k in ["kho", "bm", "team"]):
                    col_kho = idx

        pairs = []
        seen = set()
        default_admins = list(ADMIN_EMAILS)

        for r in rows[1:]:
            if not r or not any(str(c).strip() for c in r):
                continue
            sp_raw = r[col_sp] if col_sp != -1 and col_sp < len(r) else (r[1] if len(r) > 1 else "")
            sp = extract_app_code(sp_raw)
            if not sp or sp == 'UNKNOWN':
                continue

            mkt_val = str(r[col_marketer]).strip() if col_marketer != -1 and col_marketer < len(r) else ""
            kho_val = str(r[col_kho]).strip() if col_kho != -1 and col_kho < len(r) else ""
            mail_adm_val = str(r[col_mail_admin]).strip() if col_mail_admin != -1 and col_mail_admin < len(r) else ""
            mail_lead_val = str(r[col_mail_leader]).strip() if col_mail_leader != -1 and col_mail_leader < len(r) else ""
            mail_mkt_val = str(r[col_mail_marketer]).strip() if col_mail_marketer != -1 and col_mail_marketer < len(r) else ""

            raw_emails = []
            # 1. Luôn lấy email Marketer trực tiếp từ cột Tên Marketer (cột A)
            mkt_emails_from_name = extract_emails(mkt_val, kho=kho_val) if mkt_val else []
            mkt_emails_from_col_g = extract_emails(mail_mkt_val, kho=kho_val) if mail_mkt_val else []

            if mkt_emails_from_name:
                raw_emails.extend(mkt_emails_from_name)
                # Nếu cột Mail Marketer (cột G) có liệt kê nhiều email (dấu phẩy) và khớp với Marketer cột A thì giữ thêm các email phụ
                if len(mkt_emails_from_col_g) > 1 and any(e in mkt_emails_from_col_g for e in mkt_emails_from_name):
                    for extra_e in mkt_emails_from_col_g:
                        if extra_e not in raw_emails:
                            raw_emails.append(extra_e)
            else:
                raw_emails.extend(mkt_emails_from_col_g)

            # 2. Bổ sung Mail Admin và Mail Team Leader từ dòng Validate
            if mail_adm_val:
                raw_emails.extend(extract_emails(mail_adm_val, kho=kho_val))
            if mail_lead_val:
                raw_emails.extend(extract_emails(mail_lead_val, kho=kho_val))

            # Chuẩn hóa email và sửa lỗi chính tả (hannhk -> hannk)
            emails = []
            for e in raw_emails:
                e_clean = e.strip().lower().replace("hannhk@", "hannk@")
                if e_clean and e_clean not in emails:
                    emails.append(e_clean)

            for adm in default_admins:
                if adm not in emails:
                    emails.append(adm)

            for e in emails:
                e = e.strip().lower()
                key = (sp, e)
                if key not in seen:
                    seen.add(key)
                    pairs.append([sp, e])

        return [headers] + pairs
    except Exception as e:
        print(f"⚠️ Lỗi build_permissions_table: {e}", flush=True)

    return [headers]


def fetch_adjust_app_network_data(oldest_date, newest_date, adjust_token):
    """
    Kéo dữ liệu từ Adjust theo dimensions: day, app, network
    Metrics: installs, network_cost, ad_revenue_total_d0
    """
    if oldest_date > newest_date:
        oldest_date, newest_date = newest_date, oldest_date

    query = [
        f"date_period={oldest_date}:{newest_date}",
        "dimensions=day,app,network",
        "metrics=installs,network_cost,ad_revenue_total_d0",
        "utc_offset=%2B07:00",
        "sandbox=false"
    ]
    api_url = "https://automate.adjust.com/reports-service/csv_report?" + "&".join(query)
    req = urllib.request.Request(api_url, headers={
        "Authorization": "Bearer " + adjust_token,
        "Accept": "text/csv"
    })

    text = ""
    for attempt in range(1, 4):
        try:
            print(f"🔄 Đang kéo Adjust App & Network Report (lần {attempt}/3)...", flush=True)
            t0 = time.time()
            with urllib.request.urlopen(req, timeout=60) as resp:
                text = resp.read().decode("utf-8")
            if text:
                print(f"✅ Tải báo cáo Adjust App thành công ({len(text)} bytes, {time.time() - t0:.2f}s)!", flush=True)
                break
        except Exception as e:
            print(f"⚠️ Lần {attempt} thất bại khi tải Adjust App Report: {e}", flush=True)
            if attempt < 3:
                time.sleep(3 * attempt)

    if not text:
        return {}, {}

    reader = csv.reader(io.StringIO(text))
    try:
        headers = next(reader)
    except StopIteration:
        return {}, {}

    # Map dữ liệu: data[(day, app)]
    data_by_day_app = {}
    known_apps_by_code = {}

    for row in reader:
        if len(row) < 6:
            continue
        day = row[0].strip()
        app = row[1].strip()
        net = row[2].strip()
        try:
            inst = float(row[3]) if row[3] else 0.0
            cost = float(row[4]) if row[4] else 0.0
            rev = float(row[5]) if row[5] else 0.0
        except:
            continue

        sp_code = extract_app_code(app)
        if sp_code not in known_apps_by_code:
            known_apps_by_code[sp_code] = app

        key = (day, app)
        if key not in data_by_day_app:
            data_by_day_app[key] = {
                "day": day,
                "app": app,
                "sp_code": sp_code,
                "installs": 0,
                "rev_d0": 0.0,
                "adjust_fb_cost": 0.0,
                "adjust_gg_cost": 0.0,
                "tiktok_cost": 0.0,
                "minte_cost": 0.0
            }
        item = data_by_day_app[key]
        item["installs"] += int(inst)
        item["rev_d0"] += rev

        net_lower = net.lower()
        if "tiktok" in net_lower:
            item["tiktok_cost"] += cost
        elif "mintegral" in net_lower or "_mtg" in net_lower or "_minte" in net_lower:
            item["minte_cost"] += cost
        elif "facebook" in net_lower or "instagram" in net_lower:
            item["adjust_fb_cost"] += cost
        elif "google" in net_lower:
            item["adjust_gg_cost"] += cost

    return data_by_day_app, known_apps_by_code


def save_spend_cache(filename, spend_dict):
    try:
        # spend_dict: key là "YYYY-MM-DD_SPCODE", value là cost
        serialized = {}
        for k, v in spend_dict.items():
            if isinstance(k, tuple):
                serialized[f"{k[0]}_{k[1]}"] = float(v)
            else:
                serialized[str(k)] = float(v)
        with open(filename, "w", encoding="utf-8") as f:
            json.dump(serialized, f)
    except Exception as e:
        print(f"⚠️ Không thể lưu cache chi phí {filename}: {e}", flush=True)


def load_spend_cache(filename):
    res = {}
    if os.path.exists(filename):
        try:
            with open(filename, "r", encoding="utf-8") as f:
                data = json.load(f)
            for k, v in data.items():
                parts = k.split("_", 1)
                if len(parts) == 2:
                    res[(parts[0], parts[1])] = float(v)
                else:
                    res[k] = float(v)
        except Exception as e:
            print(f"⚠️ Lỗi đọc cache chi phí {filename}: {e}", flush=True)
    return res


def build_app_report_table(dates_info, adjust_data, known_apps_by_code, meta_spend_map=None, google_spend_map=None, now_str="", webhook_url=""):
    """
    Xây dựng bảng dữ liệu hoàn chỉnh CutOff:
    Tự động đọc danh sách sản phẩm từ sheet 'Validate' trên Google Sheets nếu có.
    """
    if not meta_spend_map:
        meta_spend_map = load_spend_cache(META_SPEND_FILE)
    if not google_spend_map:
        google_spend_map = load_spend_cache(GOOGLE_SPEND_FILE)

    if not now_str:
        tz = timezone(timedelta(hours=7))
        now_str = datetime.now(tz).strftime("%H:%M:%S")

    # Danh sách mặc định
    tracked_apps = list(TRACKED_APPS)
    marketer_map = dict(MARKETER_MAP)
    user_app_names = dict(USER_APP_NAMES)
    admin_map = {}
    leader_map = {}
    employee_map = {}
    email_map = {sp: f"{m.strip().lower()}@unisoftstudio.com" for sp, m in MARKETER_MAP.items() if m}

    # Ưu tiên đọc trực tiếp danh sách từ sheet Validate trên Google Sheets
    if webhook_url:
        v_apps, v_marketers, v_names, v_admins, v_leaders, v_employees, v_emails = fetch_validate_from_sheet(webhook_url)
        if v_apps and len(v_apps) > 0:
            print(f"🎯 Đã tải thành công {len(v_apps)} sản phẩm từ sheet 'Validate': {v_apps}", flush=True)
            tracked_apps = v_apps
            marketer_map = v_marketers or {}
            admin_map = v_admins or {}
            leader_map = v_leaders or {}
            employee_map = v_employees or {}
            for k, v in (v_names or {}).items():
                user_app_names[k] = v
            if v_emails:
                email_map.update(v_emails)
        else:
            print("ℹ️ Dùng danh sách app mặc định (32 app) do chưa kết nối được sheet Validate.", flush=True)

    headers = [
        "Date", "Marketer", "Email", "Mã SP", "App",
        "ROAS D0", "Total Cost", "FistOpen", "Rev Cutoff adjust", "Rev Cutoff Admob",
        "PL2 Admob", "%PL2 Admob", "Cost (VND)", "PL2 (VND)", "Facebook", "Google", "Tiktok", "Mintegral", "Time kéo"
    ]

    all_rows = []

    # Duyệt qua từng ngày (từ mới nhất đến cũ nhất)
    for dinfo in dates_info:
        day_str = dinfo["str"]
        day_items = []

        # Quét các app cần theo dõi (từ sheet Validate hoặc mặc định)
        for sp_code in tracked_apps:
            app_name = user_app_names.get(sp_code) or known_apps_by_code.get(sp_code, f"{sp_code} App")
            admin_val = admin_map.get(sp_code, "") or "DucTQ"
            leader_val = leader_map.get(sp_code, "") or ""
            employee_val = employee_map.get(sp_code, "") or ""
            marketer = marketer_map.get(sp_code, "") or employee_val or ""
            if not employee_val and marketer:
                employee_val = marketer

            # Tìm và cộng dồn dữ liệu từ Adjust cho app này trong ngày
            inst = 0
            rev_d0 = 0.0
            tiktok_cost = 0.0
            minte_cost = 0.0
            adjust_fb_cost = 0.0
            adjust_gg_cost = 0.0

            for (d, aname), it in adjust_data.items():
                if d == day_str:
                    matched = False
                    if it["sp_code"] == sp_code:
                        matched = True
                    elif sp_code.upper() in aname.upper():
                        matched = True
                    elif sp_code == "AI PHOTO" and "AI PHOTO" in aname.upper():
                        matched = True

                    if matched:
                        inst += it["installs"]
                        rev_d0 += it["rev_d0"]
                        tiktok_cost += it["tiktok_cost"]
                        minte_cost += it["minte_cost"]
                        adjust_fb_cost += it["adjust_fb_cost"]
                        adjust_gg_cost += it["adjust_gg_cost"]

            # Chi phí Facebook: Ưu tiên lấy từ Meta API, nếu không có lấy từ Adjust
            fb_cost = meta_spend_map.get((day_str, sp_code))
            if fb_cost is None or fb_cost == 0:
                fb_cost = adjust_fb_cost
            fb_cost = round(fb_cost, 2)

            # Chi phí Google: Ưu tiên lấy từ Google Ads API, nếu không có lấy từ Adjust
            gg_cost = google_spend_map.get((day_str, sp_code))
            if gg_cost is None or gg_cost == 0:
                gg_cost = adjust_gg_cost
            gg_cost = round(gg_cost, 2)

            # Chi phí TikTok & Mintegral lấy từ Adjust
            tt_cost = round(tiktok_cost, 2)
            mt_cost = round(minte_cost, 2)

            # Tổng chi phí USD từ ad network
            tot_cost = round(fb_cost + gg_cost + tt_cost + mt_cost, 2)

            # Chi phí quy đổi sang VND với đơn giá 26,000
            cost_vnd = round(tot_cost * VND_RATE)

            rev = round(rev_d0, 2)

            # ROAS D0 = Rev Cutoff adjust / Total Cost USD
            roas_d0 = round(rev / tot_cost, 4) if tot_cost > 0 else 0.0

            # Rev Cutoff adjust lấy doanh thu D0 từ Adjust
            rev_cutoff_adjust = rev

            # Chưa kéo nguồn Admob nên Rev Cutoff Admob, PL2 Admob, %PL2 và PL2 (VND) để trống
            rev_cutoff_admob = ""
            pl2_admob = ""
            pl2_pct = ""
            pl2_vnd = ""

            for email_field in get_app_emails(sp_code, email_map):
                row = [
                    day_str,
                    marketer,
                    email_field,
                    sp_code,
                    app_name,
                    roas_d0,
                    tot_cost,
                    inst,
                    rev_cutoff_adjust,
                    rev_cutoff_admob,
                    pl2_admob,
                    pl2_pct,
                    cost_vnd,
                    pl2_vnd,
                    fb_cost,
                    gg_cost,
                    tt_cost,
                    mt_cost,
                    now_str
                ]

                day_items.append({
                    "row": row,
                    "cost": tot_cost,
                    "rev": rev,
                    "inst": inst
                })

        # Sắp xếp các app trong ngày: App có chi phí cao nhất lên đầu, tiếp đến doanh thu và lượt install
        day_items.sort(key=lambda x: (x["cost"], x["rev"], x["inst"]), reverse=True)
        all_rows.extend([it["row"] for it in day_items])

    return [headers] + all_rows
