// ============================================================
//  Gescolar — container (versão 2)
//  As páginas vivem no GitHub e só falam com este container.
//  O Bubble guarda os dados (Data API) e verifica contas (workflows signup e login).
//
//  Rotas desta versão:
//    GET  /          estado e versão
//    POST /registo   cria a conta da Direcção + a Escola, devolve a sessão
//    POST /login     entra com email e palavra-passe, devolve a sessão
//    POST /sessao    diz quem é o dono da sessão, a escola e a página dele
//    Direcção (v3): /painel /turmas /turma-guardar /turma-apagar /disciplinas /disciplina-guardar
//                   /disciplina-apagar /disciplinas-modelo /professores /professor-guardar
//                   /professor-apagar /estudantes /matricular
//    Propinas e pagamentos (v4): /propinas-gerar /propinas /pagar /pagar-balcao /pagamento-estado /pagamentos
//                                GET|POST /wh-moz/<MOZ_WEBHOOK_KEY>  — webhook da MozPayment
//    SMS (v4.1): /sms-teste  — e recibo por SMS ao encarregado sempre que um pagamento fica pago
//    Facturas (v4.2): /escola-dados /escola-guardar (logótipo e dados da factura) /recibo (dados da factura-recibo em PDF)
//    Portal das famílias (v4.3): /acesso-codigo /acesso-entrar (entrada por código SMS, sem palavra-passe)
//                                /p/inicio /p/pagar /p/pagamento-estado  ·  /familias-link /familias-convite (Direcção)
//    Horários e comunicados (v4.4): /horarios /horario-guardar · /comunicados /comunicado-guardar /comunicado-apagar
//    Professores e notas (v4.5): entrada do professor por SMS · /prof/inicio /prof/pauta /prof/pauta-guardar
//                                Direcção: /pautas-turma /pauta /pauta-guardar /pautas-publicar · portal: notas em /p/inicio
//    Escola de condução 2 (v5.1): /viaturas /viatura-guardar /viatura-apagar /aulas-praticas /aula-marcar /aula-estado
//    Escola de condução 1 (v5.0): /cursos /curso-guardar /curso-apagar /instruendos /inscrever /inscricao-estado
//    Convites aos professores (v4.10): SMS automático ao registar · /professor-convite /professores-convite
//    Palavra-passe e equipa (v4.9): /senha-pedir /senha-nova (código por SMS) · /equipa /equipa-criar /equipa-estado
//    Assinatura e plataforma (v4.8): /assinatura /assinatura-pagar /assinatura-estado · /pl/resumo /pl/escola /pl/escola-guardar
//                                    /pl/transferencia /pl/transferencia-apagar  (PLATAFORMA_EMAILS)
//    Painel (v4.7): /painel-indicadores — dinheiro, chamadas de hoje, faltas, notas por trimestre
//    Presenças (v4.6): /prof/chamada /prof/chamada-guardar · Direcção: /presencas /chamadas-dia /falta-justificar · portal: faltas
//
//  Variáveis de ambiente:
//    BUBBLE_BASE     https://<app>.bubbleapps.io/version-test/api/1.1/obj   (sem / no fim)
//    BUBBLE_TOKEN    token de admin da Data API
//    SESSION_SECRET  frase longa e aleatória que assina as sessões
//    ORIGENS         endereços das páginas, separados por vírgulas
//    MOZ_EMAIL, MOZ_SENHA, MOZ_WALLET, MOZ_WEBHOOK_KEY, MOZ_CARD_PATH (ver secção PAGAMENTOS)
//    SMS_TOKEN, SMS_ORIGEM (ver secção SMS)
// ============================================================
'use strict';
const express = require('express');
const crypto = require('crypto');

const VERSAO = 'gescolar-proxy 5.1.0';
const PORT = process.env.PORT || 8080;
const BUBBLE_BASE = (process.env.BUBBLE_BASE || '').replace(/\/+$/, '');
const BUBBLE_WF = BUBBLE_BASE.replace(/\/obj$/, '/wf');
const BUBBLE_TOKEN = process.env.BUBBLE_TOKEN || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const SESSAO_DIAS = 7;
const ORIGENS = (process.env.ORIGENS || 'https://gescolar.co.mz,https://www.gescolar.co.mz,https://djdesigncreator.github.io')
  .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);

const NIVEIS = { ESC: 'Escolinha', PRI: 'Ensino Primario', SEC: 'Ensino Secundario', TEC: 'Tecnico Profissional', SUP: 'Ensino Superior', CON: 'Escola de Conducao' };
const CODIGO_NIVEL = Object.fromEntries(Object.entries(NIVEIS).map(([k, v]) => [v, k]));
const PAPEIS = { Direccao: 'direccao', Secretaria: 'direccao', Professor: 'professor', Estudante: 'estudante', Encarregado: 'encarregado', Plataforma: 'plataforma' };
const PROVINCIAS = ['Maputo Cidade', 'Maputo Província', 'Gaza', 'Inhambane', 'Sofala', 'Manica', 'Tete', 'Zambézia', 'Nampula', 'Cabo Delgado', 'Niassa'];
const PLANOS = ['Essencial', 'Pro', 'Rede'];

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

