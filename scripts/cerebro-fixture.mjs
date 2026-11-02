// Gera um estado de exemplo do Cérebro (mesmo formato da RPC cerebro_escritorio_estado) para desenvolver sem banco.
// Uso: node scripts/cerebro-fixture.mjs > /tmp/cerebro.json  e  CEREBRO_FIXTURE=/tmp/cerebro.json npm run dev
// Com --rodando=<slug,slug>, esses agentes aparecem trabalhando (execução aberta agora). Os pedidos com assunto
// comercial (leads, SDRs) levam a Manu para o Comercial (config visita); a sala fixa Vibe Code vem em `salas`.
// Chamados da gerente: a partir de 20 s depois de gerar o arquivo (--chamado-em=<segundos>), a Manu chama agentes
// ("pedido da Manu") a cada minuto, por 10 minutos (--sem-chamados desliga). O servidor só lê do arquivo o que já
// aconteceu (server/sources/cerebro/source.ts, fixtureAt), então cada chamado aparece ao vivo: o agente vai até a
// gerência, ouve a instrução e volta para o lugar.
const args = process.argv.slice(2);
const rodando = (args.find((a) => a.startsWith('--rodando='))?.split('=')[1] ?? 'scooby,salsicha,sdr-hefx').split(',').filter(Boolean);
const chamadoEm = Number(args.find((a) => a.startsWith('--chamado-em='))?.split('=')[1] ?? 20);
const semChamados = args.includes('--sem-chamados');
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const agentes = [
  { slug: 'manu', nome: 'Manu', dominio: 'Gerência', status: 'ativo', cor: '#E11D48', escritorio: { sala: 'Diretoria', tipo: 'gerencia', ordem: 5, papel: 'Gerente geral', visual: 'f', visita: { Comercial: ['comercial', 'sdr', 'lead', 'crm'] } } },
  { slug: 'scooby', nome: 'Scooby', dominio: 'Restaurante', status: 'ativo', cor: '#F59E0B', escritorio: { sala: 'Restaurante', tipo: 'restaurante', ordem: 0, papel: 'Atendente do restaurante', posto: 'balcao', visual: 'm' } },
  { slug: 'jorge', nome: 'Jorge Estoquista', dominio: 'Restaurante', status: 'ativo', cor: '#F97316', escritorio: { sala: 'Restaurante', tipo: 'restaurante', ordem: 0, papel: 'Estoque do restaurante', posto: 'cozinha', visual: 'm' } },
  { slug: 'dafne', nome: 'Dafne', dominio: 'Synapse', status: 'ativo', cor: '#8B5CF6', escritorio: { sala: 'Co-work', tipo: 'cowork', ordem: 50, papel: 'Projetos e horas (Synapse)', visual: 'f' } },
  { slug: 'salsicha', nome: 'Salsicha', dominio: 'Financeiro', status: 'ativo', cor: '#10B981', escritorio: { sala: 'Co-work', tipo: 'cowork', ordem: 50, papel: 'Financeiro e CRM (FinERP)', visual: 'm', colabora_com: { dafne: ['paralelo', 'synnapse'] } } },
  { slug: 'fred', nome: 'Fred', dominio: 'F2J', status: 'ativo', cor: '#3B82F6', escritorio: { sala: 'Sala do Fred', tipo: 'sala', ordem: 10, papel: 'Assistente da F2J', visual: 'm' } },
  { slug: 'sdr-synnapse', nome: 'SDR Synnapse', dominio: 'Synapse', status: 'ativo', cor: '#EC4899', escritorio: { sala: 'Comercial', tipo: 'sala', ordem: 20, papel: 'SDR do site Synnapse', visual: 'f' } },
  { slug: 'sdr-tokin', nome: 'SDR Tokin', dominio: 'Tokin', status: 'ativo', cor: '#0EA5E9', escritorio: { sala: 'Comercial', tipo: 'sala', ordem: 21, papel: 'SDR do site Tokin', visual: 'm' } },
  { slug: 'sdr-hefx', nome: 'SDR HEFX', dominio: 'HEFX', status: 'ativo', cor: '#14B8A6', escritorio: { sala: 'Comercial', tipo: 'sala', ordem: 22, papel: 'SDR do site HEFX', visual: 'f' } },
];

const exemplos = {
  manu: ['Cobra o Fred das tarefas atrasadas', ['Delegar_Tarefa']],
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

// pedidos da Manu agendados no futuro: [segundos depois de gerar, agentes chamados juntos, pedido]
const pedidos = [
  [0, ['scooby', 'fred'], 'Fechamento de vendas de hoje e tarefas atrasadas'],
  [60, ['dafne'], 'Horas lançadas no Synapse esta semana'],
  [120, ['sdr-hefx', 'jorge'], 'Leads novos do HEFX e estoque de frango'],
  [180, ['salsicha'], 'Contas a pagar desta semana'],
  [240, ['sdr-synnapse', 'sdr-tokin', 'scooby'], 'Resumo dos atendimentos de hoje'],
];
if (!semChamados) {
  for (let ciclo = 0; ciclo < 2; ciclo++) {
    for (const [seg, chamados, pedido] of pedidos) {
      const t0 = now + (chamadoEm + seg + ciclo * 300) * 1000;
      // a própria execução da Manu (o Ildefonso pediu pelo Telegram) e o fim dela
      const idManu = `manu-${ciclo}-${seg}`;
      execucoes.push({ id: idManu, agente: 'manu', canal: 'telegram', gatilho: 'chat', resumo: pedido, iniciado_em: iso(t0 - 4000), finalizado_em: iso(t0 + 6000), status: 'ok' });
      interacoes.push({ id: id++, agente: 'manu', ocorrido_em: iso(t0 + 6000), canal: 'telegram', status: 'ok', ferramentas: ['Delegar_Tarefa'], tokens_entrada: 9000, tokens_saida: 400, custo_brl: 0.04, duracao_ms: 10000, entrada: pedido, n8n_execution_id: idManu });
      chamados.forEach((slug, i) => {
        const idEx = `pedido-manu-${ciclo}-${seg}-${slug}`;
        const fim = t0 + (35 + i * 5) * 1000;
        execucoes.push({ id: idEx, agente: slug, canal: 'api', gatilho: 'pedido da Manu', resumo: pedido, iniciado_em: iso(t0), finalizado_em: iso(fim), status: 'ok' });
        interacoes.push({ id: id++, agente: slug, ocorrido_em: iso(fim), canal: 'api', status: 'ok', ferramentas: exemplos[slug]?.[1] ?? [], tokens_entrada: 8000, tokens_saida: 500, custo_brl: 0.03, duracao_ms: fim - t0, entrada: pedido, n8n_execution_id: idEx });
      });
    }
  }
}

// salas fixas (cerebro.escritorio_salas): existem mesmo sem agente
const salas = [{ nome: 'Vibe Code', tipo: 'vibecode', ordem: 40 }];

process.stdout.write(JSON.stringify({ agora: iso(now), agentes, salas, execucoes, interacoes }, null, 1));
