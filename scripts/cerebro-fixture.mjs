// Gera um estado de exemplo do Cérebro (mesmo formato da RPC cerebro_escritorio_estado) para desenvolver sem banco.
// Uso: node scripts/cerebro-fixture.mjs > /tmp/cerebro.json  e  CEREBRO_FIXTURE=/tmp/cerebro.json npm run dev
// Com --rodando=<slug,slug>, esses agentes aparecem trabalhando (execução aberta agora).
const args = process.argv.slice(2);
const rodando = (args.find((a) => a.startsWith('--rodando='))?.split('=')[1] ?? 'scooby,salsicha,sdr-hefx').split(',').filter(Boolean);
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const agentes = [
  { slug: 'scooby', nome: 'Scooby', dominio: 'Restaurante', status: 'ativo', cor: '#F59E0B', escritorio: { sala: 'Restaurante', tipo: 'restaurante', ordem: 0, papel: 'Atendente do restaurante', posto: 'balcao', visual: 'm' } },
  { slug: 'jorge', nome: 'Jorge Estoquista', dominio: 'Restaurante', status: 'ativo', cor: '#F97316', escritorio: { sala: 'Restaurante', tipo: 'restaurante', ordem: 0, papel: 'Estoque do restaurante', posto: 'cozinha', visual: 'm' } },
  { slug: 'dafne', nome: 'Dafne', dominio: 'Synapse', status: 'ativo', cor: '#8B5CF6', escritorio: { sala: 'Co-work', tipo: 'cowork', ordem: 50, papel: 'Projetos e horas (Synapse)', visual: 'f' } },
  { slug: 'salsicha', nome: 'Salsicha', dominio: 'Financeiro', status: 'ativo', cor: '#10B981', escritorio: { sala: 'Co-work', tipo: 'cowork', ordem: 50, papel: 'Financeiro e CRM (FinERP)', visual: 'm', colabora_com: { dafne: ['paralelo', 'synnapse'] } } },
  { slug: 'fred', nome: 'Fred', dominio: 'F2J', status: 'ativo', cor: '#3B82F6', escritorio: { sala: 'Sala do Fred', tipo: 'sala', ordem: 10, papel: 'Assistente da F2J', visual: 'm' } },
  { slug: 'sdr-synnapse', nome: 'SDR Synnapse', dominio: 'Synapse', status: 'ativo', cor: '#EC4899', escritorio: { sala: 'Comercial Synnapse', tipo: 'sala', ordem: 20, papel: 'SDR do site Synnapse', visual: 'f' } },
  { slug: 'sdr-tokin', nome: 'SDR Tokin', dominio: 'Tokin', status: 'ativo', cor: '#0EA5E9', escritorio: { sala: 'Comercial Tokin', tipo: 'sala', ordem: 21, papel: 'SDR do site Tokin', visual: 'm' } },
  { slug: 'sdr-hefx', nome: 'SDR HEFX', dominio: 'HEFX', status: 'ativo', cor: '#14B8A6', escritorio: { sala: 'Comercial HEFX', tipo: 'sala', ordem: 22, papel: 'SDR do site HEFX', visual: 'f' } },
];

const exemplos = {
  scooby: ['Quanto vendi hoje no iFood?', ['Consultar_Vendas']],
  jorge: ['Registra 3 kg de frango na produção', ['Alterar_Registro_Producao']],
  dafne: ['Status das sprints desta semana', ['Synapse_MCP_list_tickets']],
  salsicha: ['Paralelo ponto x Synnapse de hoje', ['Paralelo_Ponto_x_Synnapse']],
  fred: ['Quais minhas tarefas de hoje?', ['Listar_Tarefas']],
  'sdr-synnapse': ['Quero saber o preço do Synnapse', []],
  'sdr-tokin': ['Vocês integram com o ponto?', []],
  'sdr-hefx': ['Quero uma demonstração do HEFX', ['Registrar_Lead']],
};

let id = 1000;
const interacoes = [];
for (const [slug, [entrada, ferramentas]] of Object.entries(exemplos)) {
  for (let k = 3; k >= 1; k--) {
    const t = now - k * 47 * 60_000 - Math.floor(Math.random() * 20 * 60_000);
    interacoes.push({
      id: id++, agente: slug, ocorrido_em: iso(t), canal: slug.startsWith('sdr') ? 'web' : 'telegram', status: 'ok',
      ferramentas, tokens_entrada: 12000, tokens_saida: 600, custo_brl: 0.05, duracao_ms: 8000 + k * 1000,
      entrada, n8n_execution_id: `ex-${id}`,
    });
  }
}
const execucoes = rodando.map((slug, i) => ({
  id: `ao-vivo-${slug}`, agente: slug, canal: slug.startsWith('sdr') ? 'web' : 'telegram', gatilho: 'chat',
  resumo: exemplos[slug]?.[0] ?? 'Mensagem nova', iniciado_em: iso(now - (i + 1) * 4000), finalizado_em: null, status: 'rodando',
}));

process.stdout.write(JSON.stringify({ agora: iso(now), agentes, execucoes, interacoes }, null, 1));