// ---------- CORS ----------
app.use((req, res, next) => {
  const o = (req.headers.origin || '').replace(/\/+$/, '');
  if (o && (ORIGENS.includes(o) || /^https:\/\/[a-z0-9-]+\.gescolar\.co\.mz$/.test(o))) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- Bubble ----------
async function pedido(url, method, body) {
  if (!BUBBLE_BASE || !BUBBLE_TOKEN) throw new Error('BUBBLE_BASE ou BUBBLE_TOKEN em falta no container');
  const r = await fetch(url, {
    method,
    headers: { 'Authorization': 'Bearer ' + BUBBLE_TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await r.text();
  let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = { raw: t }; }
  if (!r.ok) {
    const msg = (d && d.body && d.body.message) || (d && d.message) || t || ('HTTP ' + r.status);
    const err = new Error(method + ' ' + url.replace(BUBBLE_BASE, '').replace(BUBBLE_WF, '/wf') + ': ' + msg);
    err.status = r.status; err.bubble = msg; throw err;
  }
  return d;
}
const bubble = (method, path, body) => pedido(BUBBLE_BASE + path, method, body);
const workflow = (nome, body) => pedido(BUBBLE_WF + '/' + nome, 'POST', body);
const obter = (tipo, id) => bubble('GET', '/' + tipo + '/' + encodeURIComponent(id)).then(d => d && d.response);
const criar = (tipo, campos) => bubble('POST', '/' + tipo, campos).then(d => d && d.id);
const mudar = (tipo, id, campos) => bubble('PATCH', '/' + tipo + '/' + encodeURIComponent(id), campos);
const apagar = (tipo, id) => bubble('DELETE', '/' + tipo + '/' + encodeURIComponent(id));
async function procurar(tipo, filtros, limite) {
  const q = '?constraints=' + encodeURIComponent(JSON.stringify(filtros || [])) + '&limit=' + (limite || 100);
  const d = await bubble('GET', '/' + tipo + q);
  return (d && d.response && d.response.results) || [];
}

// ---------- sessões assinadas ----------
const b64 = s => Buffer.from(s).toString('base64url');
function assinar(dados, dias) {
  const corpo = b64(JSON.stringify(Object.assign({}, dados, { exp: Date.now() + (dias || SESSAO_DIAS) * 864e5 })));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(corpo).digest('base64url');
  return corpo + '.' + sig;
}
function verificar(token) {
  if (!token || !SESSION_SECRET) return null;
  const [corpo, sig] = String(token).split('.');
  if (!corpo || !sig) return null;
  const certo = crypto.createHmac('sha256', SESSION_SECRET).update(corpo).digest('base64url');
  if (sig.length !== certo.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(certo))) return null;
  let d; try { d = JSON.parse(Buffer.from(corpo, 'base64url').toString()); } catch (e) { return null; }
  if (!d || !d.u || !d.exp || d.exp < Date.now()) return null;
  return d;
}
function sessaoDo(req) {
  const h = req.headers.authorization || '';
  return verificar(h.startsWith('Bearer ') ? h.slice(7) : '');
}
// para as rotas seguintes (pautas, propinas…): exige sessão válida
function exigeSessao(req, res, next) {
  const s = sessaoDo(req);
  if (!s) return erro(res, 401, 'A sessão terminou. Entre outra vez.');
  req.sessao = s; next();
}

// ---------- travão contra tentativas repetidas ----------
const tentativas = new Map();
function travao(chave, max, minutos) {
  const agora = Date.now(), jan = minutos * 60e3;
  const lista = (tentativas.get(chave) || []).filter(t => agora - t < jan);
  lista.push(agora); tentativas.set(chave, lista);
  return lista.length > max;
}
setInterval(() => { const agora = Date.now(); for (const [k, v] of tentativas) if (!v.some(t => agora - t < 3600e3)) tentativas.delete(k); }, 600e3).unref();

// ---------- utilidades ----------
const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
const soDigitos = v => String(v || '').replace(/\D/g, '');
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
function slug(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}
function erro(res, status, mensagem) { return res.status(status).json({ ok: false, erro: mensagem }); }

async function resumoEscola(id) {
  if (!id) return null;
  const e = await obter('escola', id).catch(() => null);
  if (!e) return null;
  return {
    id: e._id, nome: e['Nome'], subdominio: e['Subdominio'], estado: e['Estado'], plano: e['Plano'],
    niveis: (e['Niveis'] || []).map(n => CODIGO_NIVEL[n] || n), ano: e['Ano Lectivo'], teste_ate: e['Teste Ate'] || null, valida_ate: e['Valida Ate'] || null,
    situacao: situacaoEscola(e),
    regras: { dia_limite: e['Dia Limite'], multa: e['Multa Percent'], multa_max: e['Multa Max'], aprovacao: e['Nota Aprovacao'], dispensa: e['Nota Dispensa'], formula: e['Formula Media'] }
  };
}
const PLATAFORMA_EMAILS = (process.env.PLATAFORMA_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
async function abrirSessao(userId, pl) {
  const user = await obter('user', userId);
  if (!user) { const e = new Error('Conta não encontrada.'); e.publico = 404; throw e; }
  if (user['Activo'] === false) { const e = new Error('Esta conta está desactivada. Fale com a escola.'); e.publico = 403; throw e; }
  const papel = user['Papel'] || null;
  const escola = await resumoEscola(user['Escola']);
  if (escola && escola.estado === 'suspensa' && papel !== 'Plataforma' && !pl) { const e = new Error('O acesso desta escola está suspenso. A Direcção deve regularizar a subscrição.'); e.publico = 402; throw e; }
  mudar('user', userId, { 'Ultimo Acesso': new Date().toISOString() }).catch(() => {});
  const plataforma = !!pl || papel === 'Plataforma';
  const token = assinar(Object.assign({ u: userId, e: escola ? escola.id : null, p: papel }, plataforma ? { pl: 1 } : {}));
  return { ok: true, token, nome: user['Nome Completo'] || '', papel, pagina: (papel !== 'Plataforma' && escola) ? (PAPEIS[papel] || 'registo') : (plataforma ? 'plataforma' : (PAPEIS[papel] || 'registo')), escola, plataforma, expira_dias: SESSAO_DIAS };
}

// ============================================================
app.get('/', (req, res) => {
  res.json({ ok: true, versao: VERSAO, bubble: BUBBLE_BASE && BUBBLE_TOKEN ? 'configurado' : 'em falta', sessoes: SESSION_SECRET.length >= 32 ? 'configurado' : 'em falta', mozpayment: (process.env.MOZ_EMAIL && process.env.MOZ_SENHA && process.env.MOZ_WALLET) ? 'configurado' : 'em falta', webhook: process.env.MOZ_WEBHOOK_KEY ? 'configurado' : 'em falta', sms: (process.env.SMS_TOKEN && process.env.SMS_ORIGEM) ? 'configurado' : 'em falta', hora: new Date().toISOString() });
});

// ============================================================
//  POST /registo
//  { email, password, nome, nuit, provincia, cidade, telefone, email_escola,
//    subdominio, niveis:[...], plano, admin_nome, admin_tel }
// ============================================================
app.post('/registo', async (req, res) => {
  try {
    if (!SESSION_SECRET) return erro(res, 500, 'O servidor ainda não está configurado (SESSION_SECRET).');
    const b = req.body || {};
    const email = txt(b.email, 120).toLowerCase();
    const password = String(b.password || '');
    const nome = txt(b.nome, 120);
    const nuit = soDigitos(b.nuit);
    const provincia = txt(b.provincia, 40);
    const niveis = Array.isArray(b.niveis) ? [...new Set(b.niveis.map(x => String(x).toUpperCase()))].filter(k => NIVEIS[k]) : [];
    const plano = PLANOS.includes(b.plano) ? b.plano : 'Pro';
    const adminNome = txt(b.admin_nome, 120);

    if (travao('registo|' + req.ip, 8, 60)) return erro(res, 429, 'Muitas tentativas seguidas. Espere alguns minutos.');
    if (!emailOk(email)) return erro(res, 400, 'Escreva um email válido.');
    if (password.length < 8) return erro(res, 400, 'A palavra-passe precisa de pelo menos 8 caracteres.');
    if (nome.length < 4) return erro(res, 400, 'Escreva o nome da instituição.');
    if (nuit.length !== 9) return erro(res, 400, 'O NUIT tem 9 dígitos.');
    if (!PROVINCIAS.includes(provincia)) return erro(res, 400, 'Escolha a província.');
    if (!niveis.length) return erro(res, 400, 'Escolha pelo menos um tipo de ensino.');
    if (adminNome.split(/\s+/).length < 2) return erro(res, 400, 'Escreva o nome completo do administrador.');

    // NUIT repetido? (antes de criar a conta, para não deixar contas soltas)
    const mesmoNuit = await procurar('escola', [{ key: 'NUIT', constraint_type: 'equals', value: nuit }], 1);
    if (mesmoNuit.length) return erro(res, 409, 'Já existe uma instituição registada com este NUIT. Contacte o suporte Gescolar.');

    // 1. criar a conta no Bubble
    let userId;
    try {
      const r = await workflow('signup', { email, password });
      userId = r && r.response && r.response.user_id;
    } catch (e) {
      console.error('[registo/signup]', e.message);
      if (e.status === 400) return erro(res, 409, 'Este email já tem conta no Gescolar. Use "Entrar" ou outro email.');
      throw e;
    }
    if (!userId) throw new Error('signup não devolveu user_id — confirme o "Return data from API" no workflow signup');

    // 2. subdomínio livre
    let sub = slug(b.subdominio || nome) || 'escola';
    const iguais = await procurar('escola', [{ key: 'Subdominio', constraint_type: 'equals', value: sub }], 1);
    if (iguais.length) sub = (sub + '-' + crypto.randomBytes(2).toString('hex')).slice(0, 34);

    // 3. criar a Escola
    const hoje = new Date();
    const testeAte = new Date(hoje.getTime() + 30 * 864e5);
    const escolaId = await criar('escola', {
      'Nome': nome, 'NUIT': nuit, 'Provincia': provincia, 'Cidade': txt(b.cidade, 80),
      'Telefone': txt(b.telefone, 30), 'Email': txt(b.email_escola || email, 120), 'Subdominio': sub,
      'Niveis': niveis.map(k => NIVEIS[k]), 'Plano': plano, 'Estado': 'teste', 'Teste Ate': testeAte.toISOString(),
      'Ano Lectivo': String(hoje.getFullYear()), 'Dia Limite': 10, 'Multa Percent': 10, 'Multa Max': 25,
      'Nota Aprovacao': 10, 'Nota Dispensa': 14, 'Formula Media': 'MT = (2 x MACS + ACP) / 3'
    });

    // 4. ligar a conta à escola como Direcção
    await mudar('user', userId, { 'Escola': escolaId, 'Papel': 'Direccao', 'Nome Completo': adminNome, 'Telefone': txt(b.admin_tel, 30), 'Activo': true });

    const s = await abrirSessao(userId);
    s.subdominio = sub; s.teste_ate = testeAte.toISOString().slice(0, 10);
    res.json(s);
  } catch (e) {
    console.error('[registo]', e.message);
    erro(res, e.publico || 500, e.publico ? e.message : 'Não foi possível criar a escola agora. Tente de novo dentro de um minuto.');
  }
});

// ============================================================
//  POST /login   { email, password }
// ============================================================
app.post('/login', async (req, res) => {
  try {
    if (!SESSION_SECRET) return erro(res, 500, 'O servidor ainda não está configurado (SESSION_SECRET).');
    const email = txt((req.body || {}).email, 120).toLowerCase();
    const password = String((req.body || {}).password || '');
    if (!emailOk(email) || !password) return erro(res, 400, 'Escreva o email e a palavra-passe.');
    if (travao('login|' + email, 8, 15) || travao('login-ip|' + req.ip, 30, 15)) return erro(res, 429, 'Muitas tentativas. Espere 15 minutos ou recupere a palavra-passe.');

    let userId;
    try {
      const r = await workflow('login', { email, password });
      userId = r && r.response && r.response.user_id;
    } catch (e) {
      if (e.status === 400 || e.status === 401) return erro(res, 401, 'Email ou palavra-passe incorrectos.');
      throw e;
    }
    if (!userId) throw new Error('login não devolveu user_id');
    res.json(await abrirSessao(userId, PLATAFORMA_EMAILS.includes(email)));
  } catch (e) {
    console.error('[login]', e.message);
    erro(res, e.publico || 500, e.publico ? e.message : 'Não foi possível entrar agora. Tente de novo.');
  }
});

// ============================================================
//  POST /sessao   (cabeçalho Authorization: Bearer <token>)
// ============================================================
app.post('/sessao', async (req, res) => {
  const s = sessaoDo(req);
  if (!s) return erro(res, 401, 'A sessão terminou. Entre outra vez.');
  try { res.json(s.t === 'portal' ? await abrirSessaoPortal(s) : await abrirSessao(s.u, s.pl === 1)); }
  catch (e) { console.error('[sessao]', e.message); erro(res, e.publico || 500, e.publico ? e.message : 'Não foi possível confirmar a sessão.'); }
});


// ============================================================
//  ÁREA DA DIRECÇÃO (versão 3)
//  Todas as rotas abaixo exigem sessão de Direcção ou Secretaria.
//  A escola vem SEMPRE da sessão, nunca do corpo do pedido.
// ============================================================
function exigeDireccao(req, res, next) {
  const s = sessaoDo(req);
  if (!s) return erro(res, 401, 'A sessão terminou. Entre outra vez.');
  if (!s.e) return erro(res, 403, 'Esta conta ainda não tem escola.');
  if (s.p !== 'Direccao' && s.p !== 'Secretaria') return erro(res, 403, 'Só a Direcção e a Secretaria podem fazer isto.');
  req.sessao = s; req.escola = s.e; next();
}
const daEscola = (id) => [{ key: 'Escola', constraint_type: 'equals', value: id }];

async function procurarTodos(tipo, filtros, max) {
  const out = []; let cursor = 0; max = max || 2000;
  while (out.length < max) {
    const q = '?constraints=' + encodeURIComponent(JSON.stringify(filtros || [])) + '&limit=100&cursor=' + cursor;
    const d = await bubble('GET', '/' + tipo + q);
    const r = (d && d.response) || {};
    const lista = r.results || [];
    out.push(...lista);
    if (!r.remaining || !lista.length) break;
    cursor += lista.length;
  }
  return out;
}
async function daMinhaEscola(tipo, id, escola) {
  const x = await obter(tipo, id).catch(() => null);
  if (!x || x['Escola'] !== escola) { const e = new Error('Registo não encontrado.'); e.publico = 404; throw e; }
  return x;
}
function rota(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { console.error('[' + req.path + ']', e.message); erro(res, e.publico || 500, e.publico ? e.message : 'Não foi possível concluir. Tente de novo.'); }
  };
}
const num = (v, def) => { const n = Number(v); return isFinite(n) ? n : def; };

// ---------- currículo modelo (a escola ajusta depois) ----------
const CURRICULO = {
  ESC: [['Linguagem e comunicação', 'LNG', '#0A64DC', 6], ['Matemática lúdica', 'MLU', '#C2410C', 5], ['Expressão plástica', 'EXP', '#9B3FB5', 5], ['Música e movimento', 'MUS', '#7B4DD6', 5], ['Conhecimento do mundo', 'NAT', '#168A52', 5], ['Brincadeira livre', 'BRI', '#8A6D00', 4]],
  PRI: [['Português', 'POR', '#0A64DC', 7], ['Matemática', 'MAT', '#C2410C', 7], ['Ciências Naturais', 'CN', '#168A52', 4], ['Ciências Sociais', 'CS', '#8A6D00', 4], ['Inglês', 'ING', '#7B4DD6', 2], ['Educação Visual', 'EV', '#9B3FB5', 2], ['Educação Física', 'EF', '#3E7D1E', 2], ['Ofícios', 'OF', '#6B4E2E', 2]],
  SEC: [['Português', 'POR', '#0A64DC', 5], ['Matemática', 'MAT', '#C2410C', 5], ['Inglês', 'ING', '#7B4DD6', 3], ['Física', 'FIS', '#0E7C86', 3], ['Química', 'QUI', '#B4235A', 3], ['Biologia', 'BIO', '#168A52', 3], ['Geografia', 'GEO', '#8A6D00', 2], ['História', 'HIS', '#6B4E2E', 2], ['Educação Física', 'E.FÍS', '#3E7D1E', 2], ['Educação Visual', 'E.VIS', '#9B3FB5', 1], ['TIC', 'TIC', '#0B2A4A', 1], ['Filosofia', 'FIL', '#5A4FCF', 2], ['Francês', 'FRA', '#0E5FA8', 2]]
};

// ---------- painel: contadores e estado do arranque ----------
app.post('/painel', exigeDireccao, rota(async (req, res) => {
  const f = daEscola(req.escola);
  const [escola, turmas, disciplinas, professores, estudantes] = await Promise.all([
    resumoEscola(req.escola), procurarTodos('turma', f), procurarTodos('disciplina', f), procurarTodos('professor', f), procurarTodos('estudante', f)
  ]);
  const act = l => l.filter(x => x['Activa'] !== false && x['Activo'] !== false);
  const t = act(turmas), d = act(disciplinas), p = act(professores), todos = estudantes.filter(x => (x['Estado'] || 'activo') === 'activo');
  const e = todos.filter(x => !String(x['Numero'] || '').startsWith('C'));
  let cursos = 0, instruendos = 0;
  if (escola && (escola.niveis || []).includes('CON')) {
    const [cs, ins] = await Promise.all([procurarTodos('cursoconducao', f), procurarTodos('inscricaoconducao', f)]);
    cursos = cs.filter(c => c['Activo'] !== false).length; instruendos = ins.filter(i => (i['Estado'] || 'activa') === 'activa').length;
  }
  res.json({ ok: true, escola, contagem: { turmas: t.length, disciplinas: d.length, professores: p.length, estudantes: e.length, cursos, instruendos },
    arranque: [
      { id: 'turmas', feito: t.length > 0, n: t.length },
      { id: 'disciplinas', feito: d.length > 0, n: d.length },
      { id: 'professores', feito: p.length > 0, n: p.length },
      { id: 'estudantes', feito: e.length > 0, n: e.length }
    ] });
}));

// ---------- turmas ----------
function turmaOut(t, estudantes) {
  return { id: t._id, nome: t['Nome'], codigo: t['Codigo'] || '', nivel: CODIGO_NIVEL[t['Nivel']] || t['Nivel'] || '', classe: t['Classe'] || '', turno: t['Turno'] || '',
    sala: t['Sala'] || '', capacidade: t['Capacidade'] || 0, propina: t['Propina Mensal'] || 0, director: t['Director Turma'] || null, disciplinas: t['Disciplinas'] || [],
    estudantes: estudantes ? estudantes.filter(e => e['Turma'] === t._id && (e['Estado'] || 'activo') === 'activo').length : undefined };
}
app.post('/turmas', exigeDireccao, rota(async (req, res) => {
  const f = daEscola(req.escola);
  const [turmas, estudantes] = await Promise.all([procurarTodos('turma', f), procurarTodos('estudante', f)]);
  res.json({ ok: true, turmas: turmas.filter(t => t['Activa'] !== false).map(t => turmaOut(t, estudantes)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')) });
}));
app.post('/turma-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const nome = txt(b.nome, 80), nivel = String(b.nivel || '').toUpperCase();
  if (nome.length < 2) return erro(res, 400, 'Escreva o nome da turma, por exemplo "10ª Classe A".');
  if (!NIVEIS[nivel]) return erro(res, 400, 'Escolha o nível de ensino da turma.');
  const escola = await resumoEscola(req.escola);
  if (escola && escola.niveis.length && !escola.niveis.includes(nivel)) return erro(res, 400, 'Esta escola não tem o nível escolhido. Acrescente-o nas Definições.');
  let discs = Array.isArray(b.disciplinas) ? b.disciplinas.map(String) : null;
  if (!discs) { // por defeito: todas as disciplinas activas do mesmo nível
    const todas = await procurarTodos('disciplina', daEscola(req.escola));
    discs = todas.filter(d => d['Nivel'] === NIVEIS[nivel] && d['Activa'] !== false).map(d => d._id);
  }
  const campos = { 'Escola': req.escola, 'Nome': nome, 'Codigo': txt(b.codigo, 20) || slug(nome).toUpperCase().replace(/-/g, '').slice(0, 8), 'Nivel': NIVEIS[nivel],
    'Classe': txt(b.classe, 40), 'Turno': txt(b.turno, 20) || 'Manhã', 'Sala': txt(b.sala, 40), 'Capacidade': num(b.capacidade, 40), 'Propina Mensal': num(b.propina, 0),
    'Ano Lectivo': (escola && escola.ano) || String(new Date().getFullYear()), 'Disciplinas': discs, 'Activa': true };
  if (b.director) campos['Director Turma'] = String(b.director);
  let id = b.id ? String(b.id) : null;
  if (id) { await daMinhaEscola('turma', id, req.escola); await mudar('turma', id, campos); }
  else id = await criar('turma', campos);
  res.json({ ok: true, id });
}));
app.post('/turma-apagar', exigeDireccao, rota(async (req, res) => {
  const id = String((req.body || {}).id || '');
  await daMinhaEscola('turma', id, req.escola);
  const est = await procurarTodos('estudante', [{ key: 'Turma', constraint_type: 'equals', value: id }], 1);
  if (est.length) return erro(res, 409, 'A turma tem estudantes. Transfira-os antes de a apagar.');
  await mudar('turma', id, { 'Activa': false });
  res.json({ ok: true });
}));

// ---------- disciplinas ----------
const discOut = d => ({ id: d._id, nome: d['Nome'], sigla: d['Sigla'] || '', cor: d['Cor'] || '#0A64DC', nivel: CODIGO_NIVEL[d['Nivel']] || d['Nivel'] || '', carga: d['Carga Semanal'] || 0, creditos: d['Creditos'] || 0, descritiva: !!d['Avaliacao Descritiva'] });
app.post('/disciplinas', exigeDireccao, rota(async (req, res) => {
  const l = await procurarTodos('disciplina', daEscola(req.escola));
  res.json({ ok: true, disciplinas: l.filter(d => d['Activa'] !== false).map(discOut).sort((a, b) => (a.nivel + a.nome).localeCompare(b.nivel + b.nome, 'pt')) });
}));
app.post('/disciplina-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, nivel = String(b.nivel || '').toUpperCase(), nome = txt(b.nome, 60);
  if (nome.length < 2) return erro(res, 400, 'Escreva o nome da disciplina.');
  if (!NIVEIS[nivel]) return erro(res, 400, 'Escolha o nível.');
  const campos = { 'Escola': req.escola, 'Nome': nome, 'Sigla': txt(b.sigla, 8).toUpperCase() || nome.slice(0, 3).toUpperCase(), 'Cor': /^#[0-9a-f]{6}$/i.test(b.cor || '') ? b.cor : '#0A64DC',
    'Nivel': NIVEIS[nivel], 'Carga Semanal': num(b.carga, 2), 'Creditos': num(b.creditos, 0), 'Avaliacao Descritiva': nivel === 'ESC' ? true : !!b.descritiva, 'Activa': true };
  let id = b.id ? String(b.id) : null;
  if (id) { await daMinhaEscola('disciplina', id, req.escola); await mudar('disciplina', id, campos); }
  else id = await criar('disciplina', campos);
  res.json({ ok: true, id });
}));
app.post('/disciplina-apagar', exigeDireccao, rota(async (req, res) => {
  const id = String((req.body || {}).id || '');
  await daMinhaEscola('disciplina', id, req.escola);
  await mudar('disciplina', id, { 'Activa': false });
  res.json({ ok: true });
}));
// carrega o currículo modelo de um nível (não repete as que já existem)
app.post('/disciplinas-modelo', exigeDireccao, rota(async (req, res) => {
  const nivel = String((req.body || {}).nivel || '').toUpperCase();
  if (!CURRICULO[nivel]) return erro(res, 400, 'Não há modelo para este nível. Crie as disciplinas uma a uma.');
  const existentes = (await procurarTodos('disciplina', daEscola(req.escola))).filter(d => d['Nivel'] === NIVEIS[nivel] && d['Activa'] !== false).map(d => String(d['Nome']).toLowerCase());
  let criadas = 0;
  for (const [nome, sigla, cor, carga] of CURRICULO[nivel]) {
    if (existentes.includes(nome.toLowerCase())) continue;
    await criar('disciplina', { 'Escola': req.escola, 'Nome': nome, 'Sigla': sigla, 'Cor': cor, 'Nivel': NIVEIS[nivel], 'Carga Semanal': carga, 'Avaliacao Descritiva': nivel === 'ESC', 'Activa': true });
    criadas++;
  }
  res.json({ ok: true, criadas });
}));

// ---------- professores ----------
const profOut = p => ({ id: p._id, nome: p['Nome'], telefone: p['Telefone'] || '', email: p['Email'] || '', disciplinas: p['Disciplinas'] || [], monodocencia: !!p['Monodocencia'], desde: p['Desde'] || null, conta: !!p['Conta'], licenca: p['Licenca Instrutor'] || '' });
app.post('/professores', exigeDireccao, rota(async (req, res) => {
  const l = await procurarTodos('professor', daEscola(req.escola));
  res.json({ ok: true, professores: l.filter(p => p['Activo'] !== false).map(profOut).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')) });
}));
app.post('/professor-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, nome = txt(b.nome, 100);
  if (nome.split(/\s+/).length < 2) return erro(res, 400, 'Escreva o nome e o apelido do professor.');
  const email = txt(b.email, 120).toLowerCase();
  if (email && !emailOk(email)) return erro(res, 400, 'O email do professor não é válido.');
  const campos = { 'Escola': req.escola, 'Nome': nome, 'Telefone': txt(b.telefone, 30), 'Email': email, 'Disciplinas': Array.isArray(b.disciplinas) ? b.disciplinas.map(String) : [],
    'Monodocencia': !!b.monodocencia, 'Desde': num(b.desde, new Date().getFullYear()), 'Activo': true };
  if (b.licenca) campos['Licenca Instrutor'] = txt(b.licenca, 30);
  let id = b.id ? String(b.id) : null, novo = !id;
  if (id) { await daMinhaEscola('professor', id, req.escola); await mudar('professor', id, campos); }
  else id = await criar('professor', campos);
  let sms = false;
  if (novo && b.convidar !== false && tel9(campos['Telefone']).length === 9) sms = await convidarProfessor(req.escola, Object.assign({ _id: id }, campos)).catch(() => false);
  res.json({ ok: true, id, sms });
}));
app.post('/professor-apagar', exigeDireccao, rota(async (req, res) => {
  const id = String((req.body || {}).id || '');
  await daMinhaEscola('professor', id, req.escola);
  await mudar('professor', id, { 'Activo': false });
  res.json({ ok: true });
}));

// ---------- estudantes e encarregados ----------
const estOut = (e, encs) => { const en = encs && encs.find(x => x._id === e['Encarregado']); return { id: e._id, numero: e['Numero'], nome: e['Nome'], sexo: e['Sexo'] || '', nascimento: e['Data Nascimento'] || null, turma: e['Turma'] || null, estado: e['Estado'] || 'activo', encarregado: en ? { id: en._id, nome: en['Nome'], telefone: en['Telefone'] || '', parentesco: en['Parentesco'] || '' } : null }; };
app.post('/estudantes', exigeDireccao, rota(async (req, res) => {
  const f = daEscola(req.escola), turma = (req.body || {}).turma;
  const filtros = turma ? f.concat([{ key: 'Turma', constraint_type: 'equals', value: String(turma) }]) : f;
  const [est, encs] = await Promise.all([procurarTodos('estudante', filtros), procurarTodos('encarregado', f)]);
  res.json({ ok: true, estudantes: est.filter(e => (e['Estado'] || 'activo') !== 'apagado').map(e => estOut(e, encs)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')) });
}));
app.post('/matricular', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, nome = txt(b.nome, 100);
  if (nome.split(/\s+/).length < 2) return erro(res, 400, 'Escreva o nome e o apelido do estudante.');
  const turmaId = String(b.turma || '');
  const turma = await daMinhaEscola('turma', turmaId, req.escola);
  const escola = await resumoEscola(req.escola);
  // encarregado: reutiliza pelo telefone, senão cria
  const telEnc = soDigitos(b.enc_telefone);
  let encId = null;
  if (b.enc_nome || telEnc) {
    if (telEnc.length !== 9) return erro(res, 400, 'O telemóvel do encarregado tem 9 dígitos.');
    const encs = await procurarTodos('encarregado', daEscola(req.escola));
    const ja = encs.find(e => soDigitos(e['Telefone']) === telEnc);
    if (ja) encId = ja._id;
    else {
      if (txt(b.enc_nome, 100).split(/\s+/).length < 2) return erro(res, 400, 'Escreva o nome completo do encarregado.');
      encId = await criar('encarregado', { 'Escola': req.escola, 'Nome': txt(b.enc_nome, 100), 'Telefone': telEnc.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3'), 'Email': txt(b.enc_email, 120).toLowerCase(), 'Parentesco': txt(b.enc_parentesco, 30), 'Recebe SMS': true, 'Activo': true });
    }
  }
  // número de estudante: ano-sequência
  const todos = await procurarTodos('estudante', daEscola(req.escola));
  const ano = (escola && escola.ano) || String(new Date().getFullYear());
  const maior = todos.map(e => String(e['Numero'] || '')).filter(n => n.startsWith(ano + '-')).map(n => parseInt(n.split('-')[1], 10) || 0).reduce((a, c) => Math.max(a, c), 0);
  const numero = ano + '-' + String(maior + 1).padStart(4, '0');
  const campos = { 'Escola': req.escola, 'Numero': numero, 'Nome': nome, 'Sexo': b.sexo === 'F' ? 'F' : (b.sexo === 'M' ? 'M' : ''), 'Turma': turma._id, 'Ano Lectivo': ano,
    'Data Matricula': new Date().toISOString(), 'Estado': 'activo', 'Saude Notas': txt(b.saude, 300) };
  if (b.nascimento && !isNaN(Date.parse(b.nascimento))) campos['Data Nascimento'] = new Date(b.nascimento).toISOString();
  if (encId) campos['Encarregado'] = encId;
  const telEst = soDigitos(b.telefone).replace(/^258/, '');
  if (telEst) {
    if (telEst.length !== 9) return erro(res, 400, 'O telemóvel do estudante tem 9 dígitos.');
    campos['Telefone'] = telEst.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3');
  }
  const id = await criar('estudante', campos);
  res.json({ ok: true, id, numero });
}));


// ============================================================
//  PAGAMENTOS (versão 4)
//  MozPayment: login → token; M-Pesa / e-Mola (push para o telemóvel); cartão (link de checkout)
//  Carteira única do Gescolar (MOZ_WALLET). O Gescolar separa internamente o que é de cada escola.
//
//  Variáveis:
//    MOZ_EMAIL, MOZ_SENHA      conta MozPayment (nunca no código)
//    MOZ_WALLET                carteira que recebe tudo
//    MOZ_BASE                  https://mozpayment.co.mz/api/1.1/wf   (por defeito)
//    MOZ_CARD_PATH             caminho do cartão: payment (por defeito) ou bankpayment
//    MOZ_WEBHOOK_KEY           chave que faz parte do URL do webhook
// ============================================================
const MOZ_BASE = (process.env.MOZ_BASE || 'https://mozpayment.co.mz/api/1.1/wf').replace(/\/+$/, '');
const MOZ_EMAIL = process.env.MOZ_EMAIL || '';
const MOZ_SENHA = process.env.MOZ_SENHA || '';
const MOZ_WALLET = process.env.MOZ_WALLET || '';
const MOZ_CARD_PATH = (process.env.MOZ_CARD_PATH || 'payment').replace(/^\/+/, '');
const MOZ_WEBHOOK_KEY = process.env.MOZ_WEBHOOK_KEY || '';

// procura um campo em qualquer nível da resposta (a MozPayment nem sempre devolve no mesmo sítio)
function achar(obj, nomes, prof) {
  if (!obj || typeof obj !== 'object' || (prof || 0) > 4) return undefined;
  for (const n of nomes) if (obj[n] != null && obj[n] !== '') return obj[n];
  for (const k of Object.keys(obj)) { const v = achar(obj[k], nomes, (prof || 0) + 1); if (v != null && v !== '') return v; }
  return undefined;
}
// o link pode vir com ou sem https://, num campo com nome próprio, ou dentro de texto/HTML
const CAMPOS_LINK = ['link', 'url', 'checkout_url', 'checkoutUrl', 'checkout', 'payment_url', 'paymentUrl', 'payment_link', 'redirect_url', 'redirect', 'session_url', 'href'];
function normalLink(v) {
  if (typeof v !== 'string') return undefined;
  v = v.trim().replace(/^["']|["']$/g, '');
  const m = v.match(/https?:\/\/[^\s"'<>]+/i);
  if (m) return m[0];
  if (/^\/\/[^\s]+\.[a-z]{2,}/i.test(v)) return 'https:' + v;
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i.test(v) && v.indexOf('.') > 0 && !/^\d+(\.\d+)*$/.test(v)) return 'https://' + v;
  return undefined;
}
function acharLink(obj, prof) {
  if (typeof obj === 'string') { const m = obj.match(/https?:\/\/[^\s"'<>]+/i); return m ? m[0] : undefined; }
  if (!obj || typeof obj !== 'object' || (prof || 0) > 5) return undefined;
  for (const n of CAMPOS_LINK) { const v = normalLink(obj[n]); if (v) return v; }
  for (const k of Object.keys(obj)) { const v = acharLink(obj[k], (prof || 0) + 1); if (v) return v; }
  return undefined;
}
function sessionDoLink(link) {
  try {
    const u = new URL(link);
    for (const k of ['session_id', 'sessionId', 'session', 'sid', 'checkout_session', 'id']) { const v = u.searchParams.get(k); if (v) return v; }
    const partes = u.pathname.split('/').filter(Boolean); return partes[partes.length - 1] || null;
  } catch (e) { return null; }
}

let MOZ_TOKEN = null, MOZ_TOKEN_ATE = 0;
async function mozLogin(forcar) {
  if (!forcar && MOZ_TOKEN && Date.now() < MOZ_TOKEN_ATE) return MOZ_TOKEN;
  if (!MOZ_EMAIL || !MOZ_SENHA) throw new Error('MOZ_EMAIL ou MOZ_SENHA em falta no container');
  const r = await fetch(MOZ_BASE + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: MOZ_EMAIL, senha: MOZ_SENHA }) });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch (e) { d = { raw: t }; }
  const token = achar(d, ['token', 'access_token', 'accessToken', 'jwt']);
  if (!r.ok || !token) throw new Error('login MozPayment falhou (' + r.status + '): ' + t.slice(0, 200));
  const segs = Number(achar(d, ['expires', 'expires_in'])) || 3600;
  MOZ_TOKEN = String(token); MOZ_TOKEN_ATE = Date.now() + Math.max(300, segs - 120) * 1000;
  return MOZ_TOKEN;
}
async function mozPedido(caminho, corpo) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const token = await mozLogin(tentativa > 0);
    const r = await fetch(MOZ_BASE + '/' + caminho, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(corpo) });
    const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch (e) { d = { raw: t }; }
    if ((r.status === 401 || r.status === 403) && tentativa === 0) continue;   // token caducado: novo login e repete
    console.log('[moz] ' + caminho + ' → ' + r.status + ' ' + t.slice(0, 1500));
    if (!r.ok) { const e = new Error(achar(d, ['message', 'mensagem', 'error', 'erro']) || ('MozPayment respondeu ' + r.status)); e.moz = d; throw e; }
    return d;
  }
  throw new Error('A MozPayment recusou o acesso (verifique MOZ_EMAIL e MOZ_SENHA).');
}

// ---------- multas calculadas no momento ----------
function calcPropina(p, regras) {
  const valor = Number(p['Valor'] || 0);
  const estado = p['Estado'] || 'aberta';
  if (estado === 'paga' || estado === 'anulada') return { valor, multa: Number(p['Multa'] || 0), total: Number(p['Total'] || valor), estado, meses_atraso: 0 };
  const venc = p['Vencimento'] ? new Date(p['Vencimento']) : null;
  let meses = 0;
  if (venc && Date.now() > venc.getTime() + 864e5 - 1) meses = Math.max(1, Math.ceil((Date.now() - venc.getTime()) / (30 * 864e5)));
  const pct = (p['Tipo'] || 'propina') === 'propina' && meses ? Math.min(Number(regras.multa_max || 25), Number(regras.multa || 0) * meses) : 0;
  const multa = Math.round(valor * pct / 100);
  return { valor, multa, total: valor + multa, estado: meses ? 'atrasada' : 'aberta', meses_atraso: meses };
}
const MESES_NOME = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// ---------- criação em lote (Bubble bulk) ----------
async function criarEmLote(tipo, lista) {
  let criados = 0;
  for (let i = 0; i < lista.length; i += 500) {
    const fatia = lista.slice(i, i + 500);
    const r = await fetch(BUBBLE_BASE + '/' + tipo + '/bulk', { method: 'POST', headers: { 'Authorization': 'Bearer ' + BUBBLE_TOKEN, 'Content-Type': 'text/plain' }, body: fatia.map(x => JSON.stringify(x)).join('\n') });
    const t = await r.text();
    if (!r.ok) throw new Error('bulk ' + tipo + ': ' + t.slice(0, 200));
    criados += t.split('\n').filter(l => /"status"\s*:\s*"success"/.test(l)).length;
  }
  return criados;
}

// ---------- propinas: gerar, listar ----------
app.post('/propinas-gerar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const de = Math.max(1, Math.min(12, num(b.de, 2))), ate = Math.max(de, Math.min(12, num(b.ate, 11)));
  const escola = await resumoEscola(req.escola);
  const ano = Number((escola && escola.ano) || new Date().getFullYear());
  const dia = Math.max(1, Math.min(28, Number((escola && escola.regras.dia_limite) || 10)));
  const f = daEscola(req.escola);
  let turmas = (await procurarTodos('turma', f)).filter(t => t['Activa'] !== false);
  if (b.turma) turmas = turmas.filter(t => t._id === String(b.turma));
  if (!turmas.length) return erro(res, 400, 'Escolha uma turma.');
  const [estudantes, existentes] = await Promise.all([procurarTodos('estudante', f), procurarTodos('propina', f)]);
  const ja = new Set(existentes.filter(p => (p['Tipo'] || 'propina') === 'propina').map(p => p['Estudante'] + '|' + p['Ano Lectivo'] + '|' + p['Mes']));
  const novas = [];
  let semValor = 0;
  for (const t of turmas) {
    const valor = Number(t['Propina Mensal'] || 0);
    const daTurma = estudantes.filter(e => e['Turma'] === t._id && (e['Estado'] || 'activo') === 'activo');
    if (!valor) { semValor += daTurma.length ? 1 : 0; continue; }
    for (const e of daTurma) for (let m = de; m <= ate; m++) {
      if (ja.has(e._id + '|' + ano + '|' + m)) continue;
      const linha = { 'Escola': req.escola, 'Estudante': e._id, 'Turma': t._id, 'Ano Lectivo': String(ano), 'Tipo': 'propina', 'Mes': m,
        'Descricao': 'Propina de ' + MESES_NOME[m] + ' ' + ano + ' · ' + t['Nome'], 'Valor': valor, 'Vencimento': new Date(Date.UTC(ano, m - 1, dia, 21, 59)).toISOString(),
        'Multa': 0, 'Total': valor, 'Estado': 'aberta' };
      if (e['Encarregado']) linha['Encarregado'] = e['Encarregado'];
      novas.push(linha);
    }
  }
  const criadas = novas.length ? await criarEmLote('propina', novas) : 0;
  res.json({ ok: true, criadas, pedidas: novas.length, turmas_sem_valor: semValor });
}));

app.post('/propinas', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, f = daEscola(req.escola);
  const filtros = b.turma ? f.concat([{ key: 'Turma', constraint_type: 'equals', value: String(b.turma) }]) : f;
  const [escola, props, est, encs] = await Promise.all([resumoEscola(req.escola), procurarTodos('propina', filtros, 6000), procurarTodos('estudante', filtros), procurarTodos('encarregado', f)]);
  const regras = (escola && escola.regras) || {};
  const porEst = {};
  for (const p of props) {
    if (p['Estado'] === 'anulada') continue;
    const c = calcPropina(p, regras);
    (porEst[p['Estudante']] = porEst[p['Estudante']] || []).push({ id: p._id, mes: p['Mes'], descricao: p['Descricao'], tipo: p['Tipo'] || 'propina', vencimento: p['Vencimento'], pago_em: p['Pago Em'] || null, ...c });
  }
  const lista = est.filter(e => (e['Estado'] || 'activo') === 'activo').map(e => {
    const en = encs.find(x => x._id === e['Encarregado']);
    const ps = (porEst[e._id] || []).sort((a, b) => (a.mes || 0) - (b.mes || 0));
    const divida = ps.filter(p => p.estado === 'atrasada').reduce((s, p) => s + p.total, 0);
    return { id: e._id, nome: e['Nome'], numero: e['Numero'], turma: e['Turma'], encarregado: en ? { nome: en['Nome'], telefone: en['Telefone'] || '' } : null, propinas: ps, divida };
  }).sort((a, b) => b.divida - a.divida || a.nome.localeCompare(b.nome, 'pt'));
  const tot = { cobrado: 0, divida: 0, multas: 0, atraso: 0 };
  lista.forEach(e => e.propinas.forEach(p => { if (p.estado === 'paga') tot.cobrado += p.total; if (p.estado === 'atrasada') { tot.divida += p.total; tot.multas += p.multa; } }));
  tot.atraso = lista.filter(e => e.divida > 0).length;
  res.json({ ok: true, estudantes: lista, totais: tot, regras });
}));

// ---------- cobrar ----------
async function prepararCobranca(req, ids) {
  if (!Array.isArray(ids) || !ids.length) { const e = new Error('Escolha pelo menos uma mensalidade.'); e.publico = 400; throw e; }
  const escola = await resumoEscola(req.escola);
  const ps = [];
  for (const id of ids.map(String)) {
    const p = await daMinhaEscola('propina', id, req.escola);
    if (p['Estado'] === 'paga') { const e = new Error('Uma das mensalidades escolhidas já está paga.'); e.publico = 409; throw e; }
    if (p['Estado'] === 'anulada') { const e = new Error('Uma das mensalidades escolhidas foi anulada.'); e.publico = 409; throw e; }
    if (req.educandos && !req.educandos.includes(p['Estudante'])) { const e = new Error('Registo não encontrado.'); e.publico = 404; throw e; }
    if (ps.length && ps[0].p['Estudante'] !== p['Estudante']) { const e = new Error('Cobre as mensalidades de um estudante de cada vez.'); e.publico = 400; throw e; }
    ps.push({ p, c: calcPropina(p, (escola && escola.regras) || {}) });
  }
  const total = ps.reduce((s, x) => s + x.c.total, 0), multa = ps.reduce((s, x) => s + x.c.multa, 0);
  return { escola, ps, total, multa };
}
// ============================================================
//  SMS (Turbo Host)
//  POST https://my.turbo.host/api/international-sms/submit
//  { user_token, origin, message, numbers:[ "2588XXXXXXXX" ] }
//  Variáveis: SMS_TOKEN (user_token), SMS_ORIGEM (origin), SMS_URL (opcional)
//  Todos os números saem com o prefixo 258.
// ============================================================
const SMS_URL = process.env.SMS_URL || 'https://my.turbo.host/api/international-sms/submit';
const SMS_TOKEN = process.env.SMS_TOKEN || '';
const SMS_ORIGEM = process.env.SMS_ORIGEM || '';
// 84 123 4567 / +258 84 123 4567 / 00258841234567  →  258841234567
function numeroSMS(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (d.indexOf('00258') === 0) d = d.slice(2);
  if (d.length === 9 && d[0] === '8') d = '258' + d;
  return /^2588[2-7]\d{7}$/.test(d) ? d : null;
}
// tira acentos e caracteres especiais para a mensagem caber num SMS normal (160 caracteres)
function textoSMS(m) {
  return String(m || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/º/g, 'o').replace(/ª/g, 'a').replace(/[^\x20-\x7E\n]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, 459);
}
async function enviarSMS(numeros, mensagem) {
  if (!SMS_TOKEN || !SMS_ORIGEM) return { ok: false, erro: 'SMS_TOKEN ou SMS_ORIGEM em falta no container' };
  const lista = [...new Set((Array.isArray(numeros) ? numeros : [numeros]).map(numeroSMS).filter(Boolean))];
  if (!lista.length) return { ok: false, erro: 'nenhum número válido' };
  const message = textoSMS(mensagem);
  if (!message) return { ok: false, erro: 'mensagem vazia' };
  try {
    const r = await fetch(SMS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ user_token: SMS_TOKEN, origin: SMS_ORIGEM, message, numbers: lista }) });
    const t = await r.text();
    console.log('[sms] ' + lista.join(',') + ' → ' + r.status + ' ' + t.slice(0, 300));
    let d = null; try { d = JSON.parse(t); } catch (e) { d = { raw: t }; }
    const falhou = !r.ok || (d && (d.success === false || d.ok === false || /error|erro|fail|invalid/i.test(String(d.status || ''))));
    if (falhou) return { ok: false, erro: String(achar(d, ['message', 'mensagem', 'error', 'erro']) || ('o serviço de SMS respondeu ' + r.status)).slice(0, 200), numeros: lista };
    return { ok: true, numeros: lista, resposta: d };
  } catch (e) {
    console.error('[sms]', e.message);
    return { ok: false, erro: e.message, numeros: lista };
  }
}
const mt = v => Number(v || 0).toLocaleString('pt-PT').replace(/\s/g, ' ') + ' MT';
// recibo por SMS: ao encarregado (se aceita SMS) e a quem pagou pelo telemóvel
async function smsRecibo(pag, documento) {
  try {
    const escola = await obter('escola', pag['Escola']).catch(() => null);
    const est = pag['Estudante'] ? await obter('estudante', pag['Estudante']).catch(() => null) : null;
    const enc = pag['Encarregado'] ? await obter('encarregado', pag['Encarregado']).catch(() => null) : null;
    const numeros = [];
    if (enc && enc['Recebe SMS'] !== false && enc['Telefone']) numeros.push(enc['Telefone']);
    if (['mpesa', 'emola'].includes(String(pag['Metodo'] || '').toLowerCase()) && pag['Telefone']) numeros.push(pag['Telefone']);
    if (!numeros.length) return;
    const qtd = (pag['Propinas'] || []).length;
    const msg = (escola ? escola['Nome'] + ': ' : '') + 'recebemos ' + mt(pag['Valor']) +
      (est ? ' de ' + est['Nome'] : '') + (qtd > 1 ? ' (' + qtd + ' mensalidades)' : '') +
      '. Recibo ' + documento + '. Obrigado. Gescolar';
    const r = await enviarSMS(numeros, msg);
    if (!r.ok) console.warn('[sms] recibo ' + documento + ' não enviado: ' + r.erro);
  } catch (e) { console.error('[sms] recibo', e.message); }
}
app.post('/sms-teste', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  if (!numeroSMS(b.numero)) return erro(res, 400, 'Número inválido. Use 9 dígitos, por exemplo 84 123 4567.');
  const escola = await resumoEscola(req.escola);
  const r = await enviarSMS([b.numero], txt(b.mensagem, 300) || ((escola ? escola.nome + ': ' : '') + 'teste de SMS do Gescolar. Se recebeu esta mensagem, esta tudo a funcionar.'));
  if (!r.ok) return erro(res, 502, 'O SMS não foi enviado: ' + r.erro);
  res.json({ ok: true, enviado_para: r.numeros });
}));

