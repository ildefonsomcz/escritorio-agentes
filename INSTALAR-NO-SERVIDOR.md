# Escritório dos Agentes — instalar no servidor do n8n

O escritório em pixel art dos agentes do n8n (Manu, Scooby, Jorge, Dafne, Salsicha, Fred e os SDRs). Ele lê o banco do
Cérebro a cada 3 segundos e mostra quem está trabalhando agora, o que cada um fez no dia, tokens e custo em R$.

Baseado no [Habblaud](https://github.com/marmottajr/habblaud) (MIT, Márcio Junior). A licença original está em `LICENSE`.

## O que precisa no servidor

- Docker com Compose v2 (o mesmo que já roda o n8n serve).
- Um subdomínio apontado para o servidor, por exemplo `escritorio.f2jsolucoes.com.br`.
- A chave secreta do Supabase do Cérebro (Project Settings › API › `service_role` ou `sb_secret_...`).

## Jeito rápido (servidor da F2J, com Traefik)

```bash
git clone https://github.com/ildefonsomcz/escritorio-agentes && cd escritorio-agentes
sudo bash instalar.sh
```

O `instalar.sh` acha o Traefik, a rede e o certificado sozinho, pergunta só a chave secreta do Supabase e a senha do
login (sem mostrar na tela), monta o `.env` e sobe tudo. Falta só o registro DNS A de `escritorio.f2jsolucoes.com.br`
para o IP do servidor (no Cloudflare, sem a nuvem laranja). Para atualizar depois: `git pull && sudo bash instalar.sh`.

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

**Servidor da F2J (Traefik):** o n8n.f2jsolucoes.com.br está atrás de um Traefik em Docker (as requisições chegam
com `x-forwarded-server` = id de container e `x-real-ip`, que é o padrão do Traefik). É o modelo oficial de
docker-compose do n8n, com certresolver `mytlschallenge` e entrypoint `websecure`.

```bash
# 1. no painel de DNS, crie o registro A de escritorio.f2jsolucoes.com.br com o mesmo IP do n8n
# 2. descubra a rede do Traefik
docker ps --format '{{.Names}}' | grep -i traefik
docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' <nome-do-container-do-traefik>
# 3. ponha essa rede em TRAEFIK_REDE no .env e suba com os rótulos
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

Se o certresolver do seu Traefik tiver outro nome, ajuste `TRAEFIK_CERT` (veja com
`docker inspect <traefik> | grep certificatesresolvers`).

No EasyPanel/Coolify também dá para criar um app direto do repositório (build pelo `Dockerfile`), porta interna 4748,
com o domínio acima e as mesmas variáveis do `.env.exemplo` (mais `HABBLAUD_REMOTE_INSECURE_HTTP=1` e
`HABBLAUD_REMOTE_ALLOW=none`).

## Agente novo

Cadastre o agente em `cerebro.agentes` (slug, nome, domínio) e preencha `config.escritorio`:

```json
{ "sala": "Sala do Novo", "tipo": "sala", "ordem": 30, "papel": "O que ele faz", "visual": "f" }
```

- `sala`: agentes com a mesma sala dividem o cômodo; sala nova = cômodo novo, criado sozinho.
- `tipo`: `sala` (padrão), `restaurante` (balcão, cozinha e salão), `cowork` (fica no meio da casa) ou `gerencia`
  (sala da gerente geral: mesa executiva, mesa de reunião e placa; fica perto da entrada, logo depois do
  restaurante). Trocar o `tipo` de uma sala existente redesenha a sala sozinho, em até 3 segundos.
- `ordem`: posição no prédio (menor = mais perto da entrada).
- `posto`: lugar fixo dentro da sala (`balcao` e `cozinha` no restaurante).
- `visual`: `f` ou `m`.
- `colabora_com`: `{ "dafne": ["paralelo", "synnapse"] }` — quando uma ferramenta com essas palavras é usada, a
  colega aparece ajudando.

A Manu (gerente geral) fica na gerência:

```json
{ "sala": "Diretoria", "tipo": "gerencia", "ordem": 5, "papel": "Gerente geral", "visual": "f" }
```

**Chamado da gerente:** quando a Manu delega uma tarefa, o n8n grava em `cerebro.execucoes_ao_vivo` uma execução
**do agente chamado** com `gatilho = 'pedido da Manu'` (maiúsculas e acentos não importam), `canal = 'api'` e
`resumo` = o pedido. Ao vivo, a Manu mostra "Chamou o Scooby: <pedido>", o agente vai até a gerência, ouve a
instrução por uns 7 segundos e volta para a mesa dele, onde fica trabalhando até a interação com o mesmo
`n8n_execution_id` chegar (ou 5 minutos sem fim registrado). Vale para qualquer agente cujo nome ou slug esteja no
gatilho e que esteja numa sala `gerencia` (ou tenha o slug `manu`). Execuções da carga inicial ou com mais de 2
minutos não chamam ninguém. Diferente de "pedido do Salsicha", o pedido da gerente não termina quando a própria Manu
termina o turno dela.

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

O exemplo agenda pedidos da Manu a cada minuto, a partir de 20 s depois de gerar o arquivo (`--chamado-em=60` para
começar depois de 1 minuto, `--sem-chamados` para desligar): o servidor só lê do arquivo o que já aconteceu, então
cada chamado aparece ao vivo.
