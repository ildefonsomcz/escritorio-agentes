#!/usr/bin/env bash
# Roda o Escritório dos Agentes no seu computador (sem Docker), lendo o banco do Cérebro ao vivo.
#
#   bash iniciar-local.sh            -> dados reais (pede a chave secreta do Supabase na 1ª vez, sem mostrar)
#   bash iniciar-local.sh --exemplo  -> dados de exemplo, sem banco
#
# Abre em http://localhost:4747 (só este computador acessa; sem login). Ctrl+C para parar.
set -euo pipefail
cd "$(dirname "$0")"

PORTA=${PORTA:-4747}
ENV_LOCAL=.env.local

command -v node >/dev/null || { echo "Instale o Node.js 22.12 ou mais novo (https://nodejs.org)."; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)' \
  || { echo "Node.js $(node -v) é antigo: precisa do 22.12 ou mais novo."; exit 1; }

if [ ! -d node_modules ]; then echo "• Instalando dependências…"; npm install --no-audit --no-fund; fi
echo "• Compilando…"
npm run build >/dev/null

export HABBLAUD_SOURCE=cerebro HABBLAUD_PORT="$PORTA" HABBLAUD_HOST=127.0.0.1 HABBLAUD_DATA_DIR="$PWD/.dados-local" \
  HABBLAUD_WORLD=0 HABBLAUD_UPDATE_CHECK=0 HABBLAUD_CODEX=0 TZ="${TZ:-America/Maceio}"

if [ "${1:-}" = "--exemplo" ]; then
  node scripts/cerebro-fixture.mjs > .dados-exemplo.json
  export CEREBRO_FIXTURE="$PWD/.dados-exemplo.json"
  echo "• Usando dados de EXEMPLO."
else
  touch "$ENV_LOCAL"; chmod 600 "$ENV_LOCAL"
  # shellcheck disable=SC1090
  set -a; . "./$ENV_LOCAL"; set +a
  export CEREBRO_SUPABASE_URL="${CEREBRO_SUPABASE_URL:-https://oirauknhixnwikvffzff.supabase.co}"
  if [ -z "${CEREBRO_SUPABASE_KEY:-}" ]; then
    echo "Cole a chave SECRETA do Supabase do Cérebro (Project Settings › API Keys › secret ou service_role)."
    read -r -s -p "Chave (não aparece na tela): " CEREBRO_SUPABASE_KEY; echo
    [ -n "$CEREBRO_SUPABASE_KEY" ] || { echo "Chave vazia."; exit 1; }
    printf 'CEREBRO_SUPABASE_URL=%s\nCEREBRO_SUPABASE_KEY=%s\n' "$CEREBRO_SUPABASE_URL" "$CEREBRO_SUPABASE_KEY" > "$ENV_LOCAL"
    export CEREBRO_SUPABASE_KEY
    echo "• Chave guardada em $ENV_LOCAL (só neste computador, fora do git)."
  fi
fi

echo
echo "✔ Escritório em http://localhost:$PORTA   (Ctrl+C para parar)"
( sleep 3; command -v open >/dev/null && open "http://localhost:$PORTA" ) >/dev/null 2>&1 &
exec node dist/server/index.js