async function aplicarPago(pag, extra) {
  const agora = new Date().toISOString();
  const documento = await proximoDocumento(pag['Escola']);
  await mudar('pagamento', pag._id, Object.assign({ 'Estado': 'pago', 'Pago Em': agora, 'Documento': documento }, extra || {}));
  for (const pid of (pag['Propinas'] || [])) {
    const p = await obter('propina', pid).catch(() => null);
    const escola = p ? await resumoEscola(p['Escola']) : null;
    const c = p ? calcPropina(p, (escola && escola.regras) || {}) : { multa: 0, total: 0 };
    await mudar('propina', pid, { 'Estado': 'paga', 'Pago Em': agora, 'Pagamento': pag._id, 'Multa': c.multa, 'Total': c.total }).catch(e => console.error('[pago] propina ' + pid + ': ' + e.message));
  }
  smsRecibo(Object.assign({}, pag, extra || {}), documento);   // não espera: o SMS nunca atrasa o pagamento
  return documento;
}
async function proximoDocumento(escola) {
  const ano = new Date().getFullYear();
  const pagos = await procurarTodos('pagamento', [{ key: 'Escola', constraint_type: 'equals', value: escola }, { key: 'Documento', constraint_type: 'is_not_empty' }]);
  const maior = pagos.map(p => String(p['Documento'] || '')).filter(d => d.indexOf('FR ' + ano + '/') === 0)
    .map(d => parseInt(d.split('/')[1], 10) || 0).reduce((a, c) => Math.max(a, c), 0);
  return 'FR ' + ano + '/' + String(maior + 1).padStart(6, '0');
}

async function cobrarOnline(req, res) {
  const b = req.body || {};
  const metodo = String(b.metodo || '').toLowerCase();
  if (!['mpesa', 'emola', 'cartao'].includes(metodo)) return erro(res, 400, 'Escolha M-Pesa, e-Mola ou cartão.');
  if (!MOZ_WALLET) return erro(res, 500, 'O servidor ainda não tem a carteira configurada (MOZ_WALLET).');
  const { ps, total, multa } = await prepararCobranca(req, b.propinas);
  const est = ps[0].p['Estudante'] ? await obter('estudante', ps[0].p['Estudante']).catch(() => null) : null;
  const nome = txt(b.nome, 80) || (est && est['Nome']) || 'Encarregado';
  const numero = soDigitos(b.numero);
  if (metodo !== 'cartao') {
    if (numero.length !== 9) return erro(res, 400, 'O número tem 9 dígitos, por exemplo 84 123 4567.');
    const pre = numero.slice(0, 2);
    if (metodo === 'mpesa' && !['84', '85'].includes(pre)) return erro(res, 400, 'M-Pesa só funciona com números Vodacom (84 ou 85).');
    if (metodo === 'emola' && !['86', '87'].includes(pre)) return erro(res, 400, 'e-Mola só funciona com números Movitel (86 ou 87).');
  }
  const pagId = await criar('pagamento', { 'Escola': req.escola, 'Estudante': ps[0].p['Estudante'] || undefined, 'Encarregado': ps[0].p['Encarregado'] || undefined,
    'Propinas': ps.map(x => x.p._id), 'Metodo': metodo, 'Telefone': numero, 'Valor': total, 'Multa Incluida': multa, 'Estado': 'pendente' });
  const produto = ps.length === 1 ? (ps[0].p['Descricao'] || 'Propina') : ps.length + ' mensalidades · ' + ((est && est['Nome']) || '');
  try {
    if (metodo === 'cartao') {
      const d = await mozPedido(MOZ_CARD_PATH, { valor: String(total), nome_cliente: nome, carteira: MOZ_WALLET, nome_producto: produto.slice(0, 120) });
      const link = acharLink(d);
      if (!link) throw new Error('sem link na resposta: ' + JSON.stringify(d).slice(0, 220));
      const sessao = String(achar(d, ['session_id', 'sessionId', 'session']) || sessionDoLink(link) || '');
      await mudar('pagamento', pagId, { 'Referencia': sessao, 'Raw': JSON.stringify(d).slice(0, 4000) });
      return res.json({ ok: true, pagamento: pagId, estado: 'pendente', link, total });
    }
    const d = await mozPedido('payment', { wallet: MOZ_WALLET, payment_method: metodo, amount: String(total), number: numero, name: nome });
    const idp = achar(d, ['idpayment', 'id_payment', 'idPayment', 'payment_id', 'paymentId', 'reference', 'id']);
    await mudar('pagamento', pagId, { 'Referencia': idp ? String(idp) : '', 'Raw': JSON.stringify(d).slice(0, 4000) });
    res.json({ ok: true, pagamento: pagId, estado: 'pendente', total, mensagem: 'Pedido enviado para o ' + numero.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3') + '. O encarregado confirma com o PIN.' });
  } catch (e) {
    console.error('[pagar]', e.message);
    await mudar('pagamento', pagId, { 'Estado': 'falhado', 'Raw': String(e.message).slice(0, 2000) }).catch(() => {});
    erro(res, 502, 'A MozPayment não aceitou o pedido: ' + String(e.message).slice(0, 300));
  }
}
app.post('/pagar', exigeDireccao, rota(cobrarOnline));

app.post('/pagar-balcao', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const { ps, total, multa } = await prepararCobranca(req, b.propinas);
  const pagId = await criar('pagamento', { 'Escola': req.escola, 'Estudante': ps[0].p['Estudante'] || undefined, 'Encarregado': ps[0].p['Encarregado'] || undefined,
    'Propinas': ps.map(x => x.p._id), 'Metodo': 'balcao', 'Valor': total, 'Multa Incluida': multa, 'Estado': 'pendente', 'Recebido Por': req.sessao.u,
    'Referencia': 'CX-' + Date.now().toString(36).toUpperCase() });
  const pag = await obter('pagamento', pagId);
  const documento = await aplicarPago(pag, { 'Transacao': 'numerario' });
  res.json({ ok: true, pagamento: pagId, estado: 'pago', documento, total });
}));

app.post('/pagamento-estado', exigeDireccao, rota(async (req, res) => {
  const p = await daMinhaEscola('pagamento', String((req.body || {}).id || ''), req.escola);
  res.json({ ok: true, id: p._id, estado: p['Estado'] || 'pendente', documento: p['Documento'] || null, valor: p['Valor'] || 0, metodo: p['Metodo'] || '' });
}));

app.post('/pagamentos', exigeDireccao, rota(async (req, res) => {
  const f = daEscola(req.escola);
  const [pags, est] = await Promise.all([procurarTodos('pagamento', f, 3000), procurarTodos('estudante', f)]);
  res.json({ ok: true, pagamentos: pags.filter(p => p['Estado'] === 'pago').map(p => { const e = est.find(x => x._id === p['Estudante']);
    return { id: p._id, documento: p['Documento'], data: p['Pago Em'], metodo: p['Metodo'], valor: p['Valor'], multa: p['Multa Incluida'] || 0, estudante: e ? e['Nome'] : '', numero: e ? e['Numero'] : '', referencia: p['Referencia'] || '', transacao: p['Transacao'] || '', telefone: p['Telefone'] || '' }; })
    .sort((a, b) => String(b.data).localeCompare(String(a.data))) });
}));

// ============================================================
//  DADOS DA ESCOLA PARA AS FACTURAS (v4.2)
//  Campos novos no Bubble, data type Escola:  Logotipo (text)  ·  Morada (text)
//  O logótipo fica guardado como imagem em texto (data:image/...;base64), pequeno (até 300 KB),
//  para o PDF sair sempre com ele, sem depender de outro servidor.
// ============================================================
const LOGO_MAX = 300 * 1024;
function escolaFactura(e) {
  return { id: e._id, nome: e['Nome'] || '', nuit: e['NUIT'] || '', morada: e['Morada'] || '', cidade: e['Cidade'] || '', provincia: e['Provincia'] || '',
    telefone: e['Telefone'] || '', email: e['Email'] || '', subdominio: e['Subdominio'] || '', logotipo: e['Logotipo'] || '' };
}
app.post('/escola-dados', exigeDireccao, rota(async (req, res) => {
  const e = await obter('escola', req.escola);
  res.json({ ok: true, escola: escolaFactura(e) });
}));
app.post('/escola-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const mud = {};
  if (b.logotipo !== undefined) {
    const l = String(b.logotipo || '');
    if (l && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(l)) return erro(res, 400, 'O logótipo tem de ser uma imagem PNG, JPG ou WEBP.');
    if (l.length > LOGO_MAX) return erro(res, 400, 'O logótipo é demasiado grande. Use uma imagem mais pequena.');
    mud['Logotipo'] = l;
  }
  if (b.morada !== undefined) mud['Morada'] = txt(b.morada, 160);
  if (b.telefone !== undefined) mud['Telefone'] = txt(b.telefone, 30);
  if (b.email !== undefined) {
    const em = txt(b.email, 120).toLowerCase();
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return erro(res, 400, 'O email da escola não parece válido.');
    mud['Email'] = em;
  }
  if (!Object.keys(mud).length) return erro(res, 400, 'Nada para guardar.');
  await mudar('escola', req.escola, mud);
  const e = await obter('escola', req.escola);
  res.json({ ok: true, escola: escolaFactura(e) });
}));

// ---------- factura-recibo ----------
// Quem pode ver: a Direcção/Secretaria da escola do pagamento.
// (Na área do Estudante e do Encarregado, cada um verá só os seus — próxima fase.)
async function dadosRecibo(pag) {
  const [escola, est, enc] = await Promise.all([
    obter('escola', pag['Escola']).catch(() => null),
    pag['Estudante'] ? obter('estudante', pag['Estudante']).catch(() => null) : null,
    pag['Encarregado'] ? obter('encarregado', pag['Encarregado']).catch(() => null) : null
  ]);
  const turma = est && est['Turma'] ? await obter('turma', est['Turma']).catch(() => null) : null;
  const props = await Promise.all((pag['Propinas'] || []).map(id => obter('propina', id).catch(() => null)));
  const linhas = props.filter(Boolean).map(p => {
    const valor = Number(p['Valor'] || 0), multa = Number(p['Multa'] || 0);
    return { descricao: p['Descricao'] || 'Propina', vencimento: p['Vencimento'] || null, valor, multa, total: Number(p['Total'] || (valor + multa)) };
  }).sort((a, b) => String(a.vencimento || '').localeCompare(String(b.vencimento || '')));
  const recebido = pag['Recebido Por'] ? await obter('user', pag['Recebido Por']).catch(() => null) : null;
  return {
    escola: escola ? escolaFactura(escola) : { nome: '' },
    id: pag._id, documento: pag['Documento'] || '', data: pag['Pago Em'] || pag['Created Date'] || null,
    metodo: pag['Metodo'] || '', referencia: pag['Referencia'] || '', transacao: pag['Transacao'] || '', telefone: pag['Telefone'] || '',
    valor: Number(pag['Valor'] || 0), multa: Number(pag['Multa Incluida'] || 0),
    estudante: est ? { nome: est['Nome'] || '', numero: est['Numero'] || '', turma: turma ? (turma['Nome'] || '') : '' } : null,
    encarregado: enc ? { nome: enc['Nome'] || '', telefone: enc['Telefone'] || '', email: enc['Email'] || '' } : null,
    recebido_por: recebido ? (recebido['Nome Completo'] || '') : '',
    linhas
  };
}
app.post('/recibo', exigeQualquer, rota(async (req, res) => {
  const p = await daMinhaEscola('pagamento', String((req.body || {}).id || ''), req.escola);
  if (req.educandos && !req.educandos.includes(p['Estudante'])) return erro(res, 404, 'Registo não encontrado.');
  if (p['Estado'] !== 'pago' || !p['Documento']) return erro(res, 409, 'Este pagamento ainda não está confirmado, por isso ainda não tem factura-recibo.');
  res.json({ ok: true, recibo: await dadosRecibo(p) });
}));

// ============================================================
//  PORTAL DAS FAMÍLIAS (v4.3) — Encarregado e Estudante
//  Entrada sem palavra-passe: código da escola + telemóvel (encarregado) ou número de estudante,
//  e um código de 6 dígitos enviado por SMS. A sessão dura 30 dias.
//  Campo novo no Bubble (opcional): Estudante → Telefone (text), para estudantes com telemóvel próprio.
// ============================================================
const PORTAL_DIAS = 30;
const PORTAL_URL = (process.env.PORTAL_URL || 'https://djdesigncreator.github.io/gescolar-web/acesso.html').replace(/\/+$/, '');
const pedidosAcesso = new Map();
setInterval(() => { const a = Date.now(); for (const [k, v] of pedidosAcesso) if (v.exp < a) pedidosAcesso.delete(k); }, 300e3).unref();
const hashCodigo = c => crypto.createHmac('sha256', SESSION_SECRET || 'x').update(String(c)).digest('hex');
const tel9 = t => soDigitos(t).replace(/^00258/, '').replace(/^258(?=\d{9}$)/, '');
const mascarar = t => { const d = tel9(t); return d.length === 9 ? d.slice(0, 2) + ' *** **' + d.slice(7) : '***'; };
function linkFamilias(sub) { return PORTAL_URL + '?e=' + encodeURIComponent(sub || ''); }

async function escolaPorCodigo(codigo) {
  const c = slug(String(codigo || '').replace(/\.gescolar\.co\.mz.*$/i, ''));
  if (!c) return null;
  const l = await procurar('escola', [{ key: 'Subdominio', constraint_type: 'equals', value: c }], 1);
  return l[0] || null;
}
async function educandosDe(s) {
  if (s.p === 'Estudante') return [s.u];
  const l = await procurarTodos('estudante', [{ key: 'Escola', constraint_type: 'equals', value: s.e }, { key: 'Encarregado', constraint_type: 'equals', value: s.u }], 50);
  return l.filter(e => (e['Estado'] || 'activo') === 'activo').map(e => e._id);
}
async function abrirSessaoPortal(s) {
  const tipo = s.p === 'Estudante' ? 'estudante' : s.p === 'Professor' ? 'professor' : 'encarregado';
  const eu = await obter(tipo, s.u).catch(() => null);
  if (!eu || eu['Escola'] !== s.e) { const e = new Error('Conta não encontrada. Entre outra vez.'); e.publico = 401; throw e; }
  if ((tipo === 'encarregado' || tipo === 'professor') && eu['Activo'] === false) { const e = new Error('Este acesso foi desactivado. Fale com a escola.'); e.publico = 403; throw e; }
  if (tipo === 'estudante' && (eu['Estado'] || 'activo') !== 'activo') { const e = new Error('Este estudante já não está activo na escola.'); e.publico = 403; throw e; }
  const escola = await resumoEscola(s.e);
  if (escola && escola.estado === 'suspensa') { const e = new Error('O acesso desta escola está suspenso. Fale com a escola.'); e.publico = 402; throw e; }
  const token = assinar({ u: s.u, e: s.e, p: s.p, t: 'portal' }, PORTAL_DIAS);
  return { ok: true, token, nome: eu['Nome'] || '', papel: s.p, pagina: tipo === 'professor' ? 'professor' : 'portal', escola, expira_dias: PORTAL_DIAS };
}
async function exigePortal(req, res, next) {
  const s = sessaoDo(req);
  if (!s) return erro(res, 401, 'A sessão terminou. Entre outra vez.');
  if (s.t !== 'portal' || !s.e || (s.p !== 'Estudante' && s.p !== 'Encarregado')) return erro(res, 403, 'Esta página é para encarregados e estudantes.');
  try { req.sessao = s; req.escola = s.e; req.educandos = await educandosDe(s); next(); }
  catch (e) { console.error('[portal]', e.message); erro(res, 500, 'Não foi possível concluir. Tente de novo.'); }
}
function exigeQualquer(req, res, next) {
  const s = sessaoDo(req);
  if (s && s.t === 'portal') return exigePortal(req, res, next);
  return exigeDireccao(req, res, next);
}

