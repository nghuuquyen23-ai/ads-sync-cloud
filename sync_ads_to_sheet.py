#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HỆ THỐNG ĐỒNG BỘ ADS & ADJUST ĐA DOANH NGHIỆP (MULTI-BM CLOUD SYNC V6)
- Tự động quét tài khoản theo từng Business Manager (BM) qua Meta Graph API.
- Hỗ trợ chia tách dữ liệu độc lập cho nhiều BM (BM AG, BM IH, BM AA).
- Đẩy dữ liệu chuẩn xác về từng Google Sheet Webhook tương ứng.
- Tốc độ xử lý siêu tốc (Multi-threading 35 luồng song song).
- Chống nghẽn mạng & tự động thử lại (Retry) với cơ chế Fall-back an toàn.
"""

import sys
import os
import json
import time
import urllib.request
import urllib.parse
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor

from app_report_builder import (
    fetch_adjust_app_network_data,
    build_app_report_table,
    save_spend_cache,
    META_SPEND_FILE,
    get_app_email,
    fetch_validate_from_sheet,
    build_permissions_table,
    extract_app_code
)

# ==================== CẤU HÌNH HỆ THỐNG ====================
CONFIG = {
    # Token quản trị có quyền business_management, ads_read, ads_management (lấy từ GitHub Secrets)
    "META_TOKEN": os.environ.get("META_TOKEN", ""),
    "ADJUST_TOKEN": os.environ.get("ADJUST_TOKEN", ""),
    "DAYS_TO_SHOW": 3,
    "FETCH_COMPARE_DAYS": True,
    "APP_TOKENS": [],
    "META_API_VERSION": "v21.0",
}

# ==================== CẤU HÌNH BUSINESS MANAGERS (BM) ====================
# Webhook của Sheet chính (Hourly, FB Campaign, Total Country, CutOff, Tình trạng account, Google, PhanQuyen)
PRIMARY_WEBHOOK_URL = (os.environ.get("PRIMARY_WEBHOOK_URL") or "").strip()
# Webhook của Sheet riêng cho bảng nặng FB Country (~141,000 dòng) để không làm quá tải Blended Data trên Sheet chính
FB_COUNTRY_WEBHOOK_URL = (os.environ.get("FB_COUNTRY_WEBHOOK_URL") or "https://script.google.com/macros/s/AKfycby75UnIdHKTuRb8E3rAMTLws-nU22eag0JD95roKQWPi6CEvgYMEHz03Am0NVsjx5sQbg/exec").strip()

BM_CONFIGS = {
    "BM_IH": {
        "name": "Báo Cáo Ads - BM bigthink",
        "business_name": "BM bigthink",
        "business_id": "24663879069932144",
        "token": os.environ.get("META_TOKEN_IH", ""),
        "enabled": True
    },
    "BM_BIGTHINK02": {
        "name": "Báo Cáo Ads - BIG THIBK 02",
        "business_name": "BIG THIBK 02",
        "business_id": None,
        "token": os.environ.get("META_TOKEN_BIGTHINK02", ""),
        "enabled": True
    },
    "BM_AG": {
        "name": "Báo cáo Ads - BM 350",
        "business_name": "BM3 350 kháng 10",
        "business_id": "1397070155272678",
        "token": os.environ.get("META_TOKEN_AG", ""),
        "enabled": True
    }
}

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
    'MO': 'Macau', 'MP': 'Northern Mariana Islands', 'MQ': 'Martinique', 'MR': 'Mauritania',
    'MS': 'Montserrat', 'MT': 'Malta', 'MU': 'Mauritius', 'MV': 'Maldives',
    'MW': 'Malawi', 'MX': 'Mexico', 'MY': 'Malaysia', 'MZ': 'Mozambique',
    'NA': 'Namibia', 'NC': 'New Caledonia', 'NE': 'Niger', 'NF': 'Norfolk Island',
    'NG': 'Nigeria', 'NH': 'Vanuatu', 'NI': 'Nicaragua', 'NL': 'Netherlands',
    'NO': 'Norway', 'NP': 'Nepal', 'NR': 'Nauru', 'NU': 'Niue',
    'NZ': 'New Zealand', 'OM': 'Oman', 'PA': 'Panama', 'PE': 'Peru',
    'PF': 'French Polynesia', 'PG': 'Papua New Guinea', 'PH': 'Philippines', 'PK': 'Pakistan',
    'PL': 'Poland', 'PM': 'St. Pierre & Miquelon', 'PN': 'Pitcairn Islands', 'PR': 'Puerto Rico',
    'PS': 'Palestinian Territories', 'PT': 'Portugal', 'PW': 'Palau', 'PY': 'Paraguay',
    'QA': 'Qatar', 'QO': 'Outlying Oceania', 'RE': 'Réunion', 'RH': 'Zimbabwe',
    'RO': 'Romania', 'RS': 'Serbia', 'RU': 'Russia', 'RW': 'Rwanda',
    'SA': 'Saudi Arabia', 'SB': 'Solomon Islands', 'SC': 'Seychelles', 'SD': 'Sudan',
    'SE': 'Sweden', 'SG': 'Singapore', 'SH': 'St. Helena', 'SI': 'Slovenia',
    'SJ': 'Svalbard & Jan Mayen', 'SK': 'Slovakia', 'SL': 'Sierra Leone', 'SM': 'San Marino',
    'SN': 'Senegal', 'SO': 'Somalia', 'SR': 'Suriname', 'SS': 'South Sudan',
    'ST': 'São Tomé & Príncipe', 'SU': 'Russia', 'SV': 'El Salvador', 'SX': 'Sint Maarten',
    'SY': 'Syria', 'SZ': 'Eswatini', 'TA': 'Tristan da Cunha', 'TC': 'Turks & Caicos Islands',
    'TD': 'Chad', 'TF': 'French Southern Territories', 'TG': 'Togo', 'TH': 'Thailand',
    'TJ': 'Tajikistan', 'TK': 'Tokelau', 'TL': 'Timor-Leste', 'TM': 'Turkmenistan',
    'TN': 'Tunisia', 'TO': 'Tonga', 'TP': 'Timor-Leste', 'TR': 'Turkey',
    'TT': 'Trinidad & Tobago', 'TV': 'Tuvalu', 'TW': 'Taiwan', 'TZ': 'Tanzania',
    'UA': 'Ukraine', 'UG': 'Uganda', 'UK': 'United Kingdom', 'UM': 'U.S. Outlying Islands',
    'US': 'United States', 'USA': 'United States', 'UY': 'Uruguay', 'UZ': 'Uzbekistan',
    'VA': 'Vatican City', 'VC': 'St. Vincent & Grenadines', 'VE': 'Venezuela',
    'VG': 'British Virgin Islands', 'VI': 'U.S. Virgin Islands', 'VN': 'Vietnam',
    'VU': 'Vanuatu', 'WF': 'Wallis & Futuna', 'WS': 'Samoa', 'XK': 'Kosovo',
    'YE': 'Yemen', 'YT': 'Mayotte', 'ZA': 'South Africa', 'ZM': 'Zambia',
    'ZW': 'Zimbabwe'
}

def get_country_name(code):
    if not code:
        return 'Unknown'
    code_up = str(code).upper().strip()
    return COUNTRY_MAP.get(code_up, code_up)

def extract_product_code(name):
    if not name:
        return 'Unknown'
    cleaned = str(name).strip()
    if cleaned.upper().startswith('INVOICE_'):
        cleaned = cleaned[8:].strip()
    for sep in ['_', '-', ' ']:
        if sep in cleaned:
            cleaned = cleaned.split(sep)[0].strip()
    return cleaned.upper()

def extract_insight(name):
    if not name:
        return ''
    parts = name.strip().split('_')
    if len(parts) >= 2:
        return parts[-1].strip()
    return ''

def extract_installs(actions):
    if not actions:
        return 0
    target_actions = [
        'mobile_app_install',
        'app_install',
        'omni_app_install',
        'install_mobile'
    ]
    for act in actions:
        if act.get('action_type') in target_actions:
            try:
                return int(float(act.get('value', 0)))
            except:
                return 0
    return 0

def get_dates_info(days_to_show=3):
    tz = timezone(timedelta(hours=7))
    now = datetime.now(tz)
    dates_info = []

    for i in range(days_to_show):
        target = now - timedelta(days=i)
        str_val = target.strftime('%Y-%m-%d')
        disp_val = target.strftime('%Y-%m-%d')
        minus1_str = (target - timedelta(days=1)).strftime('%Y-%m-%d')
        minus2_str = (target - timedelta(days=2)).strftime('%Y-%m-%d')

        dates_info.append({
            'str': str_val,
            'display': disp_val,
            'minus1_str': minus1_str,
            'minus2_str': minus2_str,
            'raw_time': int(datetime(target.year, target.month, target.day, tzinfo=tz).timestamp() * 1000)
        })
    return dates_info

def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        raise e

# ==================== 1. KÉO DỮ LIỆU TỪ META THEO BM ====================
def get_meta_accounts_by_bm(tracked_apps=None):
    """
    Quét đúng danh sách tài khoản quảng cáo được gán cho System User của từng BM,
    đồng thời lọc chuẩn theo danh sách Mã SP trong bảng Validate (bỏ qua các tài khoản rác/cũ ngoài Validate).
    """
    bm_accounts = {}
    all_unique_accounts = {}
    account_to_bms = {}
    valid_sp_set = set(str(x).upper().strip() for x in (tracked_apps or []) if x)

    for bm_key, bm_info in BM_CONFIGS.items():
        if not bm_info.get('enabled'):
            continue
        token = bm_info.get('token') or CONFIG['META_TOKEN']
        bid = bm_info.get('business_id')
        b_accs = {}
        raw_total = 0
        skipped_untracked = 0

        def _register_account(a):
            nonlocal raw_total, skipped_untracked
            if a.get('account_status') in (100, 101):
                return
            raw_total += 1
            aname = a.get('name', '')
            sp_cand = extract_app_code(extract_product_code(aname))
            if valid_sp_set and sp_cand not in valid_sp_set:
                skipped_untracked += 1
                return
            aid = a['id']
            a_obj = dict(a)
            a_obj['token'] = token
            b_accs[aid] = a_obj
            all_unique_accounts[aid] = a_obj
            if aid not in account_to_bms:
                account_to_bms[aid] = []
            if bm_key not in account_to_bms[aid]:
                account_to_bms[aid].append(bm_key)

        # 1. Quét chính xác các tài khoản được gán trực tiếp cho System User (/me/adaccounts)
        me_success = False
        try:
            u = f"https://graph.facebook.com/{CONFIG['META_API_VERSION']}/me/adaccounts?fields=id,name,account_status&limit=500&access_token={token}"
            while u:
                d = fetch_json(u)
                for a in d.get('data', []):
                    _register_account(a)
                u = d.get('paging', {}).get('next')
            if len(b_accs) > 0:
                me_success = True
        except Exception as e:
            print(f"⚠️ Lỗi quét /me/adaccounts cho {bm_info['name']}: {e}", flush=True)

        # 2. Fallback: Nếu System User chưa gán trực tiếp từng TK mà có Business ID + quyền business_management
        if not me_success and bid:
            try:
                for ep in ['owned_ad_accounts', 'client_ad_accounts']:
                    u = f"https://graph.facebook.com/{CONFIG['META_API_VERSION']}/{bid}/{ep}?fields=id,name,account_status&limit=500&access_token={token}"
                    while u:
                        d = fetch_json(u)
                        for a in d.get('data', []):
                            _register_account(a)
                        u = d.get('paging', {}).get('next')
            except Exception:
                pass

        bm_accounts[bm_key] = list(b_accs.values())
        act_cnt = sum(1 for x in b_accs.values() if x.get('account_status') == 1)
        dis_cnt = sum(1 for x in b_accs.values() if x.get('account_status') != 1)
        print(
            f"✅ [{bm_info['name']}] Quét chuẩn {len(b_accs)} tài khoản thuộc Validate "
            f"(Đang hoạt động: {act_cnt}, Vô hiệu hóa: {dis_cnt} | Đã lọc bỏ {skipped_untracked}/{raw_total} TK ngoài Validate)",
            flush=True
        )

    return bm_accounts, list(all_unique_accounts.values()), account_to_bms

def fetch_campaign_insights(accounts, oldest_date, newest_date, account_to_bms):
    time_range = json.dumps({'since': oldest_date, 'until': newest_date})
    fields = 'date_start,campaign_name,campaign_id,account_name,spend,actions'
    filtering = json.dumps([{'field': 'spend', 'operator': 'GREATER_THAN', 'value': 0}])

    def fetch_acc(acc):
        token = acc.get('token', CONFIG['META_TOKEN'])
        u = (f"https://graph.facebook.com/{CONFIG['META_API_VERSION']}/{acc['id']}/insights?"
             f"level=campaign&fields={urllib.parse.quote(fields)}"
             f"&time_increment=1&time_range={urllib.parse.quote(time_range)}"
             f"&filtering={urllib.parse.quote(filtering)}&limit=1000&access_token={token}")
        items = []
        pages = 0
        while u and pages < 25:
            pages += 1
            try:
                d = fetch_json(u)
                items.extend(d.get('data', []))
                u = d.get('paging', {}).get('next')
            except Exception as e:
                break
        return acc, items

    with ThreadPoolExecutor(max_workers=35) as ex:
        results = list(ex.map(fetch_acc, accounts))

    camp_map = {}
    camp_to_app = {}
    camp_to_bms = {}
    active_accounts = []

    for acc, data in results:
        if not data:
            continue
        active_accounts.append(acc)
        bms = account_to_bms.get(acc['id'], [])
        for item in data:
            cid = str(item['campaign_id']).strip()
            day = item['date_start']
            spend = float(item.get('spend', 0))
            app_id = extract_product_code(item['campaign_name'])
            camp_to_app[cid] = app_id
            camp_to_bms[cid] = bms

            if cid not in camp_map:
                camp_map[cid] = {
                    'cid': cid,
                    'name': item['campaign_name'],
                    'account_name': item.get('account_name', acc['name']),
                    'account_id': acc['id'],
                    'bms': bms,
                    'insight': extract_insight(item['campaign_name']),
                    'app_id': app_id,
                    'status': 'PAUSED',
                    'budget': 0.0,
                    'cost': {},
                    'installs': {}
                }

            installs = extract_installs(item.get('actions', []))

            camp_map[cid]['cost'][day] = camp_map[cid]['cost'].get(day, 0.0) + spend
            camp_map[cid]['installs'][day] = camp_map[cid]['installs'].get(day, 0) + installs

    return camp_map, camp_to_app, camp_to_bms, active_accounts

def fetch_campaign_budgets(active_accounts, camp_map):
    def fetch_acc_budgets(acc):
        token = acc.get('token', CONFIG['META_TOKEN'])
        u = (f"https://graph.facebook.com/{CONFIG['META_API_VERSION']}/{acc['id']}/campaigns?"
             f"fields=id,status,effective_status,daily_budget,lifetime_budget&limit=500&access_token={token}")
        try:
            d = fetch_json(u)
            return d.get('data', [])
        except:
            return []

    with ThreadPoolExecutor(max_workers=15) as ex:
        results = list(ex.map(fetch_acc_budgets, active_accounts))

    for camp_list in results:
        for c in camp_list:
            cid = str(c['id']).strip()
            if cid in camp_map:
                raw_b = float(c.get('daily_budget') or c.get('lifetime_budget') or 0)
                camp_map[cid]['budget'] = raw_b / 100.0 if raw_b > 0 else 0.0
                camp_map[cid]['status'] = c.get('effective_status') or c.get('status') or 'PAUSED'

def fetch_meta_country_breakdowns(active_accounts, oldest_date, newest_date, account_to_bms):
    """
    Kéo quốc gia theo tài khoản (cho Total Country) và theo chiến dịch (cho FB Country).
    Phân tách theo từng BM để bảng Total Country không bị trộn lẫn số.
    """
    time_range = json.dumps({'since': oldest_date, 'until': newest_date})
    fields = 'date_start,campaign_name,campaign_id,account_name,spend,actions'
    filtering = json.dumps([{'field': 'spend', 'operator': 'GREATER_THAN', 'value': 0}])

    # 1. Total Country: Account-level breakdown
    app_country_map_by_bm = {bm: {} for bm in BM_CONFIGS}
    total_app_country_map = {}
    def fetch_acc_country(acc):
        token = acc.get('token', CONFIG['META_TOKEN'])
        app_id = extract_product_code(acc['name'])
        u = (f"https://graph.facebook.com/{CONFIG['META_API_VERSION']}/{acc['id']}/insights?"
             f"level=account&fields=date_start,account_name,spend,actions"
             f"&breakdowns=country&time_increment=1&time_range={urllib.parse.quote(time_range)}"
             f"&filtering={urllib.parse.quote(filtering)}&limit=1000&access_token={token}")
        items = []
        pages = 0
        while u and pages < 25:
            pages += 1
            try:
                d = fetch_json(u)
                items.extend(d.get('data', []))
                u = d.get('paging', {}).get('next')
            except:
                break
        return acc, app_id, items

    with ThreadPoolExecutor(max_workers=35) as ex:
        acc_country_res = list(ex.map(fetch_acc_country, active_accounts))

    for acc, app_id, data in acc_country_res:
        bms = account_to_bms.get(acc['id'], [])
        for item in data:
            day = item['date_start']
            country = str(item.get('country', '')).upper().strip()
            gkey = f"{app_id}__{country}"
            spend = float(item.get('spend', 0))
            installs = extract_installs(item.get('actions', []))

            # Tổng hợp toàn bộ về map chung
            if gkey not in total_app_country_map:
                total_app_country_map[gkey] = {'app_id': app_id, 'country': country, 'cost': {}, 'installs': {}}
            total_app_country_map[gkey]['cost'][day] = total_app_country_map[gkey]['cost'].get(day, 0.0) + spend
            total_app_country_map[gkey]['installs'][day] = total_app_country_map[gkey]['installs'].get(day, 0) + installs

            for bm in bms:
                if bm not in app_country_map_by_bm:
                    app_country_map_by_bm[bm] = {}
                if gkey not in app_country_map_by_bm[bm]:
                    app_country_map_by_bm[bm][gkey] = {'app_id': app_id, 'country': country, 'cost': {}, 'installs': {}}

                app_country_map_by_bm[bm][gkey]['cost'][day] = app_country_map_by_bm[bm][gkey]['cost'].get(day, 0.0) + spend
                app_country_map_by_bm[bm][gkey]['installs'][day] = app_country_map_by_bm[bm][gkey]['installs'].get(day, 0) + installs

    # 2. FB Country: Campaign-level breakdown
    camp_country_map = {}
    def fetch_camp_country(acc):
        token = acc.get('token', CONFIG['META_TOKEN'])
        u = (f"https://graph.facebook.com/{CONFIG['META_API_VERSION']}/{acc['id']}/insights?"
             f"level=campaign&fields={urllib.parse.quote(fields)}"
             f"&breakdowns=country&time_increment=1&time_range={urllib.parse.quote(time_range)}"
             f"&filtering={urllib.parse.quote(filtering)}&limit=1000&access_token={token}")
        items = []
        pages = 0
        while u and pages < 25:
            pages += 1
            try:
                d = fetch_json(u)
                items.extend(d.get('data', []))
                u = d.get('paging', {}).get('next')
            except:
                break
        return acc, items

    with ThreadPoolExecutor(max_workers=35) as ex:
        camp_country_res = list(ex.map(fetch_camp_country, active_accounts))

    for acc, data in camp_country_res:
        bms = account_to_bms.get(acc['id'], [])
        for item in data:
            day = item['date_start']
            cid = str(item['campaign_id']).strip()
            country = str(item.get('country', '')).upper().strip()
            ckey = f"{cid}__{country}"
            if ckey not in camp_country_map:
                camp_country_map[ckey] = {
                    'cid': cid,
                    'name': item['campaign_name'],
                    'app_id': extract_product_code(item['campaign_name']) or extract_product_code(acc['name']),
                    'account_name': item.get('account_name', acc['name']),
                    'account_id': acc['id'],
                    'bms': bms,
                    'insight': extract_insight(item['campaign_name']),
                    'country': country,
                    'cost': {},
                    'installs': {}
                }

            installs = extract_installs(item.get('actions', []))

            camp_country_map[ckey]['cost'][day] = camp_country_map[ckey]['cost'].get(day, 0.0) + float(item.get('spend', 0))
            camp_country_map[ckey]['installs'][day] = camp_country_map[ckey]['installs'].get(day, 0) + installs

    return app_country_map_by_bm, camp_country_map, total_app_country_map

# ==================== 2. KÉO DỮ LIỆU TỪ ADJUST ====================
def fetch_adjust_data(oldest_date, newest_date, camp_to_app, camp_to_bms):
    by_camp = {}
    by_camp_country = {}
    by_app_country_by_bm = {bm: {} for bm in BM_CONFIGS}
    total_adj_by_app_country = {}

    networks = 'Facebook Installs,Off-Facebook Installs,Instagram Installs'
    query_parts = [
        f'date_period={oldest_date}:{newest_date}',
        'dimensions=day,campaign_id_network,country_code',
        'network__in=' + urllib.parse.quote(networks),
        'metrics=ad_revenue_total_d0',
        'utc_offset=%2B07:00',
        'attribution_source=dynamic',
        'reattributed=all',
        'sandbox=false'
    ]
    if CONFIG.get('APP_TOKENS') and len(CONFIG['APP_TOKENS']) > 0:
        query_parts.insert(0, 'app_token__in=' + ','.join(CONFIG['APP_TOKENS']))

    api_url = 'https://automate.adjust.com/reports-service/csv_report?' + '&'.join(query_parts)

    req = urllib.request.Request(api_url, headers={
        'Authorization': 'Bearer ' + CONFIG['ADJUST_TOKEN'],
        'Accept': 'text/csv'
    })

    text = ""
    max_retries = 3
    for attempt in range(1, max_retries + 1):
        try:
            print(f"🔄 Đang kết nối Adjust Reports (lần {attempt}/{max_retries}, timeout=180s)...", flush=True)
            t_adj = time.time()
            with urllib.request.urlopen(req, timeout=180) as resp:
                text = resp.read().decode('utf-8')
            if text:
                print(f"✅ Tải báo cáo Adjust thành công ({len(text)} bytes, {time.time() - t_adj:.2f}s)!", flush=True)
                break
        except Exception as e:
            print(f"⚠️ Lần {attempt} thất bại khi tải Adjust ({e}).", flush=True)
            if attempt < max_retries:
                time.sleep(5 * attempt)
            else:
                print(f"❌ Cả {max_retries} lần tải Adjust đều thất bại! Tạm thời tiếp tục đồng bộ dữ liệu Meta Ads (tiền tiêu, CPI, installs)...", flush=True)
                text = ""

    lines = text.strip().split('\n')
    if len(lines) <= 1:
        return by_camp, by_camp_country, by_app_country_by_bm, total_adj_by_app_country

    headers = [h.strip().lstrip('\ufeff').lower() for h in lines[0].split(',')]
    day_idx = headers.index('day') if 'day' in headers else -1
    cid_idx = headers.index('campaign_id_network') if 'campaign_id_network' in headers else -1
    cc_idx = headers.index('country_code') if 'country_code' in headers else -1
    rev_idx = headers.index('ad_revenue_total_d0') if 'ad_revenue_total_d0' in headers else -1

    for line in lines[1:]:
        parts = line.split(',')
        if len(parts) <= max(day_idx, cid_idx, cc_idx, rev_idx):
            continue
        day = parts[day_idx].strip()
        cid = parts[cid_idx].strip()
        cc = parts[cc_idx].strip().upper()
        try:
            rev = float(parts[rev_idx])
        except:
            rev = 0.0

        if not cid or rev == 0:
            continue

        # 1. By Campaign
        if cid not in by_camp: by_camp[cid] = {}
        by_camp[cid][day] = by_camp[cid].get(day, 0.0) + rev

        # 2. By Campaign x Country
        ckey = f"{cid}__{cc}"
        if ckey not in by_camp_country: by_camp_country[ckey] = {}
        by_camp_country[ckey][day] = by_camp_country[ckey].get(day, 0.0) + rev

        # 3. By App x Country theo từng BM & Tổng hợp chung
        app_id = camp_to_app.get(cid)
        bms = camp_to_bms.get(cid, [])
        if app_id:
            akey = f"{app_id}__{cc}"
            if akey not in total_adj_by_app_country:
                total_adj_by_app_country[akey] = {}
            total_adj_by_app_country[akey][day] = total_adj_by_app_country[akey].get(day, 0.0) + rev

            for bm in bms:
                if bm not in by_app_country_by_bm:
                    by_app_country_by_bm[bm] = {}
                if akey not in by_app_country_by_bm[bm]:
                    by_app_country_by_bm[bm][akey] = {}
                by_app_country_by_bm[bm][akey][day] = by_app_country_by_bm[bm][akey].get(day, 0.0) + rev

    return by_camp, by_camp_country, by_app_country_by_bm, total_adj_by_app_country

# ==================== 3. XÂY DỰNG 4 BẢNG DỮ LIỆU ====================
def build_hourly_data(camp_map, adjust_by_camp, dates_info, existing_hourly_history=None, email_map=None):
    history_map = existing_hourly_history or {}
    rows = []
    headers = [
        'Date', 'Mã SP', 'Email', 'Campaign name', 'Insight', 'Campaign id', 'Account name',
        'Campaign status', 'Budget', 'Total Cost', 'ROAS', 'Hour-1', 'Hour-2', 'Hour-3',
        'Hour-4', 'Hour-5', 'Hour-6', 'Hour-7'
    ]

    for d_idx, dt in enumerate(dates_info):
        is_today = (d_idx == 0)
        day_str = dt['str']
        day_disp = dt['display']

        for cid, c in camp_map.items():
            cost = c['cost'].get(day_str, 0.0)
            rev = adjust_by_camp.get(cid, {}).get(day_str, 0.0)

            if cost == 0 and rev == 0:
                continue

            current_roas = (rev / cost) if cost > 0 else 0.0
            hist = history_map.get(f"{day_disp}_{cid}", {})

            if is_today:
                h1 = hist.get('roas', 0.0)
                h2 = hist.get('h1', 0.0)
                h3 = hist.get('h2', 0.0)
                h4 = hist.get('h3', 0.0)
                h5 = hist.get('h4', 0.0)
                h6 = hist.get('h5', 0.0)
                h7 = hist.get('h6', 0.0)
            else:
                h1 = hist.get('h1', 0.0)
                h2 = hist.get('h2', 0.0)
                h3 = hist.get('h3', 0.0)
                h4 = hist.get('h4', 0.0)
                h5 = hist.get('h4', 0.0)
                h6 = hist.get('h5', 0.0)
                h7 = hist.get('h6', 0.0)

            sp = c.get('app_id') or c.get('name')
            email_field = get_app_email(sp, email_map)

            rows.append({
                'row': [
                    day_disp, c['app_id'], email_field, c['name'], c['insight'], cid, c['account_name'],
                    c['status'], round(c['budget'], 2), round(cost, 2), round(current_roas, 4),
                    round(h1, 4), round(h2, 4), round(h3, 4), round(h4, 4), round(h5, 4), round(h6, 4), round(h7, 4)
                ],
                'raw_time': dt['raw_time'],
                'cost': cost
            })

    rows.sort(key=lambda r: (r['raw_time'], r['cost']), reverse=True)
    return [headers] + [r['row'] for r in rows]

def build_fb_campaign_data(camp_map, adjust_by_camp, dates_info, email_map=None):
    tz = timezone(timedelta(hours=7))
    now_str = datetime.now(tz).strftime('%H:%M:%S')
    headers = [
        'Date', 'Mã SP', 'Email', 'Campaign name', 'Insight', 'Campaign id', 'Account name',
        'Campaign status', 'Budget', 'Total Cost', 'Mobile App Install', 'CPI', 'ROAS',
        'ROAS D-1', 'ROAS D-2', 'Rev D0', 'Time kéo'
    ]
    rows = []

    for dt in dates_info:
        day_str = dt['str']
        day_disp = dt['display']
        m1_str = dt['minus1_str']
        m2_str = dt['minus2_str']

        for cid, c in camp_map.items():
            cost = c['cost'].get(day_str, 0.0)
            inst = c['installs'].get(day_str, 0)
            rev = adjust_by_camp.get(cid, {}).get(day_str, 0.0)

            cost_d1 = c['cost'].get(m1_str, 0.0)
            rev_d1 = adjust_by_camp.get(cid, {}).get(m1_str, 0.0)

            cost_d2 = c['cost'].get(m2_str, 0.0)
            rev_d2 = adjust_by_camp.get(cid, {}).get(m2_str, 0.0)

            if cost == 0 and inst == 0 and rev == 0:
                continue

            cpi = (cost / inst) if inst > 0 else 0.0
            roas = (rev / cost) if cost > 0 else 0.0
            roas_d1 = (rev_d1 / cost_d1) if cost_d1 > 0 else 0.0
            roas_d2 = (rev_d2 / cost_d2) if cost_d2 > 0 else 0.0

            sp = c.get('app_id') or c.get('name')
            email_field = get_app_email(sp, email_map)

            rows.append({
                'row': [
                    day_disp, c['app_id'], email_field, c['name'], c['insight'], cid, c['account_name'],
                    c['status'], round(c['budget'], 2), round(cost, 2), inst, round(cpi, 2),
                    round(roas, 4), round(roas_d1, 4), round(roas_d2, 4), round(rev, 2), now_str
                ],
                'raw_time': dt['raw_time'],
                'cost': cost
            })

    rows.sort(key=lambda r: (r['raw_time'], r['cost']), reverse=True)
    return [headers] + [r['row'] for r in rows]

def build_fb_country_data(camp_country_map, adjust_by_camp_country, dates_info, email_map=None):
    headers = [
        'Date', 'Mã SP', 'Email', 'Campaign name', 'Campaign id', 'Country', 'Account name', 'Insight',
        'Total Cost', 'Mobile App Install', 'CPI', 'ROAS D0', 'ROAS D-1', 'ROAS D-2', 'LTV D0'
    ]
    all_rows = []

    for dt in dates_info:
        day_str = dt['str']
        day_disp = dt['display']
        m1_str = dt['minus1_str']
        m2_str = dt['minus2_str']

        day_items = []
        for ckey, m in camp_country_map.items():
            cost = m['cost'].get(day_str, 0.0)
            inst = m['installs'].get(day_str, 0)
            rev = adjust_by_camp_country.get(ckey, {}).get(day_str, 0.0)

            cost_d1 = m['cost'].get(m1_str, 0.0)
            rev_d1 = adjust_by_camp_country.get(ckey, {}).get(m1_str, 0.0)

            cost_d2 = m['cost'].get(m2_str, 0.0)
            rev_d2 = adjust_by_camp_country.get(ckey, {}).get(m2_str, 0.0)

            if cost == 0 and inst == 0 and rev == 0:
                continue

            cpi = (cost / inst) if inst > 0 else 0.0
            roas_d0 = (rev / cost) if cost > 0 else 0.0
            ltv_d0 = (rev / inst) if inst > 0 else 0.0

            roas_d1 = (rev_d1 / cost_d1) if cost_d1 > 0 else 0.0
            roas_d2 = (rev_d2 / cost_d2) if cost_d2 > 0 else 0.0

            sp = m.get('app_id') or m.get('name')
            email_field = get_app_email(sp, email_map)

            day_items.append({
                'row': [
                    day_disp, m.get('app_id', ''), email_field, m['name'], m['cid'], get_country_name(m['country']), m['account_name'], m['insight'],
                    round(cost, 2), inst, round(cpi, 2), round(roas_d0, 4), round(roas_d1, 4), round(roas_d2, 4), round(ltv_d0, 2)
                ],
                'cost': cost,
                'inst': inst,
                'rev': rev
            })

        # Sắp xếp ngày đó theo chi tiêu giảm dần (kéo full 100% không bỏ sót bất kỳ dòng nào)
        day_items.sort(key=lambda r: (r['cost'], r['inst'], r['rev']), reverse=True)
        all_rows.extend([it['row'] for it in day_items])

    return [headers] + all_rows

def build_total_country_data(app_country_map, adjust_by_app_country, dates_info, email_map=None):
    headers = [
        'Date', 'Mã SP', 'Email', 'Country', 'Total Cost', 'Mobile App Install',
        'CPI', '% CPI', 'CPI D-1', 'CPI D-2',
        'ROAS D0', 'ROAS D-1', 'ROAS D-2',
        'LTV D0', 'LTV D-1', 'LTV D-2', '% LTV'
    ]
    all_rows = []

    for dt in dates_info:
        day_str = dt['str']
        day_disp = dt['display']
        m1_str = dt['minus1_str']
        m2_str = dt['minus2_str']

        day_items = []
        for gkey, g in app_country_map.items():
            cost = g['cost'].get(day_str, 0.0)
            inst = g['installs'].get(day_str, 0)
            rev = adjust_by_app_country.get(gkey, {}).get(day_str, 0.0)

            cost_d1 = g['cost'].get(m1_str, 0.0)
            inst_d1 = g['installs'].get(m1_str, 0)
            rev_d1 = adjust_by_app_country.get(gkey, {}).get(m1_str, 0.0)

            cost_d2 = g['cost'].get(m2_str, 0.0)
            inst_d2 = g['installs'].get(m2_str, 0)
            rev_d2 = adjust_by_app_country.get(gkey, {}).get(m2_str, 0.0)

            if cost == 0 and inst == 0 and rev == 0:
                continue

            cpi = (cost / inst) if inst > 0 else 0.0
            roas_d0 = (rev / cost) if cost > 0 else 0.0
            ltv_d0 = (rev / inst) if inst > 0 else 0.0

            cpi_d1 = (cost_d1 / inst_d1) if inst_d1 > 0 else 0.0
            roas_d1 = (rev_d1 / cost_d1) if cost_d1 > 0 else 0.0
            ltv_d1 = (rev_d1 / inst_d1) if inst_d1 > 0 else 0.0

            cpi_d2 = (cost_d2 / inst_d2) if inst_d2 > 0 else 0.0
            roas_d2 = (rev_d2 / cost_d2) if cost_d2 > 0 else 0.0
            ltv_d2 = (rev_d2 / inst_d2) if inst_d2 > 0 else 0.0

            pct_cpi = ((cpi - cpi_d1) / cpi_d1) if cpi_d1 > 0 else 0.0
            pct_ltv = ((ltv_d0 - ltv_d1) / ltv_d1) if ltv_d1 > 0 else 0.0

            sp = g.get('app_id')
            email_field = get_app_email(sp, email_map)

            day_items.append({
                'row': [
                    day_disp, g['app_id'], email_field, get_country_name(g['country']), round(cost, 2), inst,
                    round(cpi, 2), round(pct_cpi, 4), round(cpi_d1, 2), round(cpi_d2, 2),
                    round(roas_d0, 4), round(roas_d1, 4), round(roas_d2, 4),
                    round(ltv_d0, 2), round(ltv_d1, 2), round(ltv_d2, 2), round(pct_ltv, 4)
                ],
                'cost': cost,
                'inst': inst,
                'rev': rev
            })

        day_items.sort(key=lambda r: (r['cost'], r['inst'], r['rev']), reverse=True)
        all_rows.extend([it['row'] for it in day_items])

    return [headers] + all_rows

def build_account_status_data(accounts, account_to_bms, email_map=None, marketer_map=None, camp_map=None):
    """
    Xây dựng bảng Tình trạng account:
    - Quét toàn bộ tài khoản (Active, Disabled, Nợ tiền...)
    - Chi phí chi tiết theo từng ngày trong 2 tháng (60 ngày) qua để đối soát
    - Tổng chi tiêu trong tháng hiện tại (MTD) để quản lý budget
    - Hạn mức (Limit), Tiền nợ (Balance), Ngân sách còn lại (Remaining Budget) để tránh hết tiền tài khoản
    - Phân quyền theo Mã SP, Email, Marketer cho Looker Studio RLS
    - Cơ chế Retry 3 lần + Fallback ngày hôm nay + Fallback từ camp_map chống mất số liệu
    """
    if not accounts:
        return []

    tz = timezone(timedelta(hours=7))
    now = datetime.now(tz)
    today_str = now.strftime('%Y-%m-%d')
    first_day_of_month = now.strftime('%Y-%m-01')
    since_60d = (now - timedelta(days=60)).strftime('%Y-%m-%d')
    time_range_60d = json.dumps({'since': since_60d, 'until': today_str})
    now_str = now.strftime('%H:%M:%S')

    status_map = {
        1: '🟢 Hoạt động (ACTIVE)',
        2: '🔴 Vô hiệu hóa (DISABLED)',
        3: '🟡 Nợ tiền (UNSETTLED)',
        7: '🟠 Rà soát rủi ro (RISK)',
        8: '🟣 Chờ tất toán (PENDING)',
        9: '🟡 Ân hạn (GRACE)',
        100: '⚪ Chờ đóng (CLOSURE)',
        101: '⚪ Đã đóng (CLOSED)',
    }

    disable_reason_map = {
        0: 'Bình thường (Không vi phạm)',
        1: 'Vi phạm chính sách (POLICY)',
        2: 'Rà soát quyền sở hữu (IP REVIEW)',
        3: 'Rủi ro thanh toán (PAYMENT)',
        4: 'Tài khoản xám bị đóng (GRAY)',
        5: 'Rà soát AFC',
        6: 'Vi phạm thương mại',
        7: 'Tuân thủ DSA',
    }

    api_ver = CONFIG.get('META_API_VERSION', 'v21.0')

    def fetch_single_acc(acc):
        token = acc.get('token', CONFIG['META_TOKEN'])
        aid = acc['id']
        fields = 'id,name,account_id,account_status,disable_reason,currency,amount_spent,balance,spend_cap,created_time'
        u_acc = f"https://graph.facebook.com/{api_ver}/{aid}?fields={fields}&access_token={token}"
        meta = {}
        for attempt in range(1, 4):
            try:
                req = urllib.request.Request(u_acc, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=20) as resp:
                    meta = json.loads(resp.read().decode())
                    break
            except Exception:
                if attempt < 3:
                    time.sleep(1)
        if not meta:
            meta = acc

        u_ins = f"https://graph.facebook.com/{api_ver}/{aid}/insights?fields=spend&time_increment=1&time_range={urllib.parse.quote(time_range_60d)}&limit=1000&access_token={token}"
        daily_items = []
        for attempt in range(1, 4):
            curr_u = u_ins
            items = []
            err = False
            while curr_u:
                try:
                    req = urllib.request.Request(curr_u, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=25) as resp:
                        d = json.loads(resp.read().decode())
                        items.extend(d.get('data', []))
                        curr_u = d.get('paging', {}).get('next')
                except Exception:
                    err = True
                    break
            if not err and items:
                daily_items = items
                break
            elif attempt < 3:
                time.sleep(1.5 * attempt)

        # Fallback 1: Nếu gọi 60 ngày không ra kết quả, gọi riêng ngày hôm nay
        if not any(it.get('date_start') == today_str for it in daily_items):
            for attempt in range(1, 3):
                try:
                    u_today = f"https://graph.facebook.com/{api_ver}/{aid}/insights?fields=spend&time_range={urllib.parse.quote(json.dumps({'since': today_str, 'until': today_str}))}&access_token={token}"
                    req = urllib.request.Request(u_today, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        d_today = json.loads(resp.read().decode())
                        if d_today.get('data'):
                            sp_val = float(d_today['data'][0].get('spend', 0))
                            if sp_val > 0:
                                daily_items.append({'date_start': today_str, 'spend': str(sp_val)})
                                break
                except Exception:
                    if attempt < 2:
                        time.sleep(1)

        return meta, daily_items, account_to_bms.get(aid, [])

    with ThreadPoolExecutor(max_workers=15) as ex:
        results = list(ex.map(fetch_single_acc, accounts))

    headers = [
        'Date', 'Mã SP', 'Email', 'Marketer', 'BM', 'Account ID', 'Account Name',
        'Trạng thái', 'Lý do vi phạm', 'Chi phí ngày (USD)', 'Tiêu trong tháng (USD)',
        'Tổng tiêu 60 ngày (USD)', 'Số dư nợ (USD)', 'Hạn mức Limit (USD)',
        'Ngân sách còn lại (USD)', 'Tiền tệ', 'Ngày tạo', 'Time kéo'
    ]

    mkt_map = marketer_map or {}
    all_rows = []

    for meta, daily_items, bms in results:
        name = meta.get('name', '')
        sp = extract_app_code(name)
        email = get_app_email(sp, email_map)
        marketer = mkt_map.get(sp, 'Admin')
        st_code = meta.get('account_status', 0)
        st_text = status_map.get(st_code, f'Trạng thái {st_code}')
        dis_code = meta.get('disable_reason', 0)
        dis_text = disable_reason_map.get(dis_code, f'Mã {dis_code}')

        amt = round(float(meta.get('amount_spent', 0)) / 100.0, 2)
        bal = round(float(meta.get('balance', 0)) / 100.0, 2)
        spend_cap_val = float(meta.get('spend_cap', 0))
        limit = round(spend_cap_val / 100.0, 2) if spend_cap_val > 0 else 0.0

        if limit > 0:
            remain = round(max(0.0, limit - amt), 2)
        else:
            remain = 'Không giới hạn'

        curr = meta.get('currency', 'USD')
        aid = meta.get('account_id', meta.get('id', ''))
        created = meta.get('created_time', '')[:10]
        bm_str = ', '.join(bms)

        spend_60d = sum(float(it.get('spend', 0)) for it in daily_items)
        spend_mtd = sum(float(it.get('spend', 0)) for it in daily_items if it.get('date_start', '') >= first_day_of_month)
        day_map = {it['date_start']: float(it.get('spend', 0)) for it in daily_items}

        today_spend = day_map.get(today_str, 0.0)

        # Fallback 2: Đối soát với camp_map (dữ liệu chi tiết campaign đã quét trước đó)
        aid_clean = str(aid).replace('act_', '').strip()
        camp_today_spend = 0.0
        if camp_map:
            for cid, c in camp_map.items():
                c_acc = str(c.get('account_id', '')).replace('act_', '').strip()
                if c_acc == aid_clean:
                    camp_today_spend += c.get('cost', {}).get(today_str, 0.0)

        if camp_today_spend > today_spend:
            diff = camp_today_spend - today_spend
            today_spend = camp_today_spend
            spend_mtd += diff
            spend_60d += diff

        # Hôm nay luôn luôn có mặt (kể cả chưa tiêu gì để xem trạng thái và budget còn lại)
        all_rows.append({
            'row': [
                today_str, sp, email, marketer, bm_str, aid, name,
                st_text, dis_text, round(today_spend, 2),
                round(spend_mtd, 2), round(spend_60d, 2),
                bal, limit if limit > 0 else 'Không giới hạn', remain,
                curr, created, now_str
            ],
            'date': today_str,
            'spend': today_spend,
            'spend_60d': spend_60d
        })

        # Các ngày quá khứ có phát sinh chi phí
        for day, spend in day_map.items():
            if day != today_str and spend > 0:
                all_rows.append({
                    'row': [
                        day, sp, email, marketer, bm_str, aid, name,
                        st_text, dis_text, round(spend, 2),
                        round(spend_mtd, 2), round(spend_60d, 2),
                        bal, limit if limit > 0 else 'Không giới hạn', remain,
                        curr, created, now_str
                    ],
                    'date': day,
                    'spend': spend,
                    'spend_60d': spend_60d
                })

    all_rows.sort(key=lambda r: (r['date'], r['spend']), reverse=True)
    return [headers] + [r['row'] for r in all_rows]

# ==================== 4. GỬI DỮ LIỆU LÊN GOOGLE SHEET ====================
def send_to_google_sheet(payload, webhook_url, bm_name):
    if not webhook_url:
        print(f"⚠️ Chưa điền Webhook URL cho {bm_name}!", flush=True)
        return False

    url = webhook_url
    sheet_order = [
        ('hourly', 'Hourly'),
        ('fbCampaign', 'FB Campaign'),
        ('totalCountry', 'Total Country'),
        ('fbCountry', 'FB Country'),
        ('cutoff', 'CutOff'),
        ('accountStatus', 'Tình trạng account'),
        ('phanQuyen', 'PhanQuyen')
    ]

    for sheet_key, sheet_name in sheet_order:
        if sheet_key in payload and len(payload[sheet_key]) > 0:
            rows = payload[sheet_key]
            # KÉO FULL 100% DỮ LIỆU - KHÔNG BỎ 1 DÒNG NÀO HẾT
            print(f"🚀 [{bm_name}] Đang gửi {sheet_name} (FULL {len(rows) - 1} dòng) lên Google Sheet...", flush=True)
            t0 = time.time()
            data_bytes = json.dumps({sheet_key: rows}).encode('utf-8')
            req = urllib.request.Request(url, data=data_bytes, headers={'Content-Type': 'application/json'})
            sent_ok = False
            for send_attempt in range(1, 4):
                try:
                    with urllib.request.urlopen(req, timeout=600) as resp:
                        res_text = resp.read().decode('utf-8')
                        if 'success' in res_text or 'Web App Receiver' in res_text:
                            print(f"✅ [{bm_name}] {sheet_name} đã cập nhật thành công FULL {len(rows) - 1} dòng ({time.time() - t0:.2f}s)!", flush=True)
                            sent_ok = True
                            break
                        else:
                            print(f"⚠️ [{bm_name}] Google Webhook trả về lỗi cho {sheet_name}: {res_text[:200]}", flush=True)
                except Exception as e:
                    print(f"⚠️ [{bm_name}] Lần {send_attempt} gửi {sheet_name} thất bại: {e}", flush=True)
                    if send_attempt < 3:
                        time.sleep(3 * send_attempt)
            if not sent_ok:
                print(f"❌ [{bm_name}] Không thể gửi {sheet_name} sau 3 lần thử!", flush=True)
    return True

# ==================== MAIN RUNNER ====================
def run_sync():
    total_start = time.time()
    print("=" * 65, flush=True)
    print("⚡ BẮT ĐẦU ĐỒNG BỘ ADS & ADJUST ĐA BM (MULTI-THREADING V6)", flush=True)
    print("=" * 65, flush=True)

    dates_info = get_dates_info(CONFIG['DAYS_TO_SHOW'])
    if CONFIG.get('FETCH_COMPARE_DAYS', True):
        oldest_date = dates_info[-1]['minus2_str']
    else:
        oldest_date = dates_info[-1]['str']
    newest_date = dates_info[0]['str']
    print(f"📅 Khoảng thời gian: {oldest_date} -> {newest_date}", flush=True)

    # 0. Lấy danh sách mã SP chuẩn từ bảng Validate trước để lọc đúng Account
    validate_webhook = PRIMARY_WEBHOOK_URL
    v_apps, v_marketers, v_names, v_admins, v_leaders, v_employees, email_map = fetch_validate_from_sheet(validate_webhook)
    if not email_map:
        email_map = {}

    # 1. Kéo Meta Accounts theo từng BM (chỉ lấy các account thuộc Validate)
    t0 = time.time()
    bm_accounts, unique_accounts, account_to_bms = get_meta_accounts_by_bm(tracked_apps=v_apps)
    print(f"✅ Đã quét {len(unique_accounts)} tài khoản Meta duy nhất qua {len(bm_accounts)} BM ({time.time() - t0:.2f}s)", flush=True)

    t1 = time.time()
    camp_map, camp_to_app, camp_to_bms, active_accounts = fetch_campaign_insights(unique_accounts, oldest_date, newest_date, account_to_bms)
    print(f"✅ Đã kéo {len(camp_map)} chiến dịch từ {len(active_accounts)} tài khoản active ({time.time() - t1:.2f}s)", flush=True)

    # 2. Kéo Budget & Status
    t2 = time.time()
    fetch_campaign_budgets(active_accounts, camp_map)
    print(f"✅ Đã cập nhật Budget & Status ({time.time() - t2:.2f}s)", flush=True)

    # 3. Kéo Adjust CSV
    t3 = time.time()
    adj_by_camp, adj_by_camp_country, adj_by_app_country_by_bm, total_adj_by_app_country = fetch_adjust_data(oldest_date, newest_date, camp_to_app, camp_to_bms)
    print(f"✅ Đã kéo Adjust CSV doanh thu & ROAS ({time.time() - t3:.2f}s)", flush=True)

    # 4. Kéo Meta Country Breakdown
    t4 = time.time()
    app_country_map_by_bm, camp_country_map, total_app_country_map = fetch_meta_country_breakdowns(active_accounts, oldest_date, newest_date, account_to_bms)
    print(f"✅ Đã quét xong quốc gia (Total Country & FB Country) ({time.time() - t4:.2f}s)", flush=True)

    # 4.5. Xây dựng bảng App Report (Báo Cáo Tổng Hợp Theo App)
    t_app = time.time()
    meta_spend_map = {}
    for cid, cdata in camp_map.items():
        sp = cdata.get('app_id') or extract_product_code(cdata.get('name', ''))
        if not sp:
            continue
        for day, cost in cdata.get('cost', {}).items():
            key = (day, sp)
            meta_spend_map[key] = meta_spend_map.get(key, 0.0) + cost
    save_spend_cache(META_SPEND_FILE, meta_spend_map)

    phan_quyen_table = build_permissions_table(validate_webhook)
    print(f"✅ Đã tạo bảng PhanQuyen RLS ({len(phan_quyen_table) - 1} dòng) cho Looker Studio", flush=True)

    adjust_app_data, known_apps = fetch_adjust_app_network_data(oldest_date, newest_date, CONFIG['ADJUST_TOKEN'])
    app_table = build_app_report_table(dates_info, adjust_app_data, known_apps, meta_spend_map=meta_spend_map, webhook_url=validate_webhook)
    print(f"✅ Đã xây dựng bảng App Report ({len(app_table) - 1} dòng) ({time.time() - t_app:.2f}s)", flush=True)

    total_sec = time.time() - total_start
    print("=" * 65, flush=True)
    print(f"🎉 TỔNG THỜI GIAN KÉO & XỬ LÝ: {total_sec:.2f} GIÂY!", flush=True)
    print("=" * 65, flush=True)

    # 5. Xây dựng toàn bộ dữ liệu hợp nhất cho TẤT CẢ các System User / BM về chung 1 Sheet đang dùng
    print(f"\n📦 === ĐANG XÂY DỰNG DỮ LIỆU TỔNG HỢP CHO TẤT CẢ BM / SYSTEM USER ===", flush=True)
    print(f"   - Tổng số campaign active: {len(camp_map)}", flush=True)
    print(f"   - Tổng số tài khoản quảng cáo: {len(unique_accounts)}", flush=True)

    hourly_table = build_hourly_data(camp_map, adj_by_camp, dates_info, email_map=email_map)
    fb_camp_table = build_fb_campaign_data(camp_map, adj_by_camp, dates_info, email_map=email_map)
    fb_country_table = build_fb_country_data(camp_country_map, adj_by_camp_country, dates_info, email_map=email_map)
    total_country_table = build_total_country_data(total_app_country_map, total_adj_by_app_country, dates_info, email_map=email_map)
    account_status_table = build_account_status_data(unique_accounts, account_to_bms, email_map=email_map, marketer_map=v_marketers, camp_map=camp_map)

    print(f"   - Hourly: {len(hourly_table) - 1} dòng", flush=True)
    print(f"   - FB Campaign: {len(fb_camp_table) - 1} dòng", flush=True)
    print(f"   - FB Country: {len(fb_country_table) - 1} dòng", flush=True)
    print(f"   - Total Country: {len(total_country_table) - 1} dòng", flush=True)
    print(f"   - CutOff: {len(app_table) - 1} dòng", flush=True)
    print(f"   - PhanQuyen: {len(phan_quyen_table) - 1} dòng", flush=True)
    print(f"   - Tình trạng account: {len(account_status_table) - 1} dòng", flush=True)

    payload_main = {
        'hourly': hourly_table,
        'fbCampaign': fb_camp_table,
        'fbCountry': [fb_country_table[0]] if fb_country_table else [],
        'totalCountry': total_country_table,
        'cutoff': app_table,
        'accountStatus': account_status_table,
        'phanQuyen': phan_quyen_table
    }

    send_to_google_sheet(payload_main, PRIMARY_WEBHOOK_URL, "Sheet Chính (9 Bảng Nhẹ)")

    if FB_COUNTRY_WEBHOOK_URL and FB_COUNTRY_WEBHOOK_URL != PRIMARY_WEBHOOK_URL:
        payload_country = {
            'fbCountry': fb_country_table,
            'phanQuyen': phan_quyen_table
        }
        send_to_google_sheet(payload_country, FB_COUNTRY_WEBHOOK_URL, "Sheet Riêng FB Country (Báo cáo Ads - BM AG)")

if __name__ == '__main__':
    run_sync()
