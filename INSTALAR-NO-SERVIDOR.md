# Escritório dos Agentes — instalar no servidor do n8n

O escritório em pixel art dos agentes do n8n (Scooby, Jorge, Dafne, Salsicha, Fred e os SDRs). Ele lê o banco do
Cérebro a cada 3 segundos e mostra quem está trabalhando agora, o que cada um fez no dia, tokens e custo em R$.

Baseado no [Habblaud](https://github.com/marmottajr/habblaud) (MIT, Márcio Junior). A licença original está em `LICENSE`.

## O que precisa no servidor

- Docker com Compose v2 (o mesmo que já roda o n8n serve).
- Um subdomínio apontado para o servidor, por exemplo `escritorio.f2jsolucoes.com.br`.
- A chave secreta do Supabase do Cérebro (Project Settings › API › `service_role` ou `sb_secret_...`).

## Passo a passo

```bash
# 1. pegar o código (pasta escritorio-agentes)
cd /opt && git clone <repositório> escritorio-agentes && cd escritorio-agentes

# 2. configurar
cp .env.exemplo .env
nano .env                     # CEREBRO_SUPABASE_KEY, ESCRITORIO_DOMINIO e HABBLAUD_REMOTE_USER
node scripts/gerar-senha.mjs  # cole a linha HABBLAUD_REMOTE_PASSWORD_HASH=... no .env
#   (sem Node no servidor: docker run --rm -it -v "$PWD/scripts:/s" node:24-alpine node /s/gerar-senha.mjs)

# 3. subir
docker compose up -d --build
docker compose logs -f        # deve aparecer "Cérebro: conectado."
curl -s http://127.0.0.1:4747/api/health
```

## Publicar com HTTPS no proxy do servidor

As portas ficam presas ao `127.0.0.1`. O proxy que já atende o n8n publica a porta **4748** (a que pede login).
O escritório usa uma conexão contínua (SSE), então o proxy não pode guardar a resposta em buffer.

Nginx:

```nginx
server {
  server_name escritorio.f2jsolucoes.com.br;
  location / {
    proxy_pass http://127.0.0.1:4748;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
  # listen 443 ssl; + certificados (certbot --nginx -d escritorio.f2jsolucoes.com.br)
}
```

Traefik / EasyPanel / Coolify: crie um serviço apontando para `escritorio-agentes:4748` (ou `127.0.0.1:4748`) com o
domínio acima e HTTPS automático. Mantenha o cabeçalho `Host` original.

## Agente novo

Cadastre o agente em `cerebro.agentes` (slug, nome, domínio) e preencha `config.escritorio`:

```json
{ "sala": "Sala do Novo", "tipo": "sala", "ordem": 30, "papel": "O que ele faz", "visual": "f" }
```

- `sala`: agentes com a mesma sala dividem o cômodo; sala nova = cômodo novo, criado sozinho.
- `tipo`: `sala` (padrão), `restaurante` (balcão, cozinha e salão) ou `cowork` (fica no meio da casa).
- `ordem`: posição no prédio (menor = mais perto da entrada).
- `posto`: lugar fixo dentro da sala (`balcao` e `cozinha` no restaurante).
- `visual`: `f` ou `m`.
- `colabora_com`: `{ "dafne": ["paralelo", "synnapse"] }` — quando uma ferramenta com essas palavras é usada, a
  colega aparece ajudando.

No n8n, o fluxo do agente precisa do nó **Log Cerebro - Inicio** logo depois do gatilho (chama o subfluxo
"CEREBRO - Registrar Inicio") para o personagem começar a trabalhar na hora em que a mensagem chega.

## Atualizar

```bash
git pull && docker compose up -d --build
```

## Desenvolvimento sem banco

```bash
npm install
node scripts/cerebro-fixture.mjs > /tmp/cerebro.json
CEREBRO_FIXTURE=/tmp/cerebro.json npm run dev     # http://127.0.0.1:4747
```