// 1) pede o código
app.post('/acesso-codigo', rota(async (req, res) => {
  if (!SESSION_SECRET) return erro(res, 500, 'O servidor ainda não está configurado (SESSION_SECRET).');
  const b = req.body || {};
  const tipo = b.tipo === 'estudante' ? 'estudante' : b.tipo === 'professor' ? 'professor' : 'encarregado';
  if (travao('acesso-ip|' + req.ip, 12, 15)) return erro(res, 429, 'Muitos pedidos seguidos. Espere 15 minutos.');
  const esc = await escolaPorCodigo(b.escola);
  if (!esc) return erro(res, 404, 'Não encontrámos essa escola. Confirme o código da escola com a secretaria.');
  if (esc['Estado'] === 'suspensa') return erro(res, 402, 'O acesso desta escola está suspenso. Fale com a escola.');
  let alvo = null, destino = '';
  if (tipo === 'professor') {
    const tel = tel9(b.telefone);
    if (tel.length !== 9) return erro(res, 400, 'Escreva o seu número de telemóvel com 9 dígitos.');
    const profs = await procurarTodos('professor', daEscola(esc._id));
    alvo = profs.find(x => tel9(x['Telefone']) === tel && x['Activo'] !== false);
    if (!alvo) return erro(res, 404, 'Este número não está registado como professor nesta escola. Peça à Direcção para confirmar o seu número.');
    destino = tel;
  } else if (tipo === 'encarregado') {
    const tel = tel9(b.telefone);
    if (tel.length !== 9) return erro(res, 400, 'Escreva o seu número de telemóvel com 9 dígitos.');
    const encs = await procurarTodos('encarregado', daEscola(esc._id));
    alvo = encs.find(e => tel9(e['Telefone']) === tel && e['Activo'] !== false);
    if (!alvo) return erro(res, 404, 'Este número não está registado como encarregado nesta escola. Peça à secretaria para confirmar o seu número.');
    destino = tel;
  } else {
    const num = txt(b.numero, 30).toUpperCase().replace(/\s+/g, '');
    if (!num) return erro(res, 400, 'Escreva o seu número de estudante.');
    const l = await procurar('estudante', [{ key: 'Escola', constraint_type: 'equals', value: esc._id }, { key: 'Numero', constraint_type: 'equals', value: num }], 1);
    alvo = l[0];
    if (!alvo || (alvo['Estado'] || 'activo') !== 'activo') return erro(res, 404, 'Não encontrámos esse número de estudante nesta escola.');
    destino = tel9(alvo['Telefone']);
    if (destino.length !== 9 && alvo['Encarregado']) { const en = await obter('encarregado', alvo['Encarregado']).catch(() => null); destino = en ? tel9(en['Telefone']) : ''; }
    if (destino.length !== 9) return erro(res, 409, 'Ainda não há telemóvel registado para este estudante. Peça à secretaria para registar o seu número ou o do encarregado.');
  }
  if (travao('acesso|' + alvo._id, 3, 15)) return erro(res, 429, 'Já enviámos vários códigos. Espere 15 minutos e tente de novo.');
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const pedido = crypto.randomBytes(16).toString('hex');
  const r = await enviarSMS([destino], esc['Nome'] + ': o seu codigo de acesso ao Gescolar e ' + codigo + '. Valido 10 minutos. Nao partilhe este codigo.');
  if (!r.ok) return erro(res, 502, 'Não foi possível enviar o SMS agora. Tente de novo dentro de um minuto.');
  pedidosAcesso.set(pedido, { escola: esc._id, tipo, id: alvo._id, hash: hashCodigo(pedido + codigo), exp: Date.now() + 600e3, tent: 0 });
  res.json({ ok: true, pedido, destino: mascarar(destino), escola: esc['Nome'] || '' });
}));
// 2) confirma o código e abre a sessão
app.post('/acesso-entrar', rota(async (req, res) => {
  const b = req.body || {}, chave = String(b.pedido || '');
  const pd = pedidosAcesso.get(chave);
  if (!pd || pd.exp < Date.now()) return erro(res, 410, 'O código expirou. Peça um novo.');
  pd.tent++;
  if (pd.tent > 5) { pedidosAcesso.delete(chave); return erro(res, 429, 'Demasiadas tentativas. Peça um novo código.'); }
  const cod = soDigitos(b.codigo);
  const a = Buffer.from(hashCodigo(chave + cod)), c = Buffer.from(pd.hash);
  if (cod.length !== 6 || a.length !== c.length || !crypto.timingSafeEqual(a, c)) return erro(res, 401, 'Código errado. Confirme o SMS e tente de novo (' + (5 - pd.tent) + ' tentativas restantes).');
  pedidosAcesso.delete(chave);
  res.json(await abrirSessaoPortal({ u: pd.id, e: pd.escola, p: pd.tipo === 'estudante' ? 'Estudante' : pd.tipo === 'professor' ? 'Professor' : 'Encarregado' }));
}));

// tudo o que o portal mostra, num só pedido
app.post('/p/inicio', exigePortal, rota(async (req, res) => {
  const s = req.sessao;
  const [escRaw, eu, escola] = await Promise.all([obter('escola', req.escola), obter(s.p === 'Estudante' ? 'estudante' : 'encarregado', s.u), resumoEscola(req.escola)]);
  const regras = (escola && escola.regras) || {};
  const ests = (await Promise.all(req.educandos.map(id => obter('estudante', id).catch(() => null)))).filter(Boolean);
  const turmaIds = [...new Set(ests.map(e => e['Turma']).filter(Boolean))];
  const turmas = {}; (await Promise.all(turmaIds.map(id => obter('turma', id).catch(() => null)))).filter(Boolean).forEach(t => { turmas[t._id] = t; });
  const cache = {};
  const educandos = await Promise.all(ests.map(async e => {
    const f = [{ key: 'Escola', constraint_type: 'equals', value: req.escola }, { key: 'Estudante', constraint_type: 'equals', value: e._id }];
    const [props, pags] = await Promise.all([procurarTodos('propina', f, 600), procurarTodos('pagamento', f, 600)]);
    const ps = props.filter(p => p['Estado'] !== 'anulada').map(p => ({ id: p._id, mes: p['Mes'], descricao: p['Descricao'], tipo: p['Tipo'] || 'propina', vencimento: p['Vencimento'], pago_em: p['Pago Em'] || null, ...calcPropina(p, regras) }))
      .sort((a, b) => String(a.vencimento || '').localeCompare(String(b.vencimento || '')));
    const t = turmas[e['Turma']];
    return {
      id: e._id, nome: e['Nome'] || '', numero: e['Numero'] || '', turma: t ? (t['Nome'] || '') : '',
      horario: await horarioDaTurma(req.escola, e['Turma'], cache).catch(err => { console.error('[portal] horário', err.message); return null; }),
      faltas: await faltasDoEstudante(req.escola, e._id, cache).catch(err => { console.error('[portal] faltas', err.message); return []; }),
      notas: await notasDoEstudante(req.escola, e, cache).catch(err => { console.error('[portal] notas', err.message); return []; }),
      comunicados: await comunicadosPara(req.escola, [e['Turma']].filter(Boolean), cache).catch(err => { console.error('[portal] comunicados', err.message); return []; }),
      propinas: ps,
      divida: ps.filter(p => p.estado === 'atrasada').reduce((x, p) => x + p.total, 0),
      em_aberto: ps.filter(p => p.estado !== 'paga').reduce((x, p) => x + p.total, 0),
      recibos: pags.filter(p => p['Estado'] === 'pago' && p['Documento']).map(p => ({ id: p._id, documento: p['Documento'], data: p['Pago Em'], metodo: p['Metodo'], valor: Number(p['Valor'] || 0), multa: Number(p['Multa Incluida'] || 0) }))
        .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
    };
  }));
  let telefone = tel9(eu && eu['Telefone']);
  if (telefone.length !== 9 && s.p === 'Estudante' && eu && eu['Encarregado']) { const en = await obter('encarregado', eu['Encarregado']).catch(() => null); telefone = en ? tel9(en['Telefone']) : ''; }
  res.json({ ok: true,
    eu: { nome: (eu && eu['Nome']) || '', papel: s.p, telefone: telefone.length === 9 ? telefone : '' },
    escola: { nome: escRaw['Nome'] || '', logotipo: escRaw['Logotipo'] || '', telefone: escRaw['Telefone'] || '', email: escRaw['Email'] || '', ano: escRaw['Ano Lectivo'] || '', regras: Object.assign({}, regras, { aprovacao: Number(regras.aprovacao || 10), dispensa: Number(regras.dispensa || 14) }) },
    educandos: educandos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')) });
}));
app.post('/p/pagar', exigePortal, rota(cobrarOnline));
app.post('/p/pagamento-estado', exigePortal, rota(async (req, res) => {
  const p = await daMinhaEscola('pagamento', String((req.body || {}).id || ''), req.escola);
  if (!req.educandos.includes(p['Estudante'])) return erro(res, 404, 'Registo não encontrado.');
  res.json({ ok: true, id: p._id, estado: p['Estado'] || 'pendente', documento: p['Documento'] || null, valor: p['Valor'] || 0, metodo: p['Metodo'] || '' });
}));

// Direcção: link do portal e convite por SMS aos encarregados
app.post('/familias-link', exigeDireccao, rota(async (req, res) => {
  const [esc, encs] = await Promise.all([obter('escola', req.escola), procurarTodos('encarregado', daEscola(req.escola))]);
  const comTel = encs.filter(e => e['Activo'] !== false && e['Recebe SMS'] !== false && tel9(e['Telefone']).length === 9);
  res.json({ ok: true, link: linkFamilias(esc['Subdominio']), codigo: esc['Subdominio'] || '', encarregados: encs.length, com_telefone: comTel.length });
}));
app.post('/familias-convite', exigeDireccao, rota(async (req, res) => {
  if (travao('convite|' + req.escola, 1, 60)) return erro(res, 429, 'O convite já foi enviado há pouco. Pode voltar a enviar daqui a uma hora.');
  const [esc, encs] = await Promise.all([obter('escola', req.escola), procurarTodos('encarregado', daEscola(req.escola))]);
  const nums = [...new Set(encs.filter(e => e['Activo'] !== false && e['Recebe SMS'] !== false).map(e => tel9(e['Telefone'])).filter(t => t.length === 9))];
  if (!nums.length) return erro(res, 400, 'Ainda não há encarregados com telemóvel registado.');
  const link = linkFamilias(esc['Subdominio']).replace(/^https?:\/\//, '');
  const msg = (esc['Nome'] || 'A escola') + ': ja pode ver propinas, recibos e notas do seu educando e pagar por M-Pesa ou e-Mola. Entre em ' + link + ' com o seu numero de telemovel.';
  let enviados = 0, falhas = 0;
  for (let i = 0; i < nums.length; i += 50) {
    const r = await enviarSMS(nums.slice(i, i + 50), msg);
    if (r.ok) enviados += r.numeros.length; else falhas += nums.slice(i, i + 50).length;
  }
  if (!enviados) return erro(res, 502, 'Não foi possível enviar os SMS agora. Tente mais tarde.');
  res.json({ ok: true, enviados, falhas });
}));

// ============================================================
//  HORÁRIOS (v4.4)
//  Bubble, data type Horario: Escola (Escola) · Turma (text) · Grelha (text) · Publicado (yes/no)
//  Um registo por turma. A grelha é um JSON:
//   { dias:[1..6], tempos:[{i:"07:00",f:"07:45"}], aulas:{ "<dia>-<tempo>": { d:<disciplina>, p:<professor>, s:"sala" } } }
// ============================================================
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIAS_N = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
function lerGrelha(t) { try { const g = JSON.parse(t || ''); return g && typeof g === 'object' ? g : null; } catch (e) { return null; } }
function validarGrelha(g, discIds, profIds) {
  if (!g || typeof g !== 'object') return 'Horário inválido.';
  const dias = Array.isArray(g.dias) ? [...new Set(g.dias.map(Number))].filter(d => d >= 1 && d <= 6).sort() : [];
  if (!dias.length) return 'Escolha os dias de aulas.';
  const tempos = Array.isArray(g.tempos) ? g.tempos : [];
  if (!tempos.length || tempos.length > 14) return 'O horário tem de ter entre 1 e 14 tempos.';
  for (let k = 0; k < tempos.length; k++) {
    const t = tempos[k] || {};
    if (!HORA.test(t.i || '') || !HORA.test(t.f || '') || t.i >= t.f) return 'O ' + (k + 1) + 'º tempo tem horas inválidas (use 07:30 a 08:15).';
    if (k && tempos[k - 1].f > t.i) return 'O ' + (k + 1) + 'º tempo começa antes do anterior acabar.';
  }
  const aulas = {};
  for (const [chave, a] of Object.entries(g.aulas || {})) {
    const m = /^([1-6])-(\d{1,2})$/.exec(chave);
    if (!m || !dias.includes(Number(m[1])) || Number(m[2]) >= tempos.length || !a) continue;
    if (!a.d || !discIds.has(String(a.d))) continue;
    aulas[chave] = { d: String(a.d), p: a.p && profIds.has(String(a.p)) ? String(a.p) : '', s: txt(a.s, 30) };
  }
  return { dias, tempos: tempos.map(t => ({ i: t.i, f: t.f })), aulas };
}
// professor em duas turmas à mesma hora?
function conflitos(grelha, turmaId, outros, nomes) {
  const out = [];
  for (const [chave, a] of Object.entries(grelha.aulas)) {
    if (!a.p) continue;
    const [dia, ti] = chave.split('-').map(Number), t = grelha.tempos[ti];
    for (const o of outros) {
      if (o.turma === turmaId || !o.grelha) continue;
      for (const [ck, b] of Object.entries(o.grelha.aulas || {})) {
        if (b.p !== a.p) continue;
        const [od, oti] = ck.split('-').map(Number), ot = (o.grelha.tempos || [])[oti];
        if (od !== dia || !ot || !(t.i < ot.f && ot.i < t.f)) continue;
        out.push((nomes.prof[a.p] || 'Um professor') + ' já tem aula na turma ' + (nomes.turma[o.turma] || '?') + ' à ' + DIAS_N[dia] + ', ' + ot.i + '–' + ot.f + '.');
      }
    }
  }
  return [...new Set(out)];
}
app.post('/horarios', exigeDireccao, rota(async (req, res) => {
  const f = daEscola(req.escola);
  const [turmas, discs, profs, hs] = await Promise.all([procurarTodos('turma', f), procurarTodos('disciplina', f), procurarTodos('professor', f), procurarTodos('horario', f)]);
  res.json({ ok: true,
    turmas: turmas.filter(t => t['Activa'] !== false).map(t => turmaOut(t)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')),
    disciplinas: discs.map(discOut).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')),
    professores: profs.filter(p => p['Activo'] !== false).map(p => ({ id: p._id, nome: p['Nome'] || '', disciplinas: p['Disciplinas'] || [] })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')),
    horarios: hs.map(h => ({ id: h._id, turma: h['Turma'], publicado: !!h['Publicado'], grelha: lerGrelha(h['Grelha']), actualizado: h['Modified Date'] || null })).filter(h => h.grelha) });
}));
app.post('/horario-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, f = daEscola(req.escola);
  const turma = await daMinhaEscola('turma', String(b.turma || ''), req.escola);
  const [discs, profs, hs, turmas] = await Promise.all([procurarTodos('disciplina', f), procurarTodos('professor', f), procurarTodos('horario', f), procurarTodos('turma', f)]);
  const g = validarGrelha(b.grelha, new Set(discs.map(d => d._id)), new Set(profs.map(p => p._id)));
  if (typeof g === 'string') return erro(res, 400, g);
  const nomes = { prof: Object.fromEntries(profs.map(p => [p._id, p['Nome']])), turma: Object.fromEntries(turmas.map(t => [t._id, t['Nome']])) };
  const cf = conflitos(g, turma._id, hs.map(h => ({ turma: h['Turma'], grelha: lerGrelha(h['Grelha']) })), nomes);
  if (cf.length) return res.status(409).json({ ok: false, erro: 'Há professores com aulas sobrepostas.', conflitos: cf.slice(0, 8) });
  const campos = { 'Escola': req.escola, 'Turma': turma._id, 'Grelha': JSON.stringify(g), 'Publicado': !!b.publicado };
  const ja = hs.find(h => h['Turma'] === turma._id);
  const id = ja ? (await mudar('horario', ja._id, campos), ja._id) : await criar('horario', campos);
  res.json({ ok: true, id, grelha: g, publicado: !!b.publicado, aulas: Object.keys(g.aulas).length });
}));
// horário pronto a mostrar (nomes em vez de ids) — usado pelo portal
async function horarioDaTurma(escola, turmaId, cache) {
  if (!turmaId) return null;
  const hs = cache.hs || (cache.hs = await procurarTodos('horario', daEscola(escola)));
  const h = hs.find(x => x['Turma'] === turmaId && x['Publicado']);
  const g = h && lerGrelha(h['Grelha']);
  if (!g) return null;
  if (!cache.disc) {
    const [discs, profs] = await Promise.all([procurarTodos('disciplina', daEscola(escola)), procurarTodos('professor', daEscola(escola))]);
    cache.disc = Object.fromEntries(discs.map(d => [d._id, { nome: d['Nome'] || '', cor: d['Cor'] || '#0A64DC', sigla: d['Sigla'] || '' }]));
    cache.prof = Object.fromEntries(profs.map(p => [p._id, p['Nome'] || '']));
  }
  const aulas = {};
  for (const [k, a] of Object.entries(g.aulas || {})) { const d = cache.disc[a.d]; if (d) aulas[k] = { disciplina: d.nome, sigla: d.sigla, cor: d.cor, professor: cache.prof[a.p] || '', sala: a.s || '' }; }
  return { dias: g.dias, tempos: g.tempos, aulas };
}

// ============================================================
//  COMUNICADOS (v4.4)
//  Bubble, data type Comunicado: Escola (Escola) · Titulo (text) · Texto (text) · Turma (text, vazio = toda a escola)
//                               · Autor (text) · Publicado Em (date) · SMS Enviados (number)
// ============================================================
const comOut = (c, turmas) => ({ id: c._id, titulo: c['Titulo'] || '', texto: c['Texto'] || '', turma: c['Turma'] || '', turma_nome: c['Turma'] ? ((turmas || {})[c['Turma']] || '') : '', autor: c['Autor'] || '', data: c['Publicado Em'] || c['Created Date'] || null, sms: Number(c['SMS Enviados'] || 0) });
app.post('/comunicados', exigeDireccao, rota(async (req, res) => {
  const f = daEscola(req.escola);
  const [cs, turmas] = await Promise.all([procurarTodos('comunicado', f, 500), procurarTodos('turma', f)]);
  const tn = Object.fromEntries(turmas.map(t => [t._id, t['Nome']]));
  res.json({ ok: true, comunicados: cs.map(c => comOut(c, tn)).sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))) });
}));
app.post('/comunicado-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const titulo = txt(b.titulo, 120), texto = txt(b.texto, 3000);
  if (titulo.length < 3) return erro(res, 400, 'Escreva um título.');
  if (texto.length < 3) return erro(res, 400, 'Escreva o texto do comunicado.');
  let turma = null;
  if (b.turma) turma = await daMinhaEscola('turma', String(b.turma), req.escola);
  const [esc, eu] = await Promise.all([obter('escola', req.escola), obter('user', req.sessao.u).catch(() => null)]);
  const id = await criar('comunicado', { 'Escola': req.escola, 'Titulo': titulo, 'Texto': texto, 'Turma': turma ? turma._id : '', 'Autor': (eu && eu['Nome Completo']) || 'Direcção', 'Publicado Em': new Date().toISOString(), 'SMS Enviados': 0 });
  let sms = 0, aviso = '';
  if (b.sms) {
    if (travao('com-sms|' + req.escola, 6, 60)) aviso = 'O comunicado foi publicado, mas o SMS não foi enviado: limite de 6 envios por hora.';
    else {
      const f = daEscola(req.escola);
      const [ests, encs] = await Promise.all([procurarTodos('estudante', turma ? f.concat([{ key: 'Turma', constraint_type: 'equals', value: turma._id }]) : f), procurarTodos('encarregado', f)]);
      const encIds = new Set(ests.filter(e => (e['Estado'] || 'activo') === 'activo').map(e => e['Encarregado']).filter(Boolean));
      const nums = [...new Set(encs.filter(e => encIds.has(e._id) && e['Activo'] !== false && e['Recebe SMS'] !== false).map(e => tel9(e['Telefone'])).filter(t => t.length === 9))];
      const curto = texto.length > 120 ? texto.slice(0, 117).replace(/\s+\S*$/, '') + '...' : texto;
      const msg = (esc['Nome'] || 'Escola') + ': ' + titulo + '. ' + curto + (texto.length > 120 ? ' Veja tudo em ' + linkFamilias(esc['Subdominio']).replace(/^https?:\/\//, '') : '');
      for (let i = 0; i < nums.length; i += 50) { const r = await enviarSMS(nums.slice(i, i + 50), msg); if (r.ok) sms += r.numeros.length; }
      if (sms) await mudar('comunicado', id, { 'SMS Enviados': sms }).catch(() => {});
      else if (!nums.length) aviso = 'O comunicado foi publicado. Não há encarregados com telemóvel para receber o SMS.';
      else aviso = 'O comunicado foi publicado, mas o SMS falhou. Tente mais tarde.';
    }
  }
  res.json({ ok: true, id, sms, aviso });
}));
app.post('/comunicado-apagar', exigeDireccao, rota(async (req, res) => {
  const c = await daMinhaEscola('comunicado', String((req.body || {}).id || ''), req.escola);
  await apagar('comunicado', c._id);
  res.json({ ok: true });
}));
async function comunicadosPara(escola, turmaIds, cache) {
  const cs = cache.cs || (cache.cs = await procurarTodos('comunicado', daEscola(escola), 500));
  return cs.filter(c => !c['Turma'] || turmaIds.includes(c['Turma'])).map(c => comOut(c)).sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))).slice(0, 30);
}

