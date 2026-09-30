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
//
//  Variáveis de ambiente:
//    BUBBLE_BASE     https://<app>.bubbleapps.io/version-test/api/1.1/obj   (sem / no fim)
//    BUBBLE_TOKEN    token de admin da Data API
//    SESSION_SECRET  frase longa e aleatória que assina as sessões
//    ORIGENS         endereços das páginas, separados por vírgulas
// ============================================================
'use strict';
const express = require('express');
const crypto = require('crypto');

const VERSAO = 'gescolar-proxy 3.0.0';
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
  res.json({ ok: true, versao: VERSAO, bubble: BUBBLE_BASE && BUBBLE_TOKEN ? 'configurado' : 'em falta', sessoes: SESSION_SECRET.length >= 32 ? 'configurado' : 'em falta', hora: new Date().toISOString() });
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

app.use((req, res) => erro(res, 404, 'Rota não encontrada.'));
app.listen(PORT, () => console.log(VERSAO + ' a ouvir na porta ' + PORT));
