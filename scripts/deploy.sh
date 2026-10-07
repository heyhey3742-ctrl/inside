#!/usr/bin/env bash
# 一鍵部署兩個網站到 Netlify（需要環境變數 NETLIFY_AUTH_TOKEN）
#   bash scripts/deploy.sh          → 第一次：建立網站＋設定環境變數＋部署
#   bash scripts/deploy.sh update   → 之後：只重新部署
set -euo pipefail
cd "$(dirname "$0")/.."
: "${NETLIFY_AUTH_TOKEN:?請先設定 NETLIFY_AUTH_TOKEN}"
NL="npx --yes netlify-cli@17"
STATE=.netlify-sites   # 記錄兩個網站的 site id（不進 git）

declare -A NAME=( [cafe]="hj-cafe-booking" [hj]="hourjungle-booking" )

for SITE in cafe hj; do
  ID=$(grep "^$SITE=" $STATE 2>/dev/null | cut -d= -f2 || true)
  if [ -z "$ID" ]; then
    echo "▶ 建立網站：${NAME[$SITE]}"
    ID=$($NL api createSite --data "{\"body\":{\"name\":\"${NAME[$SITE]}-$RANDOM\"}}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
    echo "$SITE=$ID" >> $STATE
    PW=$(node -e 'console.log(require("crypto").randomBytes(6).toString("base64url"))')
    NETLIFY_SITE_ID="$ID" $NL env:set SITE "$SITE" >/dev/null
    NETLIFY_SITE_ID="$ID" $NL env:set ADMIN_PASSWORD "$PW" >/dev/null
    echo "  後台密碼：$PW（請記下來，之後可在 Netlify 環境變數修改）"
  fi
  echo "▶ 部署 $SITE（$ID）"
  SITE="$SITE" $NL deploy --prod --dir public --functions netlify/functions --site "$ID" --message "deploy $SITE" | grep -E "Website URL|Unique deploy URL|Deploy is live" || true
done