// ============================================================
//  PROFESSORES E NOTAS (v4.5)
//  Bubble, data type novo Pauta: Escola (Escola) · Turma (text) · Disciplina (text) · Trimestre (number)
//                                · Grelha (text) · Publicado (yes/no) · Actualizado Por (text)
//  Uma pauta por turma × disciplina × trimestre. Grelha JSON:
//   { colunas:[{id:"acs1",tipo:"ACS",nome:"ACS 1"}, …, {id:"acp",tipo:"ACP",nome:"ACP"}], notas:{ <estudante>:{ acs1:14, acp:12.5 } } }
//  Média do trimestre (ensino geral em Moçambique): MT = (2 × MACS + ACP) / 3 ; sem ACP, MT = MACS
// ============================================================
function exigeProfessor(req, res, next) {
  const s = sessaoDo(req);
  if (!s) return erro(res, 401, 'A sessão terminou. Entre outra vez.');
  if (s.t !== 'portal' || s.p !== 'Professor' || !s.e) return erro(res, 403, 'Esta página é para professores.');
  req.sessao = s; req.escola = s.e; next();
}
const r1 = n => Math.round(n * 10) / 10;
function mediasPauta(g, estId) {
  const n = ((g && g.notas) || {})[estId] || {};
  const acs = (g.colunas || []).filter(c => c.tipo === 'ACS').map(c => n[c.id]).filter(v => typeof v === 'number');
  const acpCol = (g.colunas || []).find(c => c.tipo === 'ACP');
  const acp = acpCol && typeof n[acpCol.id] === 'number' ? n[acpCol.id] : null;
  const macs = acs.length ? r1(acs.reduce((a, b) => a + b, 0) / acs.length) : null;
  let mt = null;
  if (macs !== null && acp !== null) mt = r1((2 * macs + acp) / 3);
  else if (macs !== null) mt = macs;
  else if (acp !== null) mt = acp;
  return { macs, acp, mt, completa: macs !== null && acp !== null };
}
function validarPauta(g, estIds) {
  if (!g || typeof g !== 'object') return 'Pauta inválida.';
  const cols = Array.isArray(g.colunas) ? g.colunas : [];
  const vistos = new Set(), colunas = [];
  for (const c of cols) {
    const id = String((c && c.id) || '').toLowerCase();
    if (!/^[a-z0-9]{1,10}$/.test(id) || vistos.has(id)) continue;
    const tipo = c.tipo === 'ACP' ? 'ACP' : 'ACS';
    if (tipo === 'ACP' && colunas.some(x => x.tipo === 'ACP')) continue;
    vistos.add(id); colunas.push({ id, tipo, nome: txt(c.nome, 16) || (tipo === 'ACP' ? 'ACP' : 'ACS') });
  }
  if (!colunas.length) return 'A pauta precisa de pelo menos uma coluna de avaliação.';
  if (colunas.length > 10) return 'No máximo 10 colunas por trimestre.';
  const notas = {}, ids = new Set(colunas.map(c => c.id));
  for (const [est, linha] of Object.entries(g.notas || {})) {
    if (!estIds.has(est) || !linha || typeof linha !== 'object') continue;
    const l = {};
    for (const [cid, v] of Object.entries(linha)) {
      if (!ids.has(cid) || v === null || v === '' || v === undefined) continue;
      const n = Number(String(v).replace(',', '.'));
      if (!isFinite(n) || n < 0 || n > 20) return 'As notas vão de 0 a 20. Verifique a nota ' + v + '.';
      l[cid] = r1(n);
    }
    if (Object.keys(l).length) notas[est] = l;
  }
  return { colunas, notas };
}
const PAUTA_NOVA = () => ({ colunas: [{ id: 'acs1', tipo: 'ACS', nome: 'ACS 1' }, { id: 'acs2', tipo: 'ACS', nome: 'ACS 2' }, { id: 'acs3', tipo: 'ACS', nome: 'ACS 3' }, { id: 'acp', tipo: 'ACP', nome: 'ACP' }], notas: {} });
const trimestreOk = t => [1, 2, 3].includes(Number(t));
async function pautaDe(escola, turma, disciplina, trimestre) {
  const l = await procurar('pauta', [{ key: 'Escola', constraint_type: 'equals', value: escola }, { key: 'Turma', constraint_type: 'equals', value: turma },
    { key: 'Disciplina', constraint_type: 'equals', value: disciplina }, { key: 'Trimestre', constraint_type: 'equals', value: Number(trimestre) }], 1);
  return l[0] || null;
}
// quem dá cada disciplina em cada turma: pelo horário; se a disciplina não tem professor no horário, pelas disciplinas do professor
async function atribuicoes(escola) {
  const f = daEscola(escola);
  const [turmas, profs, hs] = await Promise.all([procurarTodos('turma', f), procurarTodos('professor', f), procurarTodos('horario', f)]);
  const pares = [];  // {turma, disciplina, professores:Set}
  for (const t of turmas.filter(x => x['Activa'] !== false)) {
    const g = lerGrelha((hs.find(h => h['Turma'] === t._id) || {})['Grelha']);
    const doHorario = {};
    if (g) for (const a of Object.values(g.aulas || {})) { if (!a.d) continue; (doHorario[a.d] = doHorario[a.d] || new Set()); if (a.p) doHorario[a.d].add(a.p); }
    const discs = new Set([...(t['Disciplinas'] || []), ...Object.keys(doHorario)]);
    for (const d of discs) {
      let ps = doHorario[d] && doHorario[d].size ? doHorario[d] : new Set(profs.filter(p => p['Activo'] !== false && (p['Disciplinas'] || []).includes(d)).map(p => p._id));
      pares.push({ turma: t._id, disciplina: d, professores: ps });
    }
  }
  return { turmas, profs, hs, pares };
}
async function dadosPauta(escola, turmaId, discId, tri) {
  const [turma, disc, regrasEsc] = await Promise.all([daMinhaEscola('turma', turmaId, escola), daMinhaEscola('disciplina', discId, escola), resumoEscola(escola)]);
  const ests = (await procurarTodos('estudante', [{ key: 'Escola', constraint_type: 'equals', value: escola }, { key: 'Turma', constraint_type: 'equals', value: turmaId }]))
    .filter(e => (e['Estado'] || 'activo') === 'activo').sort((a, b) => String(a['Nome'] || '').localeCompare(String(b['Nome'] || ''), 'pt'));
  const reg = await pautaDe(escola, turmaId, discId, tri);
  const grelha = (reg && lerGrelha(reg['Grelha'])) || PAUTA_NOVA();
  return { turma: { id: turma._id, nome: turma['Nome'] || '' }, disciplina: { id: disc._id, nome: disc['Nome'] || '', cor: disc['Cor'] || '#0A64DC' }, trimestre: Number(tri),
    estudantes: ests.map(e => ({ id: e._id, nome: e['Nome'] || '', numero: e['Numero'] || '' })), grelha, publicado: !!(reg && reg['Publicado']),
    actualizado: reg ? (reg['Modified Date'] || null) : null, actualizado_por: reg ? (reg['Actualizado Por'] || '') : '',
    regras: { aprovacao: Number((regrasEsc && regrasEsc.regras.aprovacao) || 10), dispensa: Number((regrasEsc && regrasEsc.regras.dispensa) || 14) } };
}
async function guardarPauta(req, res, quem) {
  const b = req.body || {};
  if (!trimestreOk(b.trimestre)) return erro(res, 400, 'Escolha o trimestre (1, 2 ou 3).');
  const d = await dadosPauta(req.escola, String(b.turma || ''), String(b.disciplina || ''), b.trimestre);
  const g = validarPauta(b.grelha, new Set(d.estudantes.map(e => e.id)));
  if (typeof g === 'string') return erro(res, 400, g);
  const campos = { 'Escola': req.escola, 'Turma': d.turma.id, 'Disciplina': d.disciplina.id, 'Trimestre': d.trimestre, 'Grelha': JSON.stringify(g), 'Publicado': !!b.publicado, 'Actualizado Por': quem };
  const reg = await pautaDe(req.escola, d.turma.id, d.disciplina.id, d.trimestre);
  if (reg) await mudar('pauta', reg._id, campos); else await criar('pauta', campos);
  const lancadas = Object.keys(g.notas).length;
  res.json({ ok: true, grelha: g, publicado: !!b.publicado, lancadas, total: d.estudantes.length });
}

// ---------- professor ----------
async function podeLancar(req, turma, disc) {
  const a = await atribuicoes(req.escola);
  const par = a.pares.find(p => p.turma === turma && p.disciplina === disc);
  return !!(par && par.professores.has(req.sessao.u));
}
app.post('/prof/inicio', exigeProfessor, rota(async (req, res) => {
  const eu = await obter('professor', req.sessao.u);
  const [a, discs, escRaw, cs] = await Promise.all([atribuicoes(req.escola), procurarTodos('disciplina', daEscola(req.escola)), obter('escola', req.escola), procurarTodos('comunicado', daEscola(req.escola), 200)]);
  const DM = Object.fromEntries(discs.map(d => [d._id, d])), TM = Object.fromEntries(a.turmas.map(t => [t._id, t]));
  const meus = a.pares.filter(p => p.professores.has(req.sessao.u) && DM[p.disciplina] && TM[p.turma]);
  const ests = await procurarTodos('estudante', daEscola(req.escola));
  const aulas = [];
  for (const h of a.hs) {
    const g = lerGrelha(h['Grelha']); if (!g || !TM[h['Turma']]) continue;
    for (const [k, x] of Object.entries(g.aulas || {})) {
      if (x.p !== req.sessao.u) continue;
      const [dia, ti] = k.split('-').map(Number), t = g.tempos[ti]; if (!t) continue;
      aulas.push({ dia, tempo: ti, i: t.i, f: t.f, turma: TM[h['Turma']]['Nome'] || '', turma_id: h['Turma'], disciplina_id: x.d, disciplina: (DM[x.d] || {})['Nome'] || '', cor: (DM[x.d] || {})['Cor'] || '#0A64DC', sala: x.s || '' });
    }
  }
  aulas.sort((x, y) => x.dia - y.dia || x.i.localeCompare(y.i));
  const hoje = hojeMZ();
  const feitas = (await procurarTodos('chamada', daEscola(req.escola).concat([{ key: 'Data', constraint_type: 'equals', value: hoje.data }]))).map(c => c['Turma'] + '|' + c['Tempo']);
  aulas.forEach(x => { if (x.dia === hoje.dia) x.chamada = feitas.includes(x.turma_id + '|' + x.tempo); });
  res.json({ ok: true, hoje,
    eu: { nome: eu['Nome'] || '', telefone: eu['Telefone'] || '' },
    escola: { nome: escRaw['Nome'] || '', logotipo: escRaw['Logotipo'] || '', ano: escRaw['Ano Lectivo'] || '' },
    turmas: meus.map(p => ({ turma: p.turma, turma_nome: TM[p.turma]['Nome'] || '', disciplina: p.disciplina, disciplina_nome: DM[p.disciplina]['Nome'] || '', cor: DM[p.disciplina]['Cor'] || '#0A64DC',
      estudantes: ests.filter(e => e['Turma'] === p.turma && (e['Estado'] || 'activo') === 'activo').length }))
      .sort((x, y) => x.turma_nome.localeCompare(y.turma_nome, 'pt') || x.disciplina_nome.localeCompare(y.disciplina_nome, 'pt')),
    aulas,
    comunicados: cs.filter(c => !c['Turma']).map(c => comOut(c)).sort((x, y) => String(y.data || '').localeCompare(String(x.data || ''))).slice(0, 10) });
}));
app.post('/prof/pauta', exigeProfessor, rota(async (req, res) => {
  const b = req.body || {};
  if (!trimestreOk(b.trimestre)) return erro(res, 400, 'Escolha o trimestre (1, 2 ou 3).');
  if (!await podeLancar(req, String(b.turma || ''), String(b.disciplina || ''))) return erro(res, 403, 'Não dá esta disciplina nesta turma. Fale com a Direcção.');
  res.json({ ok: true, pauta: await dadosPauta(req.escola, String(b.turma), String(b.disciplina), b.trimestre) });
}));
app.post('/prof/pauta-guardar', exigeProfessor, rota(async (req, res) => {
  const b = req.body || {};
  if (!await podeLancar(req, String(b.turma || ''), String(b.disciplina || ''))) return erro(res, 403, 'Não dá esta disciplina nesta turma. Fale com a Direcção.');
  const eu = await obter('professor', req.sessao.u).catch(() => null);
  await guardarPauta(req, res, 'Prof. ' + ((eu && eu['Nome']) || ''));
}));

// ---------- Direcção ----------
app.post('/pauta', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  if (!trimestreOk(b.trimestre)) return erro(res, 400, 'Escolha o trimestre (1, 2 ou 3).');
  res.json({ ok: true, pauta: await dadosPauta(req.escola, String(b.turma || ''), String(b.disciplina || ''), b.trimestre) });
}));
app.post('/pauta-guardar', exigeDireccao, rota(async (req, res) => {
  const eu = await obter('user', req.sessao.u).catch(() => null);
  await guardarPauta(req, res, (eu && eu['Nome Completo']) || 'Direcção');
}));
// resumo da turma no trimestre: estudantes × disciplinas com a média
app.post('/pautas-turma', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, tri = Number(b.trimestre);
  if (!trimestreOk(tri)) return erro(res, 400, 'Escolha o trimestre (1, 2 ou 3).');
  const turma = await daMinhaEscola('turma', String(b.turma || ''), req.escola);
  const f = daEscola(req.escola);
  const [a, discs, ests, pautas, esc] = await Promise.all([atribuicoes(req.escola), procurarTodos('disciplina', f),
    procurarTodos('estudante', f.concat([{ key: 'Turma', constraint_type: 'equals', value: turma._id }])),
    procurarTodos('pauta', f.concat([{ key: 'Turma', constraint_type: 'equals', value: turma._id }])), resumoEscola(req.escola)]);
  const DM = Object.fromEntries(discs.map(d => [d._id, d])), PM = Object.fromEntries(a.profs.map(p => [p._id, p['Nome']]));
  const lista = a.pares.filter(p => p.turma === turma._id && DM[p.disciplina]).map(p => {
    const reg = pautas.find(x => x['Disciplina'] === p.disciplina && Number(x['Trimestre']) === tri);
    return { id: p.disciplina, nome: DM[p.disciplina]['Nome'] || '', cor: DM[p.disciplina]['Cor'] || '#0A64DC', professores: [...p.professores].map(id => PM[id]).filter(Boolean),
      existe: !!reg, publicado: !!(reg && reg['Publicado']), grelha: reg ? lerGrelha(reg['Grelha']) : null, actualizado_por: reg ? (reg['Actualizado Por'] || '') : '' };
  }).sort((x, y) => x.nome.localeCompare(y.nome, 'pt'));
  const activos = ests.filter(e => (e['Estado'] || 'activo') === 'activo').sort((x, y) => String(x['Nome'] || '').localeCompare(String(y['Nome'] || ''), 'pt'));
  res.json({ ok: true, turma: { id: turma._id, nome: turma['Nome'] || '' }, trimestre: tri,
    regras: { aprovacao: Number((esc && esc.regras.aprovacao) || 10), dispensa: Number((esc && esc.regras.dispensa) || 14) },
    disciplinas: lista.map(d => ({ id: d.id, nome: d.nome, cor: d.cor, professores: d.professores, existe: d.existe, publicado: d.publicado, actualizado_por: d.actualizado_por,
      lancadas: d.grelha ? Object.keys(d.grelha.notas || {}).length : 0 })),
    estudantes: activos.map(e => ({ id: e._id, nome: e['Nome'] || '', numero: e['Numero'] || '',
      medias: Object.fromEntries(lista.map(d => [d.id, d.grelha ? mediasPauta(d.grelha, e._id).mt : null])) })) });
}));
app.post('/pautas-publicar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, tri = Number(b.trimestre);
  if (!trimestreOk(tri)) return erro(res, 400, 'Escolha o trimestre (1, 2 ou 3).');
  const turma = await daMinhaEscola('turma', String(b.turma || ''), req.escola);
  const pautas = await procurarTodos('pauta', daEscola(req.escola).concat([{ key: 'Turma', constraint_type: 'equals', value: turma._id }]));
  let n = 0;
  for (const p of pautas.filter(x => Number(x['Trimestre']) === tri && !!x['Publicado'] !== !!b.publicado)) { await mudar('pauta', p._id, { 'Publicado': !!b.publicado }); n++; }
  res.json({ ok: true, alteradas: n });
}));

// ---------- portal: notas publicadas da turma do educando ----------
async function notasDoEstudante(escola, est, cache) {
  if (!est['Turma']) return [];
  const chave = 'p' + est['Turma'];
  const pautas = cache[chave] || (cache[chave] = await procurarTodos('pauta', daEscola(escola).concat([{ key: 'Turma', constraint_type: 'equals', value: est['Turma'] }])));
  if (!cache.discAll) cache.discAll = Object.fromEntries((await procurarTodos('disciplina', daEscola(escola))).map(d => [d._id, d]));
  const out = {};
  for (const p of pautas.filter(x => x['Publicado'])) {
    const g = lerGrelha(p['Grelha']), d = cache.discAll[p['Disciplina']]; if (!g || !d) continue;
    const linha = (g.notas || {})[est._id] || {};
    const m = mediasPauta(g, est._id);
    const o = out[d._id] = out[d._id] || { disciplina: d['Nome'] || '', cor: d['Cor'] || '#0A64DC', trimestres: {} };
    o.trimestres[Number(p['Trimestre'])] = { colunas: g.colunas.map(c => ({ nome: c.nome, tipo: c.tipo, nota: typeof linha[c.id] === 'number' ? linha[c.id] : null })), macs: m.macs, acp: m.acp, mt: m.mt, completa: m.completa };
  }
  return Object.values(out).sort((a, b) => a.disciplina.localeCompare(b.disciplina, 'pt'));
}

// ============================================================
//  PRESENÇAS E FALTAS (v4.6)
//  Bubble, data types novos:
//   Chamada: Escola (Escola) · Turma (text) · Data (text AAAA-MM-DD) · Tempo (number) · Disciplina (text) · Professor (text) · Sumario (text) · Feita Por (text)
//   Falta:   Escola (Escola) · Turma (text) · Estudante (text) · Data (text) · Tempo (number) · Disciplina (text) · Tipo (text: F falta, A atraso, J justificada)
//            · Chamada (text) · SMS (yes/no)
//  Só os ausentes e atrasados criam registo em Falta. Hora de Moçambique (UTC+2).
// ============================================================
function hojeMZ(desvioDias) {
  const d = new Date(Date.now() + 2 * 3600e3 + (desvioDias || 0) * 864e5);
  return { data: d.toISOString().slice(0, 10), dia: d.getUTCDay() };
}
function diaDaSemana(data) { const d = new Date(data + 'T12:00:00Z'); return isNaN(d) ? -1 : d.getUTCDay(); }
const dataOk = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && diaDaSemana(d) >= 0;
const dmCurto = d => d.slice(8, 10) + '/' + d.slice(5, 7);
// a aula (turma, data, tempo) existe no horário? devolve {disciplina, professor, i, f}
async function aulaDoHorario(escola, turmaId, data, tempo) {
  const h = (await procurar('horario', [{ key: 'Escola', constraint_type: 'equals', value: escola }, { key: 'Turma', constraint_type: 'equals', value: turmaId }], 1))[0];
  const g = h && lerGrelha(h['Grelha']); if (!g) return null;
  const a = (g.aulas || {})[diaDaSemana(data) + '-' + Number(tempo)], t = (g.tempos || [])[Number(tempo)];
  return a && t ? { disciplina: a.d, professor: a.p, i: t.i, f: t.f } : null;
}
async function chamadaDe(escola, turma, data, tempo) {
  return (await procurar('chamada', [{ key: 'Escola', constraint_type: 'equals', value: escola }, { key: 'Turma', constraint_type: 'equals', value: turma },
    { key: 'Data', constraint_type: 'equals', value: data }, { key: 'Tempo', constraint_type: 'equals', value: Number(tempo) }], 1))[0] || null;
}
async function dadosChamada(escola, turmaId, data, tempo) {
  const turma = await daMinhaEscola('turma', turmaId, escola);
  const aula = await aulaDoHorario(escola, turmaId, data, tempo);
  if (!aula) { const e = new Error('Não há aula desta turma nesse dia e tempo no horário.'); e.publico = 404; throw e; }
  const [disc, ests, ch] = await Promise.all([obter('disciplina', aula.disciplina).catch(() => null),
    procurarTodos('estudante', [{ key: 'Escola', constraint_type: 'equals', value: escola }, { key: 'Turma', constraint_type: 'equals', value: turmaId }]), chamadaDe(escola, turmaId, data, tempo)]);
  const faltas = ch ? await procurarTodos('falta', [{ key: 'Escola', constraint_type: 'equals', value: escola }, { key: 'Chamada', constraint_type: 'equals', value: ch._id }]) : [];
  return { turma: { id: turma._id, nome: turma['Nome'] || '' }, data, tempo: Number(tempo), i: aula.i, f: aula.f, professor: aula.professor,
    disciplina: { id: aula.disciplina, nome: (disc && disc['Nome']) || '', cor: (disc && disc['Cor']) || '#0A64DC' },
    estudantes: ests.filter(e => (e['Estado'] || 'activo') === 'activo').sort((a, b) => String(a['Nome'] || '').localeCompare(String(b['Nome'] || ''), 'pt')).map(e => ({ id: e._id, nome: e['Nome'] || '', numero: e['Numero'] || '' })),
    feita: !!ch, chamada_id: ch ? ch._id : null, sumario: ch ? (ch['Sumario'] || '') : '', feita_por: ch ? (ch['Feita Por'] || '') : '',
    marcas: Object.fromEntries(faltas.map(f => [f['Estudante'], f['Tipo'] || 'F'])) };
}
async function guardarChamada(req, res, quem, podeJustificar) {
  const b = req.body || {};
  const d = await dadosChamada(req.escola, String(b.turma || ''), String(b.data || ''), b.tempo);
  const ids = new Set(d.estudantes.map(e => e.id)), novas = {};
  for (const [est, t] of Object.entries(b.marcas || {})) {
    if (!ids.has(est)) continue;
    const tipo = String(t || '').toUpperCase();
    if (tipo === 'F' || tipo === 'A' || (tipo === 'J' && (podeJustificar || d.marcas[est] === 'J'))) novas[est] = tipo;
  }
  // um professor não pode tirar uma justificação que a Direcção deu
  if (!podeJustificar) for (const [est, t] of Object.entries(d.marcas)) if (t === 'J' && !novas[est]) novas[est] = 'J';
  const campos = { 'Escola': req.escola, 'Turma': d.turma.id, 'Data': d.data, 'Tempo': d.tempo, 'Disciplina': d.disciplina.id, 'Professor': d.professor || '', 'Sumario': txt(b.sumario, 1000), 'Feita Por': quem };
  let chId = d.chamada_id;
  if (chId) await mudar('chamada', chId, campos); else chId = await criar('chamada', campos);
  const existentes = await procurarTodos('falta', [{ key: 'Escola', constraint_type: 'equals', value: req.escola }, { key: 'Chamada', constraint_type: 'equals', value: chId }]);
  const avisar = [];
  for (const f of existentes) {
    const n = novas[f['Estudante']];
    if (!n) await apagar('falta', f._id);
    else if (n !== f['Tipo']) await mudar('falta', f._id, { 'Tipo': n });
    if (n === 'F' && !f['SMS']) avisar.push(f);
  }
  for (const [est, tipo] of Object.entries(novas)) {
    if (existentes.some(f => f['Estudante'] === est)) continue;
    const id = await criar('falta', { 'Escola': req.escola, 'Turma': d.turma.id, 'Estudante': est, 'Data': d.data, 'Tempo': d.tempo, 'Disciplina': d.disciplina.id, 'Tipo': tipo, 'Chamada': chId, 'SMS': false });
    if (tipo === 'F') avisar.push({ _id: id, 'Estudante': est });
  }
  let sms = 0;
  if (b.sms && avisar.length && d.data === hojeMZ().data) {
    const esc = await obter('escola', req.escola);
    for (const f of avisar) {
      const est = await obter('estudante', f['Estudante']).catch(() => null);
      const enc = est && est['Encarregado'] ? await obter('encarregado', est['Encarregado']).catch(() => null) : null;
      if (!enc || enc['Recebe SMS'] === false || tel9(enc['Telefone']).length !== 9) continue;
      const r = await enviarSMS([enc['Telefone']], (esc['Nome'] || 'Escola') + ': ' + est['Nome'] + ' faltou hoje a ' + d.disciplina.nome + ' (' + d.i + '). Se a falta tiver justificacao, contacte a escola.');
      if (r.ok) { sms++; await mudar('falta', f._id, { 'SMS': true }).catch(() => {}); }
    }
  }
  const cont = { F: 0, A: 0, J: 0 }; Object.values(novas).forEach(t => cont[t]++);
  res.json({ ok: true, chamada: chId, presentes: d.estudantes.length - cont.F - cont.J, faltas: cont.F, atrasos: cont.A, justificadas: cont.J, sms });
}

// ---------- professor ----------
app.post('/prof/chamada', exigeProfessor, rota(async (req, res) => {
  const b = req.body || {};
  if (!dataOk(b.data)) return erro(res, 400, 'Data inválida.');
  const d = await dadosChamada(req.escola, String(b.turma || ''), b.data, b.tempo);
  if (d.professor !== req.sessao.u) return erro(res, 403, 'Esta aula não é sua no horário.');
  res.json({ ok: true, chamada: d });
}));
app.post('/prof/chamada-guardar', exigeProfessor, rota(async (req, res) => {
  const b = req.body || {};
  if (!dataOk(b.data)) return erro(res, 400, 'Data inválida.');
  if (b.data > hojeMZ().data) return erro(res, 400, 'Não pode fazer a chamada de um dia que ainda não chegou.');
  if (b.data < hojeMZ(-14).data) return erro(res, 400, 'Só pode corrigir chamadas dos últimos 14 dias. Para datas anteriores, fale com a Direcção.');
  const aula = await aulaDoHorario(req.escola, String(b.turma || ''), b.data, b.tempo);
  if (!aula || aula.professor !== req.sessao.u) return erro(res, 403, 'Esta aula não é sua no horário.');
  const eu = await obter('professor', req.sessao.u).catch(() => null);
  await guardarChamada(req, res, 'Prof. ' + ((eu && eu['Nome']) || ''), false);
}));

