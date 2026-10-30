#!/usr/bin/env bash
# Instala (ou atualiza) o Escritório dos Agentes no servidor do n8n, atrás do Traefik que já atende o n8n.
#
# Uso, dentro da pasta do projeto no servidor:
#   sudo bash instalar.sh
#
# O script descobre sozinho o container do Traefik, a rede dele, o certificado (certresolver) e a entrada HTTPS.
# Ele só pergunta o que é segredo: a chave secreta do Supabase do Cérebro e a senha do login (nada aparece na tela
# nem fica no histórico; a senha vira hash). Rodar de novo atualiza a instalação e mantém o .env.
set -euo pipefail

cd "$(dirname "$0")"
DOMINIO_PADRAO="escritorio.f2jsolucoes.com.br"
SUPABASE_URL_PADRAO="https://oirauknhixnwikvffzff.supabase.co"

ok() { printf '\033[32m✔\033[0m %s\n' "$*"; }
info() { printf '\033[36m•\033[0m %s\n' "$*"; }
falha() { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || falha "Docker não encontrado."
docker compose version >/dev/null 2>&1 || falha "Docker Compose v2 não encontrado (docker compose)."

# ---------------------------------------------------------------- Traefik
TRAEFIK=$(docker ps --format '{{.Names}} {{.Image}}' | awk 'tolower($2) ~ /traefik/ {print $1; exit}')
[ -n "$TRAEFIK" ] || falha "Nenhum container do Traefik rodando. Veja INSTALAR-NO-SERVIDOR.md (Nginx)."
ok "Traefik: $TRAEFIK"

REDE=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' "$TRAEFIK" | grep -v '^$' | grep -vx 'host' | head -n1)
[ -n "$REDE" ] || falha "Não achei a rede do Traefik."
ok "Rede do Traefik: $REDE"

ARGS=$(docker inspect -f '{{range .Args}}{{.}}{{"\n"}}{{end}}{{range .Config.Cmd}}{{.}}{{"\n"}}{{end}}' "$TRAEFIK" 2>/dev/null || true)
CERT=$(printf '%s\n' "$ARGS" | sed -n 's/.*--certificatesresolvers\.\([^.=]*\)\..*/\1/p' | head -n1)
ENTRADA=$(printf '%s\n' "$ARGS" | sed -n 's/.*--entrypoints\.\([^.=]*\)\.address=:443.*/\1/p' | head -n1)
CERT=${CERT:-mytlschallenge}
ENTRADA=${ENTRADA:-websecure}
ok "Certificado: $CERT   Entrada HTTPS: $ENTRADA"

# ---------------------------------------------------------------- .env
touch .env
chmod 600 .env
valor() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- || true; }
definir() {
  local chave="$1" val="$2"
  if grep -qE "^$chave=" .env; then
    local tmp; tmp=$(mktemp)
    grep -vE "^$chave=" .env > "$tmp"; cat "$tmp" > .env; rm -f "$tmp"
  fi
  printf '%s=%s\n' "$chave" "$val" >> .env
}

[ -n "$(valor CEREBRO_SUPABASE_URL)" ] || definir CEREBRO_SUPABASE_URL "$SUPABASE_URL_PADRAO"

if [ -z "$(valor CEREBRO_SUPABASE_KEY)" ]; then
  echo
  info "Cole a chave SECRETA do Supabase do Cérebro (Project Settings › API Keys › secret ou service_role)."
  read -r -s -p "  Chave (não aparece na tela): " KEY; echo
  [ -n "$KEY" ] || falha "Chave vazia."
  definir CEREBRO_SUPABASE_KEY "$KEY"
  unset KEY
fi

if [ -z "$(valor ESCRITORIO_DOMINIO)" ]; then
  read -r -p "  Endereço do escritório [$DOMINIO_PADRAO]: " DOM
  definir ESCRITORIO_DOMINIO "${DOM:-$DOMINIO_PADRAO}"
fi

if [ -z "$(valor HABBLAUD_REMOTE_USER)" ]; then
  read -r -p "  Usuário do login [ildefonso]: " USU
  definir HABBLAUD_REMOTE_USER "${USU:-ildefonso}"
fi

if [ -z "$(valor HABBLAUD_REMOTE_PASSWORD_HASH)" ]; then
  echo
  read -r -s -p "  Senha do login (mínimo 10 caracteres, não aparece): " S1; echo
  read -r -s -p "  Repita a senha: " S2; echo
  [ "$S1" = "$S2" ] || falha "As senhas não conferem."
  [ "${#S1}" -ge 10 ] || falha "Use pelo menos 10 caracteres."
  HASH=$(printf '%s' "$S1" | docker run --rm -i node:24-alpine node -e '
    const { randomBytes, scryptSync } = require("crypto");
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const salt = randomBytes(16);
      const k = scryptSync(s.normalize("NFC"), salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 256 * 2 ** 15 * 8 });
      process.stdout.write("scrypt:15:8:1:" + salt.toString("base64url") + ":" + k.toString("base64url"));
    });')
  unset S1 S2
  [ -n "$HASH" ] || falha "Não consegui gerar o hash da senha."
  definir HABBLAUD_REMOTE_PASSWORD_HASH "$HASH"
fi

definir TRAEFIK_REDE "$REDE"
definir TRAEFIK_CERT "$CERT"
definir TRAEFIK_ENTRYPOINT "$ENTRADA"
ok ".env pronto (permissão só do dono)."

# ---------------------------------------------------------------- subir
echo
info "Construindo e subindo (a primeira vez leva alguns minutos)…"
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build

info "Esperando o escritório responder…"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$(valor ESCRITORIO_PORTA_LOCAL | grep . || echo 4747)/api/health" >/dev/null 2>&1; then
    ok "Escritório no ar."
    break
  fi
  sleep 2
done

if docker logs escritorio-agentes 2>&1 | grep -q 'Cérebro: conectado'; then
  ok "Conectado ao banco do Cérebro."
else
  info "Ainda sem 'Cérebro: conectado' no log. Veja com: docker logs -f escritorio-agentes"
fi

DOM=$(valor ESCRITORIO_DOMINIO)
IP_DOM=$(getent hosts "$DOM" 2>/dev/null | awk '{print $1; exit}' || true)
echo
if [ -z "$IP_DOM" ]; then
  info "O endereço $DOM ainda não existe no DNS. Crie o registro A apontando para o IP deste servidor (no Cloudflare, sem a nuvem laranja)."
else
  ok "DNS: $DOM -> $IP_DOM"
fi
echo
ok "Pronto. Abra https://$DOM e entre com o usuário $(valor HABBLAUD_REMOTE_USER)."
