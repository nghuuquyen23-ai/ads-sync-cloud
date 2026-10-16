#!/bin/bash
cd "$(dirname "$0")"
echo "🚀 Đang khởi động Bảng Điều Khiển Campaign & Looker Studio tại http://localhost:8505 ..."
(sleep 1 && open "http://localhost:8505") &
python3 campaign_control_server.py