// ---------- Direcção ----------
app.post('/chamadas-dia', exigeDireccao, rota(async (req, res) => {
  const data = dataOk((req.body || {}).data) ? req.body.data : hojeMZ().data, dia = diaDaSemana(data), f = daEscola(req.escola);
  const [turmas, hs, discs, profs, chs, fs] = await Promise.all([procurarTodos('turma', f), procurarTodos('horario', f), procurarTodos('disciplina', f), procurarTodos('professor', f),
    procurarTodos('chamada', f.concat([{ key: 'Data', constraint_type: 'equals', value: data }])), procurarTodos('falta', f.concat([{ key: 'Data', constraint_type: 'equals', value: data }]))]);
  const TM = Object.fromEntries(turmas.filter(t => t['Activa'] !== false).map(t => [t._id, t])), DM = Object.fromEntries(discs.map(d => [d._id, d])), PM = Object.fromEntries(profs.map(p => [p._id, p['Nome']]));
  const aulas = [];
  for (const h of hs) {
    const g = lerGrelha(h['Grelha']); if (!g || !TM[h['Turma']]) continue;
    for (const [k, a] of Object.entries(g.aulas || {})) {
      const [d, ti] = k.split('-').map(Number); if (d !== dia || !g.tempos[ti]) continue;
      const ch = chs.find(c => c['Turma'] === h['Turma'] && Number(c['Tempo']) === ti);
      const fx = ch ? fs.filter(x => x['Chamada'] === ch._id) : [];
      aulas.push({ turma: h['Turma'], turma_nome: TM[h['Turma']]['Nome'] || '', tempo: ti, i: g.tempos[ti].i, f: g.tempos[ti].f, disciplina: (DM[a.d] || {})['Nome'] || '', cor: (DM[a.d] || {})['Cor'] || '#0A64DC',
        professor: PM[a.p] || '', feita: !!ch, faltas: fx.filter(x => x['Tipo'] === 'F').length, atrasos: fx.filter(x => x['Tipo'] === 'A').length, sumario: ch ? (ch['Sumario'] || '') : '' });
    }
  }
  aulas.sort((a, b) => a.i.localeCompare(b.i) || a.turma_nome.localeCompare(b.turma_nome, 'pt'));
  res.json({ ok: true, data, dia, aulas });
}));
app.post('/chamada', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  if (!dataOk(b.data)) return erro(res, 400, 'Data inválida.');
  res.json({ ok: true, chamada: await dadosChamada(req.escola, String(b.turma || ''), b.data, b.tempo) });
}));
app.post('/chamada-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  if (!dataOk(b.data) || b.data > hojeMZ().data) return erro(res, 400, 'Data inválida.');
  const eu = await obter('user', req.sessao.u).catch(() => null);
  await guardarChamada(req, res, (eu && eu['Nome Completo']) || 'Direcção', true);
}));
// resumo de assiduidade da turma num período
app.post('/presencas', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const turma = await daMinhaEscola('turma', String(b.turma || ''), req.escola);
  const de = dataOk(b.de) ? b.de : hojeMZ(-30).data, ate = dataOk(b.ate) ? b.ate : hojeMZ().data;
  const f = daEscola(req.escola).concat([{ key: 'Turma', constraint_type: 'equals', value: turma._id }]);
  const [ests, chs, fs, discs] = await Promise.all([procurarTodos('estudante', f), procurarTodos('chamada', f, 5000), procurarTodos('falta', f, 5000), procurarTodos('disciplina', daEscola(req.escola))]);
  const DM = Object.fromEntries(discs.map(d => [d._id, d['Nome']]));
  const ch = chs.filter(c => c['Data'] >= de && c['Data'] <= ate), fx = fs.filter(x => x['Data'] >= de && x['Data'] <= ate);
  const aulas = ch.length;
  res.json({ ok: true, turma: { id: turma._id, nome: turma['Nome'] || '' }, de, ate, aulas,
    estudantes: ests.filter(e => (e['Estado'] || 'activo') === 'activo').sort((a, b) => String(a['Nome'] || '').localeCompare(String(b['Nome'] || ''), 'pt')).map(e => {
      const m = fx.filter(x => x['Estudante'] === e._id);
      const F = m.filter(x => x['Tipo'] === 'F').length, J = m.filter(x => x['Tipo'] === 'J').length, A = m.filter(x => x['Tipo'] === 'A').length;
      return { id: e._id, nome: e['Nome'] || '', numero: e['Numero'] || '', faltas: F, justificadas: J, atrasos: A, presenca: aulas ? Math.round((aulas - F - J) * 100 / aulas) : null,
        lista: m.sort((a, b) => String(b['Data']).localeCompare(String(a['Data'])) || Number(b['Tempo']) - Number(a['Tempo'])).map(x => ({ id: x._id, data: x['Data'], tempo: Number(x['Tempo']), disciplina: DM[x['Disciplina']] || '', tipo: x['Tipo'] || 'F' })) };
    }) });
}));
app.post('/falta-justificar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const x = await daMinhaEscola('falta', String(b.id || ''), req.escola);
  if (x['Tipo'] === 'A') return erro(res, 400, 'Os atrasos não se justificam.');
  await mudar('falta', x._id, { 'Tipo': b.justificar ? 'J' : 'F' });
  res.json({ ok: true, tipo: b.justificar ? 'J' : 'F' });
}));

// ---------- portal: faltas do educando ----------
async function faltasDoEstudante(escola, estId, cache) {
  if (!cache.discAll) cache.discAll = Object.fromEntries((await procurarTodos('disciplina', daEscola(escola))).map(d => [d._id, d]));
  const fs = await procurarTodos('falta', [{ key: 'Escola', constraint_type: 'equals', value: escola }, { key: 'Estudante', constraint_type: 'equals', value: estId }], 1000);
  return fs.map(x => ({ data: x['Data'], tempo: Number(x['Tempo']), disciplina: (cache.discAll[x['Disciplina']] || {})['Nome'] || '', tipo: x['Tipo'] || 'F' }))
    .sort((a, b) => String(b.data).localeCompare(String(a.data)) || b.tempo - a.tempo);
}

// ============================================================
//  PAINEL DA DIRECÇÃO COM NÚMEROS REAIS (v4.7)
//  POST /painel-indicadores   (guarda 60 s em memória por escola; { fresco:true } força)
// ============================================================
const cachePainel = new Map();
app.post('/painel-indicadores', exigeDireccao, rota(async (req, res) => {
  const c = cachePainel.get(req.escola);
  if (c && !(req.body || {}).fresco && Date.now() - c.t < 60e3) return res.json(c.d);
  const f = daEscola(req.escola), hoje = hojeMZ(), mes = hoje.data.slice(0, 7);
  const [escola, ests, turmas, props, pags, chsHoje, faltas, pautas, a, discs] = await Promise.all([
    resumoEscola(req.escola), procurarTodos('estudante', f), procurarTodos('turma', f), procurarTodos('propina', f, 20000), procurarTodos('pagamento', f, 20000),
    procurarTodos('chamada', f.concat([{ key: 'Data', constraint_type: 'equals', value: hoje.data }])), procurarTodos('falta', f, 20000), procurarTodos('pauta', f, 5000),
    atribuicoes(req.escola), procurarTodos('disciplina', f)]);
  const regras = (escola && escola.regras) || {}, ap = Number(regras.aprovacao || 10);
  const activos = ests.filter(e => (e['Estado'] || 'activo') === 'activo'), EM = Object.fromEntries(ests.map(e => [e._id, e]));
  const TM = Object.fromEntries(turmas.filter(t => t['Activa'] !== false).map(t => [t._id, t])), DM = Object.fromEntries(discs.map(d => [d._id, d]));
  const PM = Object.fromEntries(a.profs.map(p => [p._id, p['Nome'] || '']));
  const dataMZ = iso => iso ? new Date(new Date(iso).getTime() + 2 * 3600e3).toISOString().slice(0, 10) : '';

  // --- dinheiro ---
  const pagos = pags.filter(p => p['Estado'] === 'pago');
  const meses = []; for (let k = 5; k >= 0; k--) { const d = new Date(hoje.data + 'T12:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k); meses.push(d.toISOString().slice(0, 7)); }
  const serie = meses.map(m => ({ mes: m, valor: pagos.filter(p => dataMZ(p['Pago Em']).slice(0, 7) === m).reduce((x, p) => x + Number(p['Valor'] || 0), 0) }));
  const doMes = pagos.filter(p => dataMZ(p['Pago Em']).slice(0, 7) === mes);
  const porMetodo = {}; doMes.forEach(p => { const k = p['Metodo'] || 'outro'; porMetodo[k] = (porMetodo[k] || 0) + Number(p['Valor'] || 0); });
  const divida = {}; let atraso = 0, multas = 0, aVencer = 0;
  for (const p of props) {
    if (p['Estado'] === 'anulada' || p['Estado'] === 'paga' || !EM[p['Estudante']] || (EM[p['Estudante']]['Estado'] || 'activo') !== 'activo') continue;
    const cp = calcPropina(p, regras);
    if (cp.estado === 'atrasada') { atraso += cp.total; multas += cp.multa; divida[p['Estudante']] = (divida[p['Estudante']] || 0) + cp.total; }
    else if (String(p['Vencimento'] || '').slice(0, 7) === mes) aVencer += cp.total;
  }
  const devedores = Object.entries(divida).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([id, v]) => ({ id, nome: EM[id]['Nome'] || '', numero: EM[id]['Numero'] || '', turma: (TM[EM[id]['Turma']] || {})['Nome'] || '', divida: v }));
  const ultimos = pagos.slice().sort((x, y) => String(y['Pago Em'] || '').localeCompare(String(x['Pago Em'] || ''))).slice(0, 5)
    .map(p => ({ id: p._id, documento: p['Documento'] || '', data: p['Pago Em'], valor: Number(p['Valor'] || 0), metodo: p['Metodo'] || '', estudante: (EM[p['Estudante']] || {})['Nome'] || '' }));

  // --- hoje: aulas e chamadas ---
  const aulasHoje = [];
  for (const h of a.hs) {
    const g = lerGrelha(h['Grelha']); if (!g || !TM[h['Turma']]) continue;
    for (const [k, x] of Object.entries(g.aulas || {})) {
      const [d, ti] = k.split('-').map(Number); if (d !== hoje.dia || !g.tempos[ti]) continue;
      aulasHoje.push({ turma: TM[h['Turma']]['Nome'] || '', turma_id: h['Turma'], tempo: ti, i: g.tempos[ti].i, f: g.tempos[ti].f, disciplina: (DM[x.d] || {})['Nome'] || '', professor: PM[x.p] || '',
        feita: chsHoje.some(c => c['Turma'] === h['Turma'] && Number(c['Tempo']) === ti) });
    }
  }
  aulasHoje.sort((x, y) => x.i.localeCompare(y.i));
  const agora = new Date(Date.now() + 2 * 3600e3).toISOString().slice(11, 16);
  const atrasadas = aulasHoje.filter(x => !x.feita && x.i <= agora);

  // --- faltas ---
  const d7 = hojeMZ(-6).data, d30 = hojeMZ(-29).data;
  const fx = faltas.filter(x => EM[x['Estudante']]);
  const porDia = []; for (let k = 6; k >= 0; k--) { const d = hojeMZ(-k).data; porDia.push({ data: d, faltas: fx.filter(x => x['Data'] === d && x['Tipo'] === 'F').length }); }
  const cont30 = {}; fx.filter(x => x['Data'] >= d30 && x['Tipo'] === 'F').forEach(x => { cont30[x['Estudante']] = (cont30[x['Estudante']] || 0) + 1; });
  const maisFaltas = Object.entries(cont30).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([id, n]) => ({ id, nome: EM[id]['Nome'] || '', turma: (TM[EM[id]['Turma']] || {})['Nome'] || '', faltas: n }));

  // --- notas do trimestre ---
  const tri = (m => m <= 5 ? 1 : m <= 8 ? 2 : 3)(Number(hoje.data.slice(5, 7)));
  const pt = pautas.filter(p => Number(p['Trimestre']) === tri);
  const pares = a.pares.filter(p => TM[p.turma] && DM[p.disciplina]);
  const semNotas = {}; let comNotas = 0;
  for (const p of pares) {
    const reg = pt.find(x => x['Turma'] === p.turma && x['Disciplina'] === p.disciplina);
    const g = reg && lerGrelha(reg['Grelha']);
    if (g && Object.keys(g.notas || {}).length) { comNotas++; continue; }
    for (const pid of (p.professores.size ? p.professores : new Set(['']))) {
      const k = pid || 'sem'; (semNotas[k] = semNotas[k] || { professor: PM[pid] || 'Sem professor', pendentes: [] }).pendentes.push((DM[p.disciplina]['Nome'] || '') + ' · ' + (TM[p.turma]['Nome'] || ''));
    }
  }
  const aproveitamento = Object.values(TM).map(t => {
    let pos = 0, n = 0;
    for (const reg of pt.filter(x => x['Turma'] === t._id)) { const g = lerGrelha(reg['Grelha']); if (!g) continue; for (const eid of Object.keys(g.notas || {})) { const m = mediasPauta(g, eid); if (m.mt == null) continue; n++; if (Math.round(m.mt) >= ap) pos++; } }
    return { turma: t['Nome'] || '', notas: n, positivas: pos, pct: n ? Math.round(pos * 100 / n) : null };
  }).sort((x, y) => x.turma.localeCompare(y.turma, 'pt'));

  const d = { ok: true, gerado: new Date().toISOString(), hoje: hoje.data, dia: hoje.dia, mes,
    dinheiro: { recebido_mes: doMes.reduce((x, p) => x + Number(p['Valor'] || 0), 0), recebido_hoje: pagos.filter(p => dataMZ(p['Pago Em']) === hoje.data).reduce((x, p) => x + Number(p['Valor'] || 0), 0),
      pagamentos_mes: doMes.length, em_atraso: atraso, multas, a_vencer: aVencer, estudantes_atraso: Object.keys(divida).length, por_metodo: porMetodo, serie, devedores, ultimos },
    hoje_aulas: { total: aulasHoje.length, feitas: aulasHoje.filter(x => x.feita).length, por_fazer: atrasadas.slice(0, 8), faltas: fx.filter(x => x['Data'] === hoje.data && x['Tipo'] === 'F').length },
    faltas: { semana: fx.filter(x => x['Data'] >= d7 && x['Tipo'] === 'F').length, mes: fx.filter(x => x['Data'] >= d30 && x['Tipo'] === 'F').length, por_dia: porDia, mais_faltas: maisFaltas },
    notas: { trimestre: tri, pares: pares.length, com_notas: comNotas,
      publicadas: pt.filter(x => x['Publicado']).length, aproveitamento, sem_notas: Object.values(semNotas).sort((x, y) => y.pendentes.length - x.pendentes.length).slice(0, 8) },
    estudantes: activos.length };
  if ((escola && escola.niveis || []).includes('CON')) {
    const [vs, aps, ins] = await Promise.all([procurarTodos('viatura', f), procurarTodos('aulapratica', f, 20000), procurarTodos('inscricaoconducao', f)]);
    const hojeA = aps.filter(x => x['Data'] === hoje.data && x['Estado'] !== 'cancelada');
    const alertas = [];
    vs.filter(v => v['Activa'] !== false).forEach(v => { for (const [k, n] of [['Inspecao Ate', 'Inspecção'], ['Seguro Ate', 'Seguro']]) { const dd = diasAte(v[k]); if (dd !== null && dd <= 30) alertas.push({ matricula: v['Matricula'] || '', tipo: n, dias: dd, ate: v[k] }); } });
    const activas = ins.filter(i => (i['Estado'] || 'activa') === 'activa');
    d.conducao = { aulas_hoje: hojeA.length, feitas_hoje: hojeA.filter(x => x['Estado'] === 'feita').length, instruendos: activas.length,
      sem_aula: activas.filter(i => !aps.some(x => x['Inscricao'] === i._id && x['Estado'] === 'marcada' && x['Data'] >= hoje.data)).length,
      alertas: alertas.sort((x, y) => x.dias - y.dias).slice(0, 8) };
  }
  cachePainel.set(req.escola, { t: Date.now(), d });
  res.json(d);
}));

// ============================================================
//  ASSINATURA DO GESCOLAR E ÁREA DA PLATAFORMA (v4.8)
//  Bubble:
//   Escola: campo novo  Valida Ate (date)
//   Subscricao: Escola (Escola) · Plano (text) · Meses (number) · Valor (number) · Metodo (text) · Telefone (text) · Estado (text)
//               · Referencia (text) · Transacao (text) · Raw (text) · Pago Em (date) · Valida Ate (date)
//   Transferencia: Escola (Escola) · Valor (number) · Data (date) · Referencia (text) · Metodo (text) · Notas (text) · Feita Por (text)
//  Render: PLATAFORMA_EMAILS (emails com acesso à área da plataforma, separados por vírgulas)
//          TAXA_PROPINAS_PCT (opcional, % que o Gescolar retém das propinas pagas online; por defeito 0)
//          PRECO_ESSENCIAL, PRECO_PRO (opcionais, MT por mês; por defeito 4900 e 12500)
// ============================================================
const PRECOS = { Essencial: Number(process.env.PRECO_ESSENCIAL || 4900), Pro: Number(process.env.PRECO_PRO || 12500), Rede: 0 };
const LIMITES = { Essencial: 300, Pro: 1000, Rede: 0 };
const TAXA_PROPINAS = Math.max(0, Math.min(50, Number(process.env.TAXA_PROPINAS_PCT || 0)));
const TOLERANCIA_DIAS = 7;
function situacaoEscola(e) {
  if (!e) return { estado: 'desconhecida' };
  if (e['Estado'] === 'suspensa') return { estado: 'suspensa', ate: null, dias: null };
  const fim = e['Valida Ate'] || (e['Estado'] === 'teste' ? e['Teste Ate'] : null) || e['Teste Ate'];
  if (!fim) return { estado: e['Estado'] || 'activa', ate: null, dias: null };
  const dias = Math.ceil((new Date(fim).getTime() - Date.now()) / 864e5);
  const base = e['Valida Ate'] ? 'activa' : 'teste';
  return { estado: dias >= 0 ? base : (dias >= -TOLERANCIA_DIAS ? 'tolerancia' : 'expirada'), ate: fim, dias };
}
function somaMeses(iso, meses) { const d = new Date(iso); d.setUTCMonth(d.getUTCMonth() + meses); return d.toISOString(); }
function novaValidade(e, meses) {
  const fim = e['Valida Ate'] || e['Teste Ate'];
  const base = fim && new Date(fim).getTime() > Date.now() ? fim : new Date().toISOString();
  return somaMeses(base, meses);
}
const subOut = x => ({ id: x._id, plano: x['Plano'] || '', meses: Number(x['Meses'] || 0), valor: Number(x['Valor'] || 0), metodo: x['Metodo'] || '', estado: x['Estado'] || 'pendente', data: x['Pago Em'] || x['Created Date'] || null, valida_ate: x['Valida Ate'] || null, referencia: x['Referencia'] || '' });

