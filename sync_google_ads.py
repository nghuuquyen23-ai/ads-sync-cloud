#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
====================================================================
 HỆ THỐNG ĐỒNG BỘ GOOGLE ADS & ADJUST (CHUẨN XÁC 100% THEO LOOKER STUDIO)
 Tự động tạo và cập nhật 3 bảng chuẩn xác theo đúng yêu cầu:
 1. "Google Campaign":
    Date | Mã SP | Campaign | Campaign ID | Cost | FirstOpen | CPU (USD) | ROAS | ROAS D-1 | ROAS D-2 | Time kéo
 2. "Google Country":
    Mã SP | Date | Campaign | Campaign ID | Country/Territory | COST (USD) | ROAS D0 | FirtOpen | CPU | Time kéo
 3. "Google Total Country":
    Date | APP ID | Country | Total Cost | FistOpen | CPU | ROAS D0 | Time kéo
====================================================================
"""

import os
import sys
import json
import time
from datetime import datetime, timedelta, timezone
import urllib.request
import urllib.parse

from app_report_builder import (
    fetch_adjust_app_network_data,
    build_app_report_table,
    save_spend_cache,
    GOOGLE_SPEND_FILE,
    get_app_email,
    get_app_emails,
    fetch_validate_from_sheet,
    build_permissions_table
)

# ==================== CẤU HÌNH HỆ THỐNG ====================
CONFIG = {
    "DEVELOPER_TOKEN": os.environ.get("GOOGLE_ADS_DEVELOPER_TOKEN", ""),
    "CLIENT_ID": os.environ.get("GOOGLE_ADS_CLIENT_ID", ""),
    "CLIENT_SECRET": os.environ.get("GOOGLE_ADS_CLIENT_SECRET", ""),
    "REFRESH_TOKEN": os.environ.get("GOOGLE_ADS_REFRESH_TOKEN", ""),
    "LOGIN_CUSTOMER_ID": os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", ""),
    "ADJUST_TOKEN": os.environ.get("ADJUST_TOKEN", ""),
    "WEBHOOK_URL": (os.environ.get("GOOGLE_ADS_WEBHOOK_URL") or os.environ.get("PRIMARY_WEBHOOK_URL") or "").strip(),
    "DAYS_TO_SHOW": 3,
    "API_VERSION": "v25"
}

# Bảng mã quốc gia ISO sang tên đầy đủ (chuẩn Looker Studio)
COUNTRY_MAP = {
    'AC': 'Ascension Island', 'AD': 'Andorra', 'AE': 'United Arab Emirates', 'AF': 'Afghanistan',
    'AG': 'Antigua & Barbuda', 'AI': 'Anguilla', 'AL': 'Albania', 'AM': 'Armenia',
    'AN': 'Curaçao', 'AO': 'Angola', 'AQ': 'Antarctica', 'AR': 'Argentina',
    'AS': 'American Samoa', 'AT': 'Austria', 'AU': 'Australia', 'AUS': 'Australia',
    'AW': 'Aruba', 'AX': 'Åland Islands', 'AZ': 'Azerbaijan', 'BA': 'Bosnia & Herzegovina',
    'BB': 'Barbados', 'BD': 'Bangladesh', 'BE': 'Belgium', 'BF': 'Burkina Faso',
    'BG': 'Bulgaria', 'BH': 'Bahrain', 'BI': 'Burundi', 'BJ': 'Benin',
    'BL': 'St. Barthélemy', 'BM': 'Bermuda', 'BN': 'Brunei', 'BO': 'Bolivia',
    'BQ': 'Caribbean Netherlands', 'BR': 'Brazil', 'BS': 'Bahamas', 'BT': 'Bhutan',
    'BU': 'Myanmar (Burma)', 'BV': 'Bouvet Island', 'BW': 'Botswana', 'BY': 'Belarus',
    'BZ': 'Belize', 'CA': 'Canada', 'CC': 'Cocos (Keeling) Islands', 'CD': 'Congo (DRC)',
    'CF': 'Central African Republic', 'CG': 'Congo', 'CH': 'Switzerland', 'CI': 'Côte d’Ivoire',
    'CK': 'Cook Islands', 'CL': 'Chile', 'CM': 'Cameroon', 'CN': 'China',
    'CO': 'Colombia', 'COL': 'Colombia', 'CP': 'Clipperton Island', 'CQ': 'Sark',
    'CR': 'Costa Rica', 'CS': 'Serbia', 'CU': 'Cuba', 'CV': 'Cape Verde',
    'CW': 'Curaçao', 'CX': 'Christmas Island', 'CY': 'Cyprus', 'CZ': 'Czech Republic',
    'DD': 'Germany', 'DE': 'Germany', 'DG': 'Diego Garcia', 'DJ': 'Djibouti',
    'DK': 'Denmark', 'DM': 'Dominica', 'DO': 'Dominican Republic', 'DY': 'Benin',
    'DZ': 'Algeria', 'EA': 'Ceuta & Melilla', 'EC': 'Ecuador', 'EE': 'Estonia',
    'EG': 'Egypt', 'EH': 'Western Sahara', 'ER': 'Eritrea', 'ES': 'Spain',
    'ET': 'Ethiopia', 'EU': 'European Union', 'EZ': 'Eurozone', 'FI': 'Finland',
    'FJ': 'Fiji', 'FK': 'Falkland Islands', 'FM': 'Micronesia', 'FO': 'Faroe Islands',
    'FR': 'France', 'FX': 'France', 'GA': 'Gabon', 'GB': 'United Kingdom',
    'GD': 'Grenada', 'GE': 'Georgia', 'GF': 'French Guiana', 'GG': 'Guernsey',
    'GH': 'Ghana', 'GI': 'Gibraltar', 'GL': 'Greenland', 'GM': 'Gambia',
    'GN': 'Guinea', 'GP': 'Guadeloupe', 'GQ': 'Equatorial Guinea', 'GR': 'Greece',
    'GS': 'South Georgia & South Sandwich Islands', 'GT': 'Guatemala', 'GU': 'Guam', 'GW': 'Guinea-Bissau',
    'GY': 'Guyana', 'HK': 'Hong Kong', 'HM': 'Heard & McDonald Islands', 'HN': 'Honduras',
    'HR': 'Croatia', 'HT': 'Haiti', 'HU': 'Hungary', 'HV': 'Burkina Faso',
    'IC': 'Canary Islands', 'ID': 'Indonesia', 'IE': 'Ireland', 'IL': 'Israel',
    'IM': 'Isle of Man', 'IN': 'India', 'IO': 'British Indian Ocean Territory', 'IQ': 'Iraq',
    'IR': 'Iran', 'IS': 'Iceland', 'IT': 'Italy', 'JE': 'Jersey',
    'JM': 'Jamaica', 'JO': 'Jordan', 'JP': 'Japan', 'KE': 'Kenya',
    'KG': 'Kyrgyzstan', 'KH': 'Cambodia', 'KI': 'Kiribati', 'KM': 'Comoros',
    'KN': 'St. Kitts & Nevis', 'KP': 'North Korea', 'KR': 'South Korea', 'KW': 'Kuwait',
    'KY': 'Cayman Islands', 'KZ': 'Kazakhstan', 'LA': 'Laos', 'LB': 'Lebanon',
    'LC': 'St. Lucia', 'LI': 'Liechtenstein', 'LK': 'Sri Lanka', 'LR': 'Liberia',
    'LS': 'Lesotho', 'LT': 'Lithuania', 'LU': 'Luxembourg', 'LV': 'Latvia',
    'LY': 'Libya', 'MA': 'Morocco', 'MC': 'Monaco', 'MD': 'Moldova',
    'ME': 'Montenegro', 'MF': 'St. Martin', 'MG': 'Madagascar', 'MH': 'Marshall Islands',
    'MK': 'North Macedonia', 'ML': 'Mali', 'MM': 'Myanmar (Burma)', 'MN': 'Mongolia',
    'MO': 'Macao', 'MP': 'Northern Mariana Islands', 'MQ': 'Martinique', 'MR': 'Mauritania',
    'MS': 'Montserrat', 'MT': 'Malta', 'MU': 'Mauritius', 'MV': 'Maldives',
    'MW': 'Malawi', 'MX': 'Mexico', 'MY': 'Malaysia', 'MZ': 'Mozambique',
    'NA': 'Namibia', 'NC': 'New Caledonia', 'NE': 'Niger', 'NF': 'Norfolk Island',
    'NG': 'Nigeria', 'NI': 'Nicaragua', 'NL': 'Netherlands', 'NO': 'Norway',
    'NP': 'Nepal', 'NR': 'Nauru', 'NU': 'Niue', 'NZ': 'New Zealand',
    'OM': 'Oman', 'PA': 'Panama', 'PE': 'Peru', 'PF': 'French Polynesia',
    'PG': 'Papua New Guinea', 'PH': 'Philippines', 'PK': 'Pakistan', 'PL': 'Poland',
    'PM': 'St. Pierre & Miquelon', 'PN': 'Pitcairn Islands', 'PR': 'Puerto Rico',
    'PS': 'Palestine', 'PT': 'Portugal', 'PW': 'Palau', 'PY': 'Paraguay',
    'QA': 'Qatar', 'RE': 'Réunion', 'RO': 'Romania', 'RS': 'Serbia',
    'RU': 'Russia', 'RW': 'Rwanda', 'SA': 'Saudi Arabia', 'SB': 'Solomon Islands',
    'SC': 'Seychelles', 'SD': 'Sudan', 'SE': 'Sweden', 'SG': 'Singapore',
    'SH': 'St. Helena', 'SI': 'Slovenia', 'SJ': 'Svalbard & Jan Mayen', 'SK': 'Slovakia',
    'SL': 'Sierra Leone', 'SM': 'San Marino', 'SN': 'Senegal', 'SO': 'Somalia',
    'SR': 'Suriname', 'SS': 'South Sudan', 'ST': 'São Tomé & Príncipe', 'SV': 'El Salvador',
    'SX': 'Sint Maarten', 'SY': 'Syria', 'SZ': 'Eswatini', 'TA': 'Tristan da Cunha',
    'TC': 'Turks & Caicos Islands', 'TD': 'Chad', 'TF': 'French Southern Territories',
    'TG': 'Togo', 'TH': 'Thailand', 'TJ': 'Tajikistan', 'TK': 'Tokelau',
    'TL': 'Timor-Leste', 'TM': 'Turkmenistan', 'TN': 'Tunisia', 'TO': 'Tonga',
    'TR': 'Turkey', 'TT': 'Trinidad & Tobago', 'TV': 'Tuvalu', 'TW': 'Taiwan',
    'TZ': 'Tanzania', 'UA': 'Ukraine', 'UG': 'Uganda', 'UM': 'U.S. Outlying Islands',
    'US': 'United States', 'USA': 'United States', 'UY': 'Uruguay', 'UZ': 'Uzbekistan',
    'VA': 'Vatican City', 'VC': 'St. Vincent & Grenadines', 'VE': 'Venezuela',
    'VG': 'British Virgin Islands', 'VI': 'U.S. Virgin Islands', 'VN': 'Vietnam',
    'VU': 'Vanuatu', 'WF': 'Wallis & Futuna', 'WS': 'Samoa', 'XK': 'Kosovo',
    'YE': 'Yemen', 'YT': 'Mayotte', 'ZA': 'South Africa', 'ZM': 'Zambia',
    'ZW': 'Zimbabwe', 'GLOBAL': 'Global', 'WORLDWIDE': 'Worldwide'
}

def get_country_name(code):
    if not code: return "Unknown"
    c_upper = str(code).strip().upper()
    return COUNTRY_MAP.get(c_upper, c_upper)

def extract_ma_sp(campaign_name):
    """Trích xuất Mã SP / APP ID từ tiền tố Campaign Name (ví dụ: UN001, AB277, AB110)."""
    if not campaign_name: return "Unknown"
    n = str(campaign_name).strip()
    if "_" in n: return n.split("_")[0].strip()
    if " " in n: return n.split(" ")[0].strip()
    if "-" in n: return n.split("-")[0].strip()
    return n

extract_product_code = extract_ma_sp

def get_exchange_rates():
    """Lấy tỷ giá hối đoái mới nhất từ USD sang các đồng tiền khác (để quy đổi HKD -> USD)."""
    rates = {"USD": 1.0, "HKD": 7.84, "VND": 25400.0, "EUR": 0.92}
    try:
        req = urllib.request.Request("https://open.er-api.com/v6/latest/USD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if "rates" in data:
                rates.update(data["rates"])
                print(f"💱 Tỷ giá hiện tại: 1 USD = {rates.get('HKD', 7.84):.4f} HKD", flush=True)
    except Exception as e:
        print(f"⚠️ Không lấy được tỷ giá live: {e}. Sử dụng tỷ giá mặc định (HKD: {rates['HKD']}).", flush=True)
    return rates


# ==================== CLASS GOOGLE ADS CLIENT ====================
class GoogleAdsREST:
    def __init__(self, developer_token, client_id, client_secret, refresh_token, login_customer_id):
        self.dev_token = developer_token.strip()
        self.client_id = client_id.strip()
        self.client_secret = client_secret.strip()
        self.refresh_token = refresh_token.strip()
        self.login_mcc = str(login_customer_id).replace("-", "").strip()
        self.api_version = CONFIG["API_VERSION"]
        self.access_token = self._get_access_token()

    def _get_access_token(self):
        token_url = "https://oauth2.googleapis.com/token"
        params = urllib.parse.urlencode({
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "refresh_token": self.refresh_token,
            "grant_type": "refresh_token"
        }).encode("utf-8")

        req = urllib.request.Request(token_url, data=params, headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                res_data = json.loads(resp.read().decode("utf-8"))
                if "access_token" in res_data:
                    return res_data["access_token"]
                else:
                    raise Exception(f"Không có access_token: {res_data}")
        except Exception as e:
            print(f"❌ Lỗi làm mới access_token: {e}", flush=True)
            raise

    def _api_request(self, url, query_body, login_id=None):
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "developer-token": self.dev_token,
            "Content-Type": "application/json"
        }
        if login_id:
            headers["login-customer-id"] = str(login_id).replace("-", "")

        data = json.dumps(query_body).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            raise Exception(f"HTTP {e.code}: {err_body}")

    def get_child_accounts(self):
        """Lấy tất cả các tài khoản con trực thuộc MCC (loại bỏ manager accounts để tránh lỗi metrics)."""
        url = f"https://googleads.googleapis.com/{self.api_version}/customers/{self.login_mcc}/googleAds:search"
        query = {
            "query": """
                SELECT
                    customer_client.id,
                    customer_client.descriptive_name,
                    customer_client.manager,
                    customer_client.status,
                    customer_client.currency_code
                FROM customer_client
                WHERE customer_client.status = 'ENABLED'
                  AND customer_client.manager = FALSE
            """
        }
        accounts = []
        try:
            res = self._api_request(url, query, login_id=self.login_mcc)
            for row in res.get("results", []):
                cc = row.get("customerClient", {})
                raw_name = cc.get("descriptiveName") or cc.get("descriptive_name") or ""
                acc_id_str = str(cc.get("id"))
                acc_curr = cc.get("currencyCode") or cc.get("currency_code") or "USD"
                final_name = raw_name if raw_name else f"Account {acc_id_str}"
                accounts.append({
                    "id": acc_id_str,
                    "name": final_name,
                    "currency": acc_curr
                })
                print(f"🔎 [MCC Account] ID: {acc_id_str} | Name: '{raw_name}' | Keys: {list(cc.keys())}", flush=True)
            if not accounts:
                accounts.append({"id": self.login_mcc, "name": "Main Account", "currency": "USD"})
            return accounts
        except Exception as e:
            print(f"⚠️ Không duyệt được tài khoản con qua MCC {self.login_mcc}: {e}. Sẽ dùng chính ID này.", flush=True)
            return [{"id": self.login_mcc, "name": "Main Account", "currency": "USD"}]

    def fetch_all_campaigns_spend(self, accounts, start_date, end_date, fx_rates):
        """
        Kéo Campaign Spend trực tiếp từ Google Ads API (quy đổi sang USD chuẩn).
        """
        camp_map = {}  # cid -> {'id': ..., 'name': ..., 'account_name': ..., 'currency': ..., 'cost': {day: float}, 'cost_usd': {day: float}}

        for acc in accounts:
            acc_id = acc["id"]
            acc_name = acc["name"]
            acc_curr = acc.get("currency", "USD")
            rate = fx_rates.get(acc_curr, 1.0)
            if rate <= 0: rate = 1.0

            url_camp = f"https://googleads.googleapis.com/{self.api_version}/customers/{acc_id}/googleAds:searchStream"
            q_camp = {
                "query": f"""
                    SELECT
                        segments.date,
                        campaign.id,
                        campaign.name,
                        customer.id,
                        customer.descriptive_name,
                        customer.currency_code,
                        metrics.cost_micros
                    FROM campaign
                    WHERE segments.date >= '{start_date}' AND segments.date <= '{end_date}'
                      AND metrics.cost_micros > 0
                """
            }
            try:
                stream_res = self._api_request(url_camp, q_camp, login_id=self.login_mcc)
                for batch in stream_res:
                    for item in batch.get("results", []):
                        cid = str(item.get("campaign", {}).get("id"))
                        cname = item.get("campaign", {}).get("name", "")
                        day = item.get("segments", {}).get("date", "")
                        cost_raw = float(item.get("metrics", {}).get("costMicros", 0)) / 1_000_000.0
                        cost_usd = cost_raw / rate

                        # Ưu tiên lấy tên account trực tiếp từ customer.descriptive_name
                        cust_obj = item.get("customer", {})
                        direct_acc_name = cust_obj.get("descriptiveName") or cust_obj.get("descriptive_name") or ""
                        resolved_acc_name = direct_acc_name if direct_acc_name else acc_name

                        if cid not in camp_map:
                            print(f"🎯 Campaign {cid} -> Account: '{resolved_acc_name}' (Direct: '{direct_acc_name}', Acc: '{acc_name}')", flush=True)
                            camp_map[cid] = {
                                "id": cid,
                                "name": cname,
                                "account_name": resolved_acc_name,
                                "currency": acc_curr,
                                "cost": {},
                                "cost_usd": {}
                            }
                        camp_map[cid]["cost"][day] = camp_map[cid]["cost"].get(day, 0.0) + cost_raw
                        camp_map[cid]["cost_usd"][day] = camp_map[cid]["cost_usd"].get(day, 0.0) + cost_usd
            except Exception as e:
                # Bỏ qua tài khoản không có quyền hoặc không có campaign active
                err_str = str(e)
                if "NOT_ADS_USER" not in err_str and "PERMISSION_DENIED" not in err_str:
                    print(f"⚠️ Lỗi kéo Google Ads cho {acc_id} ({acc_name}): {e}", flush=True)

        return camp_map


# ==================== KÉO ADJUST DATA (GOOGLE ADS ACI) ====================
def fetch_adjust_google(oldest_date, newest_date):
    """
    Kéo Adjust CSV cho Google Ads ACI:
    dimensions=day,campaign_id_network,campaign_network,country_code
    metrics=cost,network_cost,installs,ad_revenue_total_d0
    """
    by_camp = {}         # cid -> {'name': str, 'days': {day: {'cost': float, 'installs': int, 'rev': float}}}
    by_camp_country = {} # (cid, country_name) -> {'cid': str, 'name': str, 'country': str, 'days': {day: {'cost': float, 'installs': int, 'rev': float}}}
    by_app_country = {}  # (app_id, country_name) -> {'app_id': str, 'country': str, 'days': {day: {'cost': float, 'installs': int, 'rev': float}}}

    query_parts = [
        f"date_period={oldest_date}:{newest_date}",
        "dimensions=day,campaign_id_network,campaign_network,country_code",
        "network__in=Google%20Ads%20ACI",
        "metrics=cost,network_cost,installs,ad_revenue_total_d0",
        "utc_offset=%2B07:00",
        "attribution_source=dynamic",
        "reattributed=all",
        "sandbox=false"
    ]
    api_url = "https://automate.adjust.com/reports-service/csv_report?" + "&".join(query_parts)
    req = urllib.request.Request(api_url, headers={
        "Authorization": "Bearer " + CONFIG["ADJUST_TOKEN"],
        "Accept": "text/csv"
    })

    print(f"🔄 Đang kết nối Adjust Reports (Google Ads ACI - Full Dimensions & Cost)...", flush=True)
    text = ""
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                text = resp.read().decode("utf-8")
            if text:
                break
        except Exception as e:
            print(f"⚠️ Lần {attempt} lấy Adjust thất bại: {e}", flush=True)
            if attempt < 3: time.sleep(3 * attempt)

    lines = text.strip().split("\n")
    if len(lines) <= 1:
        print("⚠️ Adjust không trả về dữ liệu cho Google Ads ACI.", flush=True)
        return by_camp, by_camp_country, by_app_country

    headers = [h.strip().lstrip("\ufeff").lower() for h in lines[0].split(",")]
    day_idx = headers.index("day") if "day" in headers else -1
    cid_idx = headers.index("campaign_id_network") if "campaign_id_network" in headers else -1
    cname_idx = headers.index("campaign_network") if "campaign_network" in headers else -1
    cc_idx = headers.index("country_code") if "country_code" in headers else -1
    cost_idx = headers.index("cost") if "cost" in headers else -1
    inst_idx = headers.index("installs") if "installs" in headers else -1
    rev_idx = headers.index("ad_revenue_total_d0") if "ad_revenue_total_d0" in headers else -1

    for line in lines[1:]:
        parts = line.split(",")
        if len(parts) <= max(day_idx, cid_idx, cname_idx, cc_idx, cost_idx, inst_idx, rev_idx):
            continue

        day = parts[day_idx].strip()
        cid = parts[cid_idx].strip()
        cname = parts[cname_idx].strip()
        cc = parts[cc_idx].strip().upper()
        country_name = get_country_name(cc)

        try: cost = float(parts[cost_idx])
        except: cost = 0.0

        try: installs = int(float(parts[inst_idx]))
        except: installs = 0

        try: rev = float(parts[rev_idx])
        except: rev = 0.0

        if not cid:
            continue

        ma_sp = extract_ma_sp(cname)

        # 1. Gom nhóm theo Campaign
        if cid not in by_camp:
            by_camp[cid] = {"name": cname, "days": {}}
        if day not in by_camp[cid]["days"]:
            by_camp[cid]["days"][day] = {"cost": 0.0, "installs": 0, "rev": 0.0}
        by_camp[cid]["days"][day]["cost"] += cost
        by_camp[cid]["days"][day]["installs"] += installs
        by_camp[cid]["days"][day]["rev"] += rev

        # 2. Gom nhóm theo Campaign x Country
        ckey = (cid, country_name)
        if ckey not in by_camp_country:
            by_camp_country[ckey] = {"cid": cid, "name": cname, "country": country_name, "days": {}}
        if day not in by_camp_country[ckey]["days"]:
            by_camp_country[ckey]["days"][day] = {"cost": 0.0, "installs": 0, "rev": 0.0}
        by_camp_country[ckey]["days"][day]["cost"] += cost
        by_camp_country[ckey]["days"][day]["installs"] += installs
        by_camp_country[ckey]["days"][day]["rev"] += rev

        # 3. Gom nhóm theo APP ID (Mã SP) x Country
        akey = (ma_sp, country_name)
        if akey not in by_app_country:
            by_app_country[akey] = {"app_id": ma_sp, "country": country_name, "days": {}}
        if day not in by_app_country[akey]["days"]:
            by_app_country[akey]["days"][day] = {"cost": 0.0, "installs": 0, "rev": 0.0}
        by_app_country[akey]["days"][day]["cost"] += cost
        by_app_country[akey]["days"][day]["installs"] += installs
        by_app_country[akey]["days"][day]["rev"] += rev

    print(f"✅ Đã tải Adjust thành công ({len(by_camp)} campaigns, {len(by_camp_country)} campaign x country, {len(by_app_country)} app x country).", flush=True)
    return by_camp, by_camp_country, by_app_country


# ==================== TÍNH TOÁN DANH SÁCH NGÀY ====================
def get_dates_info(days_to_show=3):
    tz = timezone(timedelta(hours=7))
    now = datetime.now(tz)
    dates_info = []

    for i in range(days_to_show):
        target = now - timedelta(days=i)
        str_val = target.strftime("%Y-%m-%d")
        disp_val = target.strftime("%Y-%m-%d")  # Định dạng ISO chuẩn để Sheet tự format theo locale
        minus1_str = (target - timedelta(days=1)).strftime("%Y-%m-%d")
        minus2_str = (target - timedelta(days=2)).strftime("%Y-%m-%d")

        dates_info.append({
            "str": str_val,
            "display": disp_val,
            "minus1_str": minus1_str,
            "minus2_str": minus2_str,
            "raw_time": int(datetime(target.year, target.month, target.day, tzinfo=tz).timestamp() * 1000)
        })
    return dates_info


# ==================== 1. BUILD BẢNG: Google Campaign ====================
def build_google_campaign_table(camp_map, adjust_by_camp, dates_info, now_str, valid_cids=None, email_map=None):
    headers = [
        "Date", "Mã SP", "Email", "Campaign", "Campaign ID", "Cost",
        "FirstOpen", "CPU (USD)", "ROAS", "ROAS D-1", "ROAS D-2", "Time kéo"
    ]
    rows = []

    # Chỉ lấy các campaign thuộc Google Ads MCC
    if camp_map:
        all_cids = list(camp_map.keys())
    elif valid_cids:
        all_cids = list(valid_cids)
    else:
        all_cids = list(adjust_by_camp.keys())

    for dt in dates_info:
        day_str = dt["str"]
        day_disp = dt["display"]
        m1_str = dt["minus1_str"]
        m2_str = dt["minus2_str"]

        for cid in all_cids:
            c_google = camp_map.get(cid, {})
            c_adjust = adjust_by_camp.get(cid, {})

            c_name = c_google.get("name") or c_adjust.get("name") or cid
            ma_sp = extract_ma_sp(c_name)

            # Cost chuẩn USD: Ưu tiên từ Adjust (đã là USD và khớp với FirstOpen, CPU, ROAS),
            # Nếu Adjust chưa có dữ liệu thì lấy Google Ads API đã quy đổi sang USD
            adj_d0 = c_adjust.get("days", {}).get(day_str, {})
            installs = adj_d0.get("installs", 0)
            adj_cost_d0 = adj_d0.get("cost", 0.0)
            adj_rev_d0 = adj_d0.get("rev", 0.0)

            google_cost_usd = c_google.get("cost_usd", {}).get(day_str, 0.0)
            cost = adj_cost_d0 if adj_cost_d0 > 0 else google_cost_usd

            adj_d1 = c_adjust.get("days", {}).get(m1_str, {})
            adj_cost_d1 = adj_d1.get("cost", 0.0)
            adj_rev_d1 = adj_d1.get("rev", 0.0)

            adj_d2 = c_adjust.get("days", {}).get(m2_str, {})
            adj_cost_d2 = adj_d2.get("cost", 0.0)
            adj_rev_d2 = adj_d2.get("rev", 0.0)

            if round(cost, 2) == 0 and installs == 0 and adj_rev_d0 == 0:
                continue

            # CPU (USD): Tính theo chi phí USD chia cho lượt mở FirstOpen
            cpu = round(cost / installs, 2) if installs > 0 and cost > 0 else ""

            # ROAS: Doanh thu / Chi phí Adjust (chuẩn USD)
            roas = round(adj_rev_d0 / cost, 4) if cost > 0 else 0.0
            roas_d1 = round(adj_rev_d1 / adj_cost_d1, 4) if adj_cost_d1 > 0 else 0.0
            roas_d2 = round(adj_rev_d2 / adj_cost_d2, 4) if adj_cost_d2 > 0 else 0.0

            for email_field in get_app_emails(ma_sp, email_map):
                rows.append({
                    "row": [
                        day_disp, ma_sp, email_field, c_name, cid, round(cost, 2),
                        installs, cpu, roas, roas_d1, roas_d2, now_str
                    ],
                    "raw_time": dt["raw_time"],
                    "cost": cost
                })

    rows.sort(key=lambda r: (r["raw_time"], r["cost"]), reverse=True)
    return [headers] + [r["row"] for r in rows]


# ==================== 2. BUILD BẢNG: Google Country ====================
def build_google_country_table(adjust_by_camp_country, dates_info, now_str, camp_map=None, valid_cids=None, email_map=None):
    """
    Thứ tự cột chuẩn xác 100% theo ảnh giao diện Looker Studio:
    Mã SP | Email | Date | Campaign | Campaign ID | Country/Territory | Account | COST (USD) | ROAS D0 | FirtOpen | CPU | Time kéo
    """
    headers = [
        "Mã SP", "Email", "Date", "Campaign", "Campaign ID", "Country/Territory", "Account",
        "COST (USD)", "ROAS D0", "FirtOpen", "CPU", "Time kéo"
    ]
    rows = []

    for dt in dates_info:
        day_str = dt["str"]
        day_disp = dt["display"]

        for (cid, country_name), item in adjust_by_camp_country.items():
            if valid_cids and cid not in valid_cids:
                continue

            d_data = item.get("days", {}).get(day_str)
            if not d_data:
                continue

            cost = d_data.get("cost", 0.0) # Adjust cost đã là USD chuẩn!
            installs = d_data.get("installs", 0)
            rev = d_data.get("rev", 0.0)

            if round(cost, 2) == 0 and installs == 0 and rev == 0:
                continue

            c_name = item["name"]
            ma_sp = extract_ma_sp(c_name)
            acc_name = (camp_map.get(cid, {}).get("account_name") if camp_map else None) or "Google Ads"

            roas_d0 = round(rev / cost, 4) if cost > 0 else 0.0
            cpu = round(cost / installs, 2) if installs > 0 else ""

            for email_field in get_app_emails(ma_sp, email_map):
                rows.append({
                    "row": [
                        ma_sp, email_field, day_disp, c_name, cid, country_name, acc_name,
                        round(cost, 2), roas_d0, installs, cpu, now_str
                    ],
                    "raw_time": dt["raw_time"],
                    "cost": cost
                })

    rows.sort(key=lambda r: (r["raw_time"], r["cost"]), reverse=True)
    if len(rows) > 0:
        print(f"📋 Sample Google Country row: {rows[0]['row']}", flush=True)
    return [headers] + [r["row"] for r in rows]


# ==================== 3. BUILD BẢNG: Google Total Country ====================
def build_google_total_country_table(adjust_by_camp_country, dates_info, now_str, valid_cids=None, email_map=None):
    """
    Thứ tự cột chuẩn xác 100% theo ảnh giao diện Looker Studio:
    Date | APP ID | Email | Country | Total Cost | FistOpen | CPU | ROAS D0 | Time kéo
    """
    headers = [
        "Date", "Mã SP", "APP ID", "Email", "Country", "Total Cost", "FistOpen", "CPU", "ROAS D0", "Time kéo"
    ]
    rows = []

    for dt in dates_info:
        day_str = dt["str"]
        day_disp = dt["display"]

        # Gom nhóm theo (Mã SP/APP ID, Country) CHỈ cho các campaigns thuộc MCC
        grouped = {}
        for (cid, country_name), item in adjust_by_camp_country.items():
            if valid_cids and cid not in valid_cids:
                continue

            d_data = item.get("days", {}).get(day_str)
            if not d_data:
                continue

            cost = d_data.get("cost", 0.0)
            installs = d_data.get("installs", 0)
            rev = d_data.get("rev", 0.0)

            if round(cost, 2) == 0 and installs == 0 and rev == 0:
                continue

            ma_sp = extract_ma_sp(item["name"])
            gkey = (ma_sp, country_name)
            if gkey not in grouped:
                grouped[gkey] = {"cost": 0.0, "installs": 0, "rev": 0.0}
            grouped[gkey]["cost"] += cost
            grouped[gkey]["installs"] += installs
            grouped[gkey]["rev"] += rev

        for (app_id, country_name), data in grouped.items():
            cost = data["cost"]
            inst = data["installs"]
            rev = data["rev"]

            # CPU có 3 chữ số thập phân chuẩn theo ảnh giao diện (ví dụ 0.038)
            cpu = round(cost / inst, 3) if inst > 0 else ""
            roas_d0 = round(rev / cost, 4) if cost > 0 else 0.0

            for email_field in get_app_emails(app_id, email_map):
                rows.append({
                    "row": [
                        day_disp, app_id, app_id, email_field, country_name, round(cost, 2),
                        inst, cpu, roas_d0, now_str
                    ],
                    "raw_time": dt["raw_time"],
                    "cost": cost
                })

    rows.sort(key=lambda r: (r["raw_time"], r["cost"]), reverse=True)
    return [headers] + [r["row"] for r in rows]


# ==================== GỬI WEBHOOK LÊN GOOGLE SHEETS ====================
def send_to_webhook(payload, webhook_url):
    """Gửi lần lượt 3 bảng lên Webhook Google Sheet."""
    if not webhook_url:
        print("❌ Chưa cấu hình WEBHOOK_URL!", flush=True)
        return False

    sheet_order = [
        ("googleCampaign", "Google Campaign"),
        ("googleCountry", "Google Country"),
        ("googleTotalCountry", "Google Total Country"),
        ("cutoff", "CutOff"),
        ("phanQuyen", "PhanQuyen")
    ]

    for key, name in sheet_order:
        if key in payload and len(payload[key]) > 0:
            rows = payload[key]
            print(f"🚀 Đang gửi {name} ({len(rows) - 1} dòng) lên Google Sheet...", flush=True)
            data_bytes = json.dumps({key: rows}).encode("utf-8")
            req = urllib.request.Request(webhook_url, data=data_bytes, headers={"Content-Type": "application/json"})

            sent_ok = False
            for attempt in range(1, 4):
                try:
                    with urllib.request.urlopen(req, timeout=180) as resp:
                        res_text = resp.read().decode("utf-8")
                        if "success" in res_text or "Đã cập nhật" in res_text:
                            print(f"✅ {name} cập nhật thành công!", flush=True)
                            sent_ok = True
                            break
                        else:
                            print(f"⚠️ Webhook phản hồi: {res_text[:200]}", flush=True)
                except Exception as e:
                    print(f"⚠️ Lần {attempt} gửi {name} thất bại: {e}", flush=True)
                    if attempt < 3: time.sleep(3 * attempt)

            if not sent_ok:
                print(f"❌ Không thể gửi {name} sau 3 lần thử!", flush=True)


# ==================== MAIN RUNNER ====================
def run_google_ads_sync():
    total_start = time.time()
    print("=" * 65, flush=True)
    print("⚡ BẮT ĐẦU ĐỒNG BỘ GOOGLE ADS & ADJUST (3 BẢNG GOOGLE V3 - USD)", flush=True)
    print("=" * 65, flush=True)

    dev_token = CONFIG["DEVELOPER_TOKEN"]
    client_id = CONFIG["CLIENT_ID"]
    client_secret = CONFIG["CLIENT_SECRET"]
    refresh_token = CONFIG["REFRESH_TOKEN"]
    login_mcc = CONFIG["LOGIN_CUSTOMER_ID"]
    webhook_url = CONFIG["WEBHOOK_URL"]

    # Lấy tỷ giá hối đoái để quy đổi sang USD
    fx_rates = get_exchange_rates()

    dates_info = get_dates_info(days_to_show=CONFIG["DAYS_TO_SHOW"])
    start_date = dates_info[-1]["str"]
    end_date = dates_info[0]["str"]

    tz = timezone(timedelta(hours=7))
    now_str = datetime.now(tz).strftime("%H:%M:%S")

    # 1. Kéo Google Ads API (cho bảng Google Campaign)
    camp_map = {}
    if dev_token and client_id and client_secret and refresh_token and login_mcc:
        try:
            print(f"🔑 Khởi tạo Google Ads REST API ({CONFIG['API_VERSION']})...", flush=True)
            client = GoogleAdsREST(dev_token, client_id, client_secret, refresh_token, login_mcc)
            accounts = client.get_child_accounts()
            print(f"🎯 Tìm thấy {len(accounts)} tài khoản Google Ads thuộc MCC {login_mcc}.", flush=True)

            t_g = time.time()
            camp_map = client.fetch_all_campaigns_spend(accounts, start_date, end_date, fx_rates)
            print(f"✅ Đã quét {len(camp_map)} chiến dịch Google Ads có chi phí ({time.time() - t_g:.2f}s)!", flush=True)
        except Exception as e:
            print(f"⚠️ Lỗi kết nối Google Ads API: {e}. Sẽ dùng dữ liệu chi phí từ Adjust làm nguồn dự phòng.", flush=True)
    else:
        print("ℹ️ Chưa đủ thông tin cấu hình Google Ads API. Sẽ lấy chi phí trực tiếp từ Adjust.", flush=True)

    # 2. Kéo Adjust Data (Google Ads ACI)
    t_adj = time.time()
    adjust_by_camp, adjust_by_camp_country, adjust_by_app_country = fetch_adjust_google(start_date, end_date)
    print(f"✅ Đã kéo Adjust Data Google Ads ACI ({time.time() - t_adj:.2f}s)!", flush=True)

    # Lấy dữ liệu phân quyền Email từ sheet Validate
    v_apps, v_marketers, v_names, v_admins, v_leaders, v_employees, email_map = fetch_validate_from_sheet(webhook_url)
    if not email_map:
        email_map = {}

    # Chỉ kéo các campaign thuộc MCC (hoặc app theo dõi trong Validate):
    if camp_map:
        valid_cids = set(camp_map.keys())
    else:
        tracked_set = set([a.upper() for a in v_apps]) if v_apps else set()
        valid_cids = set()
        for cid, cdata in adjust_by_camp.items():
            ma_sp = extract_ma_sp(cdata.get("name", "")).upper()
            if not tracked_set or ma_sp in tracked_set or any(t in ma_sp for t in tracked_set):
                valid_cids.add(cid)

    # 3. Xây dựng 3 bảng dữ liệu
    camp_table = build_google_campaign_table(camp_map, adjust_by_camp, dates_info, now_str, valid_cids=valid_cids, email_map=email_map)
    country_table = build_google_country_table(adjust_by_camp_country, dates_info, now_str, camp_map=camp_map, valid_cids=valid_cids, email_map=email_map)
    total_country_table = build_google_total_country_table(adjust_by_camp_country, dates_info, now_str, valid_cids=valid_cids, email_map=email_map)

    print(f"   - Google Campaign: {len(camp_table) - 1} dòng", flush=True)
    print(f"   - Google Country: {len(country_table) - 1} dòng (Có cột Account)", flush=True)
    print(f"   - Google Total Country: {len(total_country_table) - 1} dòng", flush=True)

    # 3.5. Xây dựng & cập nhật bảng App Report với chi phí Google Ads chính xác
    google_spend_map = {}
    if camp_map:
        for cid, cdata in camp_map.items():
            sp = cdata.get("sp_code") or extract_ma_sp(cdata.get("name", "")).upper()
            if not sp or sp == "UNKNOWN":
                continue
            for day, cost_usd in cdata.get("cost_usd", {}).items():
                key = (day, sp)
                google_spend_map[key] = google_spend_map.get(key, 0.0) + cost_usd

    if adjust_by_camp:
        for cid, cdata in adjust_by_camp.items():
            if camp_map and cid in camp_map:
                continue
            cname = cdata.get("name", "")
            sp = extract_ma_sp(cname).upper()
            if not sp or sp == "UNKNOWN":
                continue
            for day, metrics in cdata.get("days", {}).items():
                adj_cost = metrics.get("cost", 0.0)
                if adj_cost > 0:
                    key = (day, sp)
                    google_spend_map[key] = google_spend_map.get(key, 0.0) + adj_cost

    save_spend_cache(GOOGLE_SPEND_FILE, google_spend_map)

    app_table = []
    try:
        t_app = time.time()
        adjust_app_data, known_apps = fetch_adjust_app_network_data(start_date, end_date, CONFIG["ADJUST_TOKEN"])
        app_table = build_app_report_table(dates_info, adjust_app_data, known_apps, google_spend_map=google_spend_map, now_str=now_str, webhook_url=webhook_url)
        print(f"   - CutOff (Google Ads Updated): {len(app_table) - 1} dòng ({time.time() - t_app:.2f}s)", flush=True)
    except Exception as e:
        print(f"⚠️ Không thể cập nhật bảng CutOff trong lượt Google Ads: {e}", flush=True)

    phan_quyen_table = build_permissions_table(webhook_url)
    print(f"   - PhanQuyen: {len(phan_quyen_table) - 1} dòng", flush=True)

    payload = {
        "googleCampaign": camp_table,
        "googleCountry": country_table,
        "googleTotalCountry": total_country_table,
        "phanQuyen": phan_quyen_table
    }
    if app_table:
        payload["cutoff"] = app_table

    # 4. Gửi lên Webhook Google Sheet
    send_to_webhook(payload, webhook_url)

    total_time = time.time() - total_start
    print("=" * 65, flush=True)
    print(f"🎉 HOÀN TẤT ĐỒNG BỘ GOOGLE ADS TRONG {total_time:.2f} GIÂY!", flush=True)
    print("=" * 65, flush=True)


if __name__ == "__main__":
    run_google_ads_sync()
