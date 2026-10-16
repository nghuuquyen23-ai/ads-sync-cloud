#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SERVER ĐIỀU KHIỂN CHIẾN DỊCH & TÍCH HỢP LOOKER STUDIO (LIVE CAMPAIGN & BUDGET CONTROLLER)
- Cung cấp giao diện Web App tại http://localhost:8505 (giống hệt ảnh mẫu: Cây App -> Kênh -> Campaign, nút gạt ON/OFF, chỉnh Budget - $ +)
- Tích hợp 2 chiều với Google Sheets Webhook & Meta Graph API
- Phân quyền chặt chẽ theo Email (Marketer chỉ xem & chỉnh được Campaign thuộc Mã SP của mình; Admin toàn quyền)
"""

import os
import json
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler

from app_report_builder import (
    ADMIN_EMAILS,
    MARKETER_MAP,
    USER_APP_NAMES,
    fetch_validate_from_sheet,
    extract_app_code
)

PORT = int(os.environ.get("PORT", 8505))
DEFAULT_WEBHOOK_URL = (
    os.environ.get("PRIMARY_WEBHOOK_URL")
    or "https://script.google.com/macros/s/AKfycby75UnIdHKTuRb8E3rAMTLws-nU22eag0JD95roKQWPi6CEvgYMEHz03Am0NVsjx5sQbg/exec"
).strip()

LOCAL_STATE_FILE = os.path.join(os.path.dirname(__file__), "local_campaign_state.json")


def load_local_state():
    if os.path.exists(LOCAL_STATE_FILE):
        try:
            with open(LOCAL_STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"overrides": {}, "logs": [], "lookerEmbedUrl": "", "customFbToken": ""}


def save_local_state(st):
    try:
        with open(LOCAL_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(st, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def get_meta_tokens(custom_token=""):
    tokens = []
    for t in [
        custom_token,
        os.environ.get("META_TOKEN_IH", ""),
        os.environ.get("META_TOKEN_BIGTHINK02", ""),
        os.environ.get("META_TOKEN_AG", ""),
        os.environ.get("META_TOKEN", "")
    ]:
        clean = (t or "").strip()
        if clean and clean not in tokens:
            tokens.append(clean)

    # Also check fb_budget_optimizer/app_config.json if available
    opt_cfg_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "fb_budget_optimizer", "app_config.json"))
    if os.path.exists(opt_cfg_path):
        try:
            with open(opt_cfg_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                fb_tok = (cfg.get("fb_token") or "").strip()
                if fb_tok and fb_tok not in tokens:
                    tokens.append(fb_tok)
        except Exception:
            pass
    return tokens


def forward_to_webhook(webhook_url, payload):
    if not webhook_url:
        return None
    try:
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            webhook_url,
            data=data_bytes,
            headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            text = resp.read().decode("utf-8")
            return json.loads(text)
    except Exception:
        return None


def check_email_permission(user_email, sp_code, webhook_url):
    email = (user_email or "").strip().lower()
    if email in [a.lower() for a in ADMIN_EMAILS]:
        return True, True

    v_apps, v_marketers, v_names, v_admins, v_leaders, v_employees, email_map = fetch_validate_from_sheet(webhook_url)
    for adm in (v_admins or {}).values():
        if email in str(adm).lower():
            return True, True

    sp_up = (sp_code or "").strip().upper()
    if email_map and sp_up in email_map:
        if email in str(email_map[sp_up]).lower():
            return True, False

    mkt = MARKETER_MAP.get(sp_up, "")
    if mkt and f"{mkt.lower()}@unisoftstudio.com" == email:
        return True, False

    return False, False


def call_facebook_post(endpoint, params_dict, tokens):
    last_err = "Chưa cấu hình Meta Access Token"
    for token in tokens:
        url = f"https://graph.facebook.com/v21.0/{endpoint}"
        payload = dict(params_dict)
        payload["access_token"] = token
        data_bytes = urllib.parse.urlencode(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data_bytes, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                if body.get("success"):
                    return True, body
        except urllib.error.HTTPError as he:
            try:
                err_json = json.loads(he.read().decode("utf-8"))
                last_err = err_json.get("error", {}).get("message", str(he))
            except Exception:
                last_err = str(he)
        except Exception as e:
            last_err = str(e)
    return False, last_err


class CampaignControlHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _send_json(self, obj, status=200):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        html_path = os.path.join(os.path.dirname(__file__), "looker_campaign_manager.html")
        with open(html_path, "r", encoding="utf-8") as f:
            content = f.read().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body_raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            data = json.loads(body_raw)
        except Exception:
            data = {}

        action = data.get("action", "")
        webhook_url = (data.get("webhookUrl") or DEFAULT_WEBHOOK_URL).strip()
        local_st = load_local_state()

        # 1. Try forwarding to Google Apps Script Webhook first
        if action in ("get_dashboard_data", "toggle_campaign", "update_budget", "trigger_cloud_sync", "save_dashboard_settings"):
            remote_res = forward_to_webhook(webhook_url, data)
            if remote_res and isinstance(remote_res, dict) and (
                "fbCampaigns" in remote_res or remote_res.get("campaign_id") or action == "trigger_cloud_sync"
            ):
                self._send_json(remote_res)
                return

        # 2. Local fallback & direct Meta API execution
        if action == "save_dashboard_settings":
            if "lookerEmbedUrl" in data:
                local_st["lookerEmbedUrl"] = data["lookerEmbedUrl"]
            if data.get("customFbToken"):
                local_st["customFbToken"] = data["customFbToken"]
            save_local_state(local_st)
            self._send_json({"status": "success", "message": "Đã lưu cấu hình!"})
            return

        if action == "toggle_campaign":
            email = (data.get("email") or "").strip().lower()
            cid = str(data.get("campaign_id") or "").strip()
            camp_name = str(data.get("campaign_name") or cid).strip()
            sp = str(data.get("app_code") or "").strip().upper()
            new_status = str(data.get("new_status") or "").strip().upper()

            allowed, _ = check_email_permission(email, sp, webhook_url)
            if not allowed:
                self._send_json({"status": "error", "message": f"⛔ Email {email} không có quyền điều khiển Mã SP {sp}!"})
                return

            tokens = get_meta_tokens(data.get("custom_token") or local_st.get("customFbToken", ""))
            if tokens:
                ok, err_or_res = call_facebook_post(cid, {"status": new_status}, tokens)
                if not ok:
                    self._send_json({"status": "error", "message": f"Facebook API: {err_or_res}"})
                    return

            tz = timezone(timedelta(hours=7))
            now_str = datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S")
            local_st.setdefault("overrides", {}).setdefault(cid, {})["status"] = new_status
            log_entry = {
                "time": now_str,
                "email": email,
                "sp": sp,
                "cid": cid,
                "campaignName": camp_name,
                "action": "BẬT (ON)" if new_status == "ACTIVE" else "TẮT (PAUSED)",
                "detail": f"Đổi trạng thái sang {new_status}"
            }
            local_st.setdefault("logs", []).insert(0, log_entry)
            save_local_state(local_st)
            self._send_json({"status": "success", "campaign_id": cid, "new_status": new_status, "logEntry": log_entry})
            return

        if action == "update_budget":
            email = (data.get("email") or "").strip().lower()
            cid = str(data.get("campaign_id") or "").strip()
            camp_name = str(data.get("campaign_name") or cid).strip()
            sp = str(data.get("app_code") or "").strip().upper()
            new_budget = float(data.get("new_budget") or 0)
            old_budget = float(data.get("old_budget") or 0)

            allowed, _ = check_email_permission(email, sp, webhook_url)
            if not allowed:
                self._send_json({"status": "error", "message": f"⛔ Email {email} không có quyền chỉnh ngân sách Mã SP {sp}!"})
                return

            tokens = get_meta_tokens(data.get("custom_token") or local_st.get("customFbToken", ""))
            if tokens:
                budget_cents = int(round(new_budget * 100))
                ok, err_or_res = call_facebook_post(cid, {"daily_budget": budget_cents}, tokens)
                if not ok:
                    self._send_json({"status": "error", "message": f"Facebook API: {err_or_res}"})
                    return

            tz = timezone(timedelta(hours=7))
            now_str = datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S")
            local_st.setdefault("overrides", {}).setdefault(cid, {})["budget"] = new_budget
            log_entry = {
                "time": now_str,
                "email": email,
                "sp": sp,
                "cid": cid,
                "campaignName": camp_name,
                "action": "CHỈNH BUDGET",
                "detail": f"${old_budget:g} ➔ ${new_budget:g}"
            }
            local_st.setdefault("logs", []).insert(0, log_entry)
            save_local_state(local_st)
            self._send_json({"status": "success", "campaign_id": cid, "new_budget": new_budget, "logEntry": log_entry})
            return

        self._send_json({"status": "error", "message": "Chưa cập nhật Receiver_Webhook.js trên Google Sheet"})


if __name__ == "__main__":
    print("=" * 68)
    print(f"🚀 ADS CAMPAIGN CONTROL & LOOKER STUDIO SERVER ĐANG CHẠY TẠI:")
    print(f"👉 http://localhost:{PORT}")
    print("=" * 68)
    server = HTTPServer(("0.0.0.0", PORT), CampaignControlHandler)
    server.serve_forever()