app.post('/assinatura', exigeDireccao, rota(async (req, res) => {
  const [e, subs, ests] = await Promise.all([obter('escola', req.escola), procurarTodos('subscricao', daEscola(req.escola), 300), procurarTodos('estudante', daEscola(req.escola))]);
  const plano = e['Plano'] || 'Essencial', activos = ests.filter(x => (x['Estado'] || 'activo') === 'activo').length;
  res.json({ ok: true, plano, preco: PRECOS[plano] || 0, limite: LIMITES[plano] || 0, estudantes: activos, situacao: situacaoEscola(e), tolerancia: TOLERANCIA_DIAS,
    planos: Object.keys(PRECOS).map(k => ({ nome: k, preco: PRECOS[k], limite: LIMITES[k] })),
    historico: subs.map(subOut).sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))) });
}));
app.post('/assinatura-pagar', exigeSoDireccao, rota(async (req, res) => {
  const b = req.body || {}, metodo = String(b.metodo || '').toLowerCase();
  if (!['mpesa', 'emola', 'cartao'].includes(metodo)) return erro(res, 400, 'Escolha M-Pesa, e-Mola ou cartão.');
  if (!MOZ_WALLET) return erro(res, 500, 'O servidor ainda não tem a carteira configurada (MOZ_WALLET).');
  const meses = [1, 3, 6, 12].includes(Number(b.meses)) ? Number(b.meses) : 1;
  const e = await obter('escola', req.escola);
  const plano = PRECOS[b.plano] !== undefined && b.plano !== 'Rede' ? b.plano : (e['Plano'] || 'Essencial');
  if (plano === 'Rede' || !PRECOS[plano]) return erro(res, 400, 'O plano Rede é combinado com a equipa do Gescolar. Fale connosco.');
  const ests = await procurarTodos('estudante', daEscola(req.escola));
  const activos = ests.filter(x => (x['Estado'] || 'activo') === 'activo').length;
  if (LIMITES[plano] && activos > LIMITES[plano]) return erro(res, 400, 'A escola tem ' + activos + ' estudantes e o plano ' + plano + ' vai até ' + LIMITES[plano] + '. Escolha um plano maior.');
  const valor = PRECOS[plano] * meses, numero = soDigitos(b.numero).replace(/^258(?=\d{9}$)/, '');
  if (metodo !== 'cartao') {
    if (numero.length !== 9) return erro(res, 400, 'O número tem 9 dígitos, por exemplo 84 123 4567.');
    const pre = numero.slice(0, 2);
    if (metodo === 'mpesa' && !['84', '85'].includes(pre)) return erro(res, 400, 'M-Pesa só funciona com números Vodacom (84 ou 85).');
    if (metodo === 'emola' && !['86', '87'].includes(pre)) return erro(res, 400, 'e-Mola só funciona com números Movitel (86 ou 87).');
  }
  const id = await criar('subscricao', { 'Escola': req.escola, 'Plano': plano, 'Meses': meses, 'Valor': valor, 'Metodo': metodo, 'Telefone': numero, 'Estado': 'pendente' });
  const produto = 'Gescolar ' + plano + ' · ' + meses + (meses === 1 ? ' mês' : ' meses') + ' · ' + (e['Nome'] || '');
  try {
    if (metodo === 'cartao') {
      const d = await mozPedido(MOZ_CARD_PATH, { valor: String(valor), nome_cliente: (e['Nome'] || 'Escola').slice(0, 80), carteira: MOZ_WALLET, nome_producto: produto.slice(0, 120) });
      const link = acharLink(d);
      if (!link) throw new Error('sem link na resposta: ' + JSON.stringify(d).slice(0, 220));
      await mudar('subscricao', id, { 'Referencia': String(achar(d, ['session_id', 'sessionId', 'session']) || sessionDoLink(link) || ''), 'Raw': JSON.stringify(d).slice(0, 4000) });
      return res.json({ ok: true, id, link, total: valor });
    }
    const d = await mozPedido('payment', { wallet: MOZ_WALLET, payment_method: metodo, amount: String(valor), number: numero, name: (e['Nome'] || 'Escola').slice(0, 80) });
    const idp = achar(d, ['idpayment', 'id_payment', 'idPayment', 'payment_id', 'paymentId', 'reference', 'id']);
    await mudar('subscricao', id, { 'Referencia': idp ? String(idp) : '', 'Raw': JSON.stringify(d).slice(0, 4000) });
    res.json({ ok: true, id, total: valor, mensagem: 'Pedido enviado para o ' + numero.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3') + '. Confirme com o PIN.' });
  } catch (err) {
    console.error('[assinatura]', err.message);
    await mudar('subscricao', id, { 'Estado': 'falhado', 'Raw': String(err.message).slice(0, 2000) }).catch(() => {});
    erro(res, 502, 'A MozPayment não aceitou o pedido: ' + String(err.message).slice(0, 300));
  }
}));
app.post('/assinatura-estado', exigeDireccao, rota(async (req, res) => {
  const x = await daMinhaEscola('subscricao', String((req.body || {}).id || ''), req.escola);
  res.json({ ok: true, estado: x['Estado'] || 'pendente', valida_ate: x['Valida Ate'] || null, valor: Number(x['Valor'] || 0) });
}));
// chamado pelo webhook quando a referência é de uma assinatura
async function aplicarSubscricao(x, b, estado) {
  if (x['Estado'] === 'pago') return { ok: true, ja: 'aplicado' };
  const raw = JSON.stringify(b).slice(0, 4000), trx = txt(b.transaction_id, 120);
  const valor = Math.round(Number(String(b.amount || '').replace(',', '.')));
  if (estado === 'pago' && valor !== Math.round(Number(x['Valor'] || 0))) { await mudar('subscricao', x._id, { 'Estado': 'revisao', 'Transacao': trx, 'Raw': raw }); return { ok: true, revisao: true }; }
  if (estado !== 'pago') { await mudar('subscricao', x._id, { 'Estado': estado, 'Transacao': trx, 'Raw': raw }); return { ok: true, estado }; }
  const e = await obter('escola', x['Escola']);
  const ate = novaValidade(e, Number(x['Meses'] || 1));
  await mudar('subscricao', x._id, { 'Estado': 'pago', 'Transacao': trx, 'Raw': raw, 'Pago Em': new Date().toISOString(), 'Valida Ate': ate });
  await mudar('escola', x['Escola'], { 'Valida Ate': ate, 'Estado': 'activa', 'Plano': x['Plano'] || e['Plano'] });
  cachePainel.delete(x['Escola']);
  return { ok: true, estado: 'pago', valida_ate: ate };
}

// ---------- área da plataforma ----------
function exigePlataforma(req, res, next) {
  const s = sessaoDo(req);
  if (!s) return erro(res, 401, 'A sessão terminou. Entre outra vez.');
  if (s.pl !== 1 && s.p !== 'Plataforma') return erro(res, 403, 'Só a equipa do Gescolar tem acesso.');
  req.sessao = s; next();
}
const ONLINE = m => ['mpesa', 'emola', 'cartao'].includes(String(m || '').toLowerCase());
app.post('/pl/resumo', exigePlataforma, rota(async (req, res) => {
  const [escolas, pags, subs, trs, ests] = await Promise.all([procurarTodos('escola', [], 5000), procurarTodos('pagamento', [], 50000), procurarTodos('subscricao', [], 20000), procurarTodos('transferencia', [], 20000), procurarTodos('estudante', [], 100000)]);
  const lista = escolas.map(e => {
    const online = pags.filter(p => p['Escola'] === e._id && p['Estado'] === 'pago' && ONLINE(p['Metodo']));
    const bruto = online.reduce((x, p) => x + Number(p['Valor'] || 0), 0), taxa = Math.round(bruto * TAXA_PROPINAS / 100);
    const transferido = trs.filter(t => t['Escola'] === e._id).reduce((x, t) => x + Number(t['Valor'] || 0), 0);
    const assin = subs.filter(x => x['Escola'] === e._id && x['Estado'] === 'pago');
    return { id: e._id, nome: e['Nome'] || '', subdominio: e['Subdominio'] || '', cidade: e['Cidade'] || '', provincia: e['Provincia'] || '', telefone: e['Telefone'] || '', email: e['Email'] || '', nuit: e['NUIT'] || '',
      plano: e['Plano'] || '', situacao: situacaoEscola(e), criada: e['Created Date'] || null,
      estudantes: ests.filter(x => x['Escola'] === e._id && (x['Estado'] || 'activo') === 'activo').length,
      propinas_online: bruto, taxa, transferido, saldo: bruto - taxa - transferido, pagamentos: online.length,
      assinaturas: assin.reduce((x, s2) => x + Number(s2['Valor'] || 0), 0), ultimo_pagamento: online.map(p => p['Pago Em']).sort().pop() || null };
  }).sort((a, b) => b.saldo - a.saldo || a.nome.localeCompare(b.nome, 'pt'));
  const mes = new Date().toISOString().slice(0, 7);
  res.json({ ok: true, taxa_pct: TAXA_PROPINAS, precos: PRECOS, escolas: lista,
    totais: { escolas: lista.length, activas: lista.filter(x => ['activa', 'tolerancia'].includes(x.situacao.estado)).length, teste: lista.filter(x => x.situacao.estado === 'teste').length,
      estudantes: lista.reduce((x, e) => x + e.estudantes, 0), a_transferir: lista.reduce((x, e) => x + Math.max(0, e.saldo), 0),
      propinas_online: lista.reduce((x, e) => x + e.propinas_online, 0), assinaturas: lista.reduce((x, e) => x + e.assinaturas, 0),
      assinaturas_mes: subs.filter(x => x['Estado'] === 'pago' && String(x['Pago Em'] || '').slice(0, 7) === mes).reduce((x, s2) => x + Number(s2['Valor'] || 0), 0) } });
}));
app.post('/pl/escola', exigePlataforma, rota(async (req, res) => {
  const id = String((req.body || {}).id || '');
  const e = await obter('escola', id);
  if (!e) return erro(res, 404, 'Escola não encontrada.');
  const f = daEscola(id);
  const [pags, subs, trs, ests] = await Promise.all([procurarTodos('pagamento', f, 20000), procurarTodos('subscricao', f, 500), procurarTodos('transferencia', f, 2000), procurarTodos('estudante', f)]);
  const EM = Object.fromEntries(ests.map(x => [x._id, x['Nome']]));
  const movimentos = pags.filter(p => p['Estado'] === 'pago' && ONLINE(p['Metodo'])).map(p => ({ tipo: 'entrada', data: p['Pago Em'], valor: Number(p['Valor'] || 0), taxa: Math.round(Number(p['Valor'] || 0) * TAXA_PROPINAS / 100),
      texto: (EM[p['Estudante']] || '') + ' · ' + (p['Documento'] || ''), metodo: p['Metodo'] || '' }))
    .concat(trs.map(t => ({ tipo: 'transferencia', id: t._id, data: t['Data'] || t['Created Date'], valor: Number(t['Valor'] || 0), texto: [t['Metodo'], t['Referencia'], t['Notas']].filter(Boolean).join(' · '), feita_por: t['Feita Por'] || '' })))
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  res.json({ ok: true, escola: { id: e._id, nome: e['Nome'] || '', plano: e['Plano'] || '', situacao: situacaoEscola(e), valida_ate: e['Valida Ate'] || null, teste_ate: e['Teste Ate'] || null, estado: e['Estado'] || '' },
    movimentos: movimentos.slice(0, 400), assinaturas: subs.map(subOut).sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))) });
}));
app.post('/pl/escola-guardar', exigePlataforma, rota(async (req, res) => {
  const b = req.body || {};
  const e = await obter('escola', String(b.id || ''));
  if (!e) return erro(res, 404, 'Escola não encontrada.');
  const mud = {};
  if (b.plano !== undefined) { if (!PLANOS.includes(b.plano)) return erro(res, 400, 'Plano inválido.'); mud['Plano'] = b.plano; }
  if (b.estado !== undefined) { if (!['teste', 'activa', 'suspensa'].includes(b.estado)) return erro(res, 400, 'Estado inválido.'); mud['Estado'] = b.estado; }
  if (b.valida_ate !== undefined) { if (b.valida_ate && isNaN(Date.parse(b.valida_ate))) return erro(res, 400, 'Data inválida.'); if (b.valida_ate) mud['Valida Ate'] = new Date(b.valida_ate + 'T23:59:00Z').toISOString(); }
  if (b.mais_meses) mud['Valida Ate'] = novaValidade(e, Math.max(1, Math.min(24, Number(b.mais_meses) || 1)));
  if (!Object.keys(mud).length) return erro(res, 400, 'Nada para guardar.');
  if (mud['Valida Ate'] && !mud['Estado'] && e['Estado'] !== 'suspensa') mud['Estado'] = 'activa';
  await mudar('escola', e._id, mud);
  cachePainel.delete(e._id);
  res.json({ ok: true, situacao: situacaoEscola(Object.assign({}, e, mud)) });
}));
app.post('/pl/transferencia', exigePlataforma, rota(async (req, res) => {
  const b = req.body || {};
  const e = await obter('escola', String(b.escola || ''));
  if (!e) return erro(res, 404, 'Escola não encontrada.');
  const valor = Math.round(Number(String(b.valor || '').replace(/\s/g, '').replace(',', '.')));
  if (!(valor > 0)) return erro(res, 400, 'Escreva o valor transferido.');
  const data = b.data && !isNaN(Date.parse(b.data)) ? new Date(b.data + 'T12:00:00Z').toISOString() : new Date().toISOString();
  const eu = await obter('user', req.sessao.u).catch(() => null);
  const id = await criar('transferencia', { 'Escola': e._id, 'Valor': valor, 'Data': data, 'Referencia': txt(b.referencia, 80), 'Metodo': txt(b.metodo, 40), 'Notas': txt(b.notas, 300), 'Feita Por': (eu && eu['Nome Completo']) || 'Plataforma' });
  if (b.sms && tel9(e['Telefone']).length === 9) enviarSMS([e['Telefone']], 'Gescolar: transferimos ' + mt(valor) + ' para ' + (e['Nome'] || 'a escola') + ' (propinas pagas online)' + (b.referencia ? '. Ref. ' + txt(b.referencia, 40) : '') + '.').catch(() => {});
  res.json({ ok: true, id });
}));
app.post('/pl/transferencia-apagar', exigePlataforma, rota(async (req, res) => {
  const id = String((req.body || {}).id || '');
  const t = await obter('transferencia', id).catch(() => null);
  if (!t) return erro(res, 404, 'Transferência não encontrada.');
  await apagar('transferencia', id);
  res.json({ ok: true });
}));

// ============================================================
//  RECUPERAR PALAVRA-PASSE E EQUIPA DA ESCOLA (v4.9)
//  Bubble, 2 backend workflows novos (ver instruções):
//   senha-temp  (parâmetro email)  → Assign a temp password to a user → Return data: senha = Result of step 1
//   senha-mudar (parâmetro nova; exige autenticação do utilizador) → Update the user's credentials (Password = nova)
//  O workflow login já existente devolve o token do utilizador, usado para chamar senha-mudar em nome dele.
// ============================================================
function linkPagina(nome) { return PORTAL_URL.replace(/[^/]*$/, nome); }
async function wfComo(nome, corpo, tokenUser) {
  const r = await fetch(BUBBLE_WF + '/' + nome, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tokenUser }, body: JSON.stringify(corpo || {}) });
  const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = { raw: t }; }
  if (!r.ok) { const e = new Error(nome + ': ' + ((d && d.body && d.body.message) || (d && d.message) || t || r.status)); e.status = r.status; throw e; }
  return d;
}
async function userPorEmail(email) {
  const l = await procurar('user', [{ key: 'email', constraint_type: 'equals', value: email }], 1);
  return l[0] || null;
}
const emailDoUser = u => (u && u['authentication'] && u['authentication']['email'] && u['authentication']['email']['email']) || (u && u['email']) || '';

app.post('/senha-pedir', rota(async (req, res) => {
  const email = txt((req.body || {}).email, 120).toLowerCase();
  if (!emailOk(email)) return erro(res, 400, 'Escreva o email da sua conta.');
  if (travao('senha-ip|' + req.ip, 10, 15) || travao('senha|' + email, 3, 15)) return erro(res, 429, 'Muitos pedidos seguidos. Espere 15 minutos.');
  const u = await userPorEmail(email);
  if (!u) return erro(res, 404, 'Não encontrámos nenhuma conta com este email.');
  if (u['Activo'] === false) return erro(res, 403, 'Esta conta está desactivada. Fale com a Direcção da escola.');
  const tel = tel9(u['Telefone']);
  if (tel.length !== 9) return erro(res, 409, 'Esta conta não tem telemóvel registado. Escreva para geral@gescolar.co.mz a pedir ajuda.');
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0'), pedido = crypto.randomBytes(16).toString('hex');
  const r = await enviarSMS([tel], 'Gescolar: o seu codigo para criar uma nova palavra-passe e ' + codigo + '. Valido 10 minutos. Nao partilhe este codigo.');
  if (!r.ok) return erro(res, 502, 'Não foi possível enviar o SMS agora. Tente de novo dentro de um minuto.');
  pedidosAcesso.set(pedido, { tipo: 'senha', id: u._id, email, hash: hashCodigo(pedido + codigo), exp: Date.now() + 600e3, tent: 0 });
  res.json({ ok: true, pedido, destino: mascarar(tel) });
}));
app.post('/senha-nova', rota(async (req, res) => {
  const b = req.body || {}, chave = String(b.pedido || '');
  const pd = pedidosAcesso.get(chave);
  if (!pd || pd.tipo !== 'senha' || pd.exp < Date.now()) return erro(res, 410, 'O código expirou. Peça um novo.');
  const nova = String(b.password || '');
  if (nova.length < 8) return erro(res, 400, 'A palavra-passe tem de ter pelo menos 8 caracteres.');
  pd.tent++;
  if (pd.tent > 5) { pedidosAcesso.delete(chave); return erro(res, 429, 'Demasiadas tentativas. Peça um novo código.'); }
  const cod = soDigitos(b.codigo), a = Buffer.from(hashCodigo(chave + cod)), c = Buffer.from(pd.hash);
  if (cod.length !== 6 || a.length !== c.length || !crypto.timingSafeEqual(a, c)) return erro(res, 401, 'Código errado (' + (5 - pd.tent) + ' tentativas restantes).');
  try {
    const t = await workflow('senha-temp', { email: pd.email });
    const temp = achar(t, ['senha', 'password', 'temp', 'temp_password']);
    if (!temp) throw new Error('senha-temp não devolveu a senha — confirme o "Return data from API" com a chave senha');
    const l = await workflow('login', { email: pd.email, password: String(temp) });
    const tok = achar(l, ['token']);
    if (!tok) throw new Error('login não devolveu o token do utilizador');
    await wfComo('senha-mudar', { nova }, String(tok));
  } catch (e) {
    console.error('[senha-nova]', e.message);
    return erro(res, 500, 'Não foi possível mudar a palavra-passe agora. Tente de novo ou fale com o suporte.');
  }
  pedidosAcesso.delete(chave);
  res.json(await abrirSessao(pd.id, PLATAFORMA_EMAILS.includes(pd.email)));
}));

// ---------- equipa da escola (só a Direcção) ----------
function exigeSoDireccao(req, res, next) {
  const s = sessaoDo(req);
  if (!s) return erro(res, 401, 'A sessão terminou. Entre outra vez.');
  if (!s.e || s.p !== 'Direccao') return erro(res, 403, 'Só a Direcção pode gerir a equipa.');
  req.sessao = s; req.escola = s.e; next();
}
const userOut = u => ({ id: u._id, nome: u['Nome Completo'] || '', email: emailDoUser(u), telefone: u['Telefone'] || '', papel: u['Papel'] || '', activo: u['Activo'] !== false, ultimo: u['Ultimo Acesso'] || null });
app.post('/equipa', exigeSoDireccao, rota(async (req, res) => {
  const us = await procurarTodos('user', daEscola(req.escola), 200);
  res.json({ ok: true, eu: req.sessao.u, equipa: us.filter(u => ['Direccao', 'Secretaria'].includes(u['Papel'])).map(userOut).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')) });
}));
app.post('/equipa-criar', exigeSoDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const nome = txt(b.nome, 100), email = txt(b.email, 120).toLowerCase(), tel = tel9(b.telefone), papel = b.papel === 'Direccao' ? 'Direccao' : 'Secretaria';
  if (nome.split(/\s+/).length < 2) return erro(res, 400, 'Escreva o nome completo.');
  if (!emailOk(email)) return erro(res, 400, 'O email não parece válido.');
  if (tel.length !== 9) return erro(res, 400, 'O telemóvel tem 9 dígitos. É por ele que a pessoa cria a palavra-passe.');
  if (await userPorEmail(email)) return erro(res, 409, 'Este email já tem conta no Gescolar.');
  let userId;
  try {
    const r = await workflow('signup', { email, password: crypto.randomBytes(18).toString('base64url') });
    userId = r && r.response && r.response.user_id;
  } catch (e) {
    if (e.status === 400) return erro(res, 409, 'Este email já tem conta no Gescolar.');
    throw e;
  }
  if (!userId) throw new Error('signup não devolveu user_id');
  await mudar('user', userId, { 'Escola': req.escola, 'Papel': papel, 'Nome Completo': nome, 'Telefone': tel.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3'), 'Activo': true });
  const esc = await obter('escola', req.escola).catch(() => null);
  const link = linkPagina('recuperar.html') + '?email=' + encodeURIComponent(email);
  const r = await enviarSMS([tel], 'Gescolar: foi criada a sua conta (' + (papel === 'Direccao' ? 'Direccao' : 'Secretaria') + ') em ' + ((esc && esc['Nome']) || 'a escola') + '. Crie a sua palavra-passe em ' + link.replace(/^https?:\/\//, ''));
  res.json({ ok: true, id: userId, sms: r.ok, link });
}));
app.post('/equipa-estado', exigeSoDireccao, rota(async (req, res) => {
  const b = req.body || {}, id = String(b.id || '');
  if (id === req.sessao.u) return erro(res, 400, 'Não pode desactivar a sua própria conta.');
  const u = await obter('user', id).catch(() => null);
  if (!u || u['Escola'] !== req.escola) return erro(res, 404, 'Utilizador não encontrado.');
  await mudar('user', id, { 'Activo': !!b.activo });
  res.json({ ok: true, activo: !!b.activo });
}));

// ============================================================
//  CONVITES AOS PROFESSORES (v4.10)
//  O professor entra em acesso.html?e=<código da escola> → Professor → telemóvel → código SMS.
// ============================================================
async function convidarProfessor(escolaId, p, escRaw) {
  const tel = tel9(p['Telefone']); if (tel.length !== 9) return false;
  const esc = escRaw || await obter('escola', escolaId);
  const link = linkFamilias(esc['Subdominio']).replace(/^https?:\/\//, '');
  const r = await enviarSMS([tel], (esc['Nome'] || 'A escola') + ': foi registado como professor no Gescolar. Para ver as suas turmas, o horario, fazer a chamada e lancar notas entre em ' + link + ' , escolha Professor e use este numero.');
  return r.ok;
}
app.post('/professor-convite', exigeDireccao, rota(async (req, res) => {
  const p = await daMinhaEscola('professor', String((req.body || {}).id || ''), req.escola);
  if (tel9(p['Telefone']).length !== 9) return erro(res, 400, 'Este professor não tem telemóvel registado. Edite-o e acrescente o número.');
  if (travao('conv-prof|' + p._id, 3, 60)) return erro(res, 429, 'Já enviou o acesso a este professor várias vezes. Tente daqui a uma hora.');
  if (!await convidarProfessor(req.escola, p)) return erro(res, 502, 'O SMS não foi enviado. Tente mais tarde.');
  res.json({ ok: true });
}));
app.post('/professores-convite', exigeDireccao, rota(async (req, res) => {
  if (travao('conv-profs|' + req.escola, 1, 60)) return erro(res, 429, 'O convite já foi enviado há pouco. Pode voltar a enviar daqui a uma hora.');
  const [esc, profs] = await Promise.all([obter('escola', req.escola), procurarTodos('professor', daEscola(req.escola))]);
  const alvo = profs.filter(p => p['Activo'] !== false && tel9(p['Telefone']).length === 9);
  if (!alvo.length) return erro(res, 400, 'Nenhum professor tem telemóvel registado.');
  let enviados = 0;
  for (const p of alvo) if (await convidarProfessor(req.escola, p, esc).catch(() => false)) enviados++;
  res.json({ ok: true, enviados, sem_telefone: profs.filter(p => p['Activo'] !== false).length - alvo.length });
}));

// ============================================================
//  ESCOLA DE CONDUÇÃO · PARTE 1: CURSOS E INSCRIÇÕES (v5.0)
//  O instruendo é um Estudante (sem turma, com telemóvel próprio): assim usa o mesmo portal,
//  as mesmas cobranças (Propina com Tipo "prestacao", sem multa) e os mesmos recibos.
//  Bubble:
//   Curso Conducao:    Escola (Escola) · Categoria (text) · Nome (text) · Preco (number) · Prestacoes (number)
//                      · Aulas Teoricas (number) · Aulas Praticas (number) · Idade Minima (number) · Activo (yes/no)
//   Inscricao Conducao: Escola (Escola) · Estudante (text) · Curso (text) · Categoria (text) · Data Inscricao (date)
//                      · Estado (text: activa | concluida | desistiu) · Preco (number) · Prestacoes (number)
// ============================================================
const CATEGORIAS = {
  A1: { nome: 'Motociclos até 125 cc', idade: 16 }, A: { nome: 'Motociclos', idade: 18 }, B: { nome: 'Ligeiros', idade: 18 },
  BE: { nome: 'Ligeiros com reboque', idade: 18 }, C: { nome: 'Pesados de mercadorias', idade: 18 }, CE: { nome: 'Pesados com reboque', idade: 18 }, D: { nome: 'Pesados de passageiros', idade: 25 }
};
const cursoOut = (c, ins) => ({ id: c._id, categoria: c['Categoria'] || '', nome: c['Nome'] || '', preco: Number(c['Preco'] || 0), prestacoes: Number(c['Prestacoes'] || 1),
  teoricas: Number(c['Aulas Teoricas'] || 0), praticas: Number(c['Aulas Praticas'] || 0), idade: Number(c['Idade Minima'] || (CATEGORIAS[c['Categoria']] || {}).idade || 18), activo: c['Activo'] !== false,
  inscritos: ins ? ins.filter(i => i['Curso'] === c._id && (i['Estado'] || 'activa') === 'activa').length : undefined });
app.post('/cursos', exigeDireccao, rota(async (req, res) => {
  const f = daEscola(req.escola);
  const [cs, ins] = await Promise.all([procurarTodos('cursoconducao', f), procurarTodos('inscricaoconducao', f)]);
  res.json({ ok: true, categorias: CATEGORIAS, cursos: cs.filter(c => c['Activo'] !== false).map(c => cursoOut(c, ins)).sort((a, b) => Object.keys(CATEGORIAS).indexOf(a.categoria) - Object.keys(CATEGORIAS).indexOf(b.categoria) || a.nome.localeCompare(b.nome, 'pt')) });
}));
app.post('/curso-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, cat = String(b.categoria || '').toUpperCase();
  if (!CATEGORIAS[cat]) return erro(res, 400, 'Escolha a categoria da carta.');
  const preco = Math.round(Number(b.preco)), prest = Math.round(Number(b.prestacoes || 1));
  if (!(preco > 0)) return erro(res, 400, 'Escreva o preço do curso.');
  if (!(prest >= 1 && prest <= 12)) return erro(res, 400, 'As prestações vão de 1 a 12.');
  const campos = { 'Escola': req.escola, 'Categoria': cat, 'Nome': txt(b.nome, 80) || ('Carta ' + cat + ' · ' + CATEGORIAS[cat].nome), 'Preco': preco, 'Prestacoes': prest,
    'Aulas Teoricas': Math.max(0, Math.round(Number(b.teoricas) || 0)), 'Aulas Praticas': Math.max(0, Math.round(Number(b.praticas) || 0)),
    'Idade Minima': Math.max(CATEGORIAS[cat].idade, Math.round(Number(b.idade) || 0)), 'Activo': true };
  let id = b.id ? String(b.id) : null;
  if (id) { await daMinhaEscola('cursoconducao', id, req.escola); await mudar('cursoconducao', id, campos); } else id = await criar('cursoconducao', campos);
  res.json({ ok: true, id });
}));
app.post('/curso-apagar', exigeDireccao, rota(async (req, res) => {
  const c = await daMinhaEscola('cursoconducao', String((req.body || {}).id || ''), req.escola);
  await mudar('cursoconducao', c._id, { 'Activo': false });
  res.json({ ok: true });
}));
function idadeEm(nasc) { const n = new Date(nasc), h = new Date(); let a = h.getUTCFullYear() - n.getUTCFullYear(); if (h.getUTCMonth() < n.getUTCMonth() || (h.getUTCMonth() === n.getUTCMonth() && h.getUTCDate() < n.getUTCDate())) a--; return a; }
app.post('/instruendos', exigeDireccao, rota(async (req, res) => {
  const f = daEscola(req.escola);
  const [ins, cs, ests, props, esc, aulas] = await Promise.all([procurarTodos('inscricaoconducao', f, 5000), procurarTodos('cursoconducao', f), procurarTodos('estudante', f), procurarTodos('propina', f.concat([{ key: 'Tipo', constraint_type: 'equals', value: 'prestacao' }]), 20000), resumoEscola(req.escola), procurarTodos('aulapratica', f, 20000)]);
  const CM = Object.fromEntries(cs.map(c => [c._id, c])), EM = Object.fromEntries(ests.map(e => [e._id, e]));
  const regras = (esc && esc.regras) || {};
  res.json({ ok: true, instruendos: ins.map(i => {
    const e = EM[i['Estudante']] || {}, c = CM[i['Curso']] || {};
    const ps = props.filter(p => p['Estudante'] === i['Estudante'] && p['Estado'] !== 'anulada').map(p => Object.assign({ id: p._id, vencimento: p['Vencimento'], descricao: p['Descricao'] }, calcPropina(p, regras)));
    const pago = ps.filter(p => p.estado === 'paga').reduce((x, p) => x + p.total, 0), total = ps.reduce((x, p) => x + p.total, 0);
    const prox = ps.filter(p => p.estado !== 'paga').sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)))[0];
    return { id: i._id, estudante: i['Estudante'], nome: e['Nome'] || '', numero: e['Numero'] || '', telefone: e['Telefone'] || '', nascimento: e['Data Nascimento'] || null,
      curso: c['Nome'] || '', categoria: i['Categoria'] || c['Categoria'] || '', data: i['Data Inscricao'] || i['Created Date'] || null, estado: i['Estado'] || 'activa',
      preco: Number(i['Preco'] || 0), pago, total, em_atraso: ps.filter(p => p.estado === 'atrasada').reduce((x, p) => x + p.total, 0),
      proxima: prox ? { valor: prox.total, vencimento: prox.vencimento } : null,
      praticas: { feitas: aulas.filter(a => a['Inscricao'] === i._id && a['Estado'] === 'feita').length, marcadas: aulas.filter(a => a['Inscricao'] === i._id && a['Estado'] === 'marcada').length, total: Number(c['Aulas Praticas'] || 0) } };
  }).sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))) });
}));
app.post('/inscrever', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, nome = txt(b.nome, 100);
  if (nome.split(/\s+/).length < 2) return erro(res, 400, 'Escreva o nome completo do instruendo.');
  const tel = tel9(b.telefone);
  if (tel.length !== 9) return erro(res, 400, 'O telemóvel tem 9 dígitos. É por ele que o instruendo entra no portal e recebe avisos.');
  if (!b.nascimento || isNaN(Date.parse(b.nascimento))) return erro(res, 400, 'Escreva a data de nascimento: a idade mínima depende da categoria.');
  const c = await daMinhaEscola('cursoconducao', String(b.curso || ''), req.escola);
  if (c['Activo'] === false) return erro(res, 400, 'Este curso já não está activo.');
  const idade = idadeEm(b.nascimento), minima = Number(c['Idade Minima'] || (CATEGORIAS[c['Categoria']] || {}).idade || 18);
  if (idade < minima) return erro(res, 400, 'A carta ' + c['Categoria'] + ' exige pelo menos ' + minima + ' anos. O instruendo tem ' + idade + '.');
  const prest = Math.max(1, Math.min(Number(c['Prestacoes'] || 1), Math.round(Number(b.prestacoes) || Number(c['Prestacoes'] || 1))));
  const preco = Number(c['Preco'] || 0);
  const inicio = b.inicio && !isNaN(Date.parse(b.inicio)) ? new Date(b.inicio + 'T12:00:00Z') : new Date();
  // número do instruendo: C<ano>-0001 (separado dos estudantes)
  const ests = await procurarTodos('estudante', daEscola(req.escola));
  const ano = String(new Date().getFullYear());
  const repetido = ests.find(e => tel9(e['Telefone']) === tel && (e['Estado'] || 'activo') === 'activo' && String(e['Numero'] || '').startsWith('C'));
  let estId, numero;
  if (repetido) { estId = repetido._id; numero = repetido['Numero']; }
  else {
    const maior = ests.map(e => String(e['Numero'] || '')).filter(n => n.startsWith('C' + ano + '-')).map(n => parseInt(n.split('-')[1], 10) || 0).reduce((a, x) => Math.max(a, x), 0);
    numero = 'C' + ano + '-' + String(maior + 1).padStart(4, '0');
    const campos = { 'Escola': req.escola, 'Numero': numero, 'Nome': nome, 'Sexo': b.sexo === 'F' ? 'F' : (b.sexo === 'M' ? 'M' : ''), 'Telefone': tel.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3'),
      'Data Nascimento': new Date(b.nascimento).toISOString(), 'Ano Lectivo': ano, 'Data Matricula': new Date().toISOString(), 'Estado': 'activo' };
    estId = await criar('estudante', campos);
  }
  const insId = await criar('inscricaoconducao', { 'Escola': req.escola, 'Estudante': estId, 'Curso': c._id, 'Categoria': c['Categoria'], 'Data Inscricao': new Date().toISOString(), 'Estado': 'activa', 'Preco': preco, 'Prestacoes': prest });
  // prestações: dividir o preço; a primeira vence no dia da inscrição (ou no início escolhido), as outras de mês a mês
  const base = Math.floor(preco / prest), resto = preco - base * prest, linhas = [];
  for (let k = 0; k < prest; k++) {
    const v = new Date(inicio); v.setUTCMonth(v.getUTCMonth() + k); v.setUTCHours(21, 59, 0, 0);
    const valor = base + (k === 0 ? resto : 0);
    linhas.push({ 'Escola': req.escola, 'Estudante': estId, 'Ano Lectivo': String(v.getUTCFullYear()), 'Tipo': 'prestacao', 'Mes': v.getUTCMonth() + 1,
      'Descricao': 'Carta ' + c['Categoria'] + ' · ' + (prest === 1 ? 'pagamento único' : 'prestação ' + (k + 1) + '/' + prest), 'Valor': valor, 'Vencimento': v.toISOString(), 'Multa': 0, 'Total': valor, 'Estado': 'aberta' });
  }
  await criarEmLote('propina', linhas);
  const esc = await obter('escola', req.escola).catch(() => null);
  let sms = false;
  if (b.sms !== false && esc) {
    const link = linkFamilias(esc['Subdominio']).replace(/^https?:\/\//, '');
    const r = await enviarSMS([tel], (esc['Nome'] || 'A escola') + ': bem-vindo ao curso da carta ' + c['Categoria'] + '. O seu numero e ' + numero + '. Veja aulas, prestacoes e recibos e pague por M-Pesa ou e-Mola em ' + link + ' (escolha Estudante).');
    sms = r.ok;
  }
  cachePainel.delete(req.escola);
  res.json({ ok: true, id: insId, estudante: estId, numero, prestacoes: prest, sms });
}));
app.post('/inscricao-estado', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, estado = String(b.estado || '');
  if (!['activa', 'concluida', 'desistiu'].includes(estado)) return erro(res, 400, 'Estado inválido.');
  const i = await daMinhaEscola('inscricaoconducao', String(b.id || ''), req.escola);
  await mudar('inscricaoconducao', i._id, { 'Estado': estado });
  if (estado === 'desistiu') { // prestações por pagar ficam anuladas
    const ps = await procurarTodos('propina', daEscola(req.escola).concat([{ key: 'Estudante', constraint_type: 'equals', value: i['Estudante'] }, { key: 'Tipo', constraint_type: 'equals', value: 'prestacao' }]));
    for (const p of ps.filter(x => x['Estado'] !== 'paga')) await mudar('propina', p._id, { 'Estado': 'anulada' }).catch(() => {});
  }
  res.json({ ok: true, estado });
}));

