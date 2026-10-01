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

const VERSAO = 'gescolar-proxy 4.2.0';
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
async function procurar(tipo, filtros, limite) {
  const q = '?constraints=' + encodeURIComponent(JSON.stringify(filtros || [])) + '&limit=' + (limite || 100);
  const d = await bubble('GET', '/' + tipo + q);
  return (d && d.response && d.response.results) || [];
}

// ---------- sessões assinadas ----------
const b64 = s => Buffer.from(s).toString('base64url');
function assinar(dados) {
  const corpo = b64(JSON.stringify(Object.assign({}, dados, { exp: Date.now() + SESSAO_DIAS * 864e5 })));
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
    niveis: (e['Niveis'] || []).map(n => CODIGO_NIVEL[n] || n), ano: e['Ano Lectivo'], teste_ate: e['Teste Ate'] || null,
    regras: { dia_limite: e['Dia Limite'], multa: e['Multa Percent'], multa_max: e['Multa Max'], aprovacao: e['Nota Aprovacao'], dispensa: e['Nota Dispensa'], formula: e['Formula Media'] }
  };
}
async function abrirSessao(userId) {
  const user = await obter('user', userId);
  if (!user) { const e = new Error('Conta não encontrada.'); e.publico = 404; throw e; }
  if (user['Activo'] === false) { const e = new Error('Esta conta está desactivada. Fale com a escola.'); e.publico = 403; throw e; }
  const papel = user['Papel'] || null;
  const escola = await resumoEscola(user['Escola']);
  if (escola && escola.estado === 'suspensa' && papel !== 'Plataforma') { const e = new Error('O acesso desta escola está suspenso. A Direcção deve regularizar a subscrição.'); e.publico = 402; throw e; }
  mudar('user', userId, { 'Ultimo Acesso': new Date().toISOString() }).catch(() => {});
  const token = assinar({ u: userId, e: escola ? escola.id : null, p: papel });
  return { ok: true, token, nome: user['Nome Completo'] || '', papel, pagina: PAPEIS[papel] || 'registo', escola, expira_dias: SESSAO_DIAS };
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
    res.json(await abrirSessao(userId));
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
  try { res.json(await abrirSessao(s.u)); }
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
  const t = act(turmas), d = act(disciplinas), p = act(professores), e = estudantes.filter(x => (x['Estado'] || 'activo') === 'activo');
  res.json({ ok: true, escola, contagem: { turmas: t.length, disciplinas: d.length, professores: p.length, estudantes: e.length },
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
  let id = b.id ? String(b.id) : null;
  if (id) { await daMinhaEscola('professor', id, req.escola); await mudar('professor', id, campos); }
  else id = await criar('professor', campos);
  res.json({ ok: true, id });
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
  return String(m || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ºª]/g, '').replace(/[^\x20-\x7E\n]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, 459);
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

app.post('/pagar', exigeDireccao, rota(async (req, res) => {
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
}));

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
app.post('/recibo', exigeDireccao, rota(async (req, res) => {
  const p = await daMinhaEscola('pagamento', String((req.body || {}).id || ''), req.escola);
  if (p['Estado'] !== 'pago' || !p['Documento']) return erro(res, 409, 'Este pagamento ainda não está confirmado, por isso ainda não tem factura-recibo.');
  res.json({ ok: true, recibo: await dadosRecibo(p) });
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
    if (!p) { console.warn('[webhook] referência desconhecida: ' + candidatos.join(' / ')); return res.json({ ok: true, ignorado: 'referência desconhecida' }); }
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