// ============================================================
//  ESCOLA DE CONDUÇÃO · PARTE 2: VIATURAS E AULAS PRÁTICAS (v5.1)
//  Bubble:
//   Viatura:      Escola (Escola) · Matricula (text) · Marca Modelo (text) · Categoria (text) · Ano (number)
//                 · Inspecao Ate (date) · Seguro Ate (date) · Activa (yes/no) · Notas (text)
//   Aula Pratica: Escola (Escola) · Estudante (text) · Inscricao (text) · Instrutor (text) · Viatura (text)
//                 · Data (text AAAA-MM-DD) · Inicio (text HH:MM) · Fim (text HH:MM) · Minutos (number)
//                 · Estado (text: marcada | feita | faltou | cancelada) · Notas (text)
// ============================================================
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minDe = h => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const hhmmDe = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const catCompativel = (viatura, carta) => !viatura || !carta || viatura === carta || (carta === 'A1' && viatura === 'A') || (carta === 'BE' && viatura === 'B') || (carta === 'CE' && viatura === 'C');
function diasAte(iso) { return iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5) : null; }
const viaturaOut = v => ({ id: v._id, matricula: v['Matricula'] || '', modelo: v['Marca Modelo'] || '', categoria: v['Categoria'] || '', ano: v['Ano'] || null,
  inspecao: v['Inspecao Ate'] || null, seguro: v['Seguro Ate'] || null, dias_inspecao: diasAte(v['Inspecao Ate']), dias_seguro: diasAte(v['Seguro Ate']), notas: v['Notas'] || '', activa: v['Activa'] !== false });
app.post('/viaturas', exigeDireccao, rota(async (req, res) => {
  const f = daEscola(req.escola);
  const [vs, aulas] = await Promise.all([procurarTodos('viatura', f), procurarTodos('aulapratica', f, 20000)]);
  res.json({ ok: true, viaturas: vs.filter(v => v['Activa'] !== false).map(v => Object.assign(viaturaOut(v), {
    aulas_feitas: aulas.filter(a => a['Viatura'] === v._id && a['Estado'] === 'feita').length,
    minutos: aulas.filter(a => a['Viatura'] === v._id && a['Estado'] === 'feita').reduce((x, a) => x + Number(a['Minutos'] || 0), 0) })).sort((a, b) => a.matricula.localeCompare(b.matricula)) });
}));
app.post('/viatura-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const mat = txt(b.matricula, 20).toUpperCase().replace(/\s+/g, '-');
  if (mat.length < 5) return erro(res, 400, 'Escreva a matrícula (ex.: AFG-123-MC).');
  const cat = String(b.categoria || '').toUpperCase();
  if (!CATEGORIAS[cat]) return erro(res, 400, 'Escolha a categoria da viatura.');
  const campos = { 'Escola': req.escola, 'Matricula': mat, 'Marca Modelo': txt(b.modelo, 60), 'Categoria': cat, 'Notas': txt(b.notas, 300), 'Activa': true };
  if (b.ano) campos['Ano'] = Math.round(Number(b.ano)) || undefined;
  for (const [k, c] of [['inspecao', 'Inspecao Ate'], ['seguro', 'Seguro Ate']]) if (b[k] && !isNaN(Date.parse(b[k]))) campos[c] = new Date(b[k] + 'T23:59:00Z').toISOString();
  let id = b.id ? String(b.id) : null;
  if (!id) { const ja = (await procurarTodos('viatura', daEscola(req.escola))).find(v => v['Matricula'] === mat && v['Activa'] !== false); if (ja) return erro(res, 409, 'Já existe uma viatura com esta matrícula.'); }
  if (id) { await daMinhaEscola('viatura', id, req.escola); await mudar('viatura', id, campos); } else id = await criar('viatura', campos);
  res.json({ ok: true, id });
}));
app.post('/viatura-apagar', exigeDireccao, rota(async (req, res) => {
  const v = await daMinhaEscola('viatura', String((req.body || {}).id || ''), req.escola);
  await mudar('viatura', v._id, { 'Activa': false });
  res.json({ ok: true });
}));
async function dadosAulas(escola) {
  const f = daEscola(escola);
  const [aulas, profs, vs, ins, ests, cs] = await Promise.all([procurarTodos('aulapratica', f, 20000), procurarTodos('professor', f), procurarTodos('viatura', f), procurarTodos('inscricaoconducao', f), procurarTodos('estudante', f), procurarTodos('cursoconducao', f)]);
  return { aulas, profs, vs, ins, ests, cs, PM: Object.fromEntries(profs.map(p => [p._id, p])), VM: Object.fromEntries(vs.map(v => [v._id, v])), EM: Object.fromEntries(ests.map(e => [e._id, e])), CM: Object.fromEntries(cs.map(c => [c._id, c])), IM: Object.fromEntries(ins.map(i => [i._id, i])) };
}
function aulaOut(a, D) {
  const e = D.EM[a['Estudante']] || {}, p = D.PM[a['Instrutor']] || {}, v = D.VM[a['Viatura']] || {}, i = D.IM[a['Inscricao']] || {};
  return { id: a._id, data: a['Data'], inicio: a['Inicio'], fim: a['Fim'], minutos: Number(a['Minutos'] || 0), estado: a['Estado'] || 'marcada', notas: a['Notas'] || '',
    estudante: a['Estudante'], instruendo: e['Nome'] || '', numero: e['Numero'] || '', telefone: e['Telefone'] || '', categoria: i['Categoria'] || '',
    instrutor_id: a['Instrutor'], instrutor: p['Nome'] || '', viatura_id: a['Viatura'], viatura: v['Matricula'] || '', modelo: v['Marca Modelo'] || '' };
}
function progressoInscricao(i, D) {
  const c = D.CM[i['Curso']] || {}, minhas = D.aulas.filter(a => a['Inscricao'] === i._id);
  return { feitas: minhas.filter(a => a['Estado'] === 'feita').length, faltou: minhas.filter(a => a['Estado'] === 'faltou').length, marcadas: minhas.filter(a => a['Estado'] === 'marcada').length, total: Number(c['Aulas Praticas'] || 0) };
}
app.post('/aulas-praticas', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const de = dataOk(b.de) ? b.de : hojeMZ().data, ate = dataOk(b.ate) ? b.ate : de;
  const D = await dadosAulas(req.escola);
  res.json({ ok: true, de, ate, hoje: hojeMZ().data,
    aulas: D.aulas.filter(a => a['Data'] >= de && a['Data'] <= ate).map(a => aulaOut(a, D)).sort((x, y) => (x.data + x.inicio).localeCompare(y.data + y.inicio)),
    instrutores: D.profs.filter(p => p['Activo'] !== false).map(p => ({ id: p._id, nome: p['Nome'] || '', licenca: p['Licenca Instrutor'] || '' })).sort((x, y) => x.nome.localeCompare(y.nome, 'pt')),
    viaturas: D.vs.filter(v => v['Activa'] !== false).map(viaturaOut),
    inscricoes: D.ins.filter(i => (i['Estado'] || 'activa') === 'activa').map(i => Object.assign({ id: i._id, estudante: i['Estudante'], nome: (D.EM[i['Estudante']] || {})['Nome'] || '', numero: (D.EM[i['Estudante']] || {})['Numero'] || '', categoria: i['Categoria'] || '' }, progressoInscricao(i, D))).sort((x, y) => x.nome.localeCompare(y.nome, 'pt')),
    semana: (() => { const out = []; for (let k = 0; k < 7; k++) { const d = new Date(de + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); const ds = d.toISOString().slice(0, 10); out.push({ data: ds, aulas: D.aulas.filter(a => a['Data'] === ds && a['Estado'] !== 'cancelada').length }); } return out; })() });
}));
async function marcarAula(req, res, b) {
  const D = await dadosAulas(req.escola);
  const i = D.IM[String(b.inscricao || '')];
  if (!i || i['Escola'] !== req.escola) return erro(res, 404, 'Escolha o instruendo.');
  if ((i['Estado'] || 'activa') !== 'activa') return erro(res, 400, 'Esta inscrição já não está em curso.');
  const p = D.PM[String(b.instrutor || '')]; if (!p || p['Escola'] !== req.escola || p['Activo'] === false) return erro(res, 400, 'Escolha o instrutor.');
  const v = D.VM[String(b.viatura || '')]; if (!v || v['Escola'] !== req.escola || v['Activa'] === false) return erro(res, 400, 'Escolha a viatura.');
  if (!dataOk(b.data)) return erro(res, 400, 'Escolha a data.');
  if (b.data < hojeMZ().data) return erro(res, 400, 'Não pode marcar aulas em dias que já passaram.');
  if (!HHMM.test(b.inicio || '')) return erro(res, 400, 'Escolha a hora de início.');
  const dur = Math.max(30, Math.min(240, Math.round(Number(b.duracao) || 60)));
  const ini = minDe(b.inicio), fim = ini + dur;
  if (fim > 22 * 60) return erro(res, 400, 'A aula termina demasiado tarde.');
  if (!catCompativel(v['Categoria'], i['Categoria'])) return erro(res, 400, 'A viatura ' + v['Matricula'] + ' é da categoria ' + v['Categoria'] + ' e o instruendo tira a carta ' + i['Categoria'] + '.');
  if (v['Inspecao Ate'] && new Date(v['Inspecao Ate']).toISOString().slice(0, 10) < b.data) return erro(res, 400, 'A inspecção da viatura ' + v['Matricula'] + ' termina antes desta data. Renove-a primeiro.');
  if (v['Seguro Ate'] && new Date(v['Seguro Ate']).toISOString().slice(0, 10) < b.data) return erro(res, 400, 'O seguro da viatura ' + v['Matricula'] + ' termina antes desta data. Renove-o primeiro.');
  const sobrepoe = D.aulas.filter(a => a['Data'] === b.data && a['Estado'] !== 'cancelada' && a._id !== b.ignorar && minDe(a['Inicio']) < fim && ini < minDe(a['Fim']));
  const c1 = sobrepoe.find(a => a['Instrutor'] === p._id), c2 = sobrepoe.find(a => a['Viatura'] === v._id), c3 = sobrepoe.find(a => a['Estudante'] === i['Estudante']);
  if (c1) return erro(res, 409, p['Nome'] + ' já tem aula das ' + c1['Inicio'] + ' às ' + c1['Fim'] + ' nesse dia.');
  if (c2) return erro(res, 409, 'A viatura ' + v['Matricula'] + ' já está ocupada das ' + c2['Inicio'] + ' às ' + c2['Fim'] + '.');
  if (c3) return erro(res, 409, 'O instruendo já tem aula das ' + c3['Inicio'] + ' às ' + c3['Fim'] + ' nesse dia.');
  const id = await criar('aulapratica', { 'Escola': req.escola, 'Estudante': i['Estudante'], 'Inscricao': i._id, 'Instrutor': p._id, 'Viatura': v._id, 'Data': b.data,
    'Inicio': b.inicio, 'Fim': hhmmDe(fim), 'Minutos': dur, 'Estado': 'marcada', 'Notas': txt(b.notas, 300) });
  let sms = false;
  const e = D.EM[i['Estudante']] || {};
  if (b.sms && tel9(e['Telefone']).length === 9) {
    const esc = await obter('escola', req.escola).catch(() => null);
    const d = new Date(b.data + 'T12:00:00Z'), dia = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][d.getUTCDay()];
    const r = await enviarSMS([e['Telefone']], ((esc && esc['Nome']) || 'Escola') + ': aula pratica marcada para ' + dia + ' ' + dmCurto(b.data) + ', ' + b.inicio + '-' + hhmmDe(fim) + '. Instrutor ' + (p['Nome'] || '').split(' ')[0] + ', viatura ' + v['Matricula'] + '.');
    sms = r.ok;
  }
  return res.json({ ok: true, id, fim: hhmmDe(fim), sms });
}
app.post('/aula-marcar', exigeDireccao, rota(async (req, res) => marcarAula(req, res, req.body || {})));
app.post('/aula-estado', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, estado = String(b.estado || '');
  if (!['marcada', 'feita', 'faltou', 'cancelada'].includes(estado)) return erro(res, 400, 'Estado inválido.');
  const a = await daMinhaEscola('aulapratica', String(b.id || ''), req.escola);
  if (estado === 'feita' && a['Data'] > hojeMZ().data) return erro(res, 400, 'Esta aula ainda não aconteceu.');
  const mud = { 'Estado': estado }; if (b.notas !== undefined) mud['Notas'] = txt(b.notas, 300);
  await mudar('aulapratica', a._id, mud);
  res.json({ ok: true, estado });
}));

// ============================================================
//  WEBHOOK DA MOZPAYMENT
//  POST /wh-moz/<MOZ_WEBHOOK_KEY>
//  { transaction_id, reference, status, payment_method, wallet, amount, phone, client_name, product_name, reason, timestamp }
//  O "reason" traz o idpayment (M-Pesa/e-Mola) ou o session_id (cartão) que guardámos em Pagamento.Referencia.
// ============================================================
function chaveCerta(c) {
  if (!MOZ_WEBHOOK_KEY || !c) return false;
  const a = Buffer.from(String(c)), b = Buffer.from(MOZ_WEBHOOK_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function estadoMoz(s) {
  s = String(s || '').trim().toUpperCase();
  if (['PAID', 'SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'APPROVED', 'PAGO'].includes(s)) return 'pago';
  if (['FAILED', 'FAIL', 'ERROR', 'DECLINED', 'CANCELLED', 'CANCELED', 'REJECTED', 'FALHADO'].includes(s)) return 'falhado';
  if (['EXPIRED', 'TIMEOUT', 'EXPIRADO'].includes(s)) return 'expirado';
  return 'pendente';
}
app.get('/wh-moz/:chave', (req, res) => {
  if (!chaveCerta(req.params.chave)) return res.sendStatus(404);
  res.json({ ok: true, servico: 'gescolar', webhook: 'activo' });
});
app.post('/wh-moz/:chave', async (req, res) => {
  if (!chaveCerta(req.params.chave)) return res.sendStatus(404);
  const b = req.body || {};
  const estado = estadoMoz(b.status);
  const candidatos = [b.reason, b.reference, b.transaction_id].map(x => txt(x, 120)).filter(Boolean);
  console.log('[webhook] reason=' + (b.reason || '') + ' reference=' + (b.reference || '') + ' status=' + b.status + ' metodo=' + (b.payment_method || '') + ' valor=' + (b.amount || ''));
  try {
    if (MOZ_WALLET && b.wallet && String(b.wallet) !== MOZ_WALLET) { console.warn('[webhook] carteira diferente: ' + b.wallet); return res.json({ ok: true, ignorado: 'carteira' }); }
    let p = null;
    for (const c of candidatos) { const l = await procurar('pagamento', [{ key: 'Referencia', constraint_type: 'equals', value: c }], 1); if (l[0]) { p = l[0]; break; } }
    if (!p) {
      for (const c of candidatos) { const l = await procurar('subscricao', [{ key: 'Referencia', constraint_type: 'equals', value: c }], 1); if (l[0]) return res.json(await aplicarSubscricao(l[0], b, estado)); }
      console.warn('[webhook] referência desconhecida: ' + candidatos.join(' / ')); return res.json({ ok: true, ignorado: 'referência desconhecida' });
    }
    if (p['Estado'] === 'pago') return res.json({ ok: true, ja: 'aplicado' });
    const raw = JSON.stringify(b).slice(0, 4000);
    const valor = Math.round(Number(String(b.amount || '').replace(',', '.')));
    if (estado === 'pago' && valor !== Math.round(Number(p['Valor'] || 0))) {
      console.warn('[webhook] valor diferente: esperado=' + p['Valor'] + ' recebido=' + b.amount);
      await mudar('pagamento', p._id, { 'Estado': 'revisao', 'Transacao': txt(b.transaction_id, 120), 'Raw': raw });
      return res.json({ ok: true, revisao: true });
    }
    if (estado !== 'pago') {
      await mudar('pagamento', p._id, { 'Estado': estado, 'Transacao': txt(b.transaction_id, 120), 'Raw': raw });
      return res.json({ ok: true, estado });
    }
    const documento = await aplicarPago(p, { 'Transacao': txt(b.transaction_id, 120), 'Raw': raw, 'Telefone': txt(b.phone, 30) || p['Telefone'] || '' });
    res.json({ ok: true, estado: 'pago', documento });
  } catch (e) {
    console.error('[webhook]', e.message);
    res.status(500).json({ ok: false });
  }
});

app.use((req, res) => erro(res, 404, 'Rota não encontrada.'));
app.listen(PORT, () => console.log(VERSAO + ' a ouvir na porta ' + PORT));
