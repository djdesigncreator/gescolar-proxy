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
//    Escolinha (v5.3): avaliação descritiva nas pautas · /prof/diario /prof/diario-guardar · autorizados a recolher
//    Saldo e levantamentos (v5.8): /saldo /levantar (B2C M-Pesa/e-Mola) /sacar-cartao · /pl/saques /pl/saque-estado
//    Inscrições online (v5.7): links públicos personalizados com pagamento · /links /link-guardar /inscricoes-online · /pub/link /pub/inscrever
//    Matrícula (v5.6): SMS de boas-vindas sempre (encarregado e/ou estudante) · no superior o estudante é o titular (sem encarregado)
//    Superior e Técnico (v5.5): pautas semestrais (frequência, exame, recorrência), créditos das cadeiras
//    Primário (v5.4): professor titular da turma (monodocência) · chamada do dia (Tempo 99) · Turma.Professor Titular (text)
//                      (/autorizados /autorizado-guardar /autorizado-apagar · /p/autorizado-guardar /p/autorizado-apagar)
//    Escola de condução 3 (v5.2): /exames /exame-marcar /exame-resultado · /prof/aula-estado · portal com aulas e exames
//    Escola de condução 2 (v5.1): /viaturas /viatura-guardar /viatura-apagar /aulas-praticas /aula-marcar /aula-estado
//    Escola de condução 1 (v5.0): /cursos /curso-guardar /curso-apagar /instruendos /inscrever /inscricao-estado
//    Convites aos professores (v4.10): SMS automático ao registar · /professor-convite /professores-convite
//    Palavra-passe e equipa (v4.9): /senha-pedir /senha-nova (código por SMS) · /equipa /equipa-criar /equipa-estado
//    SMS e email (v5.25): /registo-codigo · /sms-saldo /sms-recarregar /sms-recarga-estado · /pl/sms-dar /pl/sms-recargas /pl/sms-aprovar
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

const VERSAO = 'gescolar-proxy 5.27.0';
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
const TESTE_DIAS = Math.max(1, Math.min(90, Number(process.env.TESTE_DIAS || 7)));   // período de teste das escolas novas (por defeito 7 dias)

const app = express();
app.set('trust proxy', true);
// o envio de ficheiros no chat precisa de pedidos maiores; o resto fica com 1 MB
const jsonPequeno = express.json({ limit: '1mb' }), jsonGrande = express.json({ limit: '30mb' });
const COM_FICHEIROS = new Set(['/chat/enviar', '/matricular', '/estudante-documentos-guardar', '/pub/inscrever']);   // v5.27: documentos da matrícula
app.use((req, res, next) => (COM_FICHEIROS.has(req.path) ? jsonGrande : jsonPequeno)(req, res, next));

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
// nome da tabela como aparece no Bubble (o URL da Data API não tem espaços)
const NOME_TABELA = { chamada: 'Chamada', falta: 'Falta', pauta: 'Pauta', horario: 'Horario', propina: 'Propina', pagamento: 'Pagamento', comunicado: 'Comunicado',
  subscricao: 'Subscricao', transferencia: 'Transferencia', cursoconducao: 'Curso Conducao', inscricaoconducao: 'Inscricao Conducao', viatura: 'Viatura',
  aulapratica: 'Aula Pratica', exameconducao: 'Exame Conducao', linkinscricao: 'Link Inscricao', inscricaoonline: 'Inscricao Online', diarioentrada: 'Diario Entrada', autorizadorecolha: 'Autorizado Recolha', perguntacodigo: 'Pergunta Codigo', testecodigo: 'Teste Codigo', aulateorica: 'Aula Teorica', licaocodigo: 'Licao Codigo', chatturma: 'Chat Turma', mensagemchat: 'Mensagem Chat', planoaula: 'Plano Aula', aulavideo: 'Aula Video', aulaaovivo: 'Aula Ao Vivo',
  turma: 'Turma', disciplina: 'Disciplina', professor: 'Professor', estudante: 'Estudante', encarregado: 'Encarregado', escola: 'Escola' };
const nomeTabela = t => NOME_TABELA[t] || t;
// erro do Bubble ao ler uma lista: quase sempre é a tabela que não existe (404) ou um campo que falta (400)
function erroTabela(tipo, e) {
  if (e && (e.status === 404 || e.status === 400)) {
    const x = new Error('No Bubble falta a tabela «' + nomeTabela(tipo) + '» ou um campo dela. Detalhe: ' + String(e.bubble || e.message).slice(0, 160));
    x.publico = 400; x.tabela = nomeTabela(tipo); return x;
  }
  return e;
}
const workflow = (nome, body) => pedido(BUBBLE_WF + '/' + nome, 'POST', body);
const obter = (tipo, id) => bubble('GET', '/' + tipo + '/' + encodeURIComponent(id)).then(d => d && d.response);
// ao gravar, o Bubble recusa com 400 quando falta um campo ou o tipo não bate certo: dizer qual
function erroGravar(tipo, e) {
  if (e && (e.status === 400 || e.status === 404)) {
    const x = new Error('O Bubble não aceitou gravar na tabela «' + nomeTabela(tipo) + '». Falta criar um campo ou o tipo dele está diferente. Detalhe: ' + String(e.bubble || e.message).slice(0, 200));
    x.publico = 400; x.tabela = nomeTabela(tipo); return x;
  }
  return e;
}
const criar = (tipo, campos) => bubble('POST', '/' + tipo, campos).then(d => d && d.id, e => { throw erroGravar(tipo, e); });
const mudar = (tipo, id, campos) => bubble('PATCH', '/' + tipo + '/' + encodeURIComponent(id), campos).catch(e => { throw erroGravar(tipo, e); });
const apagar = (tipo, id) => bubble('DELETE', '/' + tipo + '/' + encodeURIComponent(id));
async function procurar(tipo, filtros, limite) {
  const q = '?constraints=' + encodeURIComponent(JSON.stringify(filtros || [])) + '&limit=' + (limite || 100);
  let d; try { d = await bubble('GET', '/' + tipo + q); } catch (e) { throw erroTabela(tipo, e); }
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
  const s = verificar(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (s) try { marcarPresenca(s); } catch (e) {}
  return s;
}
// ---------- presença (v5.24): quem está a usar o Gescolar agora (em memória; recomeça quando o servidor reinicia) ----------
const PRESENCA = new Map();   // escolaId → Map('Papel:userId' → ms)
const ONLINE_MIN = 5;         // conta como «online» quem fez algum pedido nos últimos 5 minutos
function marcarPresenca(s) {
  if (!s || !s.e) return;
  let m = PRESENCA.get(s.e); if (!m) { m = new Map(); PRESENCA.set(s.e, m); }
  m.set(String(s.p || '') + ':' + String(s.u || ''), Date.now());
  if (m.size > 3000) { const lim = Date.now() - 864e5; for (const [k, t] of m) if (t < lim) m.delete(k); }
}
function presencaDe(escolaId) {
  const m = PRESENCA.get(escolaId), lim = Date.now() - ONLINE_MIN * 60e3, papeis = {};
  let online = 0, ultimo = 0;
  if (m) for (const [k, t] of m) { if (t > ultimo) ultimo = t; if (t >= lim) { online++; const p = k.split(':')[0] || 'Outro'; papeis[p] = (papeis[p] || 0) + 1; } }
  return { online, papeis, ultimo: ultimo ? new Date(ultimo).toISOString() : null };
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
    situacao: situacaoEscola(e), sms: creditosDe(e), ano_matricula: e['Ano Matricula'] || e['Ano Lectivo'] || '',
    regras: { dia_limite: e['Dia Limite'], multa: e['Multa Percent'], multa_max: e['Multa Max'], aprovacao: e['Nota Aprovacao'], dispensa: e['Nota Dispensa'], formula: e['Formula Media'], admissao: e['Nota Admissao'], peso_exame: e['Peso Exame'] }
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
  res.json({ ok: true, versao: VERSAO, bubble: BUBBLE_BASE && BUBBLE_TOKEN ? 'configurado' : 'em falta', sessoes: SESSION_SECRET.length >= 32 ? 'configurado' : 'em falta', mozpayment: (process.env.MOZ_EMAIL && process.env.MOZ_SENHA && process.env.MOZ_WALLET) ? 'configurado' : 'em falta', c2b: MOZ_C2B_MODO === 'checkout' ? 'checkout ' + MOZ_C2B_PATH : 'directo (antigo)', b2c: MOZ_B2C_MODO === 'payout' ? MOZ_PAYOUT_PATH : 'antigo', webhook: process.env.MOZ_WEBHOOK_KEY ? 'configurado' : 'em falta', sms: (process.env.SMS_TOKEN && process.env.SMS_ORIGEM) ? 'configurado' : 'em falta', email: (RESEND_KEY && MAIL_FROM) ? 'resend' : 'bubble (workflow enviar-email)', ia: process.env.OPENAI_API_KEY ? 'configurado' : 'em falta', aulas_gravadas: STREAM_OK ? 'configurado' : 'em falta', aulas_ao_vivo: AGORA_OK ? 'configurado' : 'em falta', ficheiros: BUNNY_OK ? ('bunny' + (CDN_TOKEN_KEY ? ' com links que expiram' : ' SEM CDN_TOKEN_KEY')) : 'bubble', hora: new Date().toISOString() });
});

// ============================================================
//  v5.25: confirmar o email antes de criar a escola
//  POST /registo-codigo { email, nome }  → envia um código de 6 dígitos por email (Resend) e devolve { pedido }
//  O /registo passa a exigir { pedido, codigo }. Render: REGISTO_CONFIRMAR_EMAIL=nao desliga a confirmação.
// ============================================================
const REGISTO_CONFIRMAR = String(process.env.REGISTO_CONFIRMAR_EMAIL || 'sim').toLowerCase() !== 'nao';
app.post('/registo-codigo', rota(async (req, res) => {
  const b = req.body || {}, email = txt(b.email, 120).toLowerCase(), nome = txt(b.nome, 120);
  if (!emailOk(email)) return erro(res, 400, 'Escreva um email válido.');
  if (travao('reg-cod-ip|' + req.ip, 10, 30) || travao('reg-cod|' + email, 4, 30)) return erro(res, 429, 'Já enviámos vários códigos. Espere alguns minutos e tente de novo.');
  if (await userPorEmail(email)) return erro(res, 409, 'Este email já tem conta no Gescolar. Use «Entrar» ou outro email.');
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0'), pedido = crypto.randomBytes(16).toString('hex');
  const primeiro = nome ? nome.split(/\s+/)[0] : '';
  const blocos = [{ p: (primeiro ? 'Olá, ' + primeiro + '!' : 'Olá!') + ' Está quase a criar a sua escola no Gescolar.' }, { p: 'Escreva este código na página do registo para confirmar o seu email:' }, { codigo },
    { nota: 'O código vale 15 minutos. Se não foi você que pediu, pode ignorar este email: nenhuma conta é criada sem o código.' }];
  const m = await enviarEmail(email, 'Gescolar: o seu código é ' + codigo, emailGescolar('', 'Confirme o seu email', blocos), textoDeBlocos('Confirme o seu email', blocos));
  if (!m.ok) return erro(res, 502, 'Não foi possível enviar o email agora. Confirme o endereço e tente de novo dentro de um minuto.');
  pedidosAcesso.set(pedido, { tipo: 'registo', email, hash: hashCodigo(pedido + codigo), exp: Date.now() + 900e3, tent: 0 });
  res.json({ ok: true, pedido, destino: mascararEmail(email) });
}));
function confirmarRegisto(b, email) {
  if (!REGISTO_CONFIRMAR) return null;
  if (!b.pedido) return { st: 400, msg: 'Confirme primeiro o seu email: carregue em «Criar a escola» para receber o código.' };
  const pd = pedidosAcesso.get(String(b.pedido || ''));
  if (!pd || pd.tipo !== 'registo' || pd.exp < Date.now()) return { st: 410, msg: 'O código expirou. Peça um novo.' };
  if (pd.email !== email) return { st: 400, msg: 'O código foi enviado para outro email. Peça um novo.' };
  if (pd.ok) return null;
  pd.tent++;
  if (pd.tent > 5) { pedidosAcesso.delete(String(b.pedido)); return { st: 410, msg: 'Demasiadas tentativas. Peça um novo código.' }; }
  const cod = soDigitos(b.codigo), a = Buffer.from(hashCodigo(String(b.pedido) + cod)), c = Buffer.from(pd.hash);
  if (cod.length !== 6 || a.length !== c.length || !crypto.timingSafeEqual(a, c)) return { st: 401, msg: 'Código errado (' + (5 - pd.tent) + ' tentativas restantes).' };
  pd.ok = true;   // fica válido até a escola ser criada (se faltar outro dado, não é preciso pedir outro código)
  return null;
}

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
    const nvErro = niveisValidos(niveis);   // v5.26
    if (nvErro) return erro(res, 400, nvErro);
    if (adminNome.split(/\s+/).length < 2) return erro(res, 400, 'Escreva o nome completo do administrador.');
    const conf = confirmarRegisto(b, email);   // v5.25: o email tem de ser confirmado com o código
    if (conf) return erro(res, conf.st, conf.msg);

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
    const testeAte = new Date(hoje.getTime() + TESTE_DIAS * 864e5);
    const escolaId = await criar('escola', {
      'Nome': nome, 'NUIT': nuit, 'Provincia': provincia, 'Cidade': txt(b.cidade, 80),
      'Telefone': txt(b.telefone, 30), 'Email': txt(b.email_escola || email, 120), 'Subdominio': sub,
      'Niveis': niveis.map(k => NIVEIS[k]), 'Plano': plano, 'Estado': 'teste', 'Teste Ate': testeAte.toISOString(),
      'Ano Lectivo': String(hoje.getFullYear()), 'Dia Limite': 10, 'Multa Percent': 10, 'Multa Max': 25,
      'Nota Aprovacao': 10, 'Nota Dispensa': 14, 'Formula Media': 'MT = (2 x MACS + ACP) / 3', 'SMS Creditos': SMS_INICIAIS, 'SMS Usados': 0
    });

    // 4. ligar a conta à escola como Direcção
    await mudar('user', userId, { 'Escola': escolaId, 'Papel': 'Direccao', 'Nome Completo': adminNome, 'Telefone': txt(b.admin_tel, 30), 'Activo': true });

    if (b.pedido) pedidosAcesso.delete(String(b.pedido));
    const s = await abrirSessao(userId);
    s.subdominio = sub; s.teste_ate = testeAte.toISOString().slice(0, 10); s.acesso = linkFamilias(sub);
    // SMS de boas-vindas ao director com o código da escola e os links
    const telAdm = tel9(b.admin_tel), telEsc = tel9(b.telefone);
    const nums = [...new Set([telAdm, telEsc].filter(t => t.length === 9))];
    if (nums.length) {
      const base = PORTAL_URL.replace(/[^/]*$/, '').replace(/^https?:\/\//, '');
      const r = await enviarSMS(nums, 'Gescolar: a escola ' + nome + ' foi criada. Codigo da escola: ' + sub + (SMS_LINKS ? '. Direccao entra em ' + base + 'entrar com ' + email + '. Familias, alunos e professores entram em ' + base + 'acesso?e=' + sub + ' com o telemovel.'
        : '. A Direccao entra no Gescolar com o email ' + email + '. Familias, alunos e professores entram com o codigo da escola e o numero de telemovel.')).catch(() => ({ ok: false }));
      s.sms = !!r.ok;
    }
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
    let d; try { d = await bubble('GET', '/' + tipo + q); } catch (e) { throw erroTabela(tipo, e); }
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
    catch (e) {
      console.error('[' + req.path + ']', e.message);
      if (e.pode_forcar || e.cheia || e.repetido) return res.status(e.publico || 409).json({ ok: false, erro: e.message, pode_forcar: true });
      erro(res, e.publico || 500, e.publico ? e.message : 'Não foi possível concluir. Tente de novo.');
    }
  };
}
const num = (v, def) => { const n = Number(v); return isFinite(n) ? n : def; };

// ---------- currículo modelo (a escola ajusta depois) ----------
const CURRICULO = {   // [nome, sigla, cor, tempos por semana, classes (vazio = todas as classes do nível)]
  ESC: [['Linguagem e comunicação', 'LNG', '#0A64DC', 6], ['Matemática lúdica', 'MLU', '#C2410C', 5], ['Expressão plástica', 'EXP', '#9B3FB5', 5], ['Música e movimento', 'MUS', '#7B4DD6', 5], ['Conhecimento do mundo', 'NAT', '#168A52', 5], ['Brincadeira livre', 'BRI', '#8A6D00', 4]],
  PRI: [['Português', 'POR', '#0A64DC', 7], ['Matemática', 'MAT', '#C2410C', 7], ['Educação Física', 'EF', '#3E7D1E', 2],
        ['Ciências Naturais', 'CN', '#168A52', 4, ['4ª', '5ª', '6ª']], ['Ciências Sociais', 'CS', '#8A6D00', 4, ['4ª', '5ª', '6ª']], ['Inglês', 'ING', '#7B4DD6', 2, ['4ª', '5ª', '6ª']],
        ['Educação Visual', 'EV', '#9B3FB5', 2, ['4ª', '5ª', '6ª']], ['Ofícios', 'OF', '#6B4E2E', 2, ['4ª', '5ª', '6ª']]],
  SEC: [['Português', 'POR', '#0A64DC', 5], ['Matemática', 'MAT', '#C2410C', 5], ['Inglês', 'ING', '#7B4DD6', 3], ['Física', 'FIS', '#0E7C86', 3], ['Química', 'QUI', '#B4235A', 3], ['Biologia', 'BIO', '#168A52', 3],
        ['Geografia', 'GEO', '#8A6D00', 2], ['História', 'HIS', '#6B4E2E', 2], ['Educação Física', 'E.FÍS', '#3E7D1E', 2],
        ['Educação Visual', 'E.VIS', '#9B3FB5', 1, ['7ª', '8ª', '9ª']], ['TIC', 'TIC', '#0B2A4A', 1, ['7ª', '8ª', '9ª']], ['Agro-pecuária', 'AGP', '#4D7C0F', 2, ['7ª', '8ª', '9ª']],
        ['Filosofia', 'FIL', '#5A4FCF', 2, ['10ª', '11ª', '12ª']], ['Francês', 'FRA', '#0E5FA8', 2, ['10ª', '11ª', '12ª']], ['Desenho e Geometria Descritiva', 'DGD', '#A16207', 3, ['10ª', '11ª', '12ª']]]
};
// ---------- estrutura das escolas segundo o Sistema Nacional de Educação (v5.26) ----------
//  Escolinha → salas por idade → turmas · Primário (1ª–6ª: 1º ciclo 1ª–3ª, 2º ciclo 4ª–6ª) → classes → turmas
//  Secundário (ESG1 7ª–9ª, ESG2 10ª–12ª com áreas) → classes → turmas
//  Técnico-profissional e Superior → cursos → ano → turmas
//  Bubble: tabela nova «Curso»: Escola (Escola) · Nome · Sigla · Nivel · Grau · Area (text) · Duracao (number) · Propina Mensal (number) · Coordenador (text) · Activo (yes/no)
//          Turma + «Curso» (text) · «Ano Curso» (number) · «Area» (text)
//          Disciplina + «Classes» (list of texts) · «Curso» (text) · «Ano Curso» (number) · «Semestre» (number) · «Horas» (number) · «Tipo» (text)
const CLASSES = {
  ESC: ['Berçário', '3 anos', '4 anos', '5 anos'],
  PRI: ['1ª', '2ª', '3ª', '4ª', '5ª', '6ª'],
  SEC: ['7ª', '8ª', '9ª', '10ª', '11ª', '12ª']
};
// turmas antigas: «10ª Classe», «10» ou «10a» passam a «10ª»
function classeNorm(nivel, classe) {
  const c = String(classe || '').trim();
  if (!CLASSES[nivel] || CLASSES[nivel].includes(c)) return c;
  const n = parseInt(c, 10), k = n + 'ª';
  return isFinite(n) && CLASSES[nivel].includes(k) ? k : c;
}
function cicloDe(nivel, classe) {
  const n = parseInt(classe, 10);
  if (nivel === 'PRI') return n <= 3 ? '1º ciclo' : '2º ciclo';
  if (nivel === 'SEC') return n <= 9 ? 'ESG1 · 1º ciclo' : 'ESG2 · 2º ciclo';
  return '';
}
const AREAS_ESG2 = ['Comunicação e Ciências Sociais', 'Matemática e Ciências Naturais', 'Artes Visuais e Cénicas'];
const GRAUS = {
  TEC: [{ g: 'Básico', anos: 3, d: 'Depois da 6ª/7ª classe' }, { g: 'Médio', anos: 3, d: 'Depois da 9ª/10ª classe ou do básico' },
        { g: 'CV3', anos: 1, d: 'Certificado Vocacional 3 (QNQP)' }, { g: 'CV4', anos: 1, d: 'Certificado Vocacional 4 (QNQP)' }, { g: 'CV5', anos: 1, d: 'Certificado Vocacional 5 (QNQP)' }],
  SUP: [{ g: 'Licenciatura', anos: 4, d: '1º ciclo · 180 a 240 créditos' }, { g: 'Mestrado', anos: 2, d: '2º ciclo' }, { g: 'Doutoramento', anos: 3, d: '3º ciclo' }, { g: 'Pós-graduação', anos: 1, d: 'Curso de curta duração' }]
};
const TIPOS_MODULO = ['Geral', 'Vocacional', 'Específico', 'Estágio'];
const ESTRUTURA = { classes: CLASSES, areas: AREAS_ESG2, graus: GRAUS, tipos_modulo: TIPOS_MODULO };
// Escolinha, Primário e Secundário podem juntar-se na mesma escola; Técnico, Superior e Condução ficam sempre sozinhos
const SOZINHOS = ['TEC', 'SUP', 'CON'];
const SO_NOME = { TEC: 'O ensino técnico-profissional', SUP: 'O ensino superior', CON: 'A escola de condução' };
function niveisValidos(niveis) {
  const s = niveis.filter(k => SOZINHOS.includes(k));
  if (s.length && niveis.length > 1) return SO_NOME[s[0]] + ' não se junta a outros tipos de ensino. Escolha só esse tipo, ou crie outra conta para os restantes.';
  return null;
}
const cursoEnsinoOut = c => ({ id: c._id, nome: c['Nome'] || '', sigla: c['Sigla'] || '', nivel: CODIGO_NIVEL[c['Nivel']] || c['Nivel'] || '', grau: c['Grau'] || '', area: c['Area'] || '',
  duracao: Number(c['Duracao'] || 0) || 1, propina: Number(c['Propina Mensal'] || 0), coordenador: c['Coordenador'] || '' });
app.post('/ensino-cursos', exigeDireccao, rota(async (req, res) => {
  const f = daEscola(req.escola);
  const [cs, ts] = await Promise.all([procurarTodos('curso', f).catch(() => []), procurarTodos('turma', f)]);
  res.json({ ok: true, estrutura: ESTRUTURA, cursos: cs.filter(c => c['Activo'] !== false).map(c => Object.assign(cursoEnsinoOut(c), { turmas: ts.filter(t => t['Activa'] !== false && t['Curso'] === c._id).length }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt')) });
}));
app.post('/ensino-curso-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, nivel = String(b.nivel || '').toUpperCase(), nome = txt(b.nome, 100);
  if (!['TEC', 'SUP'].includes(nivel)) return erro(res, 400, 'Os cursos são do ensino técnico-profissional ou do ensino superior.');
  const escola = await resumoEscola(req.escola);
  if (escola && escola.niveis.length && !escola.niveis.includes(nivel)) return erro(res, 400, 'Esta escola não tem esse tipo de ensino.');
  if (nome.length < 3) return erro(res, 400, 'Escreva o nome do curso, por exemplo «Contabilidade e Gestão».');
  const grau = (GRAUS[nivel].find(g => g.g === b.grau) || {}).g;
  if (!grau) return erro(res, 400, 'Escolha o nível do curso (' + GRAUS[nivel].map(g => g.g).join(', ') + ').');
  const dur = Math.round(num(b.duracao, 0));
  if (dur < 1 || dur > 7) return erro(res, 400, 'A duração do curso vai de 1 a 7 anos.');
  const campos = { 'Escola': req.escola, 'Nome': nome, 'Sigla': (txt(b.sigla, 10) || nome.split(/\s+/).filter(p => p.length > 2).map(p => p[0]).join('').slice(0, 5)).toUpperCase(),
    'Nivel': NIVEIS[nivel], 'Grau': grau, 'Area': txt(b.area, 80), 'Duracao': dur, 'Propina Mensal': Math.max(0, num(b.propina, 0)), 'Coordenador': txt(b.coordenador, 40), 'Activo': true };
  let id = b.id ? String(b.id) : null;
  if (id) {
    await daMinhaEscola('curso', id, req.escola);
    const ts = await procurarTodos('turma', [{ key: 'Escola', constraint_type: 'equals', value: req.escola }, { key: 'Curso', constraint_type: 'equals', value: id }]);
    const maior = Math.max(0, ...ts.filter(t => t['Activa'] !== false).map(t => Number(t['Ano Curso'] || 0)));
    if (maior > dur) return erro(res, 400, 'Há turmas no ' + maior + 'º ano. A duração não pode ser menor do que ' + maior + ' anos.');
    await mudar('curso', id, campos);
  } else id = await criar('curso', campos);
  res.json({ ok: true, id });
}));
app.post('/ensino-curso-apagar', exigeDireccao, rota(async (req, res) => {
  const id = String((req.body || {}).id || '');
  await daMinhaEscola('curso', id, req.escola);
  const ts = await procurarTodos('turma', [{ key: 'Escola', constraint_type: 'equals', value: req.escola }, { key: 'Curso', constraint_type: 'equals', value: id }]);
  if (ts.some(t => t['Activa'] !== false)) return erro(res, 409, 'O curso tem turmas. Apague ou mude as turmas antes de apagar o curso.');
  await mudar('curso', id, { 'Activo': false });
  res.json({ ok: true });
}));
// disciplina serve esta turma? (geral: pela classe; técnico e superior: pelo curso e ano)
function discServeTurma(d, t) {
  if (d['Nivel'] !== t['Nivel'] || d['Activa'] === false) return false;
  if (t['Curso']) return d['Curso'] === t['Curso'] && (!Number(d['Ano Curso']) || Number(d['Ano Curso']) === Number(t['Ano Curso'] || 0));
  const cl = d['Classes'] || [], tc = classeNorm(CODIGO_NIVEL[t['Nivel']] || t['Nivel'], t['Classe']);
  return !cl.length || !tc || cl.includes(tc);
}


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
  const nv = CODIGO_NIVEL[t['Nivel']] || t['Nivel'] || '', cl = classeNorm(nv, t['Classe']);
  return { id: t._id, nome: t['Nome'], codigo: t['Codigo'] || '', nivel: nv, classe: cl, ciclo: cicloDe(nv, cl), curso: t['Curso'] || '', ano_curso: Number(t['Ano Curso'] || 0) || null, area: t['Area'] || '', turno: t['Turno'] || '',
    sala: t['Sala'] || '', capacidade: t['Capacidade'] || 0, propina: t['Propina Mensal'] || 0, director: t['Director Turma'] || null, titular: t['Professor Titular'] || null, disciplinas: t['Disciplinas'] || [],
    estudantes: estudantes ? estudantes.filter(e => e['Turma'] === t._id && (e['Estado'] || 'activo') === 'activo').length : undefined };
}
app.post('/turmas', exigeDireccao, rota(async (req, res) => {
  const f = daEscola(req.escola);
  const [turmas, estudantes] = await Promise.all([procurarTodos('turma', f), procurarTodos('estudante', f)]);
  res.json({ ok: true, estrutura: ESTRUTURA, turmas: turmas.filter(t => t['Activa'] !== false).map(t => turmaOut(t, estudantes)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt', { numeric: true })) });
}));
app.post('/turma-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const nome = txt(b.nome, 80), nivel = String(b.nivel || '').toUpperCase();
  if (nome.length < 2) return erro(res, 400, 'Escreva o nome da turma, por exemplo "10ª Classe A".');
  if (!NIVEIS[nivel]) return erro(res, 400, 'Escolha o nível de ensino da turma.');
  const escola = await resumoEscola(req.escola);
  if (escola && escola.niveis.length && !escola.niveis.includes(nivel)) return erro(res, 400, 'Esta escola não tem o nível escolhido. Acrescente-o nas Definições.');
  // v5.26: ensino geral → classe (e área no ESG2); técnico e superior → curso e ano
  let classe = txt(b.classe, 40), curso = null, ano = null, area = '';
  if (CLASSES[nivel]) {
    if (!CLASSES[nivel].includes(classe)) return erro(res, 400, nivel === 'ESC' ? 'Escolha a sala (idade).' : 'Escolha a classe da turma.');
    if (nivel === 'SEC' && parseInt(classe, 10) >= 10 && b.area) { area = AREAS_ESG2.includes(b.area) ? b.area : ''; if (!area) return erro(res, 400, 'Área inválida.'); }
  } else if (nivel === 'TEC' || nivel === 'SUP') {
    curso = await daMinhaEscola('curso', String(b.curso || ''), req.escola).catch(() => null);
    if (!curso || curso['Activo'] === false || curso['Nivel'] !== NIVEIS[nivel]) return erro(res, 400, 'Escolha o curso da turma.');
    ano = Math.round(num(b.ano, 0));
    const dur = Number(curso['Duracao'] || 1);
    if (ano < 1 || ano > dur) return erro(res, 400, 'O curso ' + curso['Nome'] + ' tem ' + dur + ' ano(s). Escolha um ano de 1 a ' + dur + '.');
    classe = ano + 'º ano';
  }
  let discs = Array.isArray(b.disciplinas) ? b.disciplinas.map(String) : null;
  if (!discs) { // por defeito: as disciplinas da classe (ou do curso e ano)
    const todas = await procurarTodos('disciplina', daEscola(req.escola));
    const tv = { 'Nivel': NIVEIS[nivel], 'Classe': classe, 'Curso': curso ? curso._id : '', 'Ano Curso': ano };
    discs = todas.filter(d => discServeTurma(d, tv)).map(d => d._id);
  }
  const campos = { 'Escola': req.escola, 'Nome': nome, 'Codigo': txt(b.codigo, 20) || slug(nome).toUpperCase().replace(/-/g, '').slice(0, 8), 'Nivel': NIVEIS[nivel],
    'Classe': classe, 'Curso': curso ? curso._id : '', 'Ano Curso': ano || 0, 'Area': area, 'Turno': txt(b.turno, 20) || 'Manhã', 'Sala': txt(b.sala, 40), 'Capacidade': num(b.capacidade, 40),
    'Propina Mensal': (b.propina === '' || b.propina == null) && curso ? Number(curso['Propina Mensal'] || 0) : num(b.propina, 0),
    'Ano Lectivo': (escola && escola.ano) || String(new Date().getFullYear()), 'Disciplinas': discs, 'Activa': true };
  if (b.director) campos['Director Turma'] = String(b.director);
  if (b.titular !== undefined) {
    const tit = String(b.titular || '');
    if (tit) { const p = await daMinhaEscola('professor', tit, req.escola).catch(() => null); if (!p) return erro(res, 400, 'O professor titular escolhido não é desta escola.'); }
    if (tit || b.id) campos['Professor Titular'] = tit;
  }
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
const discOut = d => ({ id: d._id, classes: d['Classes'] || [], curso: d['Curso'] || '', ano_curso: Number(d['Ano Curso'] || 0) || null, semestre: Number(d['Semestre'] || 0) || null, horas: Number(d['Horas'] || 0), tipo: d['Tipo'] || '', nome: d['Nome'], sigla: d['Sigla'] || '', cor: d['Cor'] || '#0A64DC', nivel: CODIGO_NIVEL[d['Nivel']] || d['Nivel'] || '', carga: d['Carga Semanal'] || 0, creditos: d['Creditos'] || 0, descritiva: !!d['Avaliacao Descritiva'] });
app.post('/disciplinas', exigeDireccao, rota(async (req, res) => {
  const l = await procurarTodos('disciplina', daEscola(req.escola));
  res.json({ ok: true, estrutura: ESTRUTURA, disciplinas: l.filter(d => d['Activa'] !== false).map(discOut).sort((a, b) => (a.nivel + a.nome).localeCompare(b.nivel + b.nome, 'pt')) });
}));
app.post('/disciplina-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, nivel = String(b.nivel || '').toUpperCase(), nome = txt(b.nome, 60);
  if (nome.length < 2) return erro(res, 400, 'Escreva o nome da disciplina.');
  if (!NIVEIS[nivel]) return erro(res, 400, 'Escolha o nível.');
  const campos = { 'Escola': req.escola, 'Nome': nome, 'Sigla': txt(b.sigla, 8).toUpperCase() || nome.slice(0, 3).toUpperCase(), 'Cor': /^#[0-9a-f]{6}$/i.test(b.cor || '') ? b.cor : '#0A64DC',
    'Nivel': NIVEIS[nivel], 'Carga Semanal': num(b.carga, 2), 'Creditos': num(b.creditos, 0), 'Avaliacao Descritiva': nivel === 'ESC' ? true : !!b.descritiva, 'Activa': true };
  // v5.26: ensino geral → classes onde se dá; técnico e superior → curso, ano (e semestre no superior)
  if (CLASSES[nivel]) campos['Classes'] = Array.isArray(b.classes) ? [...new Set(b.classes.map(String))].filter(c => CLASSES[nivel].includes(c)) : [];
  if (nivel === 'TEC' || nivel === 'SUP') {
    const c = await daMinhaEscola('curso', String(b.curso || ''), req.escola).catch(() => null);
    if (!c || c['Activo'] === false || c['Nivel'] !== NIVEIS[nivel]) return erro(res, 400, nivel === 'TEC' ? 'Escolha o curso deste módulo.' : 'Escolha o curso desta cadeira.');
    const ano = Math.round(num(b.ano, 0)), dur = Number(c['Duracao'] || 1);
    if (ano < 1 || ano > dur) return erro(res, 400, 'Escolha o ano (1 a ' + dur + ').');
    campos['Curso'] = c._id; campos['Ano Curso'] = ano;
    if (nivel === 'SUP') { const sm = Math.round(num(b.semestre, 0)); if (![1, 2].includes(sm)) return erro(res, 400, 'Escolha o semestre (1º ou 2º).'); campos['Semestre'] = sm; }
    if (nivel === 'TEC') { campos['Horas'] = Math.max(0, Math.round(num(b.horas, 0))); campos['Tipo'] = TIPOS_MODULO.includes(b.tipo) ? b.tipo : 'Vocacional'; }
  }
  let id = b.id ? String(b.id) : null, novo = !id;
  if (id) { await daMinhaEscola('disciplina', id, req.escola); await mudar('disciplina', id, campos); }
  else id = await criar('disciplina', campos);
  // nova disciplina entra logo nas turmas que a usam
  if (novo) {
    const ts = (await procurarTodos('turma', daEscola(req.escola))).filter(t => t['Activa'] !== false && discServeTurma(campos, t) && !(t['Disciplinas'] || []).includes(id));
    for (const t of ts) await mudar('turma', t._id, { 'Disciplinas': [...(t['Disciplinas'] || []), id] }).catch(() => {});
  }
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
  const ts = (await procurarTodos('turma', daEscola(req.escola))).filter(t => t['Activa'] !== false && t['Nivel'] === NIVEIS[nivel]);
  for (const [nome, sigla, cor, carga, classes] of CURRICULO[nivel]) {
    if (existentes.includes(nome.toLowerCase())) continue;
    const campos = { 'Escola': req.escola, 'Nome': nome, 'Sigla': sigla, 'Cor': cor, 'Nivel': NIVEIS[nivel], 'Carga Semanal': carga, 'Avaliacao Descritiva': nivel === 'ESC', 'Classes': classes || [], 'Activa': true };
    const id = await criar('disciplina', campos);
    for (const t of ts) if (discServeTurma(campos, t)) { t['Disciplinas'] = [...(t['Disciplinas'] || []), id]; await mudar('turma', t._id, { 'Disciplinas': t['Disciplinas'] }).catch(() => {}); }
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
  let c = false;
  if (novo && b.convidar !== false) c = await convidarProfessor(req.escola, Object.assign({ _id: id }, campos)).catch(() => false);
  res.json({ ok: true, id, sms: !!(c && c.sms), email: !!(c && c.email) });
}));
app.post('/professor-apagar', exigeDireccao, rota(async (req, res) => {
  const id = String((req.body || {}).id || '');
  await daMinhaEscola('professor', id, req.escola);
  await mudar('professor', id, { 'Activo': false });
  res.json({ ok: true });
}));

// ---------- estudantes e encarregados ----------
const estOut = (e, encs) => { const en = encs && encs.find(x => x._id === e['Encarregado']); return { id: e._id, numero: e['Numero'], nome: e['Nome'], sexo: e['Sexo'] || '', nascimento: e['Data Nascimento'] || null, turma: e['Turma'] || null, estado: e['Estado'] || 'activo', ano_lectivo: e['Ano Lectivo'] || '', classe: e['Classe'] || '', tipo_matricula: e['Tipo Matricula'] || 'nova', origem: e['Origem'] || 'balcao', docs_completos: e['Docs Completos'] === undefined ? null : !!e['Docs Completos'], motivo_saida: e['Motivo Saida'] || '', encarregado: en ? { id: en._id, nome: en['Nome'], telefone: en['Telefone'] || '', parentesco: en['Parentesco'] || '' } : null }; };
app.post('/estudantes', exigeDireccao, rota(async (req, res) => {
  const f = daEscola(req.escola), turma = (req.body || {}).turma;
  const filtros = turma ? f.concat([{ key: 'Turma', constraint_type: 'equals', value: String(turma) }]) : f;
  const [est, encs] = await Promise.all([procurarTodos('estudante', filtros), procurarTodos('encarregado', f)]);
  res.json({ ok: true, estudantes: est.filter(e => (e['Estado'] || 'activo') !== 'apagado').map(e => estOut(e, encs)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')) });
}));
// matrícula partilhada: Direcção (/matricular) e inscrições online aprovadas
function pub(msg) { const e = new Error(msg); e.publico = 400; return e; }
// encarregado de educação: reutiliza pelo telefone, senão cria. obrigatorio=false → só se o nome ou o telefone vierem preenchidos
async function encarregadoDe(escolaId, b, obrigatorio) {
  const nomeEnc = txt(b.enc_nome, 100), telEnc = tel9(b.enc_telefone);
  if (!nomeEnc && !telEnc) {
    if (obrigatorio) throw pub('Escreva o nome e o telemóvel do encarregado de educação: neste nível de ensino é obrigatório.');
    return { encId: null, encTel: '' };
  }
  if (!telEnc) throw pub('Escreveu o nome do encarregado mas falta o telemóvel dele (ex.: 84 123 4567).' + (obrigatorio ? '' : ' Ou apague o nome para continuar sem encarregado.'));
  if (telEnc.length !== 9 || !/^8[2-7]/.test(telEnc)) throw pub('O telemóvel do encarregado deve ter 9 dígitos e começar por 82 a 87 (ex.: 84 123 4567). Escreveu ' + telEnc.length + ' dígito(s).');
  const encs = await procurarTodos('encarregado', daEscola(escolaId));
  const ja = encs.find(e => tel9(e['Telefone']) === telEnc);
  if (ja) return { encId: ja._id, encTel: ja['Recebe SMS'] === false ? '' : telEnc };
  if (nomeEnc.split(/\s+/).length < 2) throw pub('Escreva o nome completo do encarregado.');
  const encId = await criar('encarregado', { 'Escola': escolaId, 'Nome': nomeEnc, 'Telefone': telEnc.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3'), 'Email': txt(b.enc_email, 120).toLowerCase(), 'Parentesco': txt(b.enc_parentesco, 30), 'Recebe SMS': true, 'Activo': true });
  return { encId, encTel: telEnc };
}
// ============================================================
//  MATRÍCULAS (v5.27): documentos por classe, matrícula igual ao balcão e online, turmas automáticas, saídas e renovações
//  Bubble:
//   Escola     + Matriculas Abertas (yes/no) · Ano Matricula (text) · Turma Max (number) · Turmas Auto (yes/no) · Docs Matricula (text, JSON)
//   Estudante  + Classe (text) · Curso (text) · Ano Curso (number) · Tipo Matricula (text) · Origem (text) · Escola Anterior (text)
//              · Documentos (text, JSON) · Docs Completos (yes/no) · Data Saida (date) · Motivo Saida (text) · Historico (text, JSON)
//   Link Inscricao   + Classe (text) · Curso (text) · Ano Curso (number)
//   Inscricao Online + Classe (text) · Curso (text) · Ano Curso (number) · Sexo (text) · Tipo Matricula (text) · Escola Anterior (text) · Documentos (text, JSON)
// ============================================================
const DOC = (nome, obrig) => ({ nome, obrigatorio: obrig !== false });
// documentos pedidos por defeito nas escolas moçambicanas (a escola ajusta em Matrículas → Documentos)
const DOCS_MATRICULA = {
  'ESC': [DOC('Cédula pessoal, certidão de nascimento ou BI da criança'), DOC('Cartão de vacinas'), DOC('2 fotografias tipo passe'), DOC('BI do encarregado de educação')],
  'PRI:1ª': [DOC('Cédula pessoal, certidão de nascimento ou BI'), DOC('2 fotografias tipo passe'), DOC('Cartão de vacinas', false), DOC('BI do encarregado de educação')],
  'PRI': [DOC('Cédula pessoal, certidão de nascimento ou BI'), DOC('2 fotografias tipo passe'), DOC('Boletim ou declaração da classe anterior'), DOC('BI do encarregado de educação')],
  'SEC:7ª': [DOC('BI ou certidão de nascimento'), DOC('2 fotografias tipo passe'), DOC('Certificado ou declaração da 6ª classe'), DOC('BI do encarregado de educação')],
  'SEC:10ª': [DOC('BI'), DOC('2 fotografias tipo passe'), DOC('Certificado ou declaração da 9ª classe'), DOC('BI do encarregado de educação')],
  'SEC': [DOC('BI ou certidão de nascimento'), DOC('2 fotografias tipo passe'), DOC('Declaração ou boletim da classe anterior'), DOC('BI do encarregado de educação')],
  'TEC': [DOC('BI'), DOC('2 fotografias tipo passe'), DOC('Certificado da classe de ingresso (6ª/7ª para o básico, 9ª/10ª para o médio)'), DOC('NUIT', false), DOC('BI do encarregado de educação')],
  'SUP': [DOC('BI'), DOC('2 fotografias tipo passe'), DOC('Certificado da 12ª classe ou equivalente'), DOC('Certidão de notas'), DOC('NUIT'), DOC('Atestado médico', false)],
  'TRANSF': [DOC('Guia ou declaração de transferência'), DOC('Processo individual do aluno'), DOC('Pautas ou boletins da escola de proveniência')]
};
const TIPOS_MAT = { nova: 'Nova matrícula', renovacao: 'Renovação', transferencia: 'Transferência' };
function configMatriculas(e) {
  const docs = lerJSON(e && e['Docs Matricula'], null);
  return {
    ano: String((e && (e['Ano Matricula'] || e['Ano Lectivo'])) || new Date().getFullYear()),
    abertas: !e || e['Matriculas Abertas'] !== false,
    turma_max: Math.max(1, Number((e && e['Turma Max']) || 40)),
    turmas_auto: !e || e['Turmas Auto'] !== false,
    docs: docs && typeof docs === 'object' && !Array.isArray(docs) ? docs : DOCS_MATRICULA
  };
}
// documentos exigidos: chave mais específica primeiro (SEC:10ª → SEC); transferências juntam os da transferência
function docsExigidos(cfg, nivel, classe, tipo) {
  const D = cfg.docs || DOCS_MATRICULA, l = (classe && D[nivel + ':' + classe]) || D[nivel] || [];
  return l.concat(tipo === 'transferencia' ? (D['TRANSF'] || []) : []).map(d => ({ nome: txt(d.nome, 120), obrigatorio: d.obrigatorio !== false })).filter(d => d.nome);
}
function estadoDocs(exigidos, docs) {
  const falta = exigidos.filter(d => d.obrigatorio && !(docs && docs[d.nome] && docs[d.nome].entregue)).map(d => d.nome);
  return { completos: !falta.length, falta };
}
function lerDocsEnviados(lista) {   // [{nome, entregue, ficheiro:{nome,dados}}] vindos do formulário
  return (Array.isArray(lista) ? lista : []).slice(0, 20).map(d => ({ nome: txt(d && d.nome, 120), entregue: !!(d && (d.entregue || (d.ficheiro && d.ficheiro.dados))), ficheiro: d && d.ficheiro && d.ficheiro.dados ? d.ficheiro : null })).filter(d => d.nome);
}
const DOC_TIPOS = { pdf: 1, jpg: 1, jpeg: 1, png: 1, webp: 1 };
async function guardarDocumento(escolaId, dono, f) {
  const nome = nomeFicheiroLimpo(f.nome), ext = ((nome.match(/\.([a-z0-9]{2,5})$/i) || [])[1] || '').toLowerCase();
  if (!DOC_TIPOS[ext]) throw pub('Os documentos têm de ser PDF ou imagem (JPG, PNG).');
  const dados = String(f.dados).replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(dados)) throw pub('O ficheiro chegou estragado. Tente outra vez.');
  const bytes = Math.floor(dados.length * 3 / 4);
  if (bytes > 5 * 1048576) throw pub('Cada documento pode ter no máximo 5 MB.');
  if (travao('docs:' + escolaId, 400, 60)) throw pub('Foram enviados muitos documentos na última hora. Tente mais tarde.');
  return BUNNY_OK ? await guardarFicheiroBunny('/' + escolaId + '/docs/' + dono + '/' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex') + '/' + nome, dados) : await guardarFicheiroBubble(nome, dados);
}
async function juntarDocs(escolaId, dono, atuais, enviados, quem) {
  const docs = Object.assign({}, atuais || {});
  for (const d of enviados) {
    const ant = docs[d.nome] || {};
    const reg = { entregue: d.entregue, data: d.entregue ? (ant.data || new Date().toISOString()) : null, por: quem || ant.por || '' };
    if (d.ficheiro) { reg.ficheiro = await guardarDocumento(escolaId, dono, d.ficheiro); reg.nome_ficheiro = nomeFicheiroLimpo(d.ficheiro.nome); }
    else if (ant.ficheiro && d.entregue) { reg.ficheiro = ant.ficheiro; reg.nome_ficheiro = ant.nome_ficheiro; }
    if (!d.entregue && ant.ficheiro) apagarFicheiroBunny(ant.ficheiro).catch(() => {});
    docs[d.nome] = reg;
  }
  return docs;
}
const docsOut = docs => Object.fromEntries(Object.entries(docs || {}).map(([k, v]) => [k, { entregue: !!v.entregue, data: v.data || null, ficheiro: v.ficheiro ? linkFicheiro(v.ficheiro) : '', nome_ficheiro: v.nome_ficheiro || '' }]));
// ---------- turmas automáticas ----------
const ativoEst = e => (e['Estado'] || 'activo') === 'activo';
function nomeTurmaAuto(nivel, classe, curso, ano, n) {
  if (curso) return (curso['Sigla'] || curso['Nome']) + ' ' + ano + 'º ano - Turma ' + n;
  if (nivel === 'ESC') return (classe === 'Berçário' ? 'Berçário' : 'Sala dos ' + classe) + ' - Turma ' + n;
  return classe + ' Classe - Turma ' + n;
}
const numTurma = nome => { const m = String(nome || '').match(/turma\s*(\d+)\s*$/i); return m ? Number(m[1]) : 0; };
// alvo: { nivel, classe } ou { nivel, curso, ano } · devolve a turma com vaga (ou cria a seguinte) para o ano lectivo
async function escolherTurma(escolaId, alvo, anoLectivo, cfg) {
  {
    const f = daEscola(escolaId);
    const [ts, ests] = await Promise.all([procurarTodos('turma', f), procurarTodos('estudante', f)]);
    const nv = NIVEIS[alvo.nivel];
    const doGrupo = ts.filter(t => t['Activa'] !== false && t['Nivel'] === nv && String(t['Ano Lectivo'] || anoLectivo) === String(anoLectivo) &&
      (alvo.curso ? t['Curso'] === alvo.curso._id && Number(t['Ano Curso'] || 0) === Number(alvo.ano) : classeNorm(alvo.nivel, t['Classe']) === alvo.classe));
    const ocup = id => ests.filter(e => ativoEst(e) && e['Turma'] === id).length;
    doGrupo.sort((a, b) => (numTurma(a['Nome']) || 999) - (numTurma(b['Nome']) || 999) || String(a['Nome']).localeCompare(String(b['Nome']), 'pt', { numeric: true }));
    const livre = doGrupo.find(t => ocup(t._id) < (Number(t['Capacidade']) || cfg.turma_max));
    if (livre) return { turma: livre, criada: false };
    const qual = alvo.curso ? alvo.curso['Nome'] + ' ' + alvo.ano + 'º ano' : (alvo.nivel === 'ESC' ? 'sala dos ' + alvo.classe : alvo.classe + ' classe');
    if (!cfg.turmas_auto) throw pub(doGrupo.length ? 'Todas as turmas da ' + qual + ' estão cheias. Aumente a capacidade ou crie outra turma.' : 'Ainda não há turma da ' + qual + ' para ' + anoLectivo + '. Crie a turma primeiro.');
    const n = Math.max(doGrupo.length, ...doGrupo.map(t => numTurma(t['Nome']))) + 1;
    const classe = alvo.curso ? alvo.ano + 'º ano' : alvo.classe;
    const modelo = doGrupo[doGrupo.length - 1];
    const todas = await procurarTodos('disciplina', f);
    const campos = { 'Escola': escolaId, 'Nome': nomeTurmaAuto(alvo.nivel, alvo.classe, alvo.curso, alvo.ano, n), 'Nivel': nv, 'Classe': classe,
      'Curso': alvo.curso ? alvo.curso._id : '', 'Ano Curso': alvo.curso ? Number(alvo.ano) : 0, 'Area': '', 'Turno': (modelo && modelo['Turno']) || 'Manhã', 'Sala': '',
      'Capacidade': cfg.turma_max, 'Propina Mensal': modelo ? Number(modelo['Propina Mensal'] || 0) : (alvo.curso ? Number(alvo.curso['Propina Mensal'] || 0) : 0),
      'Ano Lectivo': String(anoLectivo), 'Activa': true };
    campos['Codigo'] = slug(campos['Nome']).toUpperCase().replace(/-/g, '').slice(0, 12);
    campos['Disciplinas'] = todas.filter(d => discServeTurma(d, campos)).map(d => d._id);
    const id = await criar('turma', campos);
    console.log('[matriculas] turma criada: ' + campos['Nome'] + ' (' + escolaId + ')');
    return { turma: Object.assign({ _id: id }, campos), criada: true };
  }
}
// resolve classe/curso a partir do pedido (ou da turma escolhida)
async function alvoDe(escolaId, b) {
  const nivel = String(b.nivel || '').toUpperCase();
  if (CLASSES[nivel]) { const classe = classeNorm(nivel, b.classe); if (!CLASSES[nivel].includes(classe)) throw pub(nivel === 'ESC' ? 'Escolha a sala (idade).' : 'Escolha a classe.'); return { nivel, classe }; }
  if (nivel === 'TEC' || nivel === 'SUP') {
    const curso = await daMinhaEscola('curso', String(b.curso || ''), escolaId).catch(() => null);
    if (!curso || curso['Activo'] === false) throw pub('Escolha o curso.');
    const ano = Math.round(num(b.ano, 1)) || 1;
    if (ano < 1 || ano > Number(curso['Duracao'] || 1)) throw pub('Escolha o ano do curso.');
    return { nivel, curso, ano };
  }
  throw pub('Escolha o nível de ensino.');
}

// matrícula partilhada: balcão (Direcção), inscrições online aprovadas e renovações — as mesmas regras para todos
async function matricularCore(escolaId, b) {
  const nome = txt(b.nome, 100);
  if (nome.split(/\s+/).length < 2) throw pub('Escreva o nome e o apelido do estudante.');
  const esc = await obter('escola', escolaId);
  const cfg = configMatriculas(esc), anoLectivo = String(b.ano_lectivo || cfg.ano);
  if (!cfg.abertas && !b.forcar) { const e = pub('As matrículas para ' + anoLectivo + ' estão fechadas. Abra-as em Matrículas → Configuração.'); e.publico = 423; throw e; }
  const tipo = TIPOS_MAT[b.tipo] ? b.tipo : 'nova';
  if (tipo === 'transferencia' && txt(b.escola_anterior, 120).length < 3) throw pub('Escreva o nome da escola de onde o aluno vem transferido.');
  return naFilaSMS('turma|' + escolaId, async () => {
    // turma: a escolhida (se tiver vaga) ou a primeira com vaga da classe/curso; se estiverem todas cheias, cria a seguinte
    let turma, criada = false, alvo;
    const ests = await procurarTodos('estudante', daEscola(escolaId));
    if (b.turma) {
      turma = await daMinhaEscola('turma', String(b.turma), escolaId);
      const nv = CODIGO_NIVEL[turma['Nivel']] || turma['Nivel'];
      alvo = { nivel: nv, classe: classeNorm(nv, turma['Classe']) };
      const ocup = ests.filter(e => ativoEst(e) && e['Turma'] === turma._id).length, cap = Number(turma['Capacidade']) || cfg.turma_max;
      if (ocup >= cap && !b.forcar) { const e = pub('A turma ' + turma['Nome'] + ' está cheia (' + ocup + ' de ' + cap + '). Escolha «Automática» ou confirme que quer passar o limite.'); e.publico = 409; e.cheia = true; throw e; }
    } else {
      alvo = await alvoDe(escolaId, b);
      const r = await escolherTurma(escolaId, alvo, anoLectivo, cfg);
      turma = r.turma; criada = r.criada;
    }
    const nivel = CODIGO_NIVEL[turma['Nivel']] || turma['Nivel'];
    const superior = nivel === 'SUP';
    if (superior && tel9(b.telefone).length !== 9) throw pub('No ensino superior o telemóvel do estudante é obrigatório: é por ele que recebe o acesso e entra no portal.');
    // evitar matrícula repetida: mesmo nome e mesma data de nascimento, ainda activo
    const chave = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const nasc = b.nascimento && !isNaN(Date.parse(b.nascimento)) ? new Date(b.nascimento).toISOString().slice(0, 10) : '';
    const rep = ests.find(e => ativoEst(e) && chave(e['Nome']) === chave(nome) && (!nasc || !e['Data Nascimento'] || String(e['Data Nascimento']).slice(0, 10) === nasc));
    if (rep && !b.forcar) { const e = pub('Já existe um estudante activo com o nome ' + rep['Nome'] + ' (nº ' + (rep['Numero'] || '') + '). Se for outra pessoa, confirme para matricular na mesma.'); e.publico = 409; e.repetido = true; throw e; }
    const { encId, encTel } = await encarregadoDe(escolaId, b, !superior);
    const maior = ests.map(e => String(e['Numero'] || '')).filter(n => n.startsWith(anoLectivo + '-')).map(n => parseInt(n.split('-')[1], 10) || 0).reduce((a, c) => Math.max(a, c), 0);
    const numero = anoLectivo + '-' + String(maior + 1).padStart(4, '0');
    const classeDocs = turma['Curso'] ? '' : classeNorm(nivel, turma['Classe']);
    const exig = docsExigidos(cfg, nivel, classeDocs, tipo);
    const id0 = crypto.randomBytes(6).toString('hex');
    const docs = await juntarDocs(escolaId, id0, b.docs_atuais || {}, lerDocsEnviados(b.docs), b.quem);
    const ed = estadoDocs(exig, docs);
    const campos = { 'Escola': escolaId, 'Numero': numero, 'Nome': nome, 'Sexo': b.sexo === 'F' ? 'F' : (b.sexo === 'M' ? 'M' : ''), 'Turma': turma._id, 'Ano Lectivo': anoLectivo,
      'Data Matricula': new Date().toISOString(), 'Estado': 'activo', 'Saude Notas': txt(b.saude, 300),
      'Classe': turma['Classe'] || '', 'Curso': turma['Curso'] || '', 'Ano Curso': Number(turma['Ano Curso'] || 0), 'Tipo Matricula': tipo, 'Origem': ['balcao', 'online', 'importacao', 'renovacao'].includes(b.origem) ? b.origem : 'balcao',
      'Escola Anterior': txt(b.escola_anterior, 120), 'Documentos': JSON.stringify(docs), 'Docs Completos': ed.completos };
    if (nasc) campos['Data Nascimento'] = new Date(nasc + 'T12:00:00Z').toISOString();
    if (encId) campos['Encarregado'] = encId;
    const telEst = tel9(b.telefone);
    if (telEst) {
      if (telEst.length !== 9 || !/^8[2-7]/.test(telEst)) throw pub('O telemóvel do estudante deve ter 9 dígitos e começar por 82 a 87 (ex.: 84 123 4567). Escreveu ' + telEst.length + ' dígito(s).');
      campos['Telefone'] = telEst.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3');
    }
    const id = await criar('estudante', campos);
    let sms = 0;
    const link = noGescolar(esc['Subdominio']), en = esc['Nome'] || 'A escola', tn = turma['Nome'] || '';
    if (b.sms !== false) {
      if (telEst) {
        const r = await smsEscola(escolaId, [telEst], en + ': ' + (superior ? 'bem-vindo(a), ' + nome.split(/\s+/)[0] + '. Esta inscrito(a) em ' : nome + ' esta matriculado(a) na ') + tn + ' com o numero ' + numero +
          '. Veja notas, horario e propinas ' + link + ' (escolha Estudante e escreva ' + numero + ').').catch(() => ({ ok: false }));
        if (r.ok) sms++;
      }
      if (encTel && encTel !== telEst) {
        const r = await smsEscola(escolaId, [encTel], en + ': ' + nome + ' foi matriculado(a) na ' + tn + ' com o numero ' + numero +
          '. Veja propinas, recibos e notas e pague por M-Pesa ou e-Mola ' + link + ' (escolha Encarregado e use este numero de telemovel).').catch(() => ({ ok: false }));
        if (r.ok) sms++;
      }
    }
    cachePainel.delete(escolaId);
    return { id, numero, sms, turma: { id: turma._id, nome: turma['Nome'] }, turma_criada: criada, docs_completos: ed.completos, falta: ed.falta };
  });
}

app.post('/matricular', exigeDireccao, rota(async (req, res) => {
  const r = await matricularCore(req.escola, Object.assign({}, req.body || {}, { origem: 'balcao', quem: 'Secretaria', docs_atuais: {} }));
  res.json(Object.assign({ ok: true }, r));
}));
// ---------- rotas das matrículas (v5.27) ----------
app.post('/matriculas-config', exigeDireccao, rota(async (req, res) => {
  const [e, cs] = await Promise.all([obter('escola', req.escola), procurarTodos('curso', daEscola(req.escola)).catch(() => [])]);
  const cfg = configMatriculas(e);
  res.json({ ok: true, config: cfg, padrao: DOCS_MATRICULA, estrutura: ESTRUTURA, ano_escola: e['Ano Lectivo'] || '', cursos: cs.filter(c => c['Activo'] !== false).map(cursoEnsinoOut) });
}));
app.post('/matriculas-config-guardar', exigeSoDireccao, rota(async (req, res) => {
  const b = req.body || {}, ano = String(b.ano || '').trim();
  if (!/^20\d{2}$/.test(ano)) return erro(res, 400, 'Escreva o ano lectivo das matrículas, por exemplo 2027.');
  const max = Math.round(num(b.turma_max, 40));
  if (max < 5 || max > 200) return erro(res, 400, 'O máximo de alunos por turma vai de 5 a 200.');
  const docs = {};
  if (b.docs && typeof b.docs === 'object') for (const [k, l] of Object.entries(b.docs)) {
    if (!/^(ESC|PRI|SEC|TEC|SUP|TRANSF)(:[^:]{1,12})?$/.test(k) || !Array.isArray(l)) continue;
    docs[k] = l.slice(0, 15).map(d => ({ nome: txt(d && d.nome, 120), obrigatorio: !(d && d.obrigatorio === false) })).filter(d => d.nome);
  }
  await mudar('escola', req.escola, { 'Ano Matricula': ano, 'Matriculas Abertas': !!b.abertas, 'Turma Max': max, 'Turmas Auto': !!b.turmas_auto, 'Docs Matricula': JSON.stringify(Object.keys(docs).length ? docs : DOCS_MATRICULA) });
  cachePainel.delete(req.escola);
  res.json({ ok: true });
}));
// o que aparece no formulário de matrícula: turmas da classe com vagas e documentos pedidos
app.post('/matricula-opcoes', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, e = await obter('escola', req.escola), cfg = configMatriculas(e);
  const alvo = await alvoDe(req.escola, b);
  const f = daEscola(req.escola);
  const [ts, ests] = await Promise.all([procurarTodos('turma', f), procurarTodos('estudante', f)]);
  const ano = String(b.ano_lectivo || cfg.ano);
  const L = ts.filter(t => t['Activa'] !== false && t['Nivel'] === NIVEIS[alvo.nivel] && String(t['Ano Lectivo'] || ano) === ano &&
    (alvo.curso ? t['Curso'] === alvo.curso._id && Number(t['Ano Curso'] || 0) === alvo.ano : classeNorm(alvo.nivel, t['Classe']) === alvo.classe))
    .map(t => { const n = ests.filter(x => ativoEst(x) && x['Turma'] === t._id).length, cap = Number(t['Capacidade']) || cfg.turma_max; return { id: t._id, nome: t['Nome'], estudantes: n, capacidade: cap, vagas: Math.max(0, cap - n) }; })
    .sort((a, b2) => a.nome.localeCompare(b2.nome, 'pt', { numeric: true }));
  const tipo = TIPOS_MAT[b.tipo] ? b.tipo : 'nova';
  res.json({ ok: true, ano, abertas: cfg.abertas, turmas_auto: cfg.turmas_auto, turma_max: cfg.turma_max, turmas: L, documentos: docsExigidos(cfg, alvo.nivel, alvo.curso ? '' : alvo.classe, tipo) });
}));
app.post('/estudante-documentos', exigeDireccao, rota(async (req, res) => {
  const e = await daMinhaEscola('estudante', String((req.body || {}).id || ''), req.escola), esc = await obter('escola', req.escola), cfg = configMatriculas(esc);
  const nv = CODIGO_NIVEL[(await obter('turma', e['Turma']).catch(() => ({})))['Nivel']] || '';
  const exig = docsExigidos(cfg, nv, e['Curso'] ? '' : classeNorm(nv, e['Classe']), e['Tipo Matricula']);
  const docs = lerJSON(e['Documentos'], {});
  const extra = Object.keys(docs).filter(k => !exig.some(d => d.nome === k)).map(k => ({ nome: k, obrigatorio: false }));
  res.json({ ok: true, nome: e['Nome'], exigidos: exig.concat(extra), docs: docsOut(docs), estado: estadoDocs(exig, docs) });
}));
app.post('/estudante-documentos-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, e = await daMinhaEscola('estudante', String(b.id || ''), req.escola), esc = await obter('escola', req.escola), cfg = configMatriculas(esc);
  const docs = await juntarDocs(req.escola, e._id, lerJSON(e['Documentos'], {}), lerDocsEnviados(b.docs), b.quem || 'Direcção');
  const nv = CODIGO_NIVEL[(await obter('turma', e['Turma']).catch(() => ({})))['Nivel']] || '';
  const ed = estadoDocs(docsExigidos(cfg, nv, e['Curso'] ? '' : classeNorm(nv, e['Classe']), e['Tipo Matricula']), docs);
  await mudar('estudante', e._id, { 'Documentos': JSON.stringify(docs), 'Docs Completos': ed.completos });
  res.json({ ok: true, estado: ed, docs: docsOut(docs) });
}));
// mudar de turma (com autorização para passar o limite)
app.post('/estudante-turma', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const r = await naFilaSMS('turma|' + req.escola, async () => {
    const e = await daMinhaEscola('estudante', String(b.id || ''), req.escola), t = await daMinhaEscola('turma', String(b.turma || ''), req.escola);
    if (e['Turma'] === t._id) return { ok: true, igual: true };
    const cfg = configMatriculas(await obter('escola', req.escola));
    const n = (await procurarTodos('estudante', [{ key: 'Escola', constraint_type: 'equals', value: req.escola }, { key: 'Turma', constraint_type: 'equals', value: t._id }])).filter(ativoEst).length;
    const cap = Number(t['Capacidade']) || cfg.turma_max;
    if (n >= cap && !b.forcar) { const x = pub('A turma ' + t['Nome'] + ' está cheia (' + n + ' de ' + cap + ').'); x.publico = 409; x.pode_forcar = true; throw x; }
    const hist = lerJSON(e['Historico'], []); hist.push({ tipo: 'mudanca', data: new Date().toISOString(), de: e['Turma'], para: t._id, motivo: txt(b.motivo, 200) });
    await mudar('estudante', e._id, { 'Turma': t._id, 'Classe': t['Classe'] || e['Classe'] || '', 'Curso': t['Curso'] || '', 'Ano Curso': Number(t['Ano Curso'] || 0), 'Historico': JSON.stringify(hist.slice(-50)) });
    return { ok: true };
  });
  cachePainel.delete(req.escola);
  res.json(r);
}));
// cancelar a matrícula ou registar a saída por transferência
app.post('/estudante-saida', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, e = await daMinhaEscola('estudante', String(b.id || ''), req.escola);
  const tipo = { cancelado: 'cancelado', transferido: 'transferido', activo: 'activo' }[b.tipo];
  if (!tipo) return erro(res, 400, 'Escolha: cancelar a matrícula, transferido para outra escola, ou reactivar.');
  if (tipo !== 'activo' && txt(b.motivo, 300).length < 3) return erro(res, 400, 'Escreva o motivo (ou a escola de destino).');
  const hist = lerJSON(e['Historico'], []); hist.push({ tipo, data: new Date().toISOString(), turma: e['Turma'], motivo: txt(b.motivo, 300) });
  await mudar('estudante', e._id, { 'Estado': tipo, 'Data Saida': tipo === 'activo' ? null : new Date().toISOString(), 'Motivo Saida': tipo === 'activo' ? '' : txt(b.motivo, 300), 'Historico': JSON.stringify(hist.slice(-50)) });
  cachePainel.delete(req.escola);
  res.json({ ok: true, estado: tipo });
}));
// renovação: passa os estudantes escolhidos para o ano lectivo seguinte, na classe (ou ano do curso) de destino, com turma automática
app.post('/renovar-matriculas', exigeSoDireccao, rota(async (req, res) => {
  const b = req.body || {}, esc = await obter('escola', req.escola), cfg = configMatriculas(esc);
  const ano = String(b.ano_lectivo || cfg.ano);
  if (!/^20\d{2}$/.test(ano)) return erro(res, 400, 'Ano lectivo inválido.');
  const ids = (Array.isArray(b.estudantes) ? b.estudantes : []).map(String).slice(0, 300);
  if (!ids.length) return erro(res, 400, 'Escolha os estudantes a renovar.');
  const alvo = await alvoDe(req.escola, b);
  const feitos = [], erros = [];
  for (const id of ids) {
    try {
      const r = await naFilaSMS('turma|' + req.escola, async () => {
        const e = await daMinhaEscola('estudante', id, req.escola);
        if (!ativoEst(e)) throw pub(e['Nome'] + ' não está activo.');
        if (String(e['Ano Lectivo']) === ano) throw pub(e['Nome'] + ' já está matriculado em ' + ano + '.');
        const { turma } = await escolherTurma(req.escola, alvo, ano, cfg);
        const hist = lerJSON(e['Historico'], []); hist.push({ tipo: 'renovacao', data: new Date().toISOString(), ano: e['Ano Lectivo'], turma: e['Turma'], classe: e['Classe'] || '' });
        await mudar('estudante', e._id, { 'Turma': turma._id, 'Ano Lectivo': ano, 'Classe': turma['Classe'] || '', 'Curso': turma['Curso'] || '', 'Ano Curso': Number(turma['Ano Curso'] || 0),
          'Tipo Matricula': 'renovacao', 'Origem': 'renovacao', 'Data Matricula': new Date().toISOString(), 'Historico': JSON.stringify(hist.slice(-50)) });
        return { id: e._id, nome: e['Nome'], turma: turma['Nome'] };
      });
      feitos.push(r);
    } catch (err) { erros.push(err.publico ? err.message : 'Erro ao renovar ' + id); }
  }
  cachePainel.delete(req.escola);
  res.json({ ok: true, renovados: feitos.length, feitos, erros });
}));
// ---------- relatórios (v5.27) ----------
//  tipos: matriculas-ano · turma · classes · matriculas · inscricoes · documentos · saidas · geral · historico
const SEXO = s => s === 'F' ? 'F' : s === 'M' ? 'M' : '—';
const dmy = d => d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4) : '';
app.post('/relatorio', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, f = daEscola(req.escola);
  const [esc, ts, ests, encs, cs, profs, ins, links] = await Promise.all([obter('escola', req.escola), procurarTodos('turma', f), procurarTodos('estudante', f), procurarTodos('encarregado', f),
    procurarTodos('curso', f).catch(() => []), procurarTodos('professor', f), procurarTodos('inscricaoonline', f, 20000).catch(() => []), procurarTodos('linkinscricao', f).catch(() => [])]);
  const cfg = configMatriculas(esc), ano = String(b.ano || cfg.ano);
  const T = Object.fromEntries(ts.map(t => [t._id, t])), C = Object.fromEntries(cs.map(c => [c._id, c])), EN = Object.fromEntries(encs.map(e => [e._id, e])), P = Object.fromEntries(profs.map(p => [p._id, p['Nome']]));
  const nvT = t => CODIGO_NIVEL[t && t['Nivel']] || (t && t['Nivel']) || '';
  const grupo = t => !t ? '—' : t['Curso'] ? ((C[t['Curso']] || {})['Nome'] || 'Curso') + ' · ' + (t['Ano Curso'] || '') + 'º ano' : classeNorm(nvT(t), t['Classe']) ? (nvT(t) === 'ESC' ? 'Sala ' + classeNorm(nvT(t), t['Classe']) : classeNorm(nvT(t), t['Classe']) + ' Classe') : (t['Classe'] || '—');
  const ordemGrupo = t => { const nv = nvT(t), i = ['ESC', 'PRI', 'SEC', 'TEC', 'SUP', 'CON'].indexOf(nv), cl = CLASSES[nv] ? CLASSES[nv].indexOf(classeNorm(nv, t['Classe'])) : (Number(t['Ano Curso']) || 0); return i * 100 + (cl < 0 ? 99 : cl); };
  // filtros comuns
  const passa = e => {
    const t = T[e['Turma']];
    if (b.nivel && nvT(t) !== b.nivel) return false;
    if (b.classe && classeNorm(nvT(t), t && t['Classe']) !== b.classe) return false;
    if (b.curso && (!t || t['Curso'] !== b.curso)) return false;
    if (b.turma && e['Turma'] !== b.turma) return false;
    if (b.sexo && e['Sexo'] !== b.sexo) return false;
    return true;
  };
  const doAno = e => String(e['Ano Lectivo'] || '') === ano;
  const activos = ests.filter(e => ativoEst(e) && doAno(e) && passa(e));
  const conta = l => ({ total: l.length, m: l.filter(e => e['Sexo'] === 'M').length, f: l.filter(e => e['Sexo'] === 'F').length });
  const out = { ok: true, escola: { nome: esc['Nome'] || '', logotipo: esc['Logotipo'] || '', nuit: esc['NUIT'] || '' }, ano, gerado: new Date().toISOString(), resumo: [], colunas: [], linhas: [] };
  const tipo = String(b.tipo || '');
  if (tipo === 'matriculas-ano') {
    const doA = ests.filter(e => doAno(e) && passa(e) && (e['Estado'] || 'activo') !== 'apagado');
    const k = conta(doA.filter(ativoEst));
    const pend = ins.filter(i => ['pendente', 'paga'].includes(i['Estado']) && (!i['Created Date'] || String(i['Created Date']).slice(0, 4) >= String(Number(ano) - 1)));
    out.titulo = 'Matrículas do ano lectivo ' + ano;
    out.resumo = [['Matriculados (activos)', k.total], ['Novas matrículas', doA.filter(e => (e['Tipo Matricula'] || 'nova') === 'nova').length], ['Renovações', doA.filter(e => e['Tipo Matricula'] === 'renovacao').length],
      ['Transferências recebidas', doA.filter(e => e['Tipo Matricula'] === 'transferencia').length], ['Inscrições por matricular', pend.length], ['Masculino', k.m], ['Feminino', k.f]];
    const G = {}; doA.filter(ativoEst).forEach(e => { const t = T[e['Turma']], g = (NIVEIS_NOME[nvT(t)] || '—') + ' · ' + grupo(t); (G[g] = G[g] || { o: ordemGrupo(t || {}), l: [] }).l.push(e); });
    out.colunas = ['Nível e classe', 'Alunos', 'M', 'F', 'Novas', 'Renovações', 'Transferências'];
    out.linhas = Object.entries(G).sort((a, c) => a[1].o - c[1].o || a[0].localeCompare(c[0], 'pt', { numeric: true })).map(([g, x]) => { const k2 = conta(x.l); return [g, k2.total, k2.m, k2.f, x.l.filter(e => (e['Tipo Matricula'] || 'nova') === 'nova').length, x.l.filter(e => e['Tipo Matricula'] === 'renovacao').length, x.l.filter(e => e['Tipo Matricula'] === 'transferencia').length]; });
  } else if (tipo === 'turma') {
    const t = T[b.turma]; if (!t) return erro(res, 400, 'Escolha a turma.');
    const l = ests.filter(e => ativoEst(e) && e['Turma'] === t._id && (!b.sexo || e['Sexo'] === b.sexo)).sort((a, c) => String(a['Nome']).localeCompare(String(c['Nome']), 'pt'));
    const k = conta(l), cap = Number(t['Capacidade']) || cfg.turma_max;
    out.titulo = 'Turma ' + t['Nome'] + ' · ' + (t['Ano Lectivo'] || ano);
    out.resumo = [['Classe / curso', grupo(t)], ['Director(a) de turma', P[t['Director Turma']] || P[t['Professor Titular']] || '—'], ['Alunos', k.total + ' de ' + cap], ['Vagas', Math.max(0, cap - k.total)], ['Masculino', k.m], ['Feminino', k.f], ['Turno', t['Turno'] || '—']];
    out.colunas = ['Nº', 'Número', 'Nome', 'Sexo', 'Nascimento', 'Encarregado', 'Telemóvel do encarregado', 'Documentos'];
    out.linhas = l.map((e, i) => { const en = EN[e['Encarregado']] || {}; return [i + 1, e['Numero'] || '', e['Nome'] || '', SEXO(e['Sexo']), dmy(e['Data Nascimento']), en['Nome'] || '—', en['Telefone'] || '—', e['Docs Completos'] === false ? 'Incompletos' : e['Docs Completos'] ? 'Completos' : '—']; });
  } else if (tipo === 'classes') {
    const G = {};
    ts.filter(t => t['Activa'] !== false && String(t['Ano Lectivo'] || ano) === ano && (!b.nivel || nvT(t) === b.nivel)).forEach(t => { const g = (NIVEIS_NOME[nvT(t)] || '') + ' · ' + grupo(t); (G[g] = G[g] || { o: ordemGrupo(t), ts: [] }).ts.push(t); });
    out.titulo = 'Alunos por classe · ' + ano;
    out.colunas = ['Nível e classe', 'Turmas', 'Alunos', 'M', 'F', 'Capacidade', 'Vagas', 'Distribuição pelas turmas'];
    let tot = 0;
    out.linhas = Object.entries(G).sort((a, c) => a[1].o - c[1].o || a[0].localeCompare(c[0], 'pt', { numeric: true })).map(([g, x]) => {
      const l = ests.filter(e => ativoEst(e) && x.ts.some(t => t._id === e['Turma'])), k = conta(l), cap = x.ts.reduce((s, t) => s + (Number(t['Capacidade']) || cfg.turma_max), 0); tot += k.total;
      return [g, x.ts.length, k.total, k.m, k.f, cap, Math.max(0, cap - k.total), x.ts.sort((p, q) => String(p['Nome']).localeCompare(String(q['Nome']), 'pt', { numeric: true })).map(t => t['Nome'] + ': ' + l.filter(e => e['Turma'] === t._id).length).join(' · ')];
    });
    out.resumo = [['Classes / anos com turmas', out.linhas.length], ['Turmas', Object.values(G).reduce((s, x) => s + x.ts.length, 0)], ['Alunos', tot]];
  } else if (tipo === 'matriculas') {
    const l = ests.filter(e => doAno(e) && passa(e) && (e['Estado'] || 'activo') !== 'apagado').sort((a, c) => String(c['Data Matricula'] || '').localeCompare(String(a['Data Matricula'] || '')));
    out.titulo = 'Lista de matrículas · ' + ano;
    out.colunas = ['Data', 'Número', 'Nome', 'Sexo', 'Classe / curso', 'Turma', 'Tipo', 'Origem', 'Estado'];
    out.linhas = l.map(e => { const t = T[e['Turma']]; return [dmy(e['Data Matricula']), e['Numero'] || '', e['Nome'] || '', SEXO(e['Sexo']), grupo(t), (t && t['Nome']) || '—', TIPOS_MAT[e['Tipo Matricula']] || 'Nova matrícula', { balcao: 'Presencial', online: 'Online', importacao: 'Importação', renovacao: 'Renovação' }[e['Origem']] || 'Presencial', e['Estado'] || 'activo']; });
    out.resumo = [['Matrículas', l.length], ['Presenciais', l.filter(e => !e['Origem'] || e['Origem'] === 'balcao').length], ['Online', l.filter(e => e['Origem'] === 'online').length], ['Importadas', l.filter(e => e['Origem'] === 'importacao').length]];
  } else if (tipo === 'inscricoes') {
    const LN = Object.fromEntries(links.map(l => [l._id, l['Titulo'] || '']));
    const EST_I = { pendente: 'À espera do pagamento', paga: 'Por matricular', matriculada: 'Matriculada', recusada: 'Recusada', falhada: 'Pagamento falhou' };
    const l = ins.filter(i => !b.estado || i['Estado'] === b.estado).sort((a, c) => String(c['Created Date'] || '').localeCompare(String(a['Created Date'] || '')));
    out.titulo = 'Inscrições online';
    out.colunas = ['Data', 'Candidato', 'Classe / curso', 'Link', 'Encarregado', 'Telemóvel', 'Valor', 'Estado', 'Nº atribuído'];
    out.linhas = l.map(i => [dmy(i['Created Date']), i['Nome'] || '', i['Curso'] ? ((C[i['Curso']] || {})['Nome'] || '') + ' ' + (i['Ano Curso'] || '') + 'º ano' : (i['Classe'] || ''), LN[i['Link']] || '', i['Encarregado Nome'] || '', i['Encarregado Telefone'] || i['Telefone'] || '', Number(i['Valor'] || 0), EST_I[i['Estado']] || i['Estado'] || '', i['Numero'] || '']);
    out.resumo = Object.entries(EST_I).map(([k, n]) => [n, ins.filter(i => i['Estado'] === k).length]);
  } else if (tipo === 'documentos') {
    const l = activos.filter(e => e['Docs Completos'] !== true).sort((a, c) => String(a['Nome']).localeCompare(String(c['Nome']), 'pt'));
    out.titulo = 'Alunos com documentação incompleta · ' + ano;
    out.colunas = ['Número', 'Nome', 'Classe / curso', 'Turma', 'Documentos em falta', 'Encarregado', 'Telemóvel'];
    out.linhas = l.map(e => { const t = T[e['Turma']], nv = nvT(t), en = EN[e['Encarregado']] || {}; const ed = estadoDocs(docsExigidos(cfg, nv, e['Curso'] ? '' : classeNorm(nv, e['Classe'] || (t && t['Classe'])), e['Tipo Matricula']), lerJSON(e['Documentos'], {}));
      return [e['Numero'] || '', e['Nome'] || '', grupo(t), (t && t['Nome']) || '—', ed.falta.join('; ') || 'Por conferir', en['Nome'] || '—', en['Telefone'] || '—']; });
    out.resumo = [['Alunos activos', activos.length], ['Com documentos em falta', l.length], ['Completos', activos.length - l.length]];
  } else if (tipo === 'saidas') {
    const l = ests.filter(e => ['cancelado', 'transferido'].includes(e['Estado']) && passa(e) && (!b.estado || e['Estado'] === b.estado)).sort((a, c) => String(c['Data Saida'] || '').localeCompare(String(a['Data Saida'] || '')));
    out.titulo = 'Matrículas canceladas e alunos transferidos';
    out.colunas = ['Data', 'Número', 'Nome', 'Turma', 'Situação', 'Motivo / destino'];
    out.linhas = l.map(e => [dmy(e['Data Saida']), e['Numero'] || '', e['Nome'] || '', (T[e['Turma']] || {})['Nome'] || '—', e['Estado'] === 'cancelado' ? 'Matrícula cancelada' : 'Transferido', e['Motivo Saida'] || '']);
    out.resumo = [['Canceladas', l.filter(e => e['Estado'] === 'cancelado').length], ['Transferidos', l.filter(e => e['Estado'] === 'transferido').length]];
  } else if (tipo === 'historico') {
    const l = ests.filter(e => passa(e) && (e['Estado'] || 'activo') !== 'apagado');
    const linhas = [];
    l.forEach(e => { lerJSON(e['Historico'], []).forEach(h => linhas.push([dmy(h.data), e['Numero'] || '', e['Nome'] || '', { renovacao: 'Renovação (vinha de ' + (h.ano || '') + ')', mudanca: 'Mudança de turma', cancelado: 'Cancelada', transferido: 'Transferido', activo: 'Reactivada' }[h.tipo] || h.tipo,
      (T[h.turma || h.de] || {})['Nome'] || '', (T[h.para] || {})['Nome'] || '', h.motivo || ''])); linhas.push([dmy(e['Data Matricula']), e['Numero'] || '', e['Nome'] || '', 'Matrícula ' + (e['Ano Lectivo'] || '') + ' · ' + (TIPOS_MAT[e['Tipo Matricula']] || 'Nova'), '', (T[e['Turma']] || {})['Nome'] || '', '']); });
    out.titulo = 'Histórico de matrículas';
    out.colunas = ['Data', 'Número', 'Nome', 'Movimento', 'De', 'Para', 'Motivo'];
    out.linhas = linhas.sort((a, c) => c[0].split('/').reverse().join('').localeCompare(a[0].split('/').reverse().join('')));
    out.resumo = [['Movimentos', linhas.length], ['Alunos', l.length]];
  } else if (tipo === 'geral') {
    const act = ests.filter(e => ativoEst(e) && doAno(e)), k = conta(act);
    const tAno = ts.filter(t => t['Activa'] !== false && String(t['Ano Lectivo'] || ano) === ano);
    out.titulo = 'Relatório geral da escola · ' + ano;
    out.resumo = [['Total de alunos', k.total], ['Masculino', k.m], ['Feminino', k.f], ['Turmas', tAno.length], ['Cursos', cs.filter(c => c['Activo'] !== false).length || '—']];
    const porNivel = {}; act.forEach(e => { const n = NIVEIS_NOME[nvT(T[e['Turma']])] || '—'; (porNivel[n] = porNivel[n] || []).push(e); });
    const porAno = {}; ests.filter(ativoEst).forEach(e => { const a = String(e['Ano Lectivo'] || '—'); (porAno[a] = porAno[a] || []).push(e); });
    out.colunas = ['Grupo', 'Valor', 'Alunos', 'M', 'F', 'Turmas'];
    out.linhas = Object.entries(porNivel).map(([n, l]) => { const k2 = conta(l); return ['Nível de ensino', n, k2.total, k2.m, k2.f, tAno.filter(t => NIVEIS_NOME[nvT(t)] === n).length]; })
      .concat(Object.entries(porAno).sort().map(([a, l]) => { const k2 = conta(l); return ['Ano lectivo', a, k2.total, k2.m, k2.f, ts.filter(t => t['Activa'] !== false && String(t['Ano Lectivo'] || '') === a).length]; }));
  } else return erro(res, 400, 'Escolha o tipo de relatório.');
  res.json(out);
}));
const NIVEIS_NOME = { ESC: 'Escolinha', PRI: 'Ensino Primário', SEC: 'Ensino Secundário', TEC: 'Técnico-Profissional', SUP: 'Ensino Superior', CON: 'Condução' };



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
const MOZ_MIN = 10;   // a MozPayment não aceita pagamentos abaixo de 10 MT
const MOZ_NUM_258 = /^(1|sim|true|258)$/i.test(String(process.env.MOZ_NUMERO_258 || '').trim());   // 1 = enviar 25884xxxxxxx; vazio = 84xxxxxxx
const numMoz = n9 => (MOZ_NUM_258 ? '258' : '') + n9;
// corpo do pedido C2B (M-Pesa/e-Mola): exactamente estes 5 campos
const corpoC2B = (metodo, valor, n9, nome) => ({ wallet: MOZ_WALLET, payment_method: metodo, amount: String(valor), number: numMoz(n9), name: String(nome || '').slice(0, 80) });

// ============================================================
//  v5.22.0 — C2B por checkout (payprocess) e B2C por payout
//  A integração antiga (/payment e /b2c-*-imale) fica em standby: volta com MOZ_C2B_MODO=directo e MOZ_B2C_MODO=antigo.
//  C2B novo: POST /payprocess { metod_payment, amount, description (até 14), name, number, wallet }
//            → devolve https://paysuite.tech/checkout/<código>. O <código> fica em Referencia e chega no webhook como "reason".
//            O cliente paga dentro de um iframe (400 × 450) na própria página; quando o webhook confirma, a janela fecha.
//  B2C novo: POST /payout { phone, holder, method, amount, wallet, secret_id }
// ============================================================
const MOZ_C2B_MODO = /^directo|antigo$/i.test(String(process.env.MOZ_C2B_MODO || '').trim()) ? 'directo' : 'checkout';
const MOZ_B2C_MODO = /^antigo|directo$/i.test(String(process.env.MOZ_B2C_MODO || '').trim()) ? 'antigo' : 'payout';
const MOZ_C2B_PATH = String(process.env.MOZ_C2B_PATH || 'payprocess').replace(/^\/+|\/+$/g, '');
const MOZ_PAYOUT_PATH = String(process.env.MOZ_PAYOUT_PATH || 'payout').replace(/^\/+|\/+$/g, '');
const descricaoC2B = t => (String(t || 'Pagamento').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w .-]/g, '').replace(/\s+/g, ' ').trim() || 'Pagamento').slice(0, 14).trim();
function codigoCheckout(link) {
  try { const u = new URL(link); const m = u.pathname.match(/\/checkout\/([^/?#]+)/i); if (m) return decodeURIComponent(m[1]); const partes = u.pathname.split('/').filter(Boolean); return partes[partes.length - 1] || null; }
  catch (e) { const m = String(link || '').match(/\/checkout\/([^/?#\s]+)/i); return m ? m[1] : null; }
}
// Inicia um C2B (M-Pesa / e-Mola). Devolve { ref, iframe?, raw }.
async function iniciarC2B(metodo, valor, n9, nome, descricao) {
  if (MOZ_C2B_MODO === 'directo') {
    const d = await mozPedido('payment', corpoC2B(metodo, valor, n9, nome));
    const idp = achar(d, ['idpayment', 'id_payment', 'idPayment', 'payment_id', 'paymentId', 'reference', 'id']);
    if (!idp) throw new Error('a MozPayment não devolveu a referência do pagamento: ' + JSON.stringify(d).slice(0, 200));
    return { ref: String(idp), iframe: null, raw: d };
  }
  const d = await mozPedido(MOZ_C2B_PATH, { metod_payment: metodo, amount: String(valor), description: descricaoC2B(descricao), name: String(nome || 'Cliente').slice(0, 80), number: numMoz(n9), wallet: MOZ_WALLET });
  const link = normalLink(achar(d, ['url_checkout', 'checkout_url', 'urlCheckout'])) || acharLink(d);   // a MozPayment devolve o link em url_checkout
  if (!link) throw new Error('a MozPayment não devolveu o link do checkout (url_checkout): ' + JSON.stringify(d).slice(0, 200));
  console.log('[checkout] url_checkout=' + link);
  const ref = codigoCheckout(link);
  if (!ref) throw new Error('o link do checkout não tem código: ' + link);
  return { ref: String(ref), iframe: link, embed: await podeEmbutir(link), raw: d };
}
// O fornecedor pode proibir a página dentro de iframes (X-Frame-Options / CSP frame-ancestors).
// Nesse caso a janela mostra um botão para abrir o checkout num separador novo, e a confirmação continua a vir pelo webhook.
// MOZ_CHECKOUT_EMBED: auto (por defeito) · sim (força iframe) · nao (abre sempre num separador)
const MOZ_CHECKOUT_EMBED = String(process.env.MOZ_CHECKOUT_EMBED || 'auto').toLowerCase();
const EMBED_CACHE = new Map();
async function podeEmbutir(link) {
  if (/^(sim|1|true)$/.test(MOZ_CHECKOUT_EMBED)) return true;
  if (/^(nao|não|0|false)$/.test(MOZ_CHECKOUT_EMBED)) return false;
  let host = ''; try { host = new URL(link).host; } catch (e) { return true; }
  const guardado = EMBED_CACHE.get(host); if (guardado && Date.now() - guardado.em < 6 * 3600e3) return guardado.ok;
  let ok = true;
  try {
    const r = await fetch(link, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(6000) });
    const xfo = String(r.headers.get('x-frame-options') || '').toLowerCase();
    const csp = String(r.headers.get('content-security-policy') || '').toLowerCase();
    const fa = (csp.match(/frame-ancestors([^;]*)/) || [])[1];
    if (/deny|sameorigin/.test(xfo)) ok = false;
    if (fa !== undefined) { const v = fa.trim(); ok = v.includes('*') ? true : ORIGENS.some(o => v.includes(o.replace(/^https?:\/\//, ''))); }
    console.log('[checkout] ' + host + ' x-frame-options=' + (xfo || '—') + ' frame-ancestors=' + (fa === undefined ? '—' : fa.trim()) + ' → ' + (ok ? 'iframe' : 'separador novo'));
  } catch (e) { console.warn('[checkout] não deu para verificar ' + host + ': ' + e.message); return true; }
  EMBED_CACHE.set(host, { ok, em: Date.now() });
  return ok;
}
const msgC2B = (r, n9) => r.iframe ? 'Complete o pagamento na janela que abriu. Fecha sozinha quando o pagamento for confirmado.' : 'Pedido enviado para o ' + n9.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3') + '. Confirme com o PIN.';

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
  console.log('[moz] login…');
  let r;
  try { r = await fetch(MOZ_BASE + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: MOZ_EMAIL, senha: MOZ_SENHA }), signal: AbortSignal.timeout(25000) }); }
  catch (e) { throw new Error(e.name === 'TimeoutError' ? 'o login na MozPayment não respondeu em 25 segundos' : 'sem ligação à MozPayment (' + e.message + ')'); }
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
    console.log('[moz] ' + caminho + ' a pedir… ' + JSON.stringify(Object.assign({}, corpo, { wallet: corpo.wallet ? '…' : undefined, carteira: corpo.carteira ? '…' : undefined })));
    let r;
    // o M-Pesa/e-Mola só responde depois de a pessoa pôr o PIN (ou desistir): esperar até 100 s
    try { r = await fetch(MOZ_BASE + '/' + caminho, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(100000) }); }
    catch (e) { const x = new Error(e.name === 'TimeoutError' ? 'a MozPayment não respondeu em 100 segundos' : 'sem ligação à MozPayment (' + e.message + ')'); x.semResposta = true; throw x; }
    const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch (e) { d = { raw: t }; }
    if ((r.status === 401 || r.status === 403) && tentativa === 0) continue;   // token caducado: novo login e repete
    console.log('[moz] ' + caminho + ' → ' + r.status + ' ' + t.slice(0, 1500));
    if (!r.ok) { const e = new Error(achar(d, ['message', 'mensagem', 'error', 'erro']) || ('MozPayment respondeu ' + r.status)); e.moz = d; throw e; }
    // a MozPayment responde 200 mesmo quando falha: ver o cod/status dentro da resposta
    const st = String(achar(d, ['status', 'estado']) || '').toLowerCase(), cod = Number(achar(d, ['cod', 'code', 'codigo', 'status_code']));
    const falhou = /error|erro|fail|falh|invalid|inv[aá]lid|recus|negad|insuf/.test(st) || (isFinite(cod) && cod >= 400);
    if (falhou) { const e = new Error(achar(d, ['message', 'mensagem', 'msg', 'error', 'erro', 'detalhe']) || ('MozPayment: ' + (st || 'cod ' + cod))); e.moz = d; throw e; }
    // erros "escondidos" num campo da resposta, ex.: { status:"success", response:{ valor_invalido:"Valor abaixo de 10MT…" } }
    const procura = o => { if (!o || typeof o !== 'object') return null; for (const [k, v] of Object.entries(o)) { if (typeof v === 'string' && /invalid|erro|error|falh|insufic|recus|negad/i.test(k)) return v; if (v && typeof v === 'object') { const x = procura(v); if (x) return x; } } return null; };
    const escondido = procura(d);
    if (escondido) { const e = new Error(escondido); e.moz = d; throw e; }
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
    if (!r.ok) {
      let msg = t; try { const d = JSON.parse(t); msg = (d.body && d.body.message) || d.message || t; } catch (e) {}
      throw erroGravar(tipo, Object.assign(new Error(msg), { status: r.status === 404 ? 404 : 400, bubble: String(msg).slice(0, 200) }));
    }
    const linhas = t.split('\n').filter(Boolean), ok = linhas.filter(l => /"status"\s*:\s*"success"/.test(l)).length;
    criados += ok;
    if (!ok && linhas.length) {   // o Bubble respondeu 200 mas recusou todas as linhas: mostrar o primeiro motivo
      let msg = linhas[0]; try { const d = JSON.parse(linhas[0]); msg = d.message || (d.body && d.body.message) || linhas[0]; } catch (e) {}
      throw erroGravar(tipo, Object.assign(new Error(msg), { status: 400, bubble: String(msg).slice(0, 200) }));
    }
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
// ---------- email (v5.16): Resend. O email vai junto com o SMS, para quando o SMS não chega ----------
//    RESEND_KEY   chave da API do Resend (re_…)
//    MAIL_FROM    remetente de um domínio verificado no Resend, ex.: Gescolar <nao-responder@gescolar.co.mz>
const RESEND_KEY = (process.env.RESEND_KEY || '').trim();
const MAIL_FROM = (process.env.MAIL_FROM || '').trim();
const RESEND_URL = process.env.RESEND_URL || 'https://api.resend.com/emails';
const escH = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// corpo do email com a cara do Gescolar; blocos = [{p:'texto'} | {codigo:'123456'} | {botao:'Texto', link:'https://…'} | {nota:'texto'}]
// v5.25: cabeçalho azul com o logótipo e a faixa amarela da marca
const LOGO_EMAIL = process.env.LOGO_EMAIL || 'https://gescolar.co.mz/logo.png';
function emailGescolar(escolaNome, titulo, blocos) {
  const F = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  const corpo = blocos.map(b => b.codigo ? '<div style="margin:22px 0;text-align:center"><div style="display:inline-block;' + F + 'font-weight:800;font-size:38px;letter-spacing:10px;color:#0B2A4A;background:#EEF4FC;border:2px dashed #0A64DC;border-radius:14px;padding:18px 26px 18px 36px">' + escH(b.codigo) + '</div></div>'
    : b.botao ? '<div style="text-align:center;margin:26px 0 8px"><a href="' + escH(b.link) + '" style="display:inline-block;background:#FFC21A;color:#0B2A4A;text-decoration:none;' + F + 'font-weight:800;font-size:16px;padding:15px 30px;border-radius:12px;border-bottom:4px solid #E0A400">' + escH(b.botao) + '</a></div><p style="' + F + 'font-size:12px;line-height:1.5;color:#8A94A3;margin:10px 0 14px;text-align:center;word-break:break-all">Se o botão não abrir, copie este endereço: ' + escH(b.link) + '</p>'
    : b.nota ? '<p style="' + F + 'font-size:13px;line-height:1.55;color:#5F6B7A;margin:16px 0 0">' + escH(b.nota) + '</p>'
    : '<p style="' + F + 'font-size:15.5px;line-height:1.6;color:#12233A;margin:0 0 14px;white-space:pre-line">' + escH(b.p) + '</p>').join('');
  return '<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escH(titulo) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#EEF2F8"><div style="padding:28px 12px">' +
    '<div style="max-width:540px;margin:0 auto;background:#FFFFFF;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(11,42,74,.10)">' +
    '<div style="background:#0A3D91;background-image:linear-gradient(135deg,#0A64DC 0%,#062A66 100%);padding:26px 26px 22px;text-align:left">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:14px"><img src="' + escH(LOGO_EMAIL) + '" width="52" height="52" alt="Gescolar" style="display:block;border-radius:50%;background:#fff;border:2px solid rgba(255,255,255,.85)"></td>' +
      '<td style="vertical-align:middle"><div style="' + F + 'font-weight:800;font-size:24px;color:#FFFFFF;letter-spacing:-.3px">G<span style="color:#FFC21A">e</span>scolar</div>' +
      '<div style="' + F + 'font-size:13px;color:#CFE0FB;margin-top:2px">' + escH(escolaNome || 'Gestão escolar em Moçambique') + '</div></td></tr></table></div>' +
    '<div style="height:6px;background:#FFC21A;line-height:6px;font-size:0">&nbsp;</div>' +
    '<div style="padding:30px 28px 26px"><h1 style="' + F + 'font-weight:800;font-size:22px;line-height:1.3;color:#0B2A4A;margin:0 0 16px">' + escH(titulo) + '</h1>' + corpo + '</div>' +
    '<div style="padding:18px 28px;background:#F6F8FC;border-top:1px solid #E6ECF4;' + F + 'font-size:12px;line-height:1.6;color:#8A94A3">' +
      '<b style="color:#0B2A4A">Gescolar</b> · a escola inteira, num só sistema<br>gescolar.co.mz · geral@gescolar.co.mz</div>' +
    '</div></div></body></html>';
}
function textoDeBlocos(titulo, blocos) { return titulo + '\n\n' + blocos.map(b => b.codigo ? 'Código: ' + b.codigo : b.botao ? b.botao + ': ' + b.link : (b.p || b.nota || '')).join('\n\n'); }
// sem Resend, o email sai pelo «Send email» do próprio Bubble: backend workflow «enviar-email» com para, assunto, texto
async function enviarEmailBubble(email, assunto, texto) {
  try {
    const d = await workflow('enviar-email', { para: email, assunto, texto });
    console.log('[email-bubble] ' + email + ' → ' + JSON.stringify(d).slice(0, 120));
    return { ok: true };
  } catch (e) { console.error('[email-bubble] ' + email + ' → ' + e.message); return { ok: false, erro: e.message }; }
}
async function enviarEmail(para, assunto, html, texto) {
  const email = String(para || '').trim().toLowerCase();
  if (!emailOk(email)) return { ok: false, erro: 'email inválido' };
  if (!RESEND_KEY || !MAIL_FROM) return enviarEmailBubble(email, assunto, texto);
  try {
    const r = await fetch(RESEND_URL, { method: 'POST', headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: MAIL_FROM, to: [email], subject: assunto, html, text: texto }), signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    console.log('[email] ' + email + ' → ' + r.status + ' ' + t.slice(0, 200));
    if (!r.ok) { let d = null; try { d = JSON.parse(t); } catch (e) {} return { ok: false, erro: String((d && (d.message || d.error)) || ('o Resend respondeu ' + r.status)).slice(0, 200) }; }
    return { ok: true };
  } catch (e) { console.error('[email]', e.message); return { ok: false, erro: e.message }; }
}
const mascararEmail = e => { const m = String(e || '').match(/^([^@]+)@(.+)$/); return m ? m[1].slice(0, 2) + '***@' + m[2] : ''; };
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
// v5.21.1: as operadoras bloqueiam SMS com links ou com qualquer coisa parecida (ex.: «gescolar.co.mz», «nome@x.com», «.233»).
// Sem SMS_LINKS=sim, tira links e emails, junta milhares («1.500» → «1500»), decimais com vírgula («12.5» → «12,5»), tira o ponto dos ordinais («2.º» → «2o»)
// e nunca deixa um ponto colado a letras ou números (vira «. »).
function semLinksSMS(m) {
  return String(m || '')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '')
    .replace(/\b([A-Za-z][\w-]*)(?:\.[A-Za-z][\w-]*)*\.(?:co\.mz|com|mz|net|org|io|app|site|run|me|info|online|pt|br)\b\/?\S*/gi, '$1')
    .replace(/(\d)\.\s?(?=[ºª])/g, '$1')
    .replace(/\d{1,3}(?:\.\d{3})+(?!\d)/g, x => x.replace(/\./g, ''))
    .replace(/(\d)\.(?=\d)/g, '$1,')
    .replace(/:\/\//g, ' ')
    .replace(/\.(?=[^\s.])/g, '. ')
    .replace(/\s+([.,)])/g, '$1');
}
function textoSMS(m) {
  if (!SMS_LINKS) m = semLinksSMS(m);
  let t = String(m || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/º/g, 'o').replace(/ª/g, 'a').replace(/[^\x20-\x7E\n]/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!SMS_LINKS) t = t.replace(/\.(?=[^\s.])/g, '. ').replace(/[ \t]+/g, ' ');
  return t.slice(0, 459);
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
// ---------- créditos de SMS por escola (v5.25) ----------
//  Cada escola começa com SMS_INICIAIS SMS (por defeito 20). Cada número que recebe gasta 1 crédito por cada parte de 160 caracteres
//  (mensagens maiores: 153 por parte). Gastam todos os SMS que a escola manda, incluindo os códigos de entrada.
//  Os avisos do Gescolar à própria escola (assinatura, transferências, saques, escola criada) não gastam.
//  Sem créditos, quem tem email recebe a mensagem por email (Resend, grátis) e a Direcção recebe um aviso para recarregar.
//  Bubble: Escola → «SMS Creditos» (number) e «SMS Usados» (number)
//          tabela nova «RecargaSMS»: Escola (Escola) · Pacote (text) · SMS (number) · Valor (number) · Metodo (text) · Telefone (text)
//                                    · Estado (text) · Referencia (text) · Transacao (text) · Raw (text) · Pago Em (date) · Feita Por (text)
//  Render (opcional): SMS_INICIAIS (20) · SMS_PACOTES («100:250,500:1000,1000:1800» = SMS:MT)
const SMS_INICIAIS = Math.max(0, Number(process.env.SMS_INICIAIS === undefined || process.env.SMS_INICIAIS === '' ? 20 : process.env.SMS_INICIAIS) || 0);
const SMS_PACOTES = String(process.env.SMS_PACOTES || '100:250,500:1000,1000:1800').split(',').map(x => x.trim().split(':').map(Number))
  .filter(x => x.length === 2 && x[0] > 0 && x[1] > 0).map(x => ({ id: String(x[0]), sms: x[0], valor: x[1] }));
const SMS_POUCOS = 5;
function partesSMS(m) { const t = textoSMS(m); return !t ? 0 : t.length <= 160 ? 1 : Math.ceil(t.length / 153); }
function creditosDe(e) { const v = e ? e['SMS Creditos'] : undefined; return (v === undefined || v === null || v === '') ? SMS_INICIAIS : Math.max(0, Math.floor(Number(v) || 0)); }
// uma fila por escola: dois envios ao mesmo tempo nunca gastam o mesmo crédito
const filaSMS = new Map();
function naFilaSMS(id, fn) {
  const ant = filaSMS.get(id) || Promise.resolve();
  const p = ant.then(fn, fn), fim = p.catch(() => {});
  filaSMS.set(id, fim); fim.then(() => { if (filaSMS.get(id) === fim) filaSMS.delete(id); });
  return p;
}
async function mexerCreditos(escolaId, delta, usados) {
  return naFilaSMS(String(escolaId), async () => {
    const e = await obter('escola', escolaId);
    if (!e) throw new Error('escola não encontrada');
    const antes = creditosDe(e), depois = Math.max(0, antes + delta);
    await mudar('escola', escolaId, { 'SMS Creditos': depois, 'SMS Usados': Math.max(0, (Number(e['SMS Usados']) || 0) + (usados || 0)) });
    if (typeof cachePainel !== 'undefined') cachePainel.delete(escolaId);
    return { e, antes, depois };
  });
}
// reserva créditos para os primeiros n números que couberem
async function reservarSMS(escolaId, quantos, partes) {
  return naFilaSMS(String(escolaId), async () => {
    const e = await obter('escola', escolaId);
    if (!e) return { e: null, n: quantos, antes: 0, depois: 0, livre: true };
    const antes = creditosDe(e), n = Math.min(quantos, Math.floor(antes / Math.max(1, partes)));
    const depois = antes - n * partes;
    if (n > 0) { await mudar('escola', escolaId, { 'SMS Creditos': depois, 'SMS Usados': (Number(e['SMS Usados']) || 0) + n * partes }); if (typeof cachePainel !== 'undefined') cachePainel.delete(escolaId); }
    return { e, n, antes, depois };
  });
}
// telemóvel → email das pessoas da escola (encarregados, professores, equipa), guardado 10 minutos
const cacheEmailsTel = new Map();
async function emailsPorTelefone(escolaId) {
  const c = cacheEmailsTel.get(escolaId);
  if (c && c.exp > Date.now()) return c.mapa;
  const f = daEscola(escolaId), mapa = new Map();
  const [encs, profs, users] = await Promise.all([procurarTodos('encarregado', f).catch(() => []), procurarTodos('professor', f).catch(() => []), procurarTodos('user', f).catch(() => [])]);
  const juntar = (tel, mail) => { const t = tel9(tel), m = String(mail || '').trim().toLowerCase(); if (t.length === 9 && emailOk(m) && !mapa.has(t)) mapa.set(t, m); };
  encs.forEach(x => juntar(x['Telefone'], x['Email'])); profs.forEach(x => juntar(x['Telefone'], x['Email'])); users.forEach(u => juntar(u['Telefone'], emailDoUser(u)));
  cacheEmailsTel.set(escolaId, { exp: Date.now() + 600e3, mapa });
  return mapa;
}
async function emailEmVezDeSMS(escolaId, e, numeros, mensagem, op) {
  let n = 0;
  try {
    const mapa = await emailsPorTelefone(escolaId), nome = (e && e['Nome']) || 'A sua escola';
    const emails = [...new Set(numeros.map(x => mapa.get(tel9(x))).filter(Boolean))];
    const blocos = [{ p: String(mensagem || '') }, { nota: 'Mensagem enviada por ' + nome + ' através do Gescolar.' }];
    for (const m of emails) { const r = await enviarEmail(m, (op && op.assunto) || (nome + ': nova mensagem'), emailGescolar(nome, (op && op.titulo) || 'Mensagem da escola', blocos), textoDeBlocos('Mensagem da escola', blocos)); if (r.ok) n++; }
  } catch (err) { console.error('[sms→email]', err.message); }
  return n;
}
// aviso à Direcção quando os SMS estão a acabar ou acabaram (no máximo um de cada tipo por dia)
const avisosSMS = new Map();
async function avisarCreditosSMS(escolaId, e, restam) {
  try {
    const tipo = restam <= 0 ? 'zero' : 'poucos', chave = escolaId + '|' + tipo, ult = avisosSMS.get(chave) || 0;
    if (Date.now() - ult < 864e5) return;
    avisosSMS.set(chave, Date.now());
    const mail = String((e && e['Email']) || '').trim().toLowerCase();
    if (!emailOk(mail)) return;
    const nome = (e && e['Nome']) || 'A sua escola';
    const blocos = restam <= 0
      ? [{ p: 'Os SMS de ' + nome + ' acabaram. Os avisos às famílias e os códigos de entrada deixam de ir por SMS; quem tem email continua a receber por email.' }, { p: 'Para voltar a enviar SMS, recarregue no painel da Direcção, em Conta → SMS e emails. Pode pagar por M-Pesa, e-Mola ou cartão.' }, { botao: 'Recarregar SMS', link: linkPagina('direccao') + '#sms' }]
      : [{ p: 'Restam só ' + restam + ' SMS a ' + nome + '.' }, { p: 'Recarregue antes que acabem, no painel da Direcção, em Conta → SMS e emails.' }, { botao: 'Recarregar SMS', link: linkPagina('direccao') + '#sms' }];
    await enviarEmail(mail, restam <= 0 ? 'Os SMS da escola acabaram' : 'Os SMS da escola estão a acabar', emailGescolar(nome, restam <= 0 ? 'Os SMS acabaram' : 'Os SMS estão a acabar', blocos), textoDeBlocos('SMS da escola', blocos));
  } catch (err) { console.error('[sms-aviso]', err.message); }
}
// envia SMS em nome de uma escola, gastando os créditos dela
//   op.semEmail: não manda por email quem fica sem SMS (quando a rota já envia o seu próprio email)
async function smsEscola(escolaId, numeros, mensagem, op) {
  op = op || {};
  if (!escolaId) return enviarSMS(numeros, mensagem);
  const lista = [...new Set((Array.isArray(numeros) ? numeros : [numeros]).map(numeroSMS).filter(Boolean))];
  if (!lista.length) return { ok: false, erro: 'nenhum número válido', numeros: [] };
  if (!SMS_TOKEN || !SMS_ORIGEM) return enviarSMS(lista, mensagem);
  const partes = partesSMS(mensagem);
  if (!partes) return { ok: false, erro: 'mensagem vazia', numeros: [] };
  const rs = await reservarSMS(escolaId, lista.length, partes);
  const vai = lista.slice(0, rs.n), fica = lista.slice(rs.n);
  let r = { ok: false, erro: 'A escola não tem SMS. Recarregue em Conta → SMS e emails.', numeros: [] };
  if (vai.length) {
    r = await enviarSMS(vai, mensagem);
    if (!r.ok && !rs.livre) await mexerCreditos(escolaId, vai.length * partes, -vai.length * partes).catch(err => console.error('[sms] devolver créditos', err.message));
  }
  if (fica.length) {
    r.sem_creditos = true; r.sem_sms = fica.length;
    r.por_email = op.semEmail ? 0 : await emailEmVezDeSMS(escolaId, rs.e, fica, mensagem, op);
    console.warn('[sms] ' + escolaId + ' sem créditos: ' + fica.length + ' número(s) sem SMS, ' + (r.por_email || 0) + ' por email');
  }
  if (rs.e && !rs.livre && (fica.length || rs.depois <= SMS_POUCOS)) avisarCreditosSMS(escolaId, rs.e, rs.depois);
  return r;
}
const mt = v => Number(v || 0).toLocaleString('pt-PT', { maximumFractionDigits: 6 }).replace(/\s/g, ' ') + ' MT';
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
    const r = await smsEscola(pag['Escola'], numeros, msg);
    if (!r.ok) console.warn('[sms] recibo ' + documento + ' não enviado: ' + r.erro);
  } catch (e) { console.error('[sms] recibo', e.message); }
}
app.post('/sms-teste', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  if (!numeroSMS(b.numero)) return erro(res, 400, 'Número inválido. Use 9 dígitos, por exemplo 84 123 4567.');
  const escola = await resumoEscola(req.escola);
  const r = await smsEscola(req.escola, [b.numero], txt(b.mensagem, 300) || ((escola ? escola.nome + ': ' : '') + 'teste de SMS do Gescolar. Se recebeu esta mensagem, esta tudo a funcionar.'), { semEmail: true });
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
  if (total < MOZ_MIN) return erro(res, 400, 'O valor mínimo para pagar online é ' + MOZ_MIN + ' MT. Este pagamento é de ' + total + ' MT.');
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
    const c2b = await iniciarC2B(metodo, total, numero, nome, ps.length === 1 ? 'Propina' : 'Propinas');
    await mudar('pagamento', pagId, { 'Referencia': c2b.ref, 'Raw': JSON.stringify(c2b.raw).slice(0, 4000) });
    res.json({ ok: true, pagamento: pagId, estado: 'pendente', total, iframe: c2b.iframe, embed: c2b.embed, mensagem: c2b.iframe ? msgC2B(c2b, numero) : 'Pedido enviado para o ' + numero.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3') + '. O encarregado confirma com o PIN.' });
  } catch (e) {
    console.error('[pagar]', e.message);
    if (e.semResposta) {   // pode ter chegado ao telemóvel: o pagamento fica pendente e o webhook ainda o pode confirmar
      await mudar('pagamento', pagId, { 'Raw': String(e.message).slice(0, 2000) }).catch(() => {});
      return res.json({ ok: true, pagamento: pagId, estado: 'pendente', total, mensagem: 'A MozPayment está a demorar a responder. Se o pedido chegou ao telemóvel e for pago, o recibo aparece sozinho.' });
    }
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
// Links sem «.html» (o GitHub Pages abre /acesso como acesso.html). PORTAL_URL pode vir com ou sem .html.
const PORTAL_URL = (process.env.PORTAL_URL || 'https://gescolar.co.mz/acesso').replace(/\/+$/, '').replace(/\.html$/, '');
const pedidosAcesso = new Map();
setInterval(() => { const a = Date.now(); for (const [k, v] of pedidosAcesso) if (v.exp < a) pedidosAcesso.delete(k); }, 300e3).unref();
const hashCodigo = c => crypto.createHmac('sha256', SESSION_SECRET || 'x').update(String(c)).digest('hex');
const tel9 = t => soDigitos(t).replace(/^00258/, '').replace(/^258(?=\d{9}$)/, '');
const mascarar = t => { const d = tel9(t); return d.length === 9 ? d.slice(0, 2) + ' *** **' + d.slice(7) : '***'; };
function linkFamilias(sub) { return PORTAL_URL + '?e=' + encodeURIComponent(sub || ''); }
// v5.17: os SMS deixam de levar links (as operadoras bloqueiam SMS com links). SMS_LINKS=sim volta a pô-los.
const SMS_LINKS = /^(sim|1|true)$/i.test(process.env.SMS_LINKS || '');
const noGescolar = sub => SMS_LINKS ? 'em ' + linkFamilias(sub).replace(/^https?:\/\//, '') : 'no Gescolar (codigo da escola: ' + (sub || '') + ')';

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
  let alvo = null, destino = '', emailDestino = '';
  if (tipo === 'professor') {
    const tel = tel9(b.telefone);
    if (tel.length !== 9) return erro(res, 400, 'Escreva o seu número de telemóvel com 9 dígitos.');
    const profs = await procurarTodos('professor', daEscola(esc._id));
    alvo = profs.find(x => tel9(x['Telefone']) === tel && x['Activo'] !== false);
    if (!alvo) return erro(res, 404, 'Este número não está registado como professor nesta escola. Peça à Direcção para confirmar o seu número.');
    destino = tel; emailDestino = alvo['Email'] || '';
  } else if (tipo === 'encarregado') {
    const tel = tel9(b.telefone);
    if (tel.length !== 9) return erro(res, 400, 'Escreva o seu número de telemóvel com 9 dígitos.');
    const encs = await procurarTodos('encarregado', daEscola(esc._id));
    alvo = encs.find(e => tel9(e['Telefone']) === tel && e['Activo'] !== false);
    if (!alvo) return erro(res, 404, 'Este número não está registado como encarregado nesta escola. Peça à secretaria para confirmar o seu número.');
    destino = tel; emailDestino = alvo['Email'] || '';
  } else {
    const num = txt(b.numero, 30).toUpperCase().replace(/\s+/g, '');
    if (!num) return erro(res, 400, 'Escreva o seu número de estudante.');
    const l = await procurar('estudante', [{ key: 'Escola', constraint_type: 'equals', value: esc._id }, { key: 'Numero', constraint_type: 'equals', value: num }], 1);
    alvo = l[0];
    if (!alvo || (alvo['Estado'] || 'activo') !== 'activo') return erro(res, 404, 'Não encontrámos esse número de estudante nesta escola.');
    destino = tel9(alvo['Telefone']);
    const en = alvo['Encarregado'] ? await obter('encarregado', alvo['Encarregado']).catch(() => null) : null;
    if (destino.length !== 9 && en) destino = tel9(en['Telefone']);
    emailDestino = (en && en['Email']) || '';
    if (destino.length !== 9 && !emailOk(emailDestino)) return erro(res, 409, 'Ainda não há telemóvel registado para este estudante. Peça à secretaria para registar o seu número ou o do encarregado.');
  }
  if (travao('acesso|' + alvo._id, 3, 15)) return erro(res, 429, 'Já enviámos vários códigos. Espere 15 minutos e tente de novo.');
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const pedido = crypto.randomBytes(16).toString('hex');
  const blocos = [{ p: 'Use este código para entrar no Gescolar (' + (tipo === 'professor' ? 'Professor' : tipo === 'estudante' ? 'Estudante' : 'Encarregado') + '):' }, { codigo }, { nota: 'O código vale 10 minutos. Não o partilhe com ninguém. Se não pediu este código, ignore este email.' }];
  const [r, m] = await Promise.all([
    destino.length === 9 ? smsEscola(esc._id, [destino], esc['Nome'] + ': o seu codigo de acesso ao Gescolar e ' + codigo + '. Valido 10 minutos. Nao partilhe este codigo.', { semEmail: true }) : Promise.resolve({ ok: false }),
    emailOk(String(emailDestino).toLowerCase()) ? enviarEmail(emailDestino, 'Código de acesso: ' + codigo, emailGescolar(esc['Nome'], 'O seu código de acesso', blocos), textoDeBlocos('O seu código de acesso', blocos)) : Promise.resolve({ ok: false })]);
  if (!r.ok && !m.ok) return erro(res, r.sem_creditos ? 402 : 502, r.sem_creditos ? 'A escola ficou sem SMS e não tem um email seu registado. Peça à escola para recarregar os SMS ou para registar o seu email.' : 'Não foi possível enviar o código agora. Tente de novo dentro de um minuto.');
  pedidosAcesso.set(pedido, { escola: esc._id, tipo, id: alvo._id, hash: hashCodigo(pedido + codigo), exp: Date.now() + 600e3, tent: 0 });
  res.json({ ok: true, pedido, destino: [r.ok ? mascarar(destino) : '', m.ok ? mascararEmail(emailDestino) : ''].filter(Boolean).join(' e '), sms: r.ok, email: m.ok, escola: esc['Nome'] || '' });
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
      escolinha: ehESC(t) ? { diario: await diarioDoEstudante(req.escola, e._id).catch(() => []), autorizados: await autorizadosDe(req.escola, [e._id]).catch(() => []) } : null,
      conducao: await conducaoDoEstudante(req.escola, e._id, cache).catch(err => { console.error('[portal] condução', err.message); return null; }),
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
    hoje: hojeMZ().data,
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
  const link = noGescolar(esc['Subdominio']);
  const msg = (esc['Nome'] || 'A escola') + ': ja pode ver propinas, recibos e notas do seu educando e pagar por M-Pesa ou e-Mola. Entre ' + link + ' com o seu numero de telemovel.';
  let enviados = 0, falhas = 0;
  for (let i = 0; i < nums.length; i += 50) {
    const r = await smsEscola(req.escola, nums.slice(i, i + 50), msg);
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
      const msg = (esc['Nome'] || 'Escola') + ': ' + titulo + '. ' + curto + (texto.length > 120 ? ' Veja tudo ' + noGescolar(esc['Subdominio']) + '.' : '');
      let semCred = 0, porEmail = 0;
      for (let i = 0; i < nums.length; i += 50) { const r = await smsEscola(req.escola, nums.slice(i, i + 50), msg, { assunto: (esc['Nome'] || 'Escola') + ': ' + titulo, titulo }); if (r.ok) sms += r.numeros.length; semCred += r.sem_sms || 0; porEmail += r.por_email || 0; }
      if (semCred) aviso = 'Os SMS da escola acabaram: ' + semCred + ' encarregado(s) ficaram sem SMS' + (porEmail ? ' (' + porEmail + ' receberam por email)' : '') + '. Recarregue em Conta → SMS e emails.';
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
const NIVEIS_DESC = { A: 'Adquirido', E: 'Em aquisição', N: 'Não adquirido' };
const ehESC = t => !!t && (t['Nivel'] === NIVEIS.ESC || t['Nivel'] === 'ESC');
function validarDescritiva(g, estIds) {
  const notas = {};
  for (const [est, l] of Object.entries((g && g.notas) || {})) {
    if (!estIds.has(est) || !l || typeof l !== 'object') continue;
    const n = String(l.n || '').toUpperCase(), o = txt(l.o, 400);
    if (n && !NIVEIS_DESC[n]) return 'Use A (adquirido), E (em aquisição) ou N (não adquirido).';
    if (n || o) notas[est] = Object.assign(n ? { n } : {}, o ? { o } : {});
  }
  return { modo: 'descritiva', notas };
}
// ---------- ensino superior e técnico (v5.5): pauta semestral ----------
//  Grelha { modo:'semestral', colunas:[{id,tipo:'F',nome}…, {id:'ex',tipo:'EX'}, {id:'rc',tipo:'RC'}], notas }
//  Frequência = média das avaliações F. Dispensado se freq ≥ dispensa (14); excluído se freq < admissão (10);
//  admitido vai a exame: Final = freq × (1 − p) + exame × p (p = peso do exame, 50% por defeito). A recorrência substitui o exame.
const ehSEM = t => !!t && [NIVEIS.SUP, NIVEIS.TEC, 'SUP', 'TEC'].includes(t['Nivel']);
const PERIODOS = t => ehSEM(t) ? 2 : 3;
function regrasPauta(esc) {
  const r = (esc && esc.regras) || {};
  const pe = Number(r.peso_exame); 
  return { aprovacao: Number(r.aprovacao || 10), dispensa: Number(r.dispensa || 14), admissao: Number(r.admissao || 10), peso_exame: pe > 0 && pe < 100 ? pe : 50 };
}
const PAUTA_SEM = () => ({ modo: 'semestral', colunas: [{ id: 't1', tipo: 'F', nome: 'Teste 1' }, { id: 't2', tipo: 'F', nome: 'Teste 2' }, { id: 'tr1', tipo: 'F', nome: 'Trabalho' },
  { id: 'ex', tipo: 'EX', nome: 'Exame' }, { id: 'rc', tipo: 'RC', nome: 'Recorrência' }], notas: {} });
function mediasSem(g, estId, R) {
  R = R || regrasPauta(null);
  const n = ((g && g.notas) || {})[estId] || {};
  const fs = (g.colunas || []).filter(c => c.tipo === 'F').map(c => n[c.id]).filter(v => typeof v === 'number');
  const freq = fs.length ? r1(fs.reduce((a, b) => a + b, 0) / fs.length) : null;
  const ex = typeof n.ex === 'number' ? n.ex : null, rc = typeof n.rc === 'number' ? n.rc : null;
  const out = { freq, exame: ex, recorrencia: rc, final: null, estado: 'sem', completa: false };
  if (freq === null) return Object.assign(out, { mt: null });
  if (Math.round(freq) >= R.dispensa) Object.assign(out, { estado: 'dispensado', final: freq, completa: true });
  else if (Math.round(freq) < R.admissao) Object.assign(out, { estado: 'excluido', final: freq, completa: true });
  else {
    const e = rc !== null ? rc : ex;
    if (e === null) out.estado = 'admitido';
    else {
      out.final = r1(freq * (1 - R.peso_exame / 100) + e * R.peso_exame / 100);
      out.estado = Math.round(out.final) >= R.aprovacao ? 'aprovado' : (rc !== null ? 'reprovado' : 'recorrencia');
      out.completa = out.estado !== 'recorrencia';
    }
  }
  out.mt = out.final;
  out.aprovado = out.estado === 'dispensado' || out.estado === 'aprovado';
  return out;
}
function validarSemestral(g, estIds) {
  if (!g || typeof g !== 'object') return 'Pauta inválida.';
  const vistos = new Set(['ex', 'rc']), colunas = [];
  for (const c of (Array.isArray(g.colunas) ? g.colunas : [])) {
    const id = String((c && c.id) || '').toLowerCase();
    if (c && (c.tipo === 'EX' || c.tipo === 'RC')) continue;
    if (!/^[a-z0-9]{1,10}$/.test(id) || vistos.has(id)) continue;
    vistos.add(id); colunas.push({ id, tipo: 'F', nome: txt(c.nome, 16) || 'Avaliação' });
  }
  if (!colunas.length) return 'A pauta precisa de pelo menos um teste ou trabalho.';
  if (colunas.length > 8) return 'No máximo 8 avaliações de frequência por semestre.';
  colunas.push({ id: 'ex', tipo: 'EX', nome: 'Exame' }, { id: 'rc', tipo: 'RC', nome: 'Recorrência' });
  const ids = new Set(colunas.map(c => c.id)), notas = {};
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
  return Object.assign({ modo: 'semestral', colunas, notas }, lerObs(g.obs, estIds));
}
function mediasPauta(g, estId, R) {
  if (g && g.modo === 'semestral') return mediasSem(g, estId, R);
  if (g && g.modo === 'descritiva') { const l = (g.notas || {})[estId] || {}; return { macs: null, acp: null, mt: null, completa: !!l.n, nivel: l.n || null }; }
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
  return Object.assign({ colunas, notas }, lerObs(g.obs, estIds));
}
// v5.9: apreciação de cada estudante (escrita pelo professor ou sugerida pela IA), guardada na grelha como obs { estudanteId: texto }
function lerObs(obs, estIds) {
  const o = {};
  if (obs && typeof obs === 'object') for (const [est, t] of Object.entries(obs)) { if (!estIds.has(est)) continue; const v = txt(t, 400); if (v) o[est] = v; }
  return Object.keys(o).length ? { obs: o } : {};
}
const PAUTA_NOVA = () => ({ colunas: [{ id: 'acs1', tipo: 'ACS', nome: 'ACS 1' }, { id: 'acs2', tipo: 'ACS', nome: 'ACS 2' }, { id: 'acs3', tipo: 'ACS', nome: 'ACS 3' }, { id: 'acp', tipo: 'ACP', nome: 'ACP' }], notas: {} });
const trimestreOk = t => [1, 2, 3].includes(Number(t));
async function pautaDe(escola, turma, disciplina, trimestre) {
  const l = await procurar('pauta', [{ key: 'Escola', constraint_type: 'equals', value: escola }, { key: 'Turma', constraint_type: 'equals', value: turma },
    { key: 'Disciplina', constraint_type: 'equals', value: disciplina }, { key: 'Trimestre', constraint_type: 'equals', value: Number(trimestre) }], 1);
  return l[0] || null;
}
// quem dá cada disciplina em cada turma: pelo horário; se a disciplina não tem professor no horário, pelas disciplinas do professor
// ---------- monodocência (v5.4) ----------
const TEMPO_DIA = 99;   // chamada única do dia, feita pelo professor titular
function titularActivo(t, profs) {
  const id = t && t['Professor Titular']; if (!id) return null;
  const p = profs.find(x => x._id === id);
  return p && p['Activo'] !== false ? id : null;
}
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
      // horário manda; sem horário, o titular (primário/escolinha) dá todas; senão, quem tem a disciplina na ficha
      const tit = titularActivo(t, profs);
      let ps = doHorario[d] && doHorario[d].size ? doHorario[d] : tit ? new Set([tit]) : new Set(profs.filter(p => p['Activo'] !== false && (p['Disciplinas'] || []).includes(d)).map(p => p._id));
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
  const desc = ehESC(turma), sem = ehSEM(turma);
  if (Number(tri) > PERIODOS(turma)) { const e = new Error('No ensino superior e técnico há só 2 semestres.'); e.publico = 400; throw e; }
  let grelha = (reg && lerGrelha(reg['Grelha'])) || (desc ? { modo: 'descritiva', notas: {} } : sem ? PAUTA_SEM() : PAUTA_NOVA());
  if (desc && grelha.modo !== 'descritiva') grelha = { modo: 'descritiva', notas: {} };
  if (sem && grelha.modo !== 'semestral') grelha = PAUTA_SEM();
  return { turma: { id: turma._id, nome: turma['Nome'] || '' }, disciplina: { id: disc._id, nome: disc['Nome'] || '', cor: disc['Cor'] || '#0A64DC', creditos: Number(disc['Creditos'] || 0) }, trimestre: Number(tri), modo: desc ? 'descritiva' : sem ? 'semestral' : 'numerica',
    estudantes: ests.map(e => ({ id: e._id, nome: e['Nome'] || '', numero: e['Numero'] || '' })), grelha, publicado: !!(reg && reg['Publicado']),
    actualizado: reg ? (reg['Modified Date'] || null) : null, actualizado_por: reg ? (reg['Actualizado Por'] || '') : '',
    regras: regrasPauta(regrasEsc), ia: !!OPENAI_KEY };
}
async function guardarPauta(req, res, quem) {
  const b = req.body || {};
  if (!trimestreOk(b.trimestre)) return erro(res, 400, 'Escolha o trimestre (1, 2 ou 3).');
  const d = await dadosPauta(req.escola, String(b.turma || ''), String(b.disciplina || ''), b.trimestre);
  const ids = new Set(d.estudantes.map(e => e.id));
  const g = d.modo === 'descritiva' ? validarDescritiva(b.grelha, ids) : d.modo === 'semestral' ? validarSemestral(b.grelha, ids) : validarPauta(b.grelha, ids);
  if (typeof g === 'string') return erro(res, 400, g);
  const campos = { 'Escola': req.escola, 'Turma': d.turma.id, 'Disciplina': d.disciplina.id, 'Trimestre': d.trimestre, 'Grelha': JSON.stringify(g), 'Publicado': !!b.publicado, 'Actualizado Por': quem };
  const reg = await pautaDe(req.escola, d.turma.id, d.disciplina.id, d.trimestre);
  if (reg) await mudar('pauta', reg._id, campos); else await criar('pauta', campos);
  const lancadas = Object.keys(g.notas).length;
  res.json({ ok: true, grelha: g, publicado: !!b.publicado, lancadas, total: d.estudantes.length });
}

// ============================================================
//  IA (v5.9) — apreciações de pauta sugeridas pela OpenAI
//  Render: OPENAI_API_KEY (obrigatório) · OPENAI_MODEL (opcional, por defeito gpt-4o-mini) · IA_LIMITE_MES (opcional, por defeito 100)
//  Bubble, campos novos em Escola: IA Mes (text) · IA Usos (number)  — contam os pedidos de cada escola no mês
//  Privacidade: à OpenAI só vão códigos (E1, E2…), notas, faltas e o nome da disciplina e da turma. Nunca nomes nem telefones.
//  A IA só escreve texto: as notas e as médias continuam a ser calculadas pelo servidor, sem IA.
// ============================================================
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const IA_LIMITE = Math.max(0, Number(process.env.IA_LIMITE_MES === undefined || process.env.IA_LIMITE_MES === '' ? 100 : process.env.IA_LIMITE_MES));
const iaMem = new Map();      // reserva, se os campos IA Mes / IA Usos ainda não existirem no Bubble
const iaAgora = new Set();    // um pedido de IA de cada vez por escola
async function iaReservar(escola) {
  const mes = hojeMZ().data.slice(0, 7);
  const e = await obter('escola', escola).catch(() => null);
  let n = e && e['IA Mes'] === mes ? Number(e['IA Usos'] || 0) : 0;
  const m = iaMem.get(escola); if (m && m.mes === mes) n = Math.max(n, m.n);
  if (n >= IA_LIMITE) throw pub('A escola já usou os ' + IA_LIMITE + ' pedidos de IA deste mês. O limite renova no dia 1.');
  return { mes, n };
}
async function iaContar(escola, u) {
  const n = u.n + 1; iaMem.set(escola, { mes: u.mes, n });
  await mudar('escola', escola, { 'IA Mes': u.mes, 'IA Usos': n }).catch(e => console.log('[ia] contador no Bubble:', String(e.message || e).slice(0, 160)));
  return n;
}
async function openaiJSON(sistema, utilizador, maxTokens) {
  if (!OPENAI_KEY) throw pub('A IA ainda não está ligada. Falta a chave OPENAI_API_KEY no Render.');
  let r, d;
  try {
    r = await fetch(process.env.OPENAI_URL || 'https://api.openai.com/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_MODEL, response_format: { type: 'json_object' }, max_completion_tokens: maxTokens || 4000,
        messages: [{ role: 'system', content: sistema }, { role: 'user', content: utilizador }] }) });
    d = await r.json().catch(() => null);
  } catch (e) { console.log('[ia] sem resposta:', e.message); throw pub('A IA demorou demasiado a responder. Tente de novo.'); }
  if (!r.ok) {
    console.log('[ia]', r.status, JSON.stringify(d).slice(0, 500));
    const m = String((d && d.error && d.error.message) || '');
    throw pub(r.status === 401 ? 'A chave da OpenAI (OPENAI_API_KEY) não é válida.' :
      r.status === 429 ? (/quota|billing|credit/i.test(m) ? 'A conta da OpenAI está sem saldo. Carregue créditos em platform.openai.com.' : 'A OpenAI está com muitos pedidos. Tente daqui a um minuto.') :
      (r.status === 404 || /model/i.test(m)) ? 'O modelo de IA «' + OPENAI_MODEL + '» não está disponível nesta conta (OPENAI_MODEL).' :
      'A IA não respondeu (' + r.status + '). Tente de novo.');
  }
  const t = (d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
  try { return JSON.parse(t); } catch (e) { console.log('[ia] resposta não é JSON:', t.slice(0, 300)); throw pub('A IA respondeu num formato inesperado. Tente de novo.'); }
}
const IA_SISTEMA = 'És um professor experiente de uma escola em Moçambique e escreves as apreciações que acompanham a pauta.\n' +
  'Escreve em português de Moçambique (norma europeia: «trimestre», «actividade», «facto»).\n' +
  'Para cada estudante escreve 1 ou 2 frases, no máximo 220 caracteres, com base APENAS nos dados recebidos.\n' +
  'Regras:\n' +
  '- Tom profissional, construtivo e encorajador. Se há negativas ou muitas faltas, diz com clareza e indica uma coisa concreta a melhorar.\n' +
  '- Não inventes nada que não esteja nos dados (comportamento, família, participação, atitudes).\n' +
  '- Não escrevas nomes nem «o aluno», «a aluna» ou «a criança». Começa com um verbo ou expressão neutra (ex.: «Revela…», «Demonstra…», «Precisa de…», «Bom trimestre:…») e evita adjectivos com género (aplicado/a, esforçado/a).\n' +
  '- Não repitas números de notas; descreve o desempenho.\n' +
  '- Varia a forma das frases de estudante para estudante.\n' +
  'Responde só com JSON no formato {"apreciacoes":{"E1":"texto","E2":"texto"}}, com uma entrada para cada código recebido.';
const IA_ESCOLINHA = '\nNesta turma (escolinha/pré-escolar) as áreas são avaliadas como Adquirido, Em aquisição ou Não adquirido. Escreve para os pais, com linguagem simples e carinhosa, e sugere uma actividade simples para casa quando a área está em aquisição ou não adquirida.';
async function iaApreciacoes(req, res) {
  const b = req.body || {};
  if (!trimestreOk(b.trimestre)) return erro(res, 400, 'Escolha o trimestre.');
  if (iaAgora.has(req.escola)) return erro(res, 429, 'Já há um pedido de IA a ser preparado. Espere uns segundos.');
  iaAgora.add(req.escola);
  try {
    const d = await dadosPauta(req.escola, String(b.turma || ''), String(b.disciplina || ''), b.trimestre);
    const ids = new Set(d.estudantes.map(e => e.id));
    const g = d.modo === 'descritiva' ? validarDescritiva(b.grelha, ids) : d.modo === 'semestral' ? validarSemestral(b.grelha, ids) : validarPauta(b.grelha, ids);
    if (typeof g === 'string') return erro(res, 400, g);
    const R = d.regras, todas = b.todas === true;
    // faltas de cada estudante nesta disciplina (ou na chamada do dia), em todo o ano
    let faltas = {};
    try {
      const fx = await procurarTodos('falta', daEscola(req.escola).concat([{ key: 'Turma', constraint_type: 'equals', value: d.turma.id }]), 20000);
      fx.filter(x => (x['Tipo'] || 'F') === 'F' && (x['Disciplina'] === d.disciplina.id || Number(x['Tempo']) === TEMPO_DIA)).forEach(x => { faltas[x['Estudante']] = (faltas[x['Estudante']] || 0) + 1; });
    } catch (e) { faltas = {}; }
    const ESTADOS = { dispensado: 'dispensado do exame', excluido: 'excluído (frequência insuficiente)', admitido: 'admitido a exame', aprovado: 'aprovado', recorrencia: 'vai à recorrência', reprovado: 'reprovado' };
    const alvo = [];
    d.estudantes.forEach(e => {
      const ja = d.modo === 'descritiva' ? ((g.notas[e.id] || {}).o || '') : ((g.obs || {})[e.id] || '');
      if (ja && !todas) return;
      const l = g.notas[e.id] || {}, x = { faltas: faltas[e.id] || 0 };
      if (d.modo === 'descritiva') { if (!l.n) return; x.nivel = NIVEIS_DESC[l.n]; }
      else if (d.modo === 'semestral') {
        const m = mediasSem(g, e.id, R); if (m.freq === null) return;
        x.avaliacoes = g.colunas.filter(c => c.tipo === 'F' && typeof l[c.id] === 'number').map(c => c.nome + ': ' + l[c.id]);
        x.frequencia = m.freq; if (m.exame !== null) x.exame = m.exame; if (m.recorrencia !== null) x.recorrencia = m.recorrencia; if (m.final !== null) x.final = m.final; x.situacao = ESTADOS[m.estado] || m.estado;
      } else {
        const m = mediasPauta(g, e.id); if (m.mt === null) return;
        x.avaliacoes = g.colunas.filter(c => typeof l[c.id] === 'number').map(c => c.nome + ': ' + l[c.id]);
        x.media_trimestre = m.mt; x.situacao = !m.completa ? 'notas ainda parciais' : Math.round(m.mt) >= R.aprovacao ? 'positiva' : 'negativa';
      }
      alvo.push({ id: e.id, x });
    });
    if (!alvo.length) {
      const algum = d.estudantes.some(e => d.modo === 'descritiva' ? (g.notas[e.id] || {}).n : Object.keys(g.notas[e.id] || {}).length);
      return erro(res, 400, !algum ? 'Lance primeiro as notas: a IA escreve as apreciações a partir delas.' : 'Todos os estudantes com notas já têm apreciação. Use «Reescrever todas» para pedir novas.');
    }
    const uso = await iaReservar(req.escola);
    const periodo = d.modo === 'semestral' ? d.trimestre + 'º semestre' : d.trimestre + 'º trimestre';
    const sistema = IA_SISTEMA + (d.modo === 'descritiva' ? IA_ESCOLINHA : '');
    const out = {};
    for (let i = 0; i < alvo.length; i += 35) {     // turmas grandes vão em partes
      const parte = alvo.slice(i, i + 35);
      const dados = { disciplina: d.disciplina.nome, turma: d.turma.nome, periodo,
        escala: d.modo === 'descritiva' ? 'Adquirido / Em aquisição / Não adquirido' : 'notas de 0 a 20; positiva a partir de ' + R.aprovacao,
        estudantes: Object.fromEntries(parte.map((a, k) => ['E' + (i + k + 1), a.x])) };
      const j = await openaiJSON(sistema, JSON.stringify(dados), 150 * parte.length + 400);
      const ap = (j && j.apreciacoes) || {};
      parte.forEach((a, k) => { const t = txt(ap['E' + (i + k + 1)], 400); if (t) out[a.id] = t; });
    }
    if (!Object.keys(out).length) return erro(res, 502, 'A IA não devolveu apreciações. Tente de novo.');
    const usados = await iaContar(req.escola, uso);
    res.json({ ok: true, apreciacoes: out, pedidos: alvo.length, feitas: Object.keys(out).length, usados, limite: IA_LIMITE });
  } finally { iaAgora.delete(req.escola); }
}
app.post('/prof/ia-apreciacoes', exigeProfessor, rota(async (req, res) => {
  const b = req.body || {};
  if (!await podeLancar(req, String(b.turma || ''), String(b.disciplina || ''))) return erro(res, 403, 'Não dá esta disciplina nesta turma. Fale com a Direcção.');
  await iaApreciacoes(req, res);
}));
app.post('/ia-apreciacoes', exigeDireccao, rota(iaApreciacoes));

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
    turmas: meus.map(p => ({ turma: p.turma, turma_nome: TM[p.turma]['Nome'] || '', esc: ehESC(TM[p.turma]), sem: ehSEM(TM[p.turma]), disciplina: p.disciplina, disciplina_nome: DM[p.disciplina]['Nome'] || '', cor: DM[p.disciplina]['Cor'] || '#0A64DC',
      estudantes: ests.filter(e => e['Turma'] === p.turma && (e['Estado'] || 'activo') === 'activo').length }))
      .sort((x, y) => x.turma_nome.localeCompare(y.turma_nome, 'pt') || x.disciplina_nome.localeCompare(y.disciplina_nome, 'pt')),
    aulas,
    titular: a.turmas.filter(t => t['Activa'] !== false && t['Professor Titular'] === req.sessao.u).map(t => ({ turma: t._id, turma_nome: t['Nome'] || '', esc: ehESC(t),
      estudantes: ests.filter(e => e['Turma'] === t._id && (e['Estado'] || 'activo') === 'activo').length, chamada: hoje.dia !== 0 && feitas.includes(t._id + '|' + TEMPO_DIA) }))
      .sort((x, y) => x.turma_nome.localeCompare(y.turma_nome, 'pt')),
    conducao: await praticasDoInstrutor(req.escola, req.sessao.u).catch(err => { console.error('[prof] condução', err.message); return null; }),
    codigo: (escRaw['Niveis'] || []).includes(NIVEIS.CON),
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
  const R = regrasPauta(esc), semT = ehSEM(turma);
  if (tri > PERIODOS(turma)) return erro(res, 400, 'No ensino superior e técnico há só 2 semestres.');
  res.json({ ok: true, turma: { id: turma._id, nome: turma['Nome'] || '' }, trimestre: tri,
    regras: regrasPauta(esc),
    disciplinas: lista.map(d => ({ id: d.id, nome: d.nome, cor: d.cor, creditos: Number(DM[d.id]['Creditos'] || 0), professores: d.professores, existe: d.existe, publicado: d.publicado, actualizado_por: d.actualizado_por,
      lancadas: d.grelha ? Object.keys(d.grelha.notas || {}).length : 0 })),
    estudantes: activos.map(e => ({ id: e._id, nome: e['Nome'] || '', numero: e['Numero'] || '',
      medias: Object.fromEntries(lista.map(d => [d.id, d.grelha ? (d.grelha.modo === 'descritiva' ? (mediasPauta(d.grelha, e._id).nivel) : mediasPauta(d.grelha, e._id, R).mt) : null])),
      estados: semT ? Object.fromEntries(lista.map(d => [d.id, d.grelha && d.grelha.modo === 'semestral' ? mediasSem(d.grelha, e._id, R).estado : null])) : undefined })),
    modo: ehESC(turma) ? 'descritiva' : semT ? 'semestral' : 'numerica', periodos: PERIODOS(turma) });
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
    if (g.modo === 'semestral') {
      if (!cache.R) cache.R = regrasPauta(await resumoEscola(escola));
      const m2 = mediasSem(g, est._id, cache.R);
      o.semestral = true; o.creditos = Number(d['Creditos'] || 0);
      o.trimestres[Number(p['Trimestre'])] = { semestral: true, colunas: g.colunas.filter(c => c.tipo === 'F').map(c => ({ nome: c.nome, nota: typeof linha[c.id] === 'number' ? linha[c.id] : null })),
        freq: m2.freq, exame: m2.exame, recorrencia: m2.recorrencia, final: m2.final, estado: m2.estado, aprovado: !!m2.aprovado, mt: m2.final, completa: m2.completa, obs: (g.obs || {})[est._id] || '' };
      continue;
    }
    if (g.modo === 'descritiva') { o.descritiva = true; o.trimestres[Number(p['Trimestre'])] = { descritiva: true, nivel: linha.n || null, nivel_nome: NIVEIS_DESC[linha.n] || '', obs: linha.o || '' }; continue; }
    o.trimestres[Number(p['Trimestre'])] = { colunas: g.colunas.map(c => ({ nome: c.nome, tipo: c.tipo, nota: typeof linha[c.id] === 'number' ? linha[c.id] : null })), macs: m.macs, acp: m.acp, mt: m.mt, completa: m.completa, obs: (g.obs || {})[est._id] || '' };
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
  if (Number(tempo) === TEMPO_DIA) {
    if (diaDaSemana(data) === 0) return null;   // domingo
    const t = await obter('turma', turmaId).catch(() => null);
    if (!t || t['Escola'] !== escola || !t['Professor Titular']) return null;
    return { disciplina: '', professor: t['Professor Titular'], i: '', f: '', dia: true };
  }
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
  if (!aula) { const e = new Error(Number(tempo) === TEMPO_DIA ? 'Esta turma não tem professor titular, ou o dia é domingo.' : 'Não há aula desta turma nesse dia e tempo no horário.'); e.publico = 404; throw e; }
  const [disc, ests, ch] = await Promise.all([aula.dia ? null : obter('disciplina', aula.disciplina).catch(() => null),
    procurarTodos('estudante', [{ key: 'Escola', constraint_type: 'equals', value: escola }, { key: 'Turma', constraint_type: 'equals', value: turmaId }]), chamadaDe(escola, turmaId, data, tempo)]);
  const faltas = ch ? await procurarTodos('falta', [{ key: 'Escola', constraint_type: 'equals', value: escola }, { key: 'Chamada', constraint_type: 'equals', value: ch._id }]) : [];
  return { turma: { id: turma._id, nome: turma['Nome'] || '' }, data, tempo: Number(tempo), i: aula.i, f: aula.f, professor: aula.professor,
    dia: !!aula.dia, disciplina: { id: aula.disciplina, nome: aula.dia ? 'Chamada do dia' : ((disc && disc['Nome']) || ''), cor: (disc && disc['Cor']) || '#0A64DC' },
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
      const r = await smsEscola(req.escola, [enc['Telefone']], (esc['Nome'] || 'Escola') + ': ' + est['Nome'] + (d.dia ? ' faltou hoje as aulas' : ' faltou hoje a ' + d.disciplina.nome + ' (' + d.i + ')') + '. Se a falta tiver justificacao, contacte a escola.');
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
  if (d.professor !== req.sessao.u) return erro(res, 403, d.dia ? 'Não é o professor titular desta turma.' : 'Esta aula não é sua no horário.');
  res.json({ ok: true, chamada: d });
}));
app.post('/prof/chamada-guardar', exigeProfessor, rota(async (req, res) => {
  const b = req.body || {};
  if (!dataOk(b.data)) return erro(res, 400, 'Data inválida.');
  if (b.data > hojeMZ().data) return erro(res, 400, 'Não pode fazer a chamada de um dia que ainda não chegou.');
  if (b.data < hojeMZ(-14).data) return erro(res, 400, 'Só pode corrigir chamadas dos últimos 14 dias. Para datas anteriores, fale com a Direcção.');
  const aula = await aulaDoHorario(req.escola, String(b.turma || ''), b.data, b.tempo);
  if (!aula || aula.professor !== req.sessao.u) return erro(res, 403, Number(b.tempo) === TEMPO_DIA ? 'Não é o professor titular desta turma.' : 'Esta aula não é sua no horário.');
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
  if (dia !== 0) for (const t of Object.values(TM)) {
    if (!t['Professor Titular']) continue;
    const ch = chs.find(c => c['Turma'] === t._id && Number(c['Tempo']) === TEMPO_DIA);
    const fx = ch ? fs.filter(x => x['Chamada'] === ch._id) : [];
    aulas.push({ turma: t._id, turma_nome: t['Nome'] || '', tempo: TEMPO_DIA, dia: true, i: '', f: '', disciplina: 'Chamada do dia', cor: '#5B6B82',
      professor: PM[t['Professor Titular']] || '', feita: !!ch, faltas: fx.filter(x => x['Tipo'] === 'F').length, atrasos: fx.filter(x => x['Tipo'] === 'A').length, sumario: ch ? (ch['Sumario'] || '') : '' });
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
        lista: m.sort((a, b) => String(b['Data']).localeCompare(String(a['Data'])) || Number(b['Tempo']) - Number(a['Tempo'])).map(x => ({ id: x._id, data: x['Data'], tempo: Number(x['Tempo']), disciplina: Number(x['Tempo']) === TEMPO_DIA ? 'Chamada do dia' : (DM[x['Disciplina']] || ''), tipo: x['Tipo'] || 'F' })) };
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
  return fs.map(x => ({ data: x['Data'], tempo: Number(x['Tempo']), disciplina: Number(x['Tempo']) === TEMPO_DIA ? 'Chamada do dia' : ((cache.discAll[x['Disciplina']] || {})['Nome'] || ''), tipo: x['Tipo'] || 'F' }))
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
  // uma tabela em falta no Bubble não deita o painel abaixo: conta como vazia e avisa
  const faltam = new Set();
  const seg = (p, t, vazio) => p.catch(e => { console.error('[painel] ' + t + ':', e.message); faltam.add(e.tabela || nomeTabela(t)); return vazio || []; });
  const [escola, ests, turmas, props, pags, chsHoje, faltas, pautas, a, discs] = await Promise.all([
    resumoEscola(req.escola), seg(procurarTodos('estudante', f), 'estudante'), seg(procurarTodos('turma', f), 'turma'), seg(procurarTodos('propina', f, 20000), 'propina'), seg(procurarTodos('pagamento', f, 20000), 'pagamento'),
    seg(procurarTodos('chamada', f.concat([{ key: 'Data', constraint_type: 'equals', value: hoje.data }])), 'chamada'), seg(procurarTodos('falta', f, 20000), 'falta'), seg(procurarTodos('pauta', f, 5000), 'pauta'),
    seg(atribuicoes(req.escola), 'horario', { turmas: [], profs: [], hs: [], pares: [] }), seg(procurarTodos('disciplina', f), 'disciplina')]);
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
  if (hoje.dia >= 1 && hoje.dia <= 5) for (const t of a.turmas) {
    if (t['Activa'] === false || !titularActivo(t, a.profs)) continue;
    aulasHoje.push({ turma: t['Nome'] || '', turma_id: t._id, tempo: TEMPO_DIA, dia: true, i: '08:00', f: '', disciplina: 'Chamada do dia', professor: PM[t['Professor Titular']] || '',
      feita: chsHoje.some(c => c['Turma'] === t._id && Number(c['Tempo']) === TEMPO_DIA) });
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

  const d = { ok: true, faltam: [...faltam], gerado: new Date().toISOString(), hoje: hoje.data, dia: hoje.dia, mes,
    dinheiro: { recebido_mes: doMes.reduce((x, p) => x + Number(p['Valor'] || 0), 0), recebido_hoje: pagos.filter(p => dataMZ(p['Pago Em']) === hoje.data).reduce((x, p) => x + Number(p['Valor'] || 0), 0),
      pagamentos_mes: doMes.length, em_atraso: atraso, multas, a_vencer: aVencer, estudantes_atraso: Object.keys(divida).length, por_metodo: porMetodo, serie, devedores, ultimos },
    hoje_aulas: { total: aulasHoje.length, feitas: aulasHoje.filter(x => x.feita).length, por_fazer: atrasadas.slice(0, 8), faltas: fx.filter(x => x['Data'] === hoje.data && x['Tipo'] === 'F').length },
    faltas: { semana: fx.filter(x => x['Data'] >= d7 && x['Tipo'] === 'F').length, mes: fx.filter(x => x['Data'] >= d30 && x['Tipo'] === 'F').length, por_dia: porDia, mais_faltas: maisFaltas },
    notas: { trimestre: tri, pares: pares.length, com_notas: comNotas,
      publicadas: pt.filter(x => x['Publicado']).length, aproveitamento, sem_notas: Object.values(semNotas).sort((x, y) => y.pendentes.length - x.pendentes.length).slice(0, 8) },
    estudantes: activos.length };
  if ((escola && escola.niveis || []).includes('CON')) {
    const [vs, aps, ins] = await Promise.all([seg(procurarTodos('viatura', f), 'viatura'), seg(procurarTodos('aulapratica', f, 20000), 'aulapratica'), seg(procurarTodos('inscricaoconducao', f), 'inscricaoconducao')]);
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
//          TAXA_PROPINAS_PCT (opcional, % que o Gescolar retém de cada pagamento online; por defeito 7)
//          PRECO_ESSENCIAL, PRECO_PRO (opcionais, MT por mês; por defeito 4900 e 12500)
// ============================================================
const PRECOS = { Essencial: Number(process.env.PRECO_ESSENCIAL || 4900), Pro: Number(process.env.PRECO_PRO || 12500), Rede: 0 };
const LIMITES = { Essencial: 300, Pro: 1000, Rede: 0 };
// v5.13: pagar vários meses de uma vez tem desconto (por defeito 30% em 3, 6 e 12 meses). Render: ASSINATURA_DESCONTO (opcional, %)
const DESCONTO_ASS = Math.max(0, Math.min(90, Number(process.env.ASSINATURA_DESCONTO === undefined || process.env.ASSINATURA_DESCONTO === '' ? 30 : process.env.ASSINATURA_DESCONTO)));
const PERIODOS_ASS = [{ meses: 1, desconto: 0 }, { meses: 3, desconto: DESCONTO_ASS }, { meses: 6, desconto: DESCONTO_ASS }, { meses: 12, desconto: DESCONTO_ASS }];
const valorAssinatura = (plano, meses) => { const p = PERIODOS_ASS.find(x => x.meses === meses) || PERIODOS_ASS[0]; return limpa(PRECOS[plano] * meses * (100 - p.desconto) / 100); };
const TAXA_PROPINAS = Math.max(0, Math.min(50, Number(process.env.TAXA_PROPINAS_PCT === undefined || process.env.TAXA_PROPINAS_PCT === '' ? 7 : process.env.TAXA_PROPINAS_PCT)));   // 7% por defeito em cada pagamento online
// 5.8.6: a taxa é exactamente TAXA_PROPINAS% do valor, sem arredondar (ex.: 15 MT → 1,05 MT; 10,55 MT → 0,7385 MT).
// limpa() só tira o ruído das contas em vírgula flutuante (1.0500000000000003 → 1.05), não arredonda os meticais.
const limpa = n => Number(Number(n || 0).toFixed(6));
const taxaDe = v => limpa(Number(v || 0) * TAXA_PROPINAS / 100);
// Valores em meticais escritos à mão: até 2 casas decimais, com vírgula ou ponto. Nunca arredonda.
const valorMT = x => { const t = String(x == null ? '' : x).replace(/\s/g, '').replace(',', '.'); return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : NaN; };
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
    planos: Object.keys(PRECOS).map(k => ({ nome: k, preco: PRECOS[k], limite: LIMITES[k] })), periodos: PERIODOS_ASS,
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
  const valor = valorAssinatura(plano, meses), numero = soDigitos(b.numero).replace(/^258(?=\d{9}$)/, '');
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
    const c2b = await iniciarC2B(metodo, valor, numero, (e['Nome'] || 'Escola').slice(0, 80), 'Gescolar ' + plano);
    await mudar('subscricao', id, { 'Referencia': c2b.ref, 'Raw': JSON.stringify(c2b.raw).slice(0, 4000) });
    res.json({ ok: true, id, total: valor, iframe: c2b.iframe, embed: c2b.embed, mensagem: msgC2B(c2b, numero) });
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

// ---------- SMS da escola: saldo e recargas (v5.25) ----------
const recargaOut = x => ({ id: x._id, data: x['Pago Em'] || x['Created Date'] || null, pacote: x['Pacote'] || '', sms: Number(x['SMS'] || 0), valor: Number(x['Valor'] || 0),
  metodo: x['Metodo'] || '', estado: x['Estado'] || 'pendente', por: x['Feita Por'] || '' });
app.post('/sms-saldo', exigeDireccao, rota(async (req, res) => {
  const [e, recs] = await Promise.all([obter('escola', req.escola), procurarTodos('recargasms', daEscola(req.escola), 300).catch(() => [])]);
  res.json({ ok: true, creditos: creditosDe(e), usados: Number(e['SMS Usados'] || 0), iniciais: SMS_INICIAIS, poucos: SMS_POUCOS, pacotes: SMS_PACOTES,
    email: RESEND_KEY && MAIL_FROM ? 'resend' : 'bubble', email_escola: e['Email'] || '',
    historico: recs.map(recargaOut).sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))) });
}));
app.post('/sms-recarregar', exigeSoDireccao, rota(async (req, res) => {
  const b = req.body || {}, metodo = String(b.metodo || '').toLowerCase();
  const pac = SMS_PACOTES.find(p => p.id === String(b.pacote));
  if (!pac) return erro(res, 400, 'Escolha um pacote de SMS.');
  if (!['mpesa', 'emola', 'cartao'].includes(metodo)) return erro(res, 400, 'Escolha M-Pesa, e-Mola ou cartão.');
  if (!MOZ_WALLET) return erro(res, 500, 'O servidor ainda não tem a carteira configurada (MOZ_WALLET).');
  const numero = soDigitos(b.numero).replace(/^258(?=\d{9}$)/, '');
  if (metodo !== 'cartao') {
    if (numero.length !== 9) return erro(res, 400, 'O número tem 9 dígitos, por exemplo 84 123 4567.');
    const pre = numero.slice(0, 2);
    if (metodo === 'mpesa' && !['84', '85'].includes(pre)) return erro(res, 400, 'M-Pesa só funciona com números Vodacom (84 ou 85).');
    if (metodo === 'emola' && !['86', '87'].includes(pre)) return erro(res, 400, 'e-Mola só funciona com números Movitel (86 ou 87).');
  }
  const e = await obter('escola', req.escola);
  const id = await criar('recargasms', { 'Escola': req.escola, 'Pacote': pac.sms + ' SMS', 'SMS': pac.sms, 'Valor': pac.valor, 'Metodo': metodo, 'Telefone': numero, 'Estado': 'pendente' });
  try {
    if (metodo === 'cartao') {
      const d = await mozPedido(MOZ_CARD_PATH, { valor: String(pac.valor), nome_cliente: (e['Nome'] || 'Escola').slice(0, 80), carteira: MOZ_WALLET, nome_producto: ('Gescolar ' + pac.sms + ' SMS · ' + (e['Nome'] || '')).slice(0, 120) });
      const link = acharLink(d);
      if (!link) throw new Error('sem link na resposta: ' + JSON.stringify(d).slice(0, 220));
      await mudar('recargasms', id, { 'Referencia': String(achar(d, ['session_id', 'sessionId', 'session']) || sessionDoLink(link) || ''), 'Raw': JSON.stringify(d).slice(0, 4000) });
      return res.json({ ok: true, id, link, total: pac.valor, sms: pac.sms });
    }
    const c2b = await iniciarC2B(metodo, pac.valor, numero, (e['Nome'] || 'Escola').slice(0, 80), 'Gescolar SMS');
    await mudar('recargasms', id, { 'Referencia': c2b.ref, 'Raw': JSON.stringify(c2b.raw).slice(0, 4000) });
    res.json({ ok: true, id, total: pac.valor, sms: pac.sms, iframe: c2b.iframe, embed: c2b.embed, mensagem: msgC2B(c2b, numero) });
  } catch (err) {
    console.error('[sms-recarga]', err.message);
    await mudar('recargasms', id, { 'Estado': 'falhado', 'Raw': String(err.message).slice(0, 2000) }).catch(() => {});
    erro(res, 502, 'A MozPayment não aceitou o pedido: ' + String(err.message).slice(0, 300));
  }
}));
app.post('/sms-recarga-estado', exigeDireccao, rota(async (req, res) => {
  const x = await daMinhaEscola('recargasms', String((req.body || {}).id || ''), req.escola);
  const e = x['Estado'] === 'pago' ? await obter('escola', req.escola).catch(() => null) : null;
  res.json({ ok: true, estado: x['Estado'] || 'pendente', sms: Number(x['SMS'] || 0), valor: Number(x['Valor'] || 0), creditos: e ? creditosDe(e) : null });
}));
// chamado pelo webhook quando a referência é de uma recarga de SMS
async function aplicarRecargaSMS(x, b, estado) {
  if (x['Estado'] === 'pago') return { ok: true, ja: 'aplicado' };
  const raw = JSON.stringify(b).slice(0, 4000), trx = txt(b.transaction_id, 120);
  const valor = Math.round(Number(String(b.amount || '').replace(',', '.')));
  if (estado === 'pago' && valor !== Math.round(Number(x['Valor'] || 0))) { await mudar('recargasms', x._id, { 'Estado': 'revisao', 'Transacao': trx, 'Raw': raw }); return { ok: true, revisao: true }; }
  if (estado !== 'pago') { await mudar('recargasms', x._id, { 'Estado': estado, 'Transacao': trx, 'Raw': raw }); return { ok: true, estado }; }
  await mudar('recargasms', x._id, { 'Estado': 'pago', 'Transacao': trx, 'Raw': raw, 'Pago Em': new Date().toISOString() });
  const m = await mexerCreditos(x['Escola'], Number(x['SMS'] || 0), 0);
  console.log('[sms-recarga] ' + x['Escola'] + ' +' + x['SMS'] + ' → ' + m.depois);
  return { ok: true, estado: 'pago', creditos: m.depois };
}
// Plataforma: dar ou tirar SMS à mão, e aprovar recargas em revisão
app.post('/pl/sms-dar', exigePlataforma, rota(async (req, res) => {
  const b = req.body || {}, n = Math.trunc(Number(b.sms));
  if (!n || Math.abs(n) > 100000) return erro(res, 400, 'Escreva quantos SMS (por exemplo 100, ou -20 para tirar).');
  const e = await obter('escola', String(b.escola || ''));
  if (!e) return erro(res, 404, 'Escola não encontrada.');
  const quem = txt(b.por, 80) || 'Plataforma';
  if (n > 0) await criar('recargasms', { 'Escola': e._id, 'Pacote': 'Atribuído à mão', 'SMS': n, 'Valor': Math.max(0, Number(String(b.valor || 0).replace(',', '.')) || 0), 'Metodo': METODOS_MANUAIS[b.metodo] ? b.metodo : 'oferta',
    'Estado': 'pago', 'Pago Em': new Date().toISOString(), 'Feita Por': quem, 'Raw': JSON.stringify({ manual: true, notas: txt(b.notas, 300) }) }).catch(err => console.error('[pl/sms-dar] registo', err.message));
  const m = await mexerCreditos(e._id, n, 0);
  if (b.avisar && n > 0 && emailOk(String(e['Email'] || '').toLowerCase())) {
    const blocos = [{ p: 'Foram adicionados ' + n + ' SMS à conta de ' + (e['Nome'] || 'a escola') + '. Saldo actual: ' + m.depois + ' SMS.' }];
    enviarEmail(e['Email'], 'Gescolar: ' + n + ' SMS adicionados', emailGescolar(e['Nome'], 'SMS adicionados', blocos), textoDeBlocos('SMS adicionados', blocos)).catch(() => {});
  }
  res.json({ ok: true, creditos: m.depois });
}));
app.post('/pl/sms-recargas', exigePlataforma, rota(async (req, res) => {
  const [recs, escolas] = await Promise.all([procurarTodos('recargasms', [], 20000).catch(() => []), procurarTodos('escola', [], 5000)]);
  const EN = Object.fromEntries(escolas.map(e => [e._id, e['Nome'] || '']));
  res.json({ ok: true, pacotes: SMS_PACOTES, recargas: recs.map(x => Object.assign(recargaOut(x), { escola: x['Escola'], escola_nome: EN[x['Escola']] || '' })).sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))) });
}));
app.post('/pl/sms-aprovar', exigePlataforma, rota(async (req, res) => {
  const x = await obter('recargasms', String((req.body || {}).id || ''));
  if (!x) return erro(res, 404, 'Recarga não encontrada.');
  if (x['Estado'] === 'pago') return erro(res, 409, 'Esta recarga já foi aplicada.');
  await mudar('recargasms', x._id, { 'Estado': 'pago', 'Pago Em': new Date().toISOString(), 'Feita Por': 'Plataforma (aprovada)' });
  const m = await mexerCreditos(x['Escola'], Number(x['SMS'] || 0), 0);
  res.json({ ok: true, creditos: m.depois });
}));

// ---------- área da plataforma ----------
function exigePlataforma(req, res, next) {
  const s = sessaoDo(req);
  if (!s) return erro(res, 401, 'A sessão terminou. Entre outra vez.');
  if (s.pl !== 1 && s.p !== 'Plataforma') return erro(res, 403, 'Só a equipa do Gescolar tem acesso.');
  req.sessao = s; next();
}
const ONLINE = m => ['mpesa', 'emola', 'cartao'].includes(String(m || '').toLowerCase());
app.post('/pl/resumo', exigePlataforma, rota(async (req, res) => {
  const [escolas, pags, subs, trs0, ests, insc, users] = await Promise.all([procurarTodos('escola', [], 5000), procurarTodos('pagamento', [], 50000), procurarTodos('subscricao', [], 20000), procurarTodos('transferencia', [], 20000), procurarTodos('estudante', [], 100000),
    procurarTodos('inscricaoonline', [], 50000).catch(() => []), procurarTodos('user', [], 20000).catch(() => [])]);
  const acessoEsc = {};
  users.forEach(u => { const e = u['Escola'], t = u['Ultimo Acesso']; if (e && t && String(t) > String(acessoEsc[e] || '')) acessoEsc[e] = t; });
  const trs = trs0.filter(t => contaTransf(t) && t['Estado'] !== 'pedido');
  const pedidos = trs0.filter(t => t['Estado'] === 'pedido');
  const lista = escolas.map(e => {
    const online = pags.filter(p => p['Escola'] === e._id && p['Estado'] === 'pago' && ONLINE(p['Metodo']));
    const insE = insc.filter(i => i['Escola'] === e._id && ['paga', 'matriculada'].includes(i['Estado']) && ONLINE(i['Metodo']));
    const bruto = online.reduce((x, p) => x + Number(p['Valor'] || 0), 0) + insE.reduce((x, i) => x + Number(i['Valor'] || 0), 0), taxa = taxaDe(bruto);
    const transferido = trs.filter(t => t['Escola'] === e._id).reduce((x, t) => x + Number(t['Valor'] || 0), 0);
    const assin = subs.filter(x => x['Escola'] === e._id && x['Estado'] === 'pago');
    return { id: e._id, nome: e['Nome'] || '', subdominio: e['Subdominio'] || '', cidade: e['Cidade'] || '', provincia: e['Provincia'] || '', telefone: e['Telefone'] || '', email: e['Email'] || '', nuit: e['NUIT'] || '',
      plano: e['Plano'] || '', situacao: situacaoEscola(e), criada: e['Created Date'] || null,
      estudantes: ests.filter(x => x['Escola'] === e._id && (x['Estado'] || 'activo') === 'activo').length,
      propinas_online: limpa(bruto), taxa, transferido: limpa(transferido), saldo: limpa(bruto - taxa - transferido), pagamentos: online.length + insE.length,
      saques_pedidos: pedidos.filter(t => t['Escola'] === e._id).reduce((x, t) => x + Number(t['Valor'] || 0), 0),
      assinaturas: assin.reduce((x, s2) => x + Number(s2['Valor'] || 0), 0), ultimo_pagamento: online.map(p => p['Pago Em']).sort().pop() || null,
      presenca: (function () { const pr = presencaDe(e._id); const a = acessoEsc[e._id] || null; if (a && (!pr.ultimo || String(a) > pr.ultimo)) pr.ultimo = a; return pr; })(),
      subs_pendentes: subs.filter(x => x['Escola'] === e._id && ['pendente', 'revisao'].includes(x['Estado'])).length, sms: creditosDe(e), sms_usados: Number(e['SMS Usados'] || 0) };
  }).sort((a, b) => b.saldo - a.saldo || a.nome.localeCompare(b.nome, 'pt'));
  const mes = new Date().toISOString().slice(0, 7);
  res.json({ ok: true, taxa_pct: TAXA_PROPINAS, precos: PRECOS, escolas: lista,
    totais: { escolas: lista.length, activas: lista.filter(x => ['activa', 'tolerancia'].includes(x.situacao.estado)).length, teste: lista.filter(x => x.situacao.estado === 'teste').length,
      estudantes: lista.reduce((x, e) => x + e.estudantes, 0), a_transferir: limpa(lista.reduce((x, e) => x + Math.max(0, e.saldo), 0)),
      propinas_online: limpa(lista.reduce((x, e) => x + e.propinas_online, 0)), assinaturas: lista.reduce((x, e) => x + e.assinaturas, 0),
      assinaturas_mes: subs.filter(x => x['Estado'] === 'pago' && String(x['Pago Em'] || '').slice(0, 7) === mes).reduce((x, s2) => x + Number(s2['Valor'] || 0), 0),
      a_expirar: lista.filter(x => ['activa', 'teste'].includes(x.situacao.estado) && x.situacao.dias != null && x.situacao.dias <= 7).length,
      expiradas: lista.filter(x => ['expirada', 'tolerancia'].includes(x.situacao.estado)).length,
      suspensas: lista.filter(x => x.situacao.estado === 'suspensa').length,
      mensal: lista.filter(x => ['activa', 'tolerancia'].includes(x.situacao.estado)).reduce((x, e) => x + (PRECOS[e.plano] || 0), 0),
      online_escolas: lista.filter(x => x.presenca.online > 0).length, online_pessoas: lista.reduce((x, e) => x + e.presenca.online, 0), online_min: ONLINE_MIN,
      revisao: subs.filter(x => x['Estado'] === 'revisao').length } });
}));
app.post('/pl/escola', exigePlataforma, rota(async (req, res) => {
  const id = String((req.body || {}).id || '');
  const e = await obter('escola', id);
  if (!e) return erro(res, 404, 'Escola não encontrada.');
  const f = daEscola(id);
  const [pags, subs, trs, ests] = await Promise.all([procurarTodos('pagamento', f, 20000), procurarTodos('subscricao', f, 500), procurarTodos('transferencia', f, 2000), procurarTodos('estudante', f)]);
  const EM = Object.fromEntries(ests.map(x => [x._id, x['Nome']]));
  const movimentos = pags.filter(p => p['Estado'] === 'pago' && ONLINE(p['Metodo'])).map(p => ({ tipo: 'entrada', data: p['Pago Em'], valor: Number(p['Valor'] || 0), taxa: taxaDe(p['Valor']),
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
  if (b.mais_dias_teste) {   // v5.24: prolongar o período de teste
    const n = Math.max(1, Math.min(90, Number(b.mais_dias_teste) || 7)), t0 = e['Teste Ate'] && new Date(e['Teste Ate']).getTime() > Date.now() ? new Date(e['Teste Ate']) : new Date();
    t0.setUTCDate(t0.getUTCDate() + n); mud['Teste Ate'] = t0.toISOString(); if (!e['Valida Ate'] && e['Estado'] !== 'suspensa') mud['Estado'] = 'teste';
  }
  if (!Object.keys(mud).length) return erro(res, 400, 'Nada para guardar.');
  if (mud['Valida Ate'] && !mud['Estado'] && e['Estado'] !== 'suspensa') mud['Estado'] = 'activa';
  await mudar('escola', e._id, mud);
  if (b.sms && mud['Estado'] && tel9(e['Telefone']).length === 9) {
    const txtSms = mud['Estado'] === 'suspensa' ? 'Gescolar: o acesso de ' + (e['Nome'] || 'a escola') + ' foi suspenso. Fale connosco para regularizar a subscricao.'
      : mud['Estado'] === 'activa' && e['Estado'] === 'suspensa' ? 'Gescolar: o acesso de ' + (e['Nome'] || 'a escola') + ' foi reactivado.' : '';
    if (txtSms) enviarSMS([e['Telefone']], txtSms).catch(() => {});
  }
  cachePainel.delete(e._id);
  res.json({ ok: true, situacao: situacaoEscola(Object.assign({}, e, mud)) });
}));
app.post('/pl/transferencia', exigePlataforma, rota(async (req, res) => {
  const b = req.body || {};
  const e = await obter('escola', String(b.escola || ''));
  if (!e) return erro(res, 404, 'Escola não encontrada.');
  const valor = valorMT(b.valor);
  if (isNaN(valor)) return erro(res, 400, 'Escreva o valor em meticais, com até 2 casas decimais (ex.: 150 ou 150,50).');
  if (!(valor > 0)) return erro(res, 400, 'Escreva o valor transferido.');
  const data = b.data && !isNaN(Date.parse(b.data)) ? new Date(b.data + 'T12:00:00Z').toISOString() : new Date().toISOString();
  const eu = await obter('user', req.sessao.u).catch(() => null);
  // M-Pesa / e-Mola com «Enviar agora»: o dinheiro sai pela MozPayment (payout) e só fica concluído quando a resposta o confirma
  const canal = /m-?pesa/i.test(b.metodo) ? 'mpesa' : /e-?mola/i.test(b.metodo) ? 'emola' : '';
  if (b.enviar && canal) {
    const numero = tel9(b.numero);
    if (numero.length !== 9) return erro(res, 400, 'Escreva o número que vai receber, com 9 dígitos.');
    if (canal === 'mpesa' && !['84', '85'].includes(numero.slice(0, 2))) return erro(res, 400, 'M-Pesa só envia para números Vodacom (84 ou 85).');
    if (canal === 'emola' && !['86', '87'].includes(numero.slice(0, 2))) return erro(res, 400, 'e-Mola só envia para números Movitel (86 ou 87).');
    if (levando.has(e._id)) return erro(res, 409, 'Já está um envio em curso para esta escola. Espere que termine.');
    levando.add(e._id);
    try {
      const id = await criar('transferencia', { 'Escola': e._id, 'Valor': valor, 'Data': data, 'Canal': canal, 'Numero': numero, 'Estado': 'pendente', 'Metodo': CANAIS[canal] + ' (transferência da Plataforma)',
        'Notas': txt(b.notas, 300), 'Pedido Por': (eu && eu['Nome Completo']) || 'Plataforma', 'Feita Por': (eu && eu['Nome Completo']) || 'Plataforma' });
      const r = await enviarPayout(id, txt(b.titular, 80) || e['Nome'] || 'Escola');
      if (r.estado === 'falhada') return erro(res, 502, 'O envio não foi feito: ' + (r.erro || 'a MozPayment recusou') + '. O valor continua no saldo da escola.');
      if (r.estado === 'concluida' && b.sms && tel9(e['Telefone']).length === 9) enviarSMS([e['Telefone']], 'Gescolar: transferimos ' + mt(valor) + ' para o ' + numero + ' (' + CANAIS[canal] + ', propinas pagas online). Ref. ' + r.ref + '.').catch(() => {});
      return res.json({ ok: true, id, estado: r.estado, referencia: r.ref || '', mensagem: r.estado === 'concluida' ? 'Enviado: ' + mt(valor) + ' para o ' + numero + '.' : (r.erro || 'Aceite pela MozPayment; fica pendente até confirmar.') });
    } finally { levando.delete(e._id); }
  }
  const id = await criar('transferencia', { 'Escola': e._id, 'Valor': valor, 'Data': data, 'Referencia': txt(b.referencia, 80), 'Metodo': txt(b.metodo, 40), 'Notas': txt(b.notas, 300), 'Feita Por': (eu && eu['Nome Completo']) || 'Plataforma' });
  if (b.sms && tel9(e['Telefone']).length === 9) enviarSMS([e['Telefone']], 'Gescolar: transferimos ' + mt(valor) + ' para ' + (e['Nome'] || 'a escola') + ' (propinas pagas online)' + (b.referencia ? '. Ref. ' + txt(b.referencia, 40) : '') + '.').catch(() => {});
  res.json({ ok: true, id });
}));
// quem está online agora (só memória, leve: a página da Plataforma pergunta de 30 em 30 segundos)
app.post('/pl/online', exigePlataforma, (req, res) => {
  const out = {}; for (const k of PRESENCA.keys()) { const p = presencaDe(k); if (p.ultimo) out[k] = p; }
  res.json({ ok: true, min: ONLINE_MIN, escolas: out, hora: new Date().toISOString() });
});
// ---------- assinaturas na Plataforma (v5.24) ----------
//  Atribuir à mão (numerário, transferência, oferta…), aprovar as que ficaram em revisão, anular um registo.
//  Usa só campos que a tabela Subscricao já tem: a referência manual vai para «Transacao» (não para «Referencia»,
//  que é a que o webhook compara) e as notas ficam em «Raw».
const METODOS_MANUAIS = { numerario: 'Numerário', transferencia: 'Transferência bancária', mpesa: 'M-Pesa', emola: 'e-Mola', cartao: 'Cartão', oferta: 'Oferta / cortesia' };
app.post('/pl/assinaturas', exigePlataforma, rota(async (req, res) => {
  const [subs, escolas] = await Promise.all([procurarTodos('subscricao', [], 20000), procurarTodos('escola', [], 5000)]);
  const EN = Object.fromEntries(escolas.map(e => [e._id, e['Nome'] || '']));
  res.json({ ok: true, metodos: METODOS_MANUAIS, assinaturas: subs.map(x => {
    let extra = {}; try { const r = JSON.parse(x['Raw'] || '{}'); if (r && r.manual) extra = r; } catch (e) {}
    return Object.assign(subOut(x), { escola: x['Escola'], escola_nome: EN[x['Escola']] || '', transacao: x['Transacao'] || '', manual: !!extra.manual, por: extra.por || '', notas: extra.notas || '' });
  }).sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))) });
}));
app.post('/pl/assinatura-manual', exigePlataforma, rota(async (req, res) => {
  const b = req.body || {};
  const e = await obter('escola', String(b.escola || ''));
  if (!e) return erro(res, 404, 'Escola não encontrada.');
  const plano = PLANOS.includes(b.plano) ? b.plano : (e['Plano'] || 'Essencial');
  const meses = Math.round(Number(b.meses));
  if (!(meses >= 1 && meses <= 36)) return erro(res, 400, 'Escolha entre 1 e 36 meses.');
  const metodo = METODOS_MANUAIS[b.metodo] ? b.metodo : '';
  if (!metodo) return erro(res, 400, 'Escolha como foi pago.');
  const valor = metodo === 'oferta' ? 0 : valorMT(b.valor === undefined || b.valor === '' ? 0 : b.valor);
  if (isNaN(valor) || valor < 0) return erro(res, 400, 'Escreva o valor em meticais (ex.: 4900 ou 4900,50). Use 0 para oferta.');
  const eu = await obter('user', req.sessao.u).catch(() => null), por = (eu && eu['Nome Completo']) || 'Plataforma';
  const inicio = b.inicio && !isNaN(Date.parse(b.inicio)) ? new Date(b.inicio + 'T00:00:00Z').toISOString() : null;
  const ate = inicio ? somaMeses(inicio, meses) : novaValidade(e, meses);
  const id = await criar('subscricao', { 'Escola': e._id, 'Plano': plano, 'Meses': meses, 'Valor': valor, 'Metodo': metodo, 'Estado': 'pago', 'Transacao': txt(b.referencia, 120),
    'Pago Em': new Date().toISOString(), 'Valida Ate': ate, 'Raw': JSON.stringify({ manual: true, por, notas: txt(b.notas, 300), inicio }) });
  await mudar('escola', e._id, { 'Valida Ate': ate, 'Estado': 'activa', 'Plano': plano });
  cachePainel.delete(e._id);
  if (b.sms && tel9(e['Telefone']).length === 9) enviarSMS([e['Telefone']], 'Gescolar: a assinatura ' + plano + ' de ' + (e['Nome'] || 'a escola') + ' esta activa ate ' + new Date(ate).toISOString().slice(0, 10).split('-').reverse().join('/') + '. Obrigado.').catch(() => {});
  res.json({ ok: true, id, valida_ate: ate, situacao: situacaoEscola(Object.assign({}, e, { 'Valida Ate': ate, 'Estado': 'activa' })) });
}));
app.post('/pl/assinatura-aprovar', exigePlataforma, rota(async (req, res) => {
  const x = await obter('subscricao', String((req.body || {}).id || '')).catch(() => null);
  if (!x) return erro(res, 404, 'Assinatura não encontrada.');
  if (x['Estado'] === 'pago') return erro(res, 409, 'Esta assinatura já está aplicada.');
  const e = await obter('escola', x['Escola']);
  if (!e) return erro(res, 404, 'A escola desta assinatura já não existe.');
  const ate = novaValidade(e, Number(x['Meses'] || 1)), eu = await obter('user', req.sessao.u).catch(() => null);
  await mudar('subscricao', x._id, { 'Estado': 'pago', 'Pago Em': new Date().toISOString(), 'Valida Ate': ate,
    'Raw': String(x['Raw'] || '').slice(0, 3600) + ' | aprovada à mão por ' + ((eu && eu['Nome Completo']) || 'Plataforma') });
  await mudar('escola', e._id, { 'Valida Ate': ate, 'Estado': 'activa', 'Plano': x['Plano'] || e['Plano'] });
  cachePainel.delete(e._id);
  res.json({ ok: true, valida_ate: ate });
}));
app.post('/pl/assinatura-anular', exigePlataforma, rota(async (req, res) => {
  const x = await obter('subscricao', String((req.body || {}).id || '')).catch(() => null);
  if (!x) return erro(res, 404, 'Assinatura não encontrada.');
  if (x['Estado'] === 'anulada') return erro(res, 409, 'Já está anulada.');
  const eraPaga = x['Estado'] === 'pago';
  await mudar('subscricao', x._id, { 'Estado': 'anulada' });
  let ate = null;
  if (eraPaga && (req.body || {}).tirar_meses) {   // tira os meses desta assinatura à validade da escola
    const e = await obter('escola', x['Escola']).catch(() => null);
    if (e && e['Valida Ate']) { ate = somaMeses(e['Valida Ate'], -Number(x['Meses'] || 1)); await mudar('escola', e._id, { 'Valida Ate': ate }); cachePainel.delete(e._id); }
  }
  res.json({ ok: true, valida_ate: ate });
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
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0'), pedido = crypto.randomBytes(16).toString('hex');
  // v5.25: por SMS (gasta um crédito da escola); sem telemóvel ou sem SMS, vai para o email da conta
  let destino = '';
  if (tel.length === 9) {
    const msg = 'Gescolar: o seu codigo para criar uma nova palavra-passe e ' + codigo + '. Valido 10 minutos. Nao partilhe este codigo.';
    const r = u['Escola'] ? await smsEscola(u['Escola'], [tel], msg, { semEmail: true }) : await enviarSMS([tel], msg);
    if (r.ok) destino = mascarar(tel);
  }
  if (!destino) {
    const blocos = [{ p: 'Pediu para criar uma nova palavra-passe no Gescolar. Use este código:' }, { codigo }, { nota: 'O código vale 10 minutos. Se não foi você, ignore este email: a sua palavra-passe continua igual.' }];
    const m = await enviarEmail(email, 'Gescolar: código para nova palavra-passe', emailGescolar('', 'Nova palavra-passe', blocos), textoDeBlocos('Nova palavra-passe', blocos));
    if (m.ok) destino = mascararEmail(email);
  }
  if (!destino) return erro(res, 502, 'Não foi possível enviar o código agora. Tente de novo dentro de um minuto.');
  pedidosAcesso.set(pedido, { tipo: 'senha', id: u._id, email, hash: hashCodigo(pedido + codigo), exp: Date.now() + 600e3, tent: 0 });
  res.json({ ok: true, pedido, destino });
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
  const link = linkPagina('recuperar') + '?email=' + encodeURIComponent(email);
  const papelN = papel === 'Direccao' ? 'Direccao' : 'Secretaria', escN = (esc && esc['Nome']) || 'a escola';
  const r = await smsEscola(req.escola, [tel], 'Gescolar: foi criada a sua conta (' + papelN + ') em ' + escN + (SMS_LINKS ? '. Crie a sua palavra-passe em ' + link.replace(/^https?:\/\//, '') : '. Enviamos para o seu email ' + email + ' o link para criar a palavra-passe.'), { semEmail: true });
  const blocos = [{ p: 'Foi criada a sua conta (' + (papel === 'Direccao' ? 'Direcção' : 'Secretaria') + ') em ' + escN + ' no Gescolar.' }, { botao: 'Criar a palavra-passe', link }, { p: 'Depois entre no Gescolar com este email (' + email + ') e a palavra-passe que escolher.' }];
  const m = await enviarEmail(email, 'Gescolar: a sua conta em ' + escN, emailGescolar(escN, 'Bem-vindo ao Gescolar', blocos), textoDeBlocos('Bem-vindo ao Gescolar', blocos));
  res.json({ ok: true, id: userId, sms: r.ok, email: m.ok, link });
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
// convite por SMS e por email (o que o professor tiver). Devolve { sms, email } ou false se nada saiu
async function convidarProfessor(escolaId, p, escRaw) {
  const tel = tel9(p['Telefone']), mail = String(p['Email'] || '').trim().toLowerCase();
  if (tel.length !== 9 && !emailOk(mail)) return false;
  const esc = escRaw || await obter('escola', escolaId);
  const linkC = linkFamilias(esc['Subdominio']), link = linkC.replace(/^https?:\/\//, '');
  const blocos = [{ p: 'Olá ' + String(p['Nome'] || '').split(' ')[0] + ',' }, { p: (esc['Nome'] || 'A escola') + ' criou o seu acesso de professor no Gescolar. Lá vê as suas turmas e o horário, faz a chamada, lança as notas e conversa com os estudantes no chat da turma.' },
    { botao: 'Entrar no Gescolar', link: linkC },
    { p: tel.length === 9 ? 'Na página, escolha «Professor» e escreva o seu número de telemóvel (' + tel + '). Vai receber um código de 6 números por SMS e neste email.'
      : 'Para entrar, a escola tem de registar o seu número de telemóvel: é com ele que entra. Peça à Direcção para o acrescentar à sua ficha.' },
    { nota: 'Código da escola: ' + (esc['Subdominio'] || '') }];
  const [r, m] = await Promise.all([
    tel.length === 9 ? smsEscola(escolaId, [tel], (esc['Nome'] || 'A escola') + ': foi registado como professor no Gescolar. Para ver as suas turmas, o horario, fazer a chamada e lancar notas entre ' + noGescolar(esc['Subdominio']) + ', escolha Professor e use este numero.') : Promise.resolve({ ok: false }),
    emailOk(mail) ? enviarEmail(mail, (esc['Nome'] || 'Gescolar') + ': o seu acesso de professor', emailGescolar(esc['Nome'], 'O seu acesso ao Gescolar', blocos), textoDeBlocos('O seu acesso ao Gescolar', blocos)) : Promise.resolve({ ok: false })]);
  return (r.ok || m.ok) ? { sms: r.ok, email: m.ok } : false;
}
app.post('/professor-convite', exigeDireccao, rota(async (req, res) => {
  const p = await daMinhaEscola('professor', String((req.body || {}).id || ''), req.escola);
  if (tel9(p['Telefone']).length !== 9 && !emailOk(String(p['Email'] || '').toLowerCase())) return erro(res, 400, 'Este professor não tem telemóvel nem email registados. Edite-o e acrescente um deles.');
  if (travao('conv-prof|' + p._id, 3, 60)) return erro(res, 429, 'Já enviou o acesso a este professor várias vezes. Tente daqui a uma hora.');
  const c = await convidarProfessor(req.escola, p);
  if (!c) return erro(res, 502, 'O acesso não foi enviado (nem SMS nem email). Tente mais tarde.');
  res.json({ ok: true, sms: c.sms, email: c.email });
}));
app.post('/professores-convite', exigeDireccao, rota(async (req, res) => {
  if (travao('conv-profs|' + req.escola, 1, 60)) return erro(res, 429, 'O convite já foi enviado há pouco. Pode voltar a enviar daqui a uma hora.');
  const [esc, profs] = await Promise.all([obter('escola', req.escola), procurarTodos('professor', daEscola(req.escola))]);
  const alvo = profs.filter(p => p['Activo'] !== false && (tel9(p['Telefone']).length === 9 || emailOk(String(p['Email'] || '').toLowerCase())));
  if (!alvo.length) return erro(res, 400, 'Nenhum professor tem telemóvel ou email registado.');
  let enviados = 0, sms = 0, emails = 0;
  for (const p of alvo) { const c = await convidarProfessor(req.escola, p, esc).catch(() => false); if (c) { enviados++; if (c.sms) sms++; if (c.email) emails++; } }
  res.json({ ok: true, enviados, sms, emails, sem_telefone: profs.filter(p => p['Activo'] !== false).length - alvo.length });
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
  teoricas: Number(c['Aulas Teoricas'] || 0), praticas: Number(c['Aulas Praticas'] || 0), idade: Number(c['Idade Minima'] || (CATEGORIAS[c['Categoria']] || {}).idade || 18), activo: c['Activo'] !== false, extra: Number(c['Preco Aula Extra'] || 0),
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
  if (b.extra !== undefined && String(b.extra).trim() !== '') { const x = Math.round(Number(String(b.extra).replace(/\s/g, ''))); if (!(x >= 0)) return erro(res, 400, 'Preço da aula extra inválido.'); campos['Preco Aula Extra'] = x; }
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
  const [ins, cs, ests, props, esc, aulas, docs, ts, teo] = await Promise.all([procurarTodos('inscricaoconducao', f, 5000), procurarTodos('cursoconducao', f), procurarTodos('estudante', f), procurarTodos('propina', f.concat([{ key: 'Tipo', constraint_type: 'equals', value: 'prestacao' }]), 20000), resumoEscola(req.escola), procurarTodos('aulapratica', f, 20000),
    docsDaEscola(req.escola), procurarTodos('testecodigo', f, 20000).catch(() => []), procurarTodos('aulateorica', f, 5000).catch(() => [])]);
  const teoConta = {}; teo.forEach(t => (lerJSON(t['Presentes'], []) || []).forEach(id => { teoConta[id] = (teoConta[id] || 0) + 1; }));
  const escRawI = await obter('escola', req.escola).catch(() => null);
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
      praticas: { feitas: aulas.filter(a => a['Inscricao'] === i._id && a['Estado'] === 'feita').length, marcadas: aulas.filter(a => a['Inscricao'] === i._id && a['Estado'] === 'marcada').length, total: Number(c['Aulas Praticas'] || 0) },
      teoricas: { feitas: teoConta[i._id] || 0, total: Number(c['Aulas Teoricas'] || 0) },
      codigo: Object.assign(resumoCodigo(ts.filter(t => t['Inscricao'] === i._id)), { acesso: i['Codigo Acesso'] || '', acesso_pago: props.some(p => p['Estudante'] === i['Estudante'] && p['Descricao'] === DESC_ACESSO && p['Estado'] === 'paga') }),
      processo: processoOut(i, docs) };
  }).sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))), documentos: docs, processos: PROCESSO,
    codigo_acesso: { modo: (escRawI && escRawI['Codigo Acesso']) === 'pago' ? 'pago' : 'gratis', preco: Number((escRawI && escRawI['Codigo Preco']) || 0) } });
}));
async function inscreverCore(escolaId, b) {
  const nome = txt(b.nome, 100);
  if (nome.split(/\s+/).length < 2) throw pub('Escreva o nome completo do instruendo.');
  const tel = tel9(b.telefone);
  if (tel.length !== 9) throw pub('O telemóvel tem 9 dígitos. É por ele que o instruendo entra no portal e recebe avisos.');
  if (!b.nascimento || isNaN(Date.parse(b.nascimento))) throw pub('Escreva a data de nascimento: a idade mínima depende da categoria.');
  const c = await daMinhaEscola('cursoconducao', String(b.curso || ''), escolaId);
  if (c['Activo'] === false) throw pub('Este curso já não está activo.');
  const idade = idadeEm(b.nascimento), minima = Number(c['Idade Minima'] || (CATEGORIAS[c['Categoria']] || {}).idade || 18);
  if (idade < minima) throw pub('A carta ' + c['Categoria'] + ' exige pelo menos ' + minima + ' anos. O instruendo tem ' + idade + '.');
  const prest = Math.max(1, Math.min(Number(c['Prestacoes'] || 1), Math.round(Number(b.prestacoes) || Number(c['Prestacoes'] || 1))));
  const preco = Number(c['Preco'] || 0);
  const inicio = b.inicio && !isNaN(Date.parse(b.inicio)) ? new Date(b.inicio + 'T12:00:00Z') : new Date();
  // número do instruendo: C<ano>-0001 (separado dos estudantes)
  const ests = await procurarTodos('estudante', daEscola(escolaId));
  const ano = String(new Date().getFullYear());
  const repetido = ests.find(e => tel9(e['Telefone']) === tel && (e['Estado'] || 'activo') === 'activo' && String(e['Numero'] || '').startsWith('C'));
  const { encId, encTel } = await encarregadoDe(escolaId, b, false);   // v5.12: encarregado opcional na condução
  let estId, numero;
  if (repetido) { estId = repetido._id; numero = repetido['Numero']; if (encId && repetido['Encarregado'] !== encId) await mudar('estudante', estId, { 'Encarregado': encId }).catch(() => {}); }
  else {
    const maior = ests.map(e => String(e['Numero'] || '')).filter(n => n.startsWith('C' + ano + '-')).map(n => parseInt(n.split('-')[1], 10) || 0).reduce((a, x) => Math.max(a, x), 0);
    numero = 'C' + ano + '-' + String(maior + 1).padStart(4, '0');
    const campos = { 'Escola': escolaId, 'Numero': numero, 'Nome': nome, 'Sexo': b.sexo === 'F' ? 'F' : (b.sexo === 'M' ? 'M' : ''), 'Telefone': tel.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3'),
      'Data Nascimento': new Date(b.nascimento).toISOString(), 'Ano Lectivo': ano, 'Data Matricula': new Date().toISOString(), 'Estado': 'activo' };
    if (encId) campos['Encarregado'] = encId;
    estId = await criar('estudante', campos);
  }
  const insId = await criar('inscricaoconducao', { 'Escola': escolaId, 'Estudante': estId, 'Curso': c._id, 'Categoria': c['Categoria'], 'Data Inscricao': new Date().toISOString(), 'Estado': 'activa', 'Preco': preco, 'Prestacoes': prest });
  // prestações: dividir o preço; a primeira vence no dia da inscrição (ou no início escolhido), as outras de mês a mês
  const base = Math.floor(preco / prest), resto = preco - base * prest, linhas = [];
  for (let k = 0; k < prest; k++) {
    const v = new Date(inicio); v.setUTCMonth(v.getUTCMonth() + k); v.setUTCHours(21, 59, 0, 0);
    const valor = base + (k === 0 ? resto : 0);
    linhas.push({ 'Escola': escolaId, 'Estudante': estId, 'Ano Lectivo': String(v.getUTCFullYear()), 'Tipo': 'prestacao', 'Mes': v.getUTCMonth() + 1,
      'Descricao': 'Carta ' + c['Categoria'] + ' · ' + (prest === 1 ? 'pagamento único' : 'prestação ' + (k + 1) + '/' + prest), 'Valor': valor, 'Vencimento': v.toISOString(), 'Multa': 0, 'Total': valor, 'Estado': 'aberta' });
  }
  await criarEmLote('propina', linhas);
  const esc = await obter('escola', escolaId).catch(() => null);
  let sms = false;
  if (esc) {
    const link = noGescolar(esc['Subdominio']);
    const r = await smsEscola(escolaId, [tel], (esc['Nome'] || 'A escola') + ': bem-vindo ao curso da carta ' + c['Categoria'] + '. O seu numero e ' + numero + '. Veja aulas, prestacoes e recibos e pague por M-Pesa ou e-Mola ' + link + ' (escolha Estudante).');
    sms = r.ok;
    if (encTel && encTel !== tel) await smsEscola(escolaId, [encTel], (esc['Nome'] || 'A escola') + ': ' + nome + ' foi inscrito(a) no curso da carta ' + c['Categoria'] + ' com o numero ' + numero + '. Acompanhe aulas e prestacoes e pague por M-Pesa ou e-Mola ' + link + ' (escolha Encarregado e use este numero de telemovel).').catch(() => {});
  }
  cachePainel.delete(escolaId);
  return { id: insId, estudante: estId, numero, prestacoes: prest, sms };
}
app.post('/inscrever', exigeDireccao, rota(async (req, res) => {
  const r = await inscreverCore(req.escola, req.body || {});
  res.json(Object.assign({ ok: true }, r));
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
  // v5.10: depois de esgotadas as aulas do curso, cada aula nova é uma aula extra paga (se o curso tiver preço de aula extra)
  let extra = 0;
  const cur = D.CM[i['Curso']] || {}, incluidas = Number(cur['Aulas Praticas'] || 0), precoExtra = Number(cur['Preco Aula Extra'] || 0);
  const usadas = D.aulas.filter(a => a['Inscricao'] === i._id && ['feita', 'marcada', 'faltou'].includes(a['Estado'])).length;
  if (incluidas > 0 && precoExtra > 0 && usadas >= incluidas) {
    const vz = new Date(b.data + 'T21:59:00Z');
    await criar('propina', { 'Escola': req.escola, 'Estudante': i['Estudante'], 'Ano Lectivo': b.data.slice(0, 4), 'Tipo': 'prestacao', 'Mes': Number(b.data.slice(5, 7)),
      'Descricao': 'Aula prática extra · ' + dmCurto(b.data) + ' ' + b.inicio, 'Valor': precoExtra, 'Vencimento': vz.toISOString(), 'Multa': 0, 'Total': precoExtra, 'Estado': 'aberta' });
    extra = precoExtra;
  }
  let sms = false;
  const e = D.EM[i['Estudante']] || {};
  if (b.sms && tel9(e['Telefone']).length === 9) {
    const esc = await obter('escola', req.escola).catch(() => null);
    const d = new Date(b.data + 'T12:00:00Z'), dia = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][d.getUTCDay()];
    const r = await smsEscola(req.escola, [e['Telefone']], ((esc && esc['Nome']) || 'Escola') + ': aula pratica marcada para ' + dia + ' ' + dmCurto(b.data) + ', ' + b.inicio + '-' + hhmmDe(fim) + '. Instrutor ' + (p['Nome'] || '').split(' ')[0] + ', viatura ' + v['Matricula'] + '.' + (extra ? ' Aula extra: ' + extra + ' MT, pague no portal.' : ''));
    sms = r.ok;
  }
  return res.json({ ok: true, id, fim: hhmmDe(fim), sms, extra });
}
app.post('/aula-marcar', exigeDireccao, rota(async (req, res) => marcarAula(req, res, req.body || {})));
app.post('/aula-estado', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, estado = String(b.estado || '');
  if (!['marcada', 'feita', 'faltou', 'cancelada'].includes(estado)) return erro(res, 400, 'Estado inválido.');
  const a = await daMinhaEscola('aulapratica', String(b.id || ''), req.escola);
  if (estado === 'feita' && a['Data'] > hojeMZ().data) return erro(res, 400, 'Esta aula ainda não aconteceu.');
  const mud = { 'Estado': estado }; if (b.notas !== undefined) mud['Notas'] = txt(b.notas, 300);
  await mudar('aulapratica', a._id, mud);
  let sms = false;
  if (estado === 'cancelada' && (a['Estado'] || 'marcada') === 'marcada') {
    // a aula extra que ainda não foi paga deixa de ser devida
    const ps = await procurarTodos('propina', daEscola(req.escola).concat([{ key: 'Estudante', constraint_type: 'equals', value: a['Estudante'] }])).catch(() => []);
    const ref = 'Aula prática extra · ' + dmCurto(a['Data']) + ' ' + a['Inicio'];
    for (const p of ps.filter(x => x['Descricao'] === ref && x['Estado'] !== 'paga')) await mudar('propina', p._id, { 'Estado': 'anulada' }).catch(() => {});
    if (b.sms !== false && a['Data'] >= hojeMZ().data) {
      const [e, esc] = await Promise.all([obter('estudante', a['Estudante']).catch(() => null), obter('escola', req.escola).catch(() => null)]);
      if (e && tel9(e['Telefone']).length === 9) sms = (await smsEscola(req.escola, [e['Telefone']], ((esc && esc['Nome']) || 'Escola') + ': a sua aula pratica de ' + dmCurto(a['Data']) + ' as ' + a['Inicio'] + ' foi cancelada. A escola vai marcar outra data.')).ok;
    }
  }
  res.json({ ok: true, estado, sms });
}));

// ============================================================
//  ESCOLA DE CONDUÇÃO · PARTE 3: EXAMES, INSTRUTOR E PORTAL (v5.2)
//  Bubble:
//   Exame Conducao: Escola (Escola) · Estudante (text) · Inscricao (text) · Tipo (text: codigo | conducao) · Data (text AAAA-MM-DD)
//                   · Hora (text) · Local (text) · Resultado (text: marcado | aprovado | reprovado | faltou) · Tentativa (number) · Notas (text)
//  Regra: o exame de condução só se marca depois de aprovado no exame de código.
//  Aprovado no exame de condução → a inscrição passa a "concluida" e o instruendo recebe os parabéns por SMS.
// ============================================================
const TIPO_EXAME = { codigo: 'Exame de código', conducao: 'Exame de condução' };
const exameOut = (x, D) => { const e = (D && D.EM[x['Estudante']]) || {}, i = (D && D.IM[x['Inscricao']]) || {};
  return { id: x._id, tipo: x['Tipo'] || 'codigo', tipo_nome: TIPO_EXAME[x['Tipo']] || 'Exame', data: x['Data'] || '', hora: x['Hora'] || '', local: x['Local'] || '', resultado: x['Resultado'] || 'marcado',
    tentativa: Number(x['Tentativa'] || 1), notas: x['Notas'] || '', estudante: x['Estudante'], instruendo: e['Nome'] || '', numero: e['Numero'] || '', categoria: i['Categoria'] || '', inscricao: x['Inscricao'] }; };
app.post('/exames', exigeDireccao, rota(async (req, res) => {
  const [D, xs] = await Promise.all([dadosAulas(req.escola), procurarTodos('exameconducao', daEscola(req.escola), 5000)]);
  const hoje = hojeMZ().data;
  res.json({ ok: true, hoje,
    exames: xs.map(x => exameOut(x, D)).sort((a, b) => (b.data.localeCompare(a.data)) || (b.tentativa - a.tentativa) || b.hora.localeCompare(a.hora)),
    instrutores: taxaPorInstrutor(xs, D),
    inscricoes: D.ins.filter(i => (i['Estado'] || 'activa') === 'activa').map(i => {
      const meus = xs.filter(x => x['Inscricao'] === i._id);
      return Object.assign({ id: i._id, nome: (D.EM[i['Estudante']] || {})['Nome'] || '', numero: (D.EM[i['Estudante']] || {})['Numero'] || '', categoria: i['Categoria'] || '',
        codigo_aprovado: meus.some(x => x['Tipo'] === 'codigo' && x['Resultado'] === 'aprovado') }, progressoInscricao(i, D)); }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')) });
}));
app.post('/exame-marcar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, tipo = b.tipo === 'conducao' ? 'conducao' : 'codigo';
  const i = await daMinhaEscola('inscricaoconducao', String(b.inscricao || ''), req.escola);
  if ((i['Estado'] || 'activa') !== 'activa') return erro(res, 400, 'Esta inscrição já não está em curso.');
  if (!dataOk(b.data)) return erro(res, 400, 'Escolha a data do exame.');
  if (b.hora && !HHMM.test(b.hora)) return erro(res, 400, 'Hora inválida.');
  const xs = await procurarTodos('exameconducao', daEscola(req.escola).concat([{ key: 'Inscricao', constraint_type: 'equals', value: i._id }]));
  if (xs.some(x => x['Tipo'] === tipo && (x['Resultado'] || 'marcado') === 'marcado')) return erro(res, 409, 'Já há um ' + TIPO_EXAME[tipo].toLowerCase() + ' marcado para este instruendo. Registe primeiro o resultado.');
  if (tipo === 'conducao' && !xs.some(x => x['Tipo'] === 'codigo' && x['Resultado'] === 'aprovado')) return erro(res, 400, 'O instruendo ainda não foi aprovado no exame de código.');
  if (tipo === 'codigo' && xs.some(x => x['Tipo'] === 'codigo' && x['Resultado'] === 'aprovado')) return erro(res, 400, 'O instruendo já foi aprovado no exame de código.');
  if (!b.forcar) {
    const divida = await dividaDe(req.escola, i['Estudante']);
    if (divida > 0) return res.status(409).json({ ok: false, divida, erro: 'O instruendo tem ' + mt(divida) + ' de prestações em atraso.' });
  }
  const tentativa = xs.filter(x => x['Tipo'] === tipo && ['aprovado', 'reprovado', 'faltou'].includes(x['Resultado'])).length + 1;
  const id = await criar('exameconducao', { 'Escola': req.escola, 'Estudante': i['Estudante'], 'Inscricao': i._id, 'Tipo': tipo, 'Data': b.data, 'Hora': b.hora || '', 'Local': txt(b.local, 80), 'Resultado': 'marcado', 'Tentativa': tentativa, 'Notas': txt(b.notas, 300) });
  let sms = false;
  if (b.sms) {
    const [e, esc] = await Promise.all([obter('estudante', i['Estudante']).catch(() => null), obter('escola', req.escola).catch(() => null)]);
    if (e && tel9(e['Telefone']).length === 9) sms = (await smsEscola(req.escola, [e['Telefone']], ((esc && esc['Nome']) || 'Escola') + ': ' + TIPO_EXAME[tipo].toLowerCase() + ' da carta ' + i['Categoria'] + ' marcado para ' + dmCurto(b.data) + (b.hora ? ' as ' + b.hora : '') + (b.local ? ', ' + txt(b.local, 60) : '') + '. Leve o BI. Boa sorte!')).ok;
  }
  res.json({ ok: true, id, tentativa, sms });
}));
app.post('/exame-resultado', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, r = String(b.resultado || '');
  if (!['marcado', 'aprovado', 'reprovado', 'faltou'].includes(r)) return erro(res, 400, 'Resultado inválido.');
  const x = await daMinhaEscola('exameconducao', String(b.id || ''), req.escola);
  if (r !== 'marcado' && x['Data'] > hojeMZ().data) return erro(res, 400, 'O exame ainda não aconteceu.');
  await mudar('exameconducao', x._id, { 'Resultado': r });
  let concluida = false, sms = false;
  if (x['Tipo'] === 'conducao' && r === 'aprovado') {
    await mudar('inscricaoconducao', x['Inscricao'], { 'Estado': 'concluida' }).catch(() => {});
    concluida = true;
    const [e, esc, i] = await Promise.all([obter('estudante', x['Estudante']).catch(() => null), obter('escola', req.escola).catch(() => null), obter('inscricaoconducao', x['Inscricao']).catch(() => null)]);
    if (e && tel9(e['Telefone']).length === 9) sms = (await smsEscola(req.escola, [e['Telefone']], ((esc && esc['Nome']) || 'Escola') + ': parabens, ' + String(e['Nome'] || '').split(' ')[0] + '! Foi aprovado no exame de conducao da carta ' + ((i && i['Categoria']) || '') + '. Boa estrada!')).ok;
  }
  cachePainel.delete(req.escola);
  res.json({ ok: true, resultado: r, concluida, sms });
}));

// ---------- instrutor: as suas aulas práticas ----------
async function praticasDoInstrutor(escola, profId) {
  const f = daEscola(escola);
  const aps = (await procurarTodos('aulapratica', f.concat([{ key: 'Instrutor', constraint_type: 'equals', value: profId }]), 5000));
  if (!aps.length) return null;
  const D = await dadosAulas(escola);
  const hoje = hojeMZ().data, ate = hojeMZ(7).data, antes = hojeMZ(-7).data;
  return { hoje, aulas: aps.filter(a => a['Data'] >= antes && a['Data'] <= ate && a['Estado'] !== 'cancelada').map(a => aulaOut(a, D)).sort((x, y) => (x.data + x.inicio).localeCompare(y.data + y.inicio)),
    feitas_mes: aps.filter(a => a['Estado'] === 'feita' && String(a['Data']).slice(0, 7) === hoje.slice(0, 7)).length };
}
app.post('/prof/aula-estado', exigeProfessor, rota(async (req, res) => {
  const b = req.body || {}, estado = String(b.estado || '');
  if (!['feita', 'faltou', 'marcada'].includes(estado)) return erro(res, 400, 'Estado inválido.');
  const a = await daMinhaEscola('aulapratica', String(b.id || ''), req.escola);
  if (a['Instrutor'] !== req.sessao.u) return erro(res, 403, 'Esta aula não é sua.');
  if (a['Estado'] === 'cancelada') return erro(res, 400, 'Esta aula foi cancelada pela escola.');
  if (estado !== 'marcada' && a['Data'] > hojeMZ().data) return erro(res, 400, 'Esta aula ainda não aconteceu.');
  if (a['Data'] < hojeMZ(-7).data) return erro(res, 400, 'Só pode corrigir aulas dos últimos 7 dias. Fale com a escola.');
  const mud = { 'Estado': estado }; if (b.notas !== undefined) mud['Notas'] = txt(b.notas, 300);
  await mudar('aulapratica', a._id, mud);
  res.json({ ok: true, estado });
}));

// ============================================================
//  ESCOLA DE CONDUÇÃO · PARTE 4 (v5.10)
//  Treino do código · lembretes por SMS · processo e documentos · aulas teóricas · regras
//  Bubble, tabelas novas:
//   Pergunta Codigo: Escola (Escola) · Base (text) · Tema (text) · Pergunta (text) · Opcoes (text) · Correcta (number)
//                    · Explicacao (text) · Imagem (text) · Activa (yes/no)
//   Teste Codigo:    Escola (Escola) · Estudante (text) · Inscricao (text) · Data (date) · Acertos (number) · Total (number) · Erradas (text)
//   Aula Teorica:    Escola (Escola) · Data (text) · Inicio (text) · Tema (text) · Instrutor (text) · Presentes (text)
//  Bubble, campos novos:
//   Aula Pratica: Lembrete (yes/no) · Exame Conducao: Lembrete (yes/no)
//   Inscricao Conducao: Documentos (text) · Processo (text) · Licenca Numero (text) · Licenca Validade (date)
//   Curso Conducao: Preco Aula Extra (number) · Escola: Docs Conducao (text)
//  Render (opcionais): LEMBRETES_HORA (por defeito 18) · CODIGO_PRONTO (% para "pronto para o exame", por defeito 80)
// ============================================================

// ---------- treino do código ----------
//  Banco de base do Gescolar: perguntas gerais de segurança e sinalização, sem números de lei (velocidades, taxas de álcool),
//  para a escola completar com as suas. A escola pode esconder qualquer pergunta de base e criar as próprias.
const BANCO_CODIGO = [
  { id: 'g01', t: 'Sinais', i: 'stop', p: 'O que deve fazer perante este sinal?', o: ['Abrandar e passar se não vier ninguém', 'Parar sempre e só avançar quando for seguro', 'Buzinar e seguir'], c: 1, e: 'O sinal STOP obriga a parar sempre, mesmo que não venha ninguém. Só depois de parar avança, quando for seguro.' },
  { id: 'g02', t: 'Sinais', i: 'ceder', p: 'O que indica este sinal?', o: ['Cedência de passagem', 'Proibido parar', 'Fim de prioridade da estrada'], c: 0, e: 'O triângulo invertido de bordo vermelho manda ceder a passagem aos veículos da outra via. Não obriga a parar se a via estiver livre.' },
  { id: 'g03', t: 'Sinais', i: 'sentido_proibido', p: 'O que indica este sinal?', o: ['Estacionamento proibido', 'Sentido proibido: não pode entrar nesta via', 'Estrada com prioridade'], c: 1, e: 'O disco vermelho com uma barra branca horizontal é o sentido proibido. Não pode entrar na via por esse lado.' },
  { id: 'g04', t: 'Sinais', i: 'perigo', p: 'Os sinais triangulares com bordo vermelho, com o vértice para cima, indicam:', o: ['Um perigo à frente', 'Uma obrigação', 'Um serviço (bomba, hospital)'], c: 0, e: 'Os triângulos com bordo vermelho são sinais de perigo: avisam de uma situação que exige atenção redobrada e, normalmente, abrandar.' },
  { id: 'g05', t: 'Sinais', i: 'proibicao', p: 'Os sinais circulares com bordo vermelho indicam, em regra:', o: ['Perigo', 'Proibição', 'Informação turística'], c: 1, e: 'Os sinais redondos com bordo vermelho proíbem alguma coisa: entrar, virar, ultrapassar, estacionar, entre outras.' },
  { id: 'g06', t: 'Regras', p: 'Em Moçambique, os veículos circulam:', o: ['Pela esquerda', 'Pela direita', 'Pelo centro da faixa'], c: 0, e: 'Moçambique tem circulação pela esquerda. Mantenha-se o mais à esquerda possível da sua faixa.' },
  { id: 'g07', t: 'Regras', p: 'Numa estrada com circulação pela esquerda, a ultrapassagem faz-se normalmente:', o: ['Pela direita do veículo que vai ultrapassar', 'Pela esquerda do veículo que vai ultrapassar', 'Por qualquer lado, desde que seja rápido'], c: 0, e: 'Com circulação pela esquerda, ultrapassa-se pela direita, depois de verificar espelhos, sinalizar e confirmar que há espaço e visibilidade.' },
  { id: 'g08', t: 'Regras', p: 'Numa rotunda, em Moçambique, circula-se:', o: ['No sentido dos ponteiros do relógio', 'No sentido contrário aos ponteiros do relógio', 'No sentido que tiver menos trânsito'], c: 0, e: 'Com circulação pela esquerda, contorna-se a rotunda no sentido dos ponteiros do relógio.' },
  { id: 'g09', t: 'Semáforos', i: 'semaforo_vermelho', p: 'Com a luz vermelha acesa, deve:', o: ['Parar antes da linha de paragem', 'Passar devagar se não vier ninguém', 'Buzinar e avançar'], c: 0, e: 'A luz vermelha obriga a parar antes da linha de paragem e esperar pela luz verde.' },
  { id: 'g10', t: 'Semáforos', i: 'semaforo_amarelo', p: 'A luz amarela fixa acende-se quando está a chegar ao semáforo. Deve:', o: ['Acelerar para passar antes do vermelho', 'Parar, a não ser que já esteja tão perto que não consiga parar em segurança', 'Avançar sempre, porque ainda não está vermelho'], c: 1, e: 'O amarelo fixo manda parar. Só pode continuar se já estiver tão perto que uma travagem brusca seria perigosa.' },
  { id: 'g11', t: 'Regras', p: 'Antes de mudar de faixa ou de direcção, deve:', o: ['Sinalizar com o pisca com antecedência e confirmar nos espelhos', 'Sinalizar só depois de mudar', 'Não precisa de sinalizar se não vir ninguém'], c: 0, e: 'Sinalize sempre com antecedência e confirme espelhos e ângulo morto antes de mudar de faixa ou de direcção.' },
  { id: 'g12', t: 'Regras', p: 'Uma linha contínua no meio da estrada significa que:', o: ['Não a pode pisar nem transpor', 'Pode ultrapassar se tiver pressa', 'Indica um lugar de estacionamento'], c: 0, e: 'A linha contínua não pode ser pisada nem transposta. Normalmente marca zonas onde ultrapassar é perigoso.' },
  { id: 'g13', t: 'Regras', p: 'É proibido parar ou estacionar:', o: ['Em curvas e lombas com pouca visibilidade', 'Num parque de estacionamento', 'Numa garagem própria'], c: 0, e: 'Parar em curvas e lombas sem visibilidade obriga os outros a desviar sem ver o que vem, e causa acidentes graves.' },
  { id: 'g14', t: 'Peões', p: 'Um peão está a atravessar na passadeira. Deve:', o: ['Buzinar para ele se apressar', 'Parar e deixá-lo atravessar em segurança', 'Contorná-lo devagar'], c: 1, e: 'Na passadeira, o peão que já está a atravessar tem sempre de ser respeitado: pare e espere que termine.' },
  { id: 'g15', t: 'Regras', p: 'Ouve a sirene de uma ambulância em marcha de urgência atrás de si. Deve:', o: ['Facilitar a passagem, encostando-se quando for seguro', 'Manter a velocidade e a faixa', 'Acelerar para ficar à frente dela'], c: 0, e: 'Os veículos de emergência com sinais luminosos e sonoros ligados têm prioridade. Facilite a passagem sem manobras bruscas.' },
  { id: 'g16', t: 'Segurança', p: 'Quem deve usar o cinto de segurança?', o: ['Só o condutor', 'O condutor e todos os passageiros, nos lugares com cinto', 'Só os passageiros da frente'], c: 1, e: 'O cinto protege todos os ocupantes. Num choque, um passageiro de trás sem cinto pode ferir gravemente quem vai à frente.' },
  { id: 'g17', t: 'Segurança', p: 'Pode segurar o telemóvel na mão enquanto conduz?', o: ['Não', 'Sim, em rectas', 'Sim, se for uma chamada curta'], c: 0, e: 'Segurar o telemóvel tira as mãos e a atenção da condução. É proibido e é uma das grandes causas de acidentes.' },
  { id: 'g18', t: 'Segurança', p: 'O álcool, mesmo em pouca quantidade:', o: ['Melhora os reflexos', 'Aumenta o tempo de reacção e prejudica a condução', 'Não tem efeito se a pessoa tiver comido'], c: 1, e: 'O álcool atrasa as reacções, reduz a visão e dá falsa confiança. A única forma segura é não beber antes de conduzir.' },
  { id: 'g19', t: 'Segurança', p: 'Para que serve a distância de segurança ao veículo da frente?', o: ['Para conseguir parar sem bater se ele travar de repente', 'Para ultrapassar mais depressa', 'Não tem utilidade dentro das cidades'], c: 0, e: 'A distância de segurança dá-lhe tempo para reagir e travar. Deve ser maior com chuva, à noite e a velocidades mais altas.' },
  { id: 'g20', t: 'Segurança', p: 'Com chuva forte, deve:', o: ['Reduzir a velocidade e aumentar a distância de segurança', 'Manter a velocidade, com os máximos ligados', 'Travar a fundo nas curvas'], c: 0, e: 'Com chuva, o piso escorrega e a visibilidade diminui: a distância de travagem aumenta. Abrande e afaste-se do veículo da frente.' },
  { id: 'g21', t: 'Segurança', p: 'Numa viagem longa, começa a sentir sono. O que deve fazer?', o: ['Abrir a janela e continuar', 'Parar num local seguro e descansar', 'Acelerar para chegar mais cedo'], c: 1, e: 'O sono ao volante é muito perigoso. Abrir a janela ou pôr música não resolve: pare num local seguro e descanse.' },
  { id: 'g22', t: 'Segurança', p: 'Pneus muito gastos:', o: ['Aumentam a distância de travagem e o risco de derrapar', 'Não afectam a condução', 'Melhoram a aderência'], c: 0, e: 'Pneus gastos agarram menos ao piso, sobretudo com chuva. Verifique o estado e a pressão com regularidade.' },
  { id: 'g23', t: 'Segurança', p: 'Antes de arrancar com o veículo, deve:', o: ['Verificar os espelhos e o ângulo morto', 'Buzinar para avisar', 'Acelerar a fundo'], c: 0, e: 'Antes de arrancar, confirme espelhos e ângulo morto: peões, motas e bicicletas podem estar escondidos.' },
  { id: 'g24', t: 'Segurança', p: 'Crianças pequenas devem viajar:', o: ['Ao colo de um passageiro da frente', 'Numa cadeira ou sistema de retenção adequado à idade, no banco de trás', 'Soltas no banco de trás'], c: 1, e: 'Ao colo, num choque, a criança é projectada. Use sempre um sistema de retenção adequado, de preferência no banco de trás.' },
  { id: 'g25', t: 'Segurança', p: 'À noite, ao cruzar-se com outro veículo, deve:', o: ['Passar dos máximos para os médios', 'Manter os máximos ligados', 'Desligar as luzes'], c: 0, e: 'Os máximos encandeiam quem vem de frente. Mude para os médios ao cruzar-se ou ao seguir outro veículo de perto.' },
  { id: 'g26', t: 'Segurança', p: 'Vê gado a atravessar a estrada. Deve:', o: ['Abrandar e, se for preciso, parar até a estrada estar livre', 'Buzinar e passar entre os animais', 'Acelerar para passar antes deles'], c: 0, e: 'Os animais têm reacções imprevisíveis. Abrande, pare se for preciso e só avance com a estrada livre.' },
  { id: 'g27', t: 'Avarias', p: 'O carro avariou na estrada. Para avisar os outros condutores, deve:', o: ['Colocar o triângulo de pré-sinalização bem visível, antes do carro', 'Deixar o carro sem qualquer aviso', 'Pôr só o rádio alto'], c: 0, e: 'O triângulo de pré-sinalização avisa os outros com antecedência. Ligue também os quatro piscas e saia do carro pelo lado seguro.' },
  { id: 'g28', t: 'Primeiros socorros', p: 'Chega a um acidente com feridos. A primeira coisa a fazer é:', o: ['Tirar logo os feridos dos carros', 'Sinalizar o local, proteger-se e pedir ajuda', 'Dar água aos feridos'], c: 1, e: 'Primeiro evite um segundo acidente: sinalize e proteja-se. Depois peça ajuda. Não mexa nos feridos sem necessidade.' },
  { id: 'g29', t: 'Primeiros socorros', p: 'Um ferido pode ter uma lesão na coluna. Deve:', o: ['Sentá-lo para respirar melhor', 'Não o mexer, a não ser que haja perigo imediato, como fogo', 'Levantá-lo e levá-lo a andar'], c: 1, e: 'Mexer num ferido com lesão na coluna pode causar paralisia. Só o retire se houver perigo imediato.' },
  { id: 'g30', t: 'Motociclos', p: 'Num motociclo, o capacete deve ser usado por:', o: ['Só o condutor', 'O condutor e o passageiro', 'Ninguém, dentro das cidades'], c: 1, e: 'O capacete protege a cabeça de quem conduz e de quem vai atrás. Use-o sempre, bem apertado.' }
];
const SINAIS_CODIGO = ['stop', 'ceder', 'sentido_proibido', 'perigo', 'proibicao', 'semaforo_vermelho', 'semaforo_amarelo'];
const CODIGO_PRONTO = Math.max(50, Math.min(100, Number(process.env.CODIGO_PRONTO || 80)));
const CODIGO_PERGUNTAS = 20;
const lerJSON = (t, padrao) => { try { const v = JSON.parse(t || ''); return v == null ? padrao : v; } catch (e) { return padrao; } };
async function bancoCodigo(escola) {
  const linhas = await procurarTodos('perguntacodigo', daEscola(escola), 3000).catch(() => []);
  const ocultas = new Set(linhas.filter(x => x['Base'] && x['Activa'] === false).map(x => x['Base']));
  const base = BANCO_CODIGO.map(q => ({ id: q.id, base: true, tema: q.t, pergunta: q.p, opcoes: q.o, correcta: q.c, explicacao: q.e, imagem: q.i || '', activa: !ocultas.has(q.id) }));
  const proprias = linhas.filter(x => !x['Base']).map(x => {
    const o = lerJSON(x['Opcoes'], []);
    return { id: x._id, base: false, tema: x['Tema'] || 'Geral', pergunta: x['Pergunta'] || '', opcoes: Array.isArray(o) ? o.map(String) : [], correcta: Number(x['Correcta'] || 0), explicacao: x['Explicacao'] || '', imagem: x['Imagem'] || '', activa: x['Activa'] !== false };
  }).filter(q => q.opcoes.length >= 2 && q.pergunta);
  return base.concat(proprias);
}
const pctDe = t => Number(t['Total'] || 0) ? Math.round(Number(t['Acertos'] || 0) * 100 / Number(t['Total'])) : 0;
function resumoCodigo(testes) {
  const L = testes.slice().sort((a, b) => String(b['Data'] || b['Created Date'] || '').localeCompare(String(a['Data'] || a['Created Date'] || '')));
  const ult3 = L.slice(0, 3).map(pctDe), media = ult3.length ? Math.round(ult3.reduce((a, b) => a + b, 0) / ult3.length) : null;
  return { testes: L.length, ultimo: L[0] ? { pct: pctDe(L[0]), data: L[0]['Data'] || L[0]['Created Date'] || null } : null, media, pronto: L.length >= 3 && media >= CODIGO_PRONTO, alvo: CODIGO_PRONTO };
}
app.post('/codigo-perguntas', exigeDireccao, rota(async (req, res) => {
  const L = await bancoCodigo(req.escola);
  res.json({ ok: true, perguntas: L, sinais: SINAIS_CODIGO, activas: L.filter(q => q.activa).length, por_teste: CODIGO_PERGUNTAS });
}));
app.post('/codigo-pergunta-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const pergunta = txt(b.pergunta, 400), opcoes = (Array.isArray(b.opcoes) ? b.opcoes : []).map(o => txt(o, 200)).filter(Boolean);
  if (pergunta.length < 8) return erro(res, 400, 'Escreva a pergunta.');
  if (opcoes.length < 2 || opcoes.length > 4) return erro(res, 400, 'Escreva entre 2 e 4 respostas.');
  const correcta = Math.round(Number(b.correcta));
  if (!(correcta >= 0 && correcta < opcoes.length)) return erro(res, 400, 'Escolha qual é a resposta certa.');
  const imagem = txt(b.imagem, 500);
  if (imagem && !SINAIS_CODIGO.includes(imagem) && !/^https:\/\/\S+$/i.test(imagem)) return erro(res, 400, 'A imagem tem de ser um dos sinais da lista ou um endereço que comece por https://');
  const campos = { 'Escola': req.escola, 'Base': '', 'Tema': txt(b.tema, 40) || 'Geral', 'Pergunta': pergunta, 'Opcoes': JSON.stringify(opcoes), 'Correcta': correcta, 'Explicacao': txt(b.explicacao, 600), 'Imagem': imagem, 'Activa': true };
  let id = b.id ? String(b.id) : null;
  if (id) { const x = await daMinhaEscola('perguntacodigo', id, req.escola); if (x['Base']) return erro(res, 400, 'As perguntas de base não se editam: esconda-a e crie uma sua.'); await mudar('perguntacodigo', id, campos); }
  else id = await criar('perguntacodigo', campos);
  res.json({ ok: true, id });
}));
app.post('/codigo-pergunta-estado', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, id = String(b.id || ''), activa = b.activa !== false;
  if (BANCO_CODIGO.some(q => q.id === id)) {
    const ja = (await procurarTodos('perguntacodigo', daEscola(req.escola).concat([{ key: 'Base', constraint_type: 'equals', value: id }]))).filter(x => x['Escola'] === req.escola)[0];
    if (ja) await mudar('perguntacodigo', ja._id, { 'Activa': activa });
    else if (!activa) await criar('perguntacodigo', { 'Escola': req.escola, 'Base': id, 'Activa': false, 'Pergunta': '(pergunta de base escondida)' });
  } else {
    const x = await daMinhaEscola('perguntacodigo', id, req.escola);
    await mudar('perguntacodigo', x._id, { 'Activa': activa });
  }
  res.json({ ok: true, activa });
}));
app.post('/codigo-resultados', exigeDireccao, rota(async (req, res) => {
  const f = daEscola(req.escola);
  const [ins, ests, ts] = await Promise.all([procurarTodos('inscricaoconducao', f), procurarTodos('estudante', f), procurarTodos('testecodigo', f, 20000).catch(() => [])]);
  const EM = Object.fromEntries(ests.map(e => [e._id, e]));
  const mes = hojeMZ().data.slice(0, 7);
  res.json({ ok: true, alvo: CODIGO_PRONTO, testes_mes: ts.filter(t => String(t['Data'] || t['Created Date'] || '').slice(0, 7) === mes).length,
    instruendos: ins.filter(i => (i['Estado'] || 'activa') === 'activa').map(i => Object.assign({ id: i._id, nome: (EM[i['Estudante']] || {})['Nome'] || '', numero: (EM[i['Estudante']] || {})['Numero'] || '', categoria: i['Categoria'] || '' },
      resumoCodigo(ts.filter(t => t['Inscricao'] === i._id)))).sort((a, b) => (b.media == null ? -1 : b.media) - (a.media == null ? -1 : a.media) || a.nome.localeCompare(b.nome, 'pt')) });
}));
async function inscricaoActivaDe(escola, estId) {
  const l = await procurarTodos('inscricaoconducao', daEscola(escola).concat([{ key: 'Estudante', constraint_type: 'equals', value: estId }]));
  return l.filter(i => (i['Estado'] || 'activa') === 'activa')[0] || null;
}
function embaralhar(a) { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [x[i], x[j]] = [x[j], x[i]]; } return x; }
app.post('/p/codigo-teste', exigePortal, rota(async (req, res) => {
  const est = String((req.body || {}).estudante || '');
  if (!req.educandos.includes(est)) return erro(res, 403, 'Este instruendo não pertence a esta conta.');
  if (travao('codigo|' + est, 30, 60)) return erro(res, 429, 'Já fez muitos testes na última hora. Descanse um pouco e volte mais tarde.');
  const i = await exigeAcessoCodigo(req, est);
  const L = (await bancoCodigo(req.escola)).filter(q => q.activa);
  if (L.length < 5) return erro(res, 400, 'A escola ainda está a preparar as perguntas do código.');
  const escolhidas = embaralhar(L).slice(0, CODIGO_PERGUNTAS);
  const token = assinar({ u: est, t: 'codigo', i: i._id, q: escolhidas.map(q => q.id) }, 1);
  res.json({ ok: true, token, perguntas: escolhidas.map(q => ({ id: q.id, tema: q.tema, pergunta: q.pergunta, opcoes: q.opcoes, imagem: q.imagem })) });
}));
app.post('/p/codigo-corrigir', exigePortal, rota(async (req, res) => {
  const b = req.body || {}, est = String(b.estudante || '');
  if (!req.educandos.includes(est)) return erro(res, 403, 'Este instruendo não pertence a esta conta.');
  const t = verificar(String(b.token || ''));
  if (!t || t.t !== 'codigo' || t.u !== est || !Array.isArray(t.q)) return erro(res, 400, 'Este teste expirou. Comece um novo.');
  const M = Object.fromEntries((await bancoCodigo(req.escola)).map(q => [q.id, q]));
  const resp = (b.respostas && typeof b.respostas === 'object') ? b.respostas : {};
  const correccao = t.q.map(id => M[id]).filter(Boolean).map(q => {
    const r = resp[q.id], esc = (r === null || r === undefined || r === '') ? null : Number(r);
    return { id: q.id, tema: q.tema, pergunta: q.pergunta, opcoes: q.opcoes, imagem: q.imagem, explicacao: q.explicacao, certa: q.correcta, escolhida: esc, acertou: esc === q.correcta };
  });
  const acertos = correccao.filter(x => x.acertou).length, total = correccao.length;
  let guardado = true;
  try {
    await criar('testecodigo', { 'Escola': req.escola, 'Estudante': est, 'Inscricao': t.i, 'Data': new Date().toISOString(), 'Acertos': acertos, 'Total': total, 'Erradas': JSON.stringify(correccao.filter(x => !x.acertou).map(x => x.id)) });
  } catch (e) { guardado = false; console.error('[codigo] não guardou o teste:', e.message); }
  const ts = await procurarTodos('testecodigo', daEscola(req.escola).concat([{ key: 'Inscricao', constraint_type: 'equals', value: t.i }])).catch(() => []);
  res.json({ ok: true, acertos, total, pct: total ? Math.round(acertos * 100 / total) : 0, correccao, guardado, resumo: resumoCodigo(ts) });
}));


// ---------- lições do código (v5.11) ----------
//  Bubble: Licao Codigo: Escola (Escola) · Base (text) · Tema (text) · Titulo (text) · Texto (text) · Ordem (number) · Activa (yes/no)
//          Escola: Codigo Acesso (text: gratis | pago) · Codigo Preco (number)
//          Inscricao Conducao: Codigo Acesso (text: vazio = como a escola | gratis | pago)
//  Cada lição junta o texto e as perguntas com o mesmo Tema. Só instruendos, instrutores e Direcção de escolas de condução.
//  O Código da Estrada de Moçambique está em revisão: as lições de base não trazem limites nem valores; a escola acrescenta os que estão em vigor.
const LICOES_BASE = [
  { id: 'l01', t: 'Sinais', o: 1, ti: 'Sinais de trânsito: formas e cores', x:
'Os sinais falam pela forma e pela cor. Reconhecer a forma de longe dá-lhe tempo para reagir antes de conseguir ler o símbolo.\n\n' +
'- Triângulo com bordo vermelho e vértice para cima: perigo. Avisa de uma curva, de um cruzamento, de peões, de animais ou de obras. Abrande e prepare-se.\n' +
'- Círculo com bordo vermelho: proibição. Proíbe entrar, virar, ultrapassar, parar ou estacionar, entre outras.\n' +
'- Disco vermelho com barra branca: sentido proibido. Não pode entrar na via por esse lado.\n' +
'- Octógono vermelho com a palavra STOP: paragem obrigatória. Pare sempre, mesmo sem trânsito, e só depois avance com segurança.\n' +
'- Triângulo com o vértice para baixo: cedência de passagem. Deixe passar os veículos da outra via; se estiver livre, não precisa de parar.\n\n' +
'Os sinais de obrigação, de indicação e de informação têm formas e cores próprias. O seu instrutor mostra-lhe os modelos usados em Moçambique.\n\n' +
'Lembre-se: as ordens de um agente de trânsito estão acima dos sinais e das regras gerais. Se o agente mandar avançar com o semáforo vermelho, obedeça ao agente.' },
  { id: 'l02', t: 'Semáforos', o: 2, ti: 'Semáforos', x:
'- Vermelho: pare antes da linha de paragem e espere.\n' +
'- Amarelo fixo: pare. Só pode continuar se já estiver tão perto que uma travagem brusca seria perigosa.\n' +
'- Verde: pode avançar, mas com atenção. O verde não lhe dá o direito de atropelar quem ainda está a atravessar o cruzamento ou a passadeira.\n\n' +
'Quando o semáforo está desligado ou avariado, valem os sinais verticais do cruzamento e as regras de prioridade. Aproxime-se devagar e esteja pronto para parar.\n\n' +
'Nunca acelere para «apanhar» o amarelo: é uma das causas mais comuns de choques nos cruzamentos.' },
  { id: 'l03', t: 'Regras', o: 3, ti: 'Regras de circulação', x:
'Em Moçambique circula-se pela esquerda. Mantenha-se o mais à esquerda possível da sua faixa, deixando espaço para quem ultrapassa.\n\n' +
'Ultrapassagem\n' +
'- Faz-se pela direita do veículo ultrapassado.\n' +
'- Antes: verifique os espelhos e o ângulo morto, confirme que tem visibilidade e espaço, e sinalize com o pisca.\n' +
'- Não ultrapasse em curvas, lombas, passadeiras, cruzamentos ou onde haja linha contínua.\n\n' +
'Rotundas: contornam-se no sentido dos ponteiros do relógio. Sinalize a saída.\n\n' +
'Mudanças de direcção e de faixa: sinalize com antecedência e confirme os espelhos. Sinalizar não lhe dá prioridade: só avança quando for seguro.\n\n' +
'Marcas no pavimento: a linha contínua não pode ser pisada nem transposta; a linha descontínua pode ser transposta quando for seguro.\n\n' +
'Parar e estacionar: é proibido em curvas e lombas sem visibilidade, nas passadeiras, nos cruzamentos e onde os sinais o proíbam.\n\n' +
'Velocidade: ajuste sempre a velocidade às condições da via, do tempo e do trânsito, mesmo abaixo do limite. Os limites de velocidade em vigor são dados pelo seu instrutor, de acordo com o Código da Estrada.' },
  { id: 'l04', t: 'Peões', o: 4, ti: 'Peões e utilizadores vulneráveis', x:
'Peões, ciclistas e motociclistas não têm a protecção de uma carroçaria. Um pequeno toque pode ser fatal.\n\n' +
'- Na passadeira, o peão que está a atravessar tem de ser respeitado: pare e espere que termine.\n' +
'- Junto a escolas, mercados, paragens de chapa e machimbombo, abrande: há pessoas a atravessar fora da passadeira.\n' +
'- Crianças podem correr para a estrada sem olhar. Idosos e pessoas com deficiência atravessam mais devagar.\n' +
'- Ao ultrapassar uma bicicleta, deixe bastante espaço lateral.\n' +
'- À noite, peões com roupa escura são difíceis de ver: reduza a velocidade nas zonas habitadas.' },
  { id: 'l05', t: 'Segurança', o: 5, ti: 'Segurança ao volante', x:
'Cinto e crianças\n' +
'- Todos os ocupantes usam cinto nos lugares que o têm.\n' +
'- Crianças viajam num sistema de retenção adequado à idade, de preferência no banco de trás, nunca ao colo.\n\n' +
'Atenção\n' +
'- Não segure o telemóvel a conduzir.\n' +
'- O álcool e as drogas atrasam as reacções e dão falsa confiança. Se vai conduzir, não beba.\n' +
'- O sono mata: numa viagem longa, pare e descanse.\n\n' +
'Distância e tempo\n' +
'- Mantenha distância de segurança ao veículo da frente: é o que lhe permite travar a tempo.\n' +
'- Com chuva, à noite ou com piso de terra, aumente a distância e reduza a velocidade.\n\n' +
'Luzes: use os médios ao cruzar-se com outro veículo ou ao seguir alguém de perto; os máximos encandeiam.\n\n' +
'Veículo: pneus gastos, travões fracos ou luzes fundidas aumentam o risco. Verifique-os com regularidade.\n\n' +
'Animais na via: abrande e, se for preciso, pare até a estrada estar livre.' },
  { id: 'l06', t: 'Avarias', o: 6, ti: 'Avarias na estrada', x:
'Se o veículo avariar:\n' +
'- Tente tirá-lo da faixa de rodagem.\n' +
'- Ligue os quatro piscas.\n' +
'- Coloque o triângulo de pré-sinalização bem visível, antes do veículo, para avisar quem vem atrás.\n' +
'- Saia pelo lado seguro e afaste os passageiros da estrada.\n' +
'- À noite, torne-se visível. Confirme com o instrutor o equipamento obrigatório no veículo.' },
  { id: 'l07', t: 'Primeiros socorros', o: 7, ti: 'Acidentes e primeiros socorros', x:
'Num acidente, siga a ordem: proteger, alertar, socorrer.\n\n' +
'- Proteger: sinalize o local e proteja-se, para não haver um segundo acidente.\n' +
'- Alertar: peça ajuda. Guarde no telemóvel os números de emergência da sua zona.\n' +
'- Socorrer: não mexa nos feridos sem necessidade. Uma lesão na coluna pode piorar. Só os retire se houver perigo imediato, como fogo.\n\n' +
'Enquanto a ajuda não chega: fale com o ferido, mantenha-o quente e não lhe dê de beber. Num motociclista ferido, não tire o capacete, a não ser que ele não consiga respirar.' },
  { id: 'l08', t: 'Motociclos', o: 8, ti: 'Motociclos', x:
'- O capacete, bem apertado, é para o condutor e para o passageiro.\n' +
'- As motas são difíceis de ver: circule com as luzes ligadas e fique fora do ângulo morto dos carros e camiões.\n' +
'- Não circule entre filas de carros nem faça ultrapassagens arriscadas.\n' +
'- Com chuva ou areia na estrada, trave com suavidade: a mota escorrega com facilidade.\n' +
'- Leve só os passageiros e a carga que a mota pode transportar com segurança.' }
];
async function licoesCodigo(escola) {
  const linhas = await procurarTodos('licaocodigo', daEscola(escola), 500).catch(() => []);
  const ocultas = new Set(linhas.filter(x => x['Base'] && x['Activa'] === false).map(x => x['Base']));
  const base = LICOES_BASE.map(l => ({ id: l.id, base: true, tema: l.t, titulo: l.ti, texto: l.x, ordem: l.o, activa: !ocultas.has(l.id) }));
  const proprias = linhas.filter(x => !x['Base'] && x['Titulo']).map(x => ({ id: x._id, base: false, tema: x['Tema'] || 'Geral', titulo: x['Titulo'] || '', texto: x['Texto'] || '', ordem: Number(x['Ordem'] || 50), activa: x['Activa'] !== false }));
  return base.concat(proprias).sort((a, b) => a.ordem - b.ordem || a.titulo.localeCompare(b.titulo, 'pt'));
}
// material de estudo: lições activas com as perguntas do mesmo tema (com a resposta certa, porque é para estudar)
async function materialCodigo(escola) {
  const [ls, qs] = await Promise.all([licoesCodigo(escola), bancoCodigo(escola)]);
  const activas = qs.filter(q => q.activa), usadas = new Set();
  const licoes = ls.filter(l => l.activa).map(l => {
    const perguntas = activas.filter(q => q.tema.toLowerCase() === l.tema.toLowerCase()); perguntas.forEach(q => usadas.add(q.id));
    return { id: l.id, tema: l.tema, titulo: l.titulo, texto: l.texto, perguntas: perguntas.map(q => ({ id: q.id, pergunta: q.pergunta, opcoes: q.opcoes, correcta: q.correcta, explicacao: q.explicacao, imagem: q.imagem })) };
  });
  const soltas = activas.filter(q => !usadas.has(q.id));
  if (soltas.length) licoes.push({ id: 'outras', tema: 'Outras', titulo: 'Outras perguntas da escola', texto: '', perguntas: soltas.map(q => ({ id: q.id, pergunta: q.pergunta, opcoes: q.opcoes, correcta: q.correcta, explicacao: q.explicacao, imagem: q.imagem })) });
  return licoes;
}
// acesso pago ou gratuito
const DESC_ACESSO = 'Acesso ao treino do código';
function modoAcesso(escRaw, ins) { const m = (ins && ins['Codigo Acesso']) || (escRaw && escRaw['Codigo Acesso']) || 'gratis'; return m === 'pago' ? 'pago' : 'gratis'; }
async function acessoCodigo(escola, ins, escRaw) {
  const e = escRaw || await obter('escola', escola).catch(() => null);
  const preco = Number((e && e['Codigo Preco']) || 0), modo = modoAcesso(e, ins);
  if (modo !== 'pago' || !(preco > 0)) return { livre: true, modo: 'gratis', preco: 0 };
  const ps = await procurarTodos('propina', daEscola(escola).concat([{ key: 'Estudante', constraint_type: 'equals', value: ins['Estudante'] }])).catch(() => []);
  const minhas = ps.filter(p => p['Descricao'] === DESC_ACESSO && p['Estado'] !== 'anulada');
  const paga = minhas.find(p => p['Estado'] === 'paga'), aberta = minhas.find(p => p['Estado'] !== 'paga');
  return { livre: !!paga, modo: 'pago', preco, cobranca: aberta ? aberta._id : null };
}
async function exigeAcessoCodigo(req, est) {
  const i = await inscricaoActivaDe(req.escola, est);
  if (!i) throw pub('O treino do código está disponível durante o curso de condução.');
  const a = await acessoCodigo(req.escola, i);
  if (!a.livre) { const e = new Error('O treino do código desta escola é pago (' + mt(a.preco) + '). Pague o acesso nas Prestações.'); e.publico = 402; throw e; }
  return i;
}
app.post('/codigo-licoes', exigeDireccao, rota(async (req, res) => {
  const [ls, e] = await Promise.all([licoesCodigo(req.escola), obter('escola', req.escola)]);
  res.json({ ok: true, licoes: ls, acesso: { modo: (e && e['Codigo Acesso']) === 'pago' ? 'pago' : 'gratis', preco: Number((e && e['Codigo Preco']) || 0) } });
}));
app.post('/codigo-licao-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const titulo = txt(b.titulo, 120), texto = String(b.texto == null ? '' : b.texto).trim().slice(0, 6000);
  if (titulo.length < 3) return erro(res, 400, 'Escreva o título da lição.');
  if (texto.length < 20) return erro(res, 400, 'Escreva o texto da lição.');
  const campos = { 'Escola': req.escola, 'Base': '', 'Tema': txt(b.tema, 40) || 'Geral', 'Titulo': titulo, 'Texto': texto, 'Ordem': Math.max(1, Math.min(999, Math.round(Number(b.ordem) || 50))), 'Activa': true };
  let id = b.id ? String(b.id) : null;
  if (id) { const x = await daMinhaEscola('licaocodigo', id, req.escola); if (x['Base']) return erro(res, 400, 'As lições de base não se editam: esconda-a e crie uma sua.'); await mudar('licaocodigo', id, campos); }
  else id = await criar('licaocodigo', campos);
  res.json({ ok: true, id });
}));
app.post('/codigo-licao-estado', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, id = String(b.id || ''), activa = b.activa !== false;
  if (LICOES_BASE.some(l => l.id === id)) {
    const ja = (await procurarTodos('licaocodigo', daEscola(req.escola).concat([{ key: 'Base', constraint_type: 'equals', value: id }]))).filter(x => x['Escola'] === req.escola)[0];
    if (ja) await mudar('licaocodigo', ja._id, { 'Activa': activa });
    else if (!activa) await criar('licaocodigo', { 'Escola': req.escola, 'Base': id, 'Activa': false, 'Titulo': '', 'Texto': '' });
  } else { const x = await daMinhaEscola('licaocodigo', id, req.escola); await mudar('licaocodigo', x._id, { 'Activa': activa }); }
  res.json({ ok: true, activa });
}));
app.post('/codigo-acesso-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, modo = b.modo === 'pago' ? 'pago' : 'gratis';
  const preco = Math.round(Number(String(b.preco == null ? '' : b.preco).replace(/\s/g, '')) || 0);
  if (modo === 'pago' && !(preco >= MOZ_MIN)) return erro(res, 400, 'Escreva o preço do acesso (pelo menos ' + MOZ_MIN + ' MT, o mínimo para pagar online).');
  await mudar('escola', req.escola, { 'Codigo Acesso': modo, 'Codigo Preco': modo === 'pago' ? preco : 0 });
  res.json({ ok: true, modo, preco: modo === 'pago' ? preco : 0 });
}));
app.post('/inscricao-codigo-acesso', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, v = ['gratis', 'pago'].includes(b.acesso) ? b.acesso : '';
  const i = await daMinhaEscola('inscricaoconducao', String(b.id || ''), req.escola);
  await mudar('inscricaoconducao', i._id, { 'Codigo Acesso': v });
  // ao passar para gratuito, a cobrança do acesso que ainda não foi paga deixa de ser devida
  if (v === 'gratis') {
    const ps = await procurarTodos('propina', daEscola(req.escola).concat([{ key: 'Estudante', constraint_type: 'equals', value: i['Estudante'] }])).catch(() => []);
    for (const p of ps.filter(x => x['Descricao'] === DESC_ACESSO && x['Estado'] !== 'paga' && x['Estado'] !== 'anulada')) await mudar('propina', p._id, { 'Estado': 'anulada' }).catch(() => {});
  }
  res.json({ ok: true, acesso: await acessoCodigo(req.escola, Object.assign({}, i, { 'Codigo Acesso': v })) });
}));
// portal do instruendo
app.post('/p/codigo-estudo', exigePortal, rota(async (req, res) => {
  const est = String((req.body || {}).estudante || '');
  if (!req.educandos.includes(est)) return erro(res, 403, 'Este instruendo não pertence a esta conta.');
  await exigeAcessoCodigo(req, est);
  res.json({ ok: true, licoes: await materialCodigo(req.escola) });
}));
app.post('/p/codigo-acesso', exigePortal, rota(async (req, res) => {
  const est = String((req.body || {}).estudante || '');
  if (!req.educandos.includes(est)) return erro(res, 403, 'Este instruendo não pertence a esta conta.');
  const i = await inscricaoActivaDe(req.escola, est);
  if (!i) return erro(res, 400, 'O treino do código está disponível durante o curso de condução.');
  const a = await acessoCodigo(req.escola, i);
  if (a.livre) return res.json({ ok: true, livre: true });
  let id = a.cobranca;
  if (!id) {
    const hoje = hojeMZ().data, vz = new Date(hoje + 'T21:59:00Z');
    id = await criar('propina', { 'Escola': req.escola, 'Estudante': est, 'Ano Lectivo': hoje.slice(0, 4), 'Tipo': 'prestacao', 'Mes': Number(hoje.slice(5, 7)), 'Descricao': DESC_ACESSO, 'Valor': a.preco, 'Vencimento': vz.toISOString(), 'Multa': 0, 'Total': a.preco, 'Estado': 'aberta' });
  }
  res.json({ ok: true, livre: false, cobranca: id, preco: a.preco });
}));
// instrutores: o mesmo material, para preparar as aulas
app.post('/prof/codigo-estudo', exigeProfessor, rota(async (req, res) => {
  const e = await resumoEscola(req.escola);
  if (!e || !(e.niveis || []).includes('CON')) return erro(res, 403, 'O treino do código é só para escolas de condução.');
  res.json({ ok: true, licoes: await materialCodigo(req.escola) });
}));

// ---------- processo, documentos e licença de aprendizagem ----------
const DOCS_PADRAO = ['Bilhete de Identidade (BI)', 'Atestado médico', 'Fotografias tipo passe'];
const PROCESSO = { documentos: 'A reunir documentos', submetido: 'Processo entregue no INATRO', licenca: 'Licença de aprendizagem emitida', carta: 'Carta emitida' };
async function docsDaEscola(escola, escRaw) {
  const e = escRaw || await obter('escola', escola).catch(() => null);
  const l = lerJSON(e && e['Docs Conducao'], null);
  return Array.isArray(l) && l.length ? l.map(String) : DOCS_PADRAO.slice();
}
function processoOut(i, docs) {
  const d = lerJSON(i['Documentos'], {}), entregues = docs.filter(n => d && d[n]);
  const val = i['Licenca Validade'] || null;
  return { documentos: Object.fromEntries(docs.map(n => [n, !!(d && d[n])])), docs_entregues: entregues.length, docs_total: docs.length, faltam: docs.filter(n => !(d && d[n])),
    processo: PROCESSO[i['Processo']] ? i['Processo'] : 'documentos', processo_nome: PROCESSO[i['Processo']] || PROCESSO.documentos,
    licenca: { numero: i['Licenca Numero'] || '', validade: val, dias: diasAte(val) } };
}
app.post('/conducao-docs', exigeDireccao, rota(async (req, res) => {
  res.json({ ok: true, documentos: await docsDaEscola(req.escola), padrao: DOCS_PADRAO, processos: PROCESSO });
}));
app.post('/conducao-docs-guardar', exigeDireccao, rota(async (req, res) => {
  const l = [...new Set((Array.isArray((req.body || {}).documentos) ? req.body.documentos : []).map(x => txt(x, 60)).filter(Boolean))];
  if (!l.length) return erro(res, 400, 'Escreva pelo menos um documento.');
  if (l.length > 15) return erro(res, 400, 'No máximo 15 documentos.');
  await mudar('escola', req.escola, { 'Docs Conducao': JSON.stringify(l) });
  res.json({ ok: true, documentos: l });
}));
app.post('/inscricao-processo', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const i = await daMinhaEscola('inscricaoconducao', String(b.id || ''), req.escola);
  const docs = await docsDaEscola(req.escola), entregue = {};
  docs.forEach(n => { if (b.documentos && b.documentos[n]) entregue[n] = true; });
  const mud = { 'Documentos': JSON.stringify(entregue), 'Processo': PROCESSO[b.processo] ? b.processo : 'documentos', 'Licenca Numero': txt(b.licenca_numero, 40) };
  if (b.licenca_validade && !isNaN(Date.parse(b.licenca_validade))) mud['Licenca Validade'] = new Date(b.licenca_validade + 'T23:59:00Z').toISOString();
  await mudar('inscricaoconducao', i._id, mud);
  res.json({ ok: true, processo: processoOut(Object.assign({}, i, mud), docs) });
}));

// ---------- aulas teóricas: presenças ----------
const teoricaOut = (t, D) => { const p = lerJSON(t['Presentes'], []); const ids = Array.isArray(p) ? p : [];
  return { id: t._id, data: t['Data'] || '', inicio: t['Inicio'] || '', tema: t['Tema'] || '', instrutor_id: t['Instrutor'] || '', instrutor: ((D.PM[t['Instrutor']] || {})['Nome']) || '',
    presentes: ids, nomes: ids.map(id => (D.EM[(D.IM[id] || {})['Estudante']] || {})['Nome']).filter(Boolean) }; };
app.post('/teoricas', exigeDireccao, rota(async (req, res) => {
  const [D, ts] = await Promise.all([dadosAulas(req.escola), procurarTodos('aulateorica', daEscola(req.escola), 5000)]);
  const conta = {}; ts.forEach(t => (lerJSON(t['Presentes'], []) || []).forEach(id => { conta[id] = (conta[id] || 0) + 1; }));
  res.json({ ok: true, hoje: hojeMZ().data,
    aulas: ts.map(t => teoricaOut(t, D)).sort((a, b) => (b.data + b.inicio).localeCompare(a.data + a.inicio)).slice(0, 200),
    instrutores: D.profs.filter(p => p['Activo'] !== false).map(p => ({ id: p._id, nome: p['Nome'] || '' })).sort((x, y) => x.nome.localeCompare(y.nome, 'pt')),
    inscricoes: D.ins.filter(i => (i['Estado'] || 'activa') === 'activa').map(i => ({ id: i._id, nome: (D.EM[i['Estudante']] || {})['Nome'] || '', numero: (D.EM[i['Estudante']] || {})['Numero'] || '', categoria: i['Categoria'] || '',
      feitas: conta[i._id] || 0, total: Number((D.CM[i['Curso']] || {})['Aulas Teoricas'] || 0) })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')) });
}));
app.post('/teorica-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  if (!dataOk(b.data)) return erro(res, 400, 'Escolha a data da aula.');
  if (b.data > hojeMZ().data) return erro(res, 400, 'Registe a aula teórica no dia em que acontece, com quem esteve presente.');
  if (b.inicio && !HHMM.test(b.inicio)) return erro(res, 400, 'Hora inválida.');
  const D = await dadosAulas(req.escola);
  const presentes = [...new Set((Array.isArray(b.presentes) ? b.presentes : []).map(String))].filter(id => D.IM[id] && D.IM[id]['Escola'] === req.escola);
  if (!presentes.length) return erro(res, 400, 'Marque quem esteve presente.');
  if (b.instrutor && !D.PM[String(b.instrutor)]) return erro(res, 400, 'Instrutor inválido.');
  const campos = { 'Escola': req.escola, 'Data': b.data, 'Inicio': b.inicio || '', 'Tema': txt(b.tema, 120), 'Instrutor': b.instrutor ? String(b.instrutor) : '', 'Presentes': JSON.stringify(presentes) };
  let id = b.id ? String(b.id) : null;
  if (id) { await daMinhaEscola('aulateorica', id, req.escola); await mudar('aulateorica', id, campos); } else id = await criar('aulateorica', campos);
  res.json({ ok: true, id, presentes: presentes.length });
}));
app.post('/teorica-apagar', exigeDireccao, rota(async (req, res) => {
  const t = await daMinhaEscola('aulateorica', String((req.body || {}).id || ''), req.escola);
  await apagar('aulateorica', t._id);
  res.json({ ok: true });
}));

// ---------- lembretes automáticos por SMS (véspera da aula prática e do exame) ----------
const LEMBRETES_HORA = Math.max(8, Math.min(21, Number(process.env.LEMBRETES_HORA || 18)));
const lembretesFeitos = new Set();   // protege contra envios repetidos se o campo Lembrete ainda não existir no Bubble
let lembretesAgora = false;
async function lembretesConducao() {
  if (lembretesAgora || !BUBBLE_BASE || !BUBBLE_TOKEN) return;
  const h = new Date(Date.now() + 2 * 3600e3).getUTCHours();
  if (h < LEMBRETES_HORA || h >= 22) return;
  lembretesAgora = true;
  try {
    const amanha = hojeMZ(1).data, dia = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][new Date(amanha + 'T12:00:00Z').getUTCDay()];
    const [aulas, exames] = await Promise.all([
      procurarTodos('aulapratica', [{ key: 'Data', constraint_type: 'equals', value: amanha }, { key: 'Estado', constraint_type: 'equals', value: 'marcada' }], 5000).catch(() => []),
      procurarTodos('exameconducao', [{ key: 'Data', constraint_type: 'equals', value: amanha }, { key: 'Resultado', constraint_type: 'equals', value: 'marcado' }], 2000).catch(() => [])]);
    if (!aulas.length && !exames.length) return;
    const cache = {}, pega = async (tipo, id) => { const k = tipo + id; if (!(k in cache)) cache[k] = id ? await obter(tipo, id).catch(() => null) : null; return cache[k]; };
    let n = 0;
    for (const a of aulas.filter(x => x['Lembrete'] !== true && !lembretesFeitos.has(x._id))) {
      lembretesFeitos.add(a._id);
      const [esc, e, p, v] = await Promise.all([pega('escola', a['Escola']), pega('estudante', a['Estudante']), pega('professor', a['Instrutor']), pega('viatura', a['Viatura'])]);
      if (!esc || esc['Estado'] === 'suspensa' || !e || tel9(e['Telefone']).length !== 9) continue;
      const r = await smsEscola(esc._id, [e['Telefone']], (esc['Nome'] || 'Escola') + ': lembrete - amanha (' + dia + ' ' + dmCurto(amanha) + ') tem aula pratica das ' + a['Inicio'] + ' as ' + a['Fim'] + (p ? ' com ' + String(p['Nome'] || '').split(' ')[0] : '') + (v ? ', viatura ' + v['Matricula'] : '') + '. Se nao puder vir, avise a escola.');
      if (r.ok) { n++; await mudar('aulapratica', a._id, { 'Lembrete': true }).catch(() => {}); }
    }
    // agenda do dia seguinte para cada instrutor
    const porInst = {};
    aulas.forEach(a => { if (a['Instrutor']) (porInst[a['Instrutor']] = porInst[a['Instrutor']] || []).push(a); });
    for (const [pid, L] of Object.entries(porInst)) {
      const k = 'inst|' + pid + '|' + amanha; if (lembretesFeitos.has(k)) continue; lembretesFeitos.add(k);
      const p = await pega('professor', pid), esc = await pega('escola', L[0]['Escola']);
      if (!p || !esc || esc['Estado'] === 'suspensa' || tel9(p['Telefone']).length !== 9) continue;
      L.sort((x, y) => String(x['Inicio']).localeCompare(String(y['Inicio'])));
      const r = await smsEscola(esc._id, [p['Telefone']], (esc['Nome'] || 'Escola') + ': amanha (' + dia + ' ' + dmCurto(amanha) + ') tem ' + L.length + ' aula(s) pratica(s). A primeira e as ' + L[0]['Inicio'] + '. Veja a agenda no Gescolar.');
      if (r.ok) n++;
    }
    for (const x of exames.filter(z => z['Lembrete'] !== true && !lembretesFeitos.has(z._id))) {
      lembretesFeitos.add(x._id);
      const [esc, e] = await Promise.all([pega('escola', x['Escola']), pega('estudante', x['Estudante'])]);
      if (!esc || esc['Estado'] === 'suspensa' || !e || tel9(e['Telefone']).length !== 9) continue;
      const r = await smsEscola(esc._id, [e['Telefone']], (esc['Nome'] || 'Escola') + ': lembrete - amanha (' + dmCurto(amanha) + ') tem ' + (TIPO_EXAME[x['Tipo']] || 'exame').toLowerCase() + (x['Hora'] ? ' as ' + x['Hora'] : '') + (x['Local'] ? ', ' + String(x['Local']).slice(0, 50) : '') + '. Leve o BI e chegue cedo. Boa sorte!');
      if (r.ok) { n++; await mudar('exameconducao', x._id, { 'Lembrete': true }).catch(() => {}); }
    }
    if (n) console.log('[lembretes] ' + n + ' SMS enviados para ' + amanha);
    if (lembretesFeitos.size > 20000) lembretesFeitos.clear();
  } finally { lembretesAgora = false; }
}
setInterval(() => { lembretesConducao().catch(e => console.error('[lembretes]', e.message)); }, 15 * 60e3);
setTimeout(() => { lembretesConducao().catch(e => console.error('[lembretes]', e.message)); }, 60e3);

// ---------- regras: dívida antes do exame, aula extra e taxa de aprovação por instrutor ----------
async function dividaDe(escola, estId) {
  const [ps, esc] = await Promise.all([procurarTodos('propina', daEscola(escola).concat([{ key: 'Estudante', constraint_type: 'equals', value: estId }])), resumoEscola(escola)]);
  const regras = (esc && esc.regras) || {};
  return ps.filter(p => p['Estado'] !== 'anulada').map(p => calcPropina(p, regras)).filter(c => c.estado === 'atrasada').reduce((x, c) => x + c.total, 0);
}
function taxaPorInstrutor(xs, D) {
  const out = {};
  xs.filter(x => x['Tipo'] === 'conducao' && ['aprovado', 'reprovado'].includes(x['Resultado'])).forEach(x => {
    const conta = {}; D.aulas.filter(a => a['Inscricao'] === x['Inscricao'] && a['Estado'] === 'feita' && a['Instrutor']).forEach(a => { conta[a['Instrutor']] = (conta[a['Instrutor']] || 0) + 1; });
    const pid = Object.keys(conta).sort((a, b) => conta[b] - conta[a])[0]; if (!pid) return;
    const o = out[pid] = out[pid] || { id: pid, nome: (D.PM[pid] || {})['Nome'] || '', exames: 0, aprovados: 0 };
    o.exames++; if (x['Resultado'] === 'aprovado') o.aprovados++;
  });
  return Object.values(out).map(o => Object.assign(o, { taxa: Math.round(o.aprovados * 100 / o.exames) })).sort((a, b) => b.taxa - a.taxa || b.exames - a.exames);
}

// ---------- portal: o percurso do instruendo ----------
async function conducaoDoEstudante(escola, estId, cache) {
  const f = daEscola(escola).concat([{ key: 'Estudante', constraint_type: 'equals', value: estId }]);
  const ins = await procurarTodos('inscricaoconducao', f);
  if (!ins.length) return null;
  const i = ins.filter(x => (x['Estado'] || 'activa') === 'activa')[0] || ins.sort((a, b) => String(b['Created Date'] || '').localeCompare(String(a['Created Date'] || '')))[0];
  const [c, aps, xs, ts, teo, docs] = await Promise.all([obter('cursoconducao', i['Curso']).catch(() => null), procurarTodos('aulapratica', f, 2000), procurarTodos('exameconducao', f, 200),
    procurarTodos('testecodigo', f, 500).catch(() => []), procurarTodos('aulateorica', daEscola(escola), 5000).catch(() => []), docsDaEscola(escola)]);
  const teoFeitas = teo.filter(t => (lerJSON(t['Presentes'], []) || []).includes(i._id)).length;
  if (!cache.profs) cache.profs = Object.fromEntries((await procurarTodos('professor', daEscola(escola))).map(p => [p._id, p['Nome'] || '']));
  if (!cache.vias) cache.vias = Object.fromEntries((await procurarTodos('viatura', daEscola(escola))).map(v => [v._id, v]));
  const minhas = aps.filter(a => a['Inscricao'] === i._id), hoje = hojeMZ().data;
  return { categoria: i['Categoria'] || '', curso: (c && c['Nome']) || '', estado: i['Estado'] || 'activa', teoricas: Number((c && c['Aulas Teoricas']) || 0), teoricas_feitas: teoFeitas,
    codigo: Object.assign(resumoCodigo(ts.filter(t => t['Inscricao'] === i._id)), { acesso: (i['Estado'] || 'activa') === 'activa' ? await acessoCodigo(escola, i).catch(() => ({ livre: true })) : { livre: false, fim: true } }), processo: processoOut(i, docs),
    praticas: { feitas: minhas.filter(a => a['Estado'] === 'feita').length, faltou: minhas.filter(a => a['Estado'] === 'faltou').length, total: Number((c && c['Aulas Praticas']) || 0), minutos: minhas.filter(a => a['Estado'] === 'feita').reduce((x, a) => x + Number(a['Minutos'] || 0), 0) },
    proximas: minhas.filter(a => a['Estado'] === 'marcada' && a['Data'] >= hoje).sort((a, b) => (a['Data'] + a['Inicio']).localeCompare(b['Data'] + b['Inicio'])).slice(0, 10)
      .map(a => ({ data: a['Data'], inicio: a['Inicio'], fim: a['Fim'], instrutor: cache.profs[a['Instrutor']] || '', viatura: (cache.vias[a['Viatura']] || {})['Matricula'] || '', modelo: (cache.vias[a['Viatura']] || {})['Marca Modelo'] || '' })),
    historico: minhas.filter(a => ['feita', 'faltou'].includes(a['Estado'])).sort((a, b) => (b['Data'] + b['Inicio']).localeCompare(a['Data'] + a['Inicio'])).slice(0, 20)
      .map(a => ({ data: a['Data'], inicio: a['Inicio'], estado: a['Estado'], instrutor: cache.profs[a['Instrutor']] || '', notas: a['Notas'] || '' })),
    exames: xs.filter(x => x['Inscricao'] === i._id).map(x => exameOut(x)).sort((a, b) => (b.data.localeCompare(a.data)) || (b.tentativa - a.tentativa) || b.hora.localeCompare(a.hora)) };
}

// ============================================================
//  ESCOLINHA (v5.3): DIÁRIO DA CRIANÇA E AUTORIZADOS A RECOLHER
//  Bubble:
//   Diario Entrada:     Escola (Escola) · Estudante (text) · Turma (text) · Data (text AAAA-MM-DD) · Refeicao (text) · Sesta (text)
//                       · Humor (text) · Actividades (text) · Recado (text) · Feito Por (text)
//   Autorizado Recolha: Escola (Escola) · Estudante (text) · Nome (text) · Parentesco (text) · Telefone (text) · Activo (yes/no) · Criado Por (text)
// ============================================================
const OPC_DIARIO = { refeicao: ['Comeu tudo', 'Comeu metade', 'Comeu pouco', 'Não comeu'], sesta: ['Dormiu bem', 'Dormiu pouco', 'Não dormiu'], humor: ['Bem-disposto', 'Calmo', 'Agitado', 'Choroso', 'Doente'] };
const autOut = a => ({ id: a._id, estudante: a['Estudante'], nome: a['Nome'] || '', parentesco: a['Parentesco'] || '', telefone: a['Telefone'] || '', criado_por: a['Criado Por'] || '' });
async function autorizadosDe(escola, estIds) {
  const l = await procurarTodos('autorizadorecolha', daEscola(escola), 5000);
  return l.filter(a => a['Activo'] !== false && estIds.includes(a['Estudante'])).map(autOut);
}
async function guardarAutorizado(escola, estId, b, quem) {
  const nome = txt(b.nome, 100), tel = tel9(b.telefone);
  if (nome.split(/\s+/).length < 2) { const e = new Error('Escreva o nome completo de quem vai recolher.'); e.publico = 400; throw e; }
  if (tel.length !== 9) { const e = new Error('O telemóvel tem 9 dígitos.'); e.publico = 400; throw e; }
  const actuais = await autorizadosDe(escola, [estId]);
  if (actuais.length >= 8) { const e = new Error('No máximo 8 pessoas autorizadas por criança.'); e.publico = 400; throw e; }
  return criar('autorizadorecolha', { 'Escola': escola, 'Estudante': estId, 'Nome': nome, 'Parentesco': txt(b.parentesco, 30), 'Telefone': tel.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3'), 'Activo': true, 'Criado Por': quem });
}
// Direcção
app.post('/autorizados', exigeDireccao, rota(async (req, res) => {
  const e = await daMinhaEscola('estudante', String((req.body || {}).estudante || ''), req.escola);
  const enc = e['Encarregado'] ? await obter('encarregado', e['Encarregado']).catch(() => null) : null;
  res.json({ ok: true, estudante: { id: e._id, nome: e['Nome'] || '' }, encarregado: enc ? { nome: enc['Nome'] || '', telefone: enc['Telefone'] || '', parentesco: enc['Parentesco'] || '' } : null, autorizados: await autorizadosDe(req.escola, [e._id]) });
}));
app.post('/autorizado-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const e = await daMinhaEscola('estudante', String(b.estudante || ''), req.escola);
  const eu = await obter('user', req.sessao.u).catch(() => null);
  res.json({ ok: true, id: await guardarAutorizado(req.escola, e._id, b, (eu && eu['Nome Completo']) || 'Direcção') });
}));
app.post('/autorizado-apagar', exigeDireccao, rota(async (req, res) => {
  const a = await daMinhaEscola('autorizadorecolha', String((req.body || {}).id || ''), req.escola);
  await mudar('autorizadorecolha', a._id, { 'Activo': false });
  res.json({ ok: true });
}));
// Encarregado (portal)
function exigeEncarregado(req, res, next) {
  const s = sessaoDo(req);
  if (!s || s.t !== 'portal' || s.p !== 'Encarregado') return erro(res, 403, 'Só o encarregado pode mudar quem recolhe a criança.');
  exigePortal(req, res, next);
}
app.post('/p/autorizado-guardar', exigeEncarregado, rota(async (req, res) => {
  const b = req.body || {}, est = String(b.estudante || '');
  if (!req.educandos.includes(est)) return erro(res, 404, 'Registo não encontrado.');
  const enc = await obter('encarregado', req.sessao.u).catch(() => null);
  res.json({ ok: true, id: await guardarAutorizado(req.escola, est, b, 'Encarregado · ' + ((enc && enc['Nome']) || '')) });
}));
app.post('/p/autorizado-apagar', exigeEncarregado, rota(async (req, res) => {
  const a = await daMinhaEscola('autorizadorecolha', String((req.body || {}).id || ''), req.escola);
  if (!req.educandos.includes(a['Estudante'])) return erro(res, 404, 'Registo não encontrado.');
  await mudar('autorizadorecolha', a._id, { 'Activo': false });
  res.json({ ok: true });
}));
// Educadora (professor.html)
async function turmaDoProfessor(req, turmaId) {
  const a = await atribuicoes(req.escola);
  if (!a.pares.some(p => p.turma === turmaId && p.professores.has(req.sessao.u))) { const e = new Error('Não é educador(a) desta turma.'); e.publico = 403; throw e; }
  return a.turmas.find(t => t._id === turmaId);
}
app.post('/prof/diario', exigeProfessor, rota(async (req, res) => {
  const b = req.body || {}, data = dataOk(b.data) ? b.data : hojeMZ().data;
  const t = await turmaDoProfessor(req, String(b.turma || ''));
  const f = daEscola(req.escola);
  const ests = (await procurarTodos('estudante', f.concat([{ key: 'Turma', constraint_type: 'equals', value: t._id }]))).filter(e => (e['Estado'] || 'activo') === 'activo')
    .sort((x, y) => String(x['Nome'] || '').localeCompare(String(y['Nome'] || ''), 'pt'));
  const [ds, auts, encs] = await Promise.all([procurarTodos('diarioentrada', f.concat([{ key: 'Turma', constraint_type: 'equals', value: t._id }, { key: 'Data', constraint_type: 'equals', value: data }])),
    autorizadosDe(req.escola, ests.map(e => e._id)), procurarTodos('encarregado', f)]);
  const EN = Object.fromEntries(encs.map(x => [x._id, x]));
  res.json({ ok: true, turma: { id: t._id, nome: t['Nome'] || '' }, data, hoje: hojeMZ().data, opcoes: OPC_DIARIO,
    criancas: ests.map(e => { const d = ds.find(x => x['Estudante'] === e._id) || {}, en = EN[e['Encarregado']];
      return { id: e._id, nome: e['Nome'] || '', saude: e['Saude Notas'] || '', encarregado: en ? { nome: en['Nome'] || '', telefone: en['Telefone'] || '', parentesco: en['Parentesco'] || '' } : null,
        autorizados: auts.filter(a => a.estudante === e._id), refeicao: d['Refeicao'] || '', sesta: d['Sesta'] || '', humor: d['Humor'] || '', recado: d['Recado'] || '', actividades: d['Actividades'] || '', feito: !!d._id }; }) });
}));
app.post('/prof/diario-guardar', exigeProfessor, rota(async (req, res) => {
  const b = req.body || {}, data = String(b.data || '');
  if (!dataOk(data) || data > hojeMZ().data || data < hojeMZ(-7).data) return erro(res, 400, 'Só pode escrever o diário de hoje ou dos últimos 7 dias.');
  const t = await turmaDoProfessor(req, String(b.turma || ''));
  const f = daEscola(req.escola);
  const [ests, ds, eu] = await Promise.all([procurarTodos('estudante', f.concat([{ key: 'Turma', constraint_type: 'equals', value: t._id }])),
    procurarTodos('diarioentrada', f.concat([{ key: 'Turma', constraint_type: 'equals', value: t._id }, { key: 'Data', constraint_type: 'equals', value: data }])), obter('professor', req.sessao.u).catch(() => null)]);
  const ids = new Set(ests.map(e => e._id)), act = txt(b.actividades, 600);
  let n = 0;
  for (const [est, l] of Object.entries(b.entradas || {})) {
    if (!ids.has(est) || !l) continue;
    const campos = { 'Escola': req.escola, 'Estudante': est, 'Turma': t._id, 'Data': data, 'Actividades': act, 'Feito Por': (eu && eu['Nome']) || 'Educadora',
      'Refeicao': OPC_DIARIO.refeicao.includes(l.refeicao) ? l.refeicao : '', 'Sesta': OPC_DIARIO.sesta.includes(l.sesta) ? l.sesta : '', 'Humor': OPC_DIARIO.humor.includes(l.humor) ? l.humor : '', 'Recado': txt(l.recado, 400) };
    if (!campos['Refeicao'] && !campos['Sesta'] && !campos['Humor'] && !campos['Recado'] && !act) continue;
    const ja = ds.find(x => x['Estudante'] === est);
    if (ja) await mudar('diarioentrada', ja._id, campos); else await criar('diarioentrada', campos);
    n++;
  }
  res.json({ ok: true, guardados: n });
}));
async function diarioDoEstudante(escola, estId) {
  const l = await procurarTodos('diarioentrada', daEscola(escola).concat([{ key: 'Estudante', constraint_type: 'equals', value: estId }]), 200);
  const de = hojeMZ(-14).data;
  return l.filter(x => x['Data'] >= de).map(x => ({ data: x['Data'], refeicao: x['Refeicao'] || '', sesta: x['Sesta'] || '', humor: x['Humor'] || '', actividades: x['Actividades'] || '', recado: x['Recado'] || '', por: x['Feito Por'] || '' }))
    .sort((a, b) => b.data.localeCompare(a.data));
}


// ============================================================
//  INSCRIÇÕES ONLINE (v5.7)
//  A escola cria links públicos (inscricao.html?e=<escola>&l=<codigo>) com a sua capa, texto, preço, prazo e vagas.
//  O candidato preenche os dados, paga a taxa (M-Pesa, e-Mola ou cartão) e fica na lista da Direcção para matricular.
//  Bubble:
//   Link Inscricao:  Escola (Escola) · Codigo (text) · Titulo (text) · Descricao (text) · Preco (number) · Cor (text) · Capa (text)
//                    · Nivel (text) · Prazo (date) · Vagas (number) · Campos (text, JSON) · Mensagem Final (text) · Contacto (text)
//                    · WhatsApp (text) · Activo (yes/no)
//   Inscricao Online: Escola (Escola) · Link (text) · Nome (text) · Telefone (text) · Nascimento (text) · Encarregado Nome (text)
//                    · Encarregado Telefone (text) · Email (text) · Respostas (text, JSON) · Valor (number) · Metodo (text)
//                    · Estado (text: pendente | paga | falhada | matriculada | recusada) · Referencia (text) · Transacao (text)
//                    · Pago Em (date) · Chave (text) · Estudante (text) · Numero (text)
// ============================================================
const TIPOS_CAMPO = ['texto', 'opcoes', 'simnao'];
const COR_OK = c => /^#[0-9a-f]{6}$/i.test(String(c || ''));
function lerCampos(t) { try { const l = JSON.parse(t || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
function validarCampos(lista) {
  const out = [];
  for (const c of (Array.isArray(lista) ? lista : []).slice(0, 10)) {
    const rotulo = txt(c && c.rotulo, 60); if (!rotulo) continue;
    const tipo = TIPOS_CAMPO.includes(c.tipo) ? c.tipo : 'texto';
    const opcoes = tipo === 'opcoes' ? [...new Set((Array.isArray(c.opcoes) ? c.opcoes : String(c.opcoes || '').split(',')).map(o => txt(o, 40)).filter(Boolean))].slice(0, 12) : [];
    if (tipo === 'opcoes' && opcoes.length < 2) throw pub('A pergunta "' + rotulo + '" precisa de pelo menos 2 opções, separadas por vírgulas.');
    out.push({ id: 'c' + (out.length + 1), rotulo, tipo, opcoes, obrigatorio: !!c.obrigatorio });
  }
  return out;
}
const pedeEncarregado = l => !['SUP', 'CON', NIVEIS.SUP, NIVEIS.CON].includes(l['Nivel']);
function fimDoPrazo(l) { return l['Prazo'] ? new Date(String(l['Prazo']).slice(0, 10) + 'T21:59:59Z') : null; }   // fim do dia em Maputo
async function contarInscritos(escola, link) {
  const l = await procurarTodos('inscricaoonline', daEscola(escola).concat([{ key: 'Link', constraint_type: 'equals', value: link._id }]), 5000);
  const validas = l.filter(i => ['paga', 'matriculada'].includes(i['Estado']) || (!Number(link['Preco']) && i['Estado'] !== 'recusada'));
  return { todas: l, validas: validas.length };
}
function situacaoLink(l, inscritos) {
  if (l['Activo'] === false) return { aberto: false, motivo: 'As inscrições deste link estão fechadas.' };
  const fim = fimDoPrazo(l);
  if (fim && Date.now() > fim.getTime()) return { aberto: false, motivo: 'O prazo de inscrição terminou a ' + String(l['Prazo']).slice(8, 10) + '/' + String(l['Prazo']).slice(5, 7) + '/' + String(l['Prazo']).slice(0, 4) + '.' };
  const vagas = Number(l['Vagas'] || 0);
  if (vagas && inscritos >= vagas) return { aberto: false, motivo: 'As vagas já estão todas preenchidas.' };
  return { aberto: true, restantes: vagas ? vagas - inscritos : null };
}
function linkOut(l, extra) {
  return Object.assign({ id: l._id, codigo: l['Codigo'] || '', titulo: l['Titulo'] || '', descricao: l['Descricao'] || '', preco: Number(l['Preco'] || 0), cor: COR_OK(l['Cor']) ? l['Cor'] : '#0A64DC',
    capa: l['Capa'] || '', nivel: CODIGO_NIVEL[l['Nivel']] || l['Nivel'] || '', classe: l['Classe'] || '', curso: l['Curso'] || '', ano_curso: Number(l['Ano Curso'] || 0) || null, prazo: l['Prazo'] ? String(l['Prazo']).slice(0, 10) : '', vagas: Number(l['Vagas'] || 0),
    campos: lerCampos(l['Campos']), mensagem: l['Mensagem Final'] || '', contacto: l['Contacto'] || '', whatsapp: l['WhatsApp'] || '', activo: l['Activo'] !== false,
    encarregado: pedeEncarregado(l) }, extra || {});
}
const inscOut = i => ({ id: i._id, link: i['Link'] || '', nome: i['Nome'] || '', telefone: i['Telefone'] || '', nascimento: i['Nascimento'] || '', enc_nome: i['Encarregado Nome'] || '',
  enc_telefone: i['Encarregado Telefone'] || '', email: i['Email'] || '', respostas: (() => { try { return JSON.parse(i['Respostas'] || '{}'); } catch (e) { return {}; } })(),
  valor: Number(i['Valor'] || 0), metodo: i['Metodo'] || '', estado: i['Estado'] || 'pendente', referencia: i['Referencia'] || '', pago_em: i['Pago Em'] || null,
  criado: i['Created Date'] || null, numero: i['Numero'] || '', estudante: i['Estudante'] || '', classe: i['Classe'] || '', curso: i['Curso'] || '', ano_curso: Number(i['Ano Curso'] || 0) || null,
  sexo: i['Sexo'] || '', tipo_matricula: i['Tipo Matricula'] || 'nova', escola_anterior: i['Escola Anterior'] || '', documentos: docsOut(lerJSON(i['Documentos'], {})) });
function linkPublico(sub, codigo) { return PORTAL_URL.replace(/[^/]*$/, '') + 'inscricao?e=' + encodeURIComponent(sub || '') + '&l=' + encodeURIComponent(codigo || ''); }

// ---------- Direcção ----------
app.post('/links', exigeDireccao, rota(async (req, res) => {
  const f = daEscola(req.escola);
  const [ls, is, esc] = await Promise.all([procurarTodos('linkinscricao', f), procurarTodos('inscricaoonline', f, 10000), obter('escola', req.escola)]);
  res.json({ ok: true, base: linkPublico(esc['Subdominio'], ''), links: ls.map(l => {
    const d = is.filter(i => i['Link'] === l._id), pagas = d.filter(i => i['Estado'] === 'paga').length, mat = d.filter(i => i['Estado'] === 'matriculada').length;
    const sit = situacaoLink(l, d.filter(i => ['paga', 'matriculada'].includes(i['Estado']) || (!Number(l['Preco']) && i['Estado'] !== 'recusada')).length);
    return linkOut(l, { capa: undefined, tem_capa: !!l['Capa'], url: linkPublico(esc['Subdominio'], l['Codigo']), total: d.length, pagas, matriculadas: mat,
      pendentes: d.filter(i => i['Estado'] === 'pendente').length, aberto: sit.aberto, motivo: sit.motivo || '' });
  }).sort((a, b) => Number(b.activo) - Number(a.activo) || a.titulo.localeCompare(b.titulo, 'pt')) });
}));
app.post('/link', exigeDireccao, rota(async (req, res) => {
  const l = await daMinhaEscola('linkinscricao', String((req.body || {}).id || ''), req.escola);
  res.json({ ok: true, link: linkOut(l) });
}));
app.post('/link-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const titulo = txt(b.titulo, 90);
  if (titulo.length < 4) return erro(res, 400, 'Escreva o título do link, por exemplo "Inscrições 2027 · 8ª Classe".');
  const nivel = String(b.nivel || '').toUpperCase();
  if (nivel && !NIVEIS[nivel]) return erro(res, 400, 'Nível inválido.');
  const preco = Math.max(0, Math.round(num(b.preco, 0)));
  if (preco > 500000) return erro(res, 400, 'O preço parece demasiado alto. Verifique o valor.');
  if (preco && preco < MOZ_MIN) return erro(res, 400, 'A taxa tem de ser 0 (gratuita) ou pelo menos ' + MOZ_MIN + ' MT: é o mínimo para pagar online.');
  const capa = String(b.capa || '');
  if (capa && (!/^data:image\/(png|jpe?g|webp);base64,/.test(capa) || capa.length > 420000)) return erro(res, 400, 'A imagem de capa tem de ser JPG, PNG ou WebP e ter no máximo 300 KB.');
  if (b.prazo && !dataOk(b.prazo)) return erro(res, 400, 'Data limite inválida.');
  const campos = validarCampos(b.campos);
  const campos2 = { 'Escola': req.escola, 'Titulo': titulo, 'Descricao': txt(b.descricao, 2000), 'Preco': preco, 'Cor': COR_OK(b.cor) ? b.cor : '#0A64DC', 'Capa': capa,
    'Nivel': nivel ? NIVEIS[nivel] : '', 'Classe': CLASSES[nivel] && CLASSES[nivel].includes(b.classe) ? b.classe : '', 'Curso': (nivel === 'TEC' || nivel === 'SUP') && b.curso ? String(b.curso) : '', 'Ano Curso': (nivel === 'TEC' || nivel === 'SUP') && b.curso ? Math.max(1, Math.round(num(b.ano_curso, 1))) : 0,
    'Vagas': Math.max(0, Math.round(num(b.vagas, 0))), 'Campos': JSON.stringify(campos), 'Mensagem Final': txt(b.mensagem, 600),
    'Contacto': txt(b.contacto, 40), 'WhatsApp': tel9(b.whatsapp).length === 9 ? tel9(b.whatsapp) : '', 'Activo': b.activo !== false };
  if (b.prazo) campos2['Prazo'] = new Date(b.prazo + 'T12:00:00Z').toISOString();
  let id = b.id ? String(b.id) : null;
  if (id) { await daMinhaEscola('linkinscricao', id, req.escola); await mudar('linkinscricao', id, campos2); }
  else {
    const todos = await procurarTodos('linkinscricao', daEscola(req.escola));
    let cod = slug(txt(b.codigo, 30) || titulo).slice(0, 24) || 'inscricao';
    while (todos.some(l => l['Codigo'] === cod)) cod = cod.replace(/-\d{3}$/, '') + '-' + (100 + Math.floor(Math.random() * 900));
    campos2['Codigo'] = cod;
    id = await criar('linkinscricao', campos2);
  }
  const l = await obter('linkinscricao', id), esc = await obter('escola', req.escola);
  res.json({ ok: true, id, codigo: l['Codigo'], url: linkPublico(esc['Subdominio'], l['Codigo']) });
}));
app.post('/link-estado', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const l = await daMinhaEscola('linkinscricao', String(b.id || ''), req.escola);
  await mudar('linkinscricao', l._id, { 'Activo': !!b.activo });
  res.json({ ok: true, activo: !!b.activo });
}));
app.post('/inscricoes-online', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const f = daEscola(req.escola).concat(b.link ? [{ key: 'Link', constraint_type: 'equals', value: String(b.link) }] : []);
  const l = await procurarTodos('inscricaoonline', f, 10000);
  res.json({ ok: true, inscricoes: l.map(inscOut).sort((x, y) => String(y.pago_em || y.criado || '').localeCompare(String(x.pago_em || x.criado || ''))) });
}));
app.post('/inscricao-online-matricular', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const i = await daMinhaEscola('inscricaoonline', String(b.id || ''), req.escola);
  if (i['Estado'] === 'matriculada') return erro(res, 400, 'Esta inscrição já foi matriculada (nº ' + (i['Numero'] || '') + ').');
  if (i['Estado'] !== 'paga') return erro(res, 400, 'Só pode matricular inscrições pagas.');
  let r;
  if (b.curso) {   // escola de condução: inscreve no curso escolhido
    r = await inscreverCore(req.escola, { curso: String(b.curso), nome: i['Nome'], telefone: i['Telefone'] || i['Encarregado Telefone'], nascimento: i['Nascimento'],
      enc_nome: i['Telefone'] ? i['Encarregado Nome'] : '', enc_telefone: i['Telefone'] ? i['Encarregado Telefone'] : '' });
    r = { id: r.estudante, numero: r.numero, sms: r.sms ? 1 : 0 };
  } else {
    // v5.27: a mesma matrícula do balcão — turma automática da classe pedida (ou a turma escolhida), documentos entregues online
    const l = i['Link'] ? await obter('linkinscricao', i['Link']).catch(() => null) : null;
    const nivel = String(b.nivel || CODIGO_NIVEL[(l && l['Nivel']) || ''] || '').toUpperCase();
    r = await matricularCore(req.escola, { nome: i['Nome'], turma: b.turma ? String(b.turma) : '', nivel, classe: b.classe || i['Classe'], curso: b.curso_ensino || i['Curso'], ano: b.ano || i['Ano Curso'],
      sexo: i['Sexo'], tipo: i['Tipo Matricula'] || 'nova', escola_anterior: i['Escola Anterior'], nascimento: i['Nascimento'], telefone: i['Telefone'],
      enc_nome: i['Encarregado Nome'], enc_telefone: i['Encarregado Telefone'], enc_email: i['Email'], docs_atuais: lerJSON(i['Documentos'], {}), origem: 'online', quem: 'Inscrição online', forcar: !!b.forcar });
  }
  await mudar('inscricaoonline', i._id, { 'Estado': 'matriculada', 'Estudante': r.id || '', 'Numero': r.numero || '' });
  res.json({ ok: true, numero: r.numero, sms: r.sms, turma: r.turma, turma_criada: r.turma_criada, docs_completos: r.docs_completos });
}));
app.post('/inscricao-online-recusar', exigeDireccao, rota(async (req, res) => {
  const i = await daMinhaEscola('inscricaoonline', String((req.body || {}).id || ''), req.escola);
  if (i['Estado'] === 'matriculada') return erro(res, 400, 'Esta inscrição já foi matriculada.');
  await mudar('inscricaoonline', i._id, { 'Estado': 'recusada' });
  res.json({ ok: true });
}));

// ---------- página pública ----------
async function linkDaEscola(sub, codigo) {
  const esc = await escolaPorCodigo(sub);
  if (!esc) return {};
  const l = (await procurar('linkinscricao', daEscola(esc._id).concat([{ key: 'Codigo', constraint_type: 'equals', value: slug(codigo) }]), 1))[0];
  return { esc, l };
}
app.post('/pub/link', rota(async (req, res) => {
  const b = req.body || {};
  if (travao('pub-link|' + req.ip, 60, 10)) return erro(res, 429, 'Muitos pedidos seguidos. Espere alguns minutos.');
  const { esc, l } = await linkDaEscola(b.escola, b.link);
  if (!esc || !l) return erro(res, 404, 'Este link de inscrição não existe. Confirme o endereço com a escola.');
  const n = await contarInscritos(esc._id, l), sit0 = situacaoLink(l, n.validas), cfgM = configMatriculas(esc);
  const sit = sit0.aberto && !cfgM.abertas ? { aberto: false, motivo: 'As matrículas desta escola estão fechadas de momento.' } : sit0;
  const nvL = CODIGO_NIVEL[l['Nivel']] || '', cursosL = (nvL === 'TEC' || nvL === 'SUP') ? (await procurarTodos('curso', daEscola(esc._id)).catch(() => [])).filter(c => c['Activo'] !== false).map(c => ({ id: c._id, nome: c['Nome'], grau: c['Grau'] || '', duracao: Number(c['Duracao'] || 1) })) : [];
  res.json({ ok: true, ano_lectivo: cfgM.ano, classes: CLASSES[nvL] || [], cursos: cursosL, docs: cfgM.docs, escola: { nome: esc['Nome'] || '', logotipo: esc['Logotipo'] || '', telefone: esc['Telefone'] || '', email: esc['Email'] || '', morada: esc['Morada'] || '' },
    link: linkOut(l), aberto: sit.aberto, motivo: sit.motivo || '', restantes: sit.restantes == null ? null : sit.restantes });
}));
async function confirmarInscricaoSMS(i, l, esc) {
  const tel = tel9(i['Encarregado Telefone']) || tel9(i['Telefone']);
  if (tel.length !== 9) return false;
  const r = await smsEscola(esc._id || i['Escola'], [tel], (esc['Nome'] || 'A escola') + ': inscricao de ' + i['Nome'] + ' em "' + (l['Titulo'] || '') + '" recebida' +
    (Number(i['Valor']) ? ' e paga (' + Number(i['Valor']) + ' MT)' : '') + '. A escola vai contacta-lo para a matricula.').catch(() => ({ ok: false }));
  return !!r.ok;
}
app.post('/pub/inscrever', rota(async (req, res) => {
  const b = req.body || {};
  if (travao('pub-insc|' + req.ip, 8, 30)) return erro(res, 429, 'Muitas inscrições seguidas a partir desta ligação. Espere meia hora.');
  const { esc, l } = await linkDaEscola(b.escola, b.link);
  if (!esc || !l) return erro(res, 404, 'Este link de inscrição não existe.');
  const n = await contarInscritos(esc._id, l), sit = situacaoLink(l, n.validas);
  if (!sit.aberto) return erro(res, 400, sit.motivo);
  const nome = txt(b.nome, 100);
  if (nome.split(/\s+/).length < 2) return erro(res, 400, 'Escreva o nome completo do candidato.');
  const tel = tel9(b.telefone), telEnc = tel9(b.enc_telefone);
  const comEnc = pedeEncarregado(l);
  if (tel && (tel.length !== 9 || !/^8[2-7]/.test(tel))) return erro(res, 400, 'O telemóvel do candidato deve ter 9 dígitos (ex.: 84 123 4567).');
  const encDado = !!(txt(b.enc_nome, 100) || telEnc);
  if (comEnc || encDado) {   // obrigatório nos outros níveis; no superior e na condução só se for preenchido
    if (txt(b.enc_nome, 100).split(/\s+/).length < 2) return erro(res, 400, 'Escreva o nome completo do encarregado de educação.');
    if (telEnc.length !== 9 || !/^8[2-7]/.test(telEnc)) return erro(res, 400, 'O telemóvel do encarregado deve ter 9 dígitos (ex.: 84 123 4567).');
  }
  if (!comEnc && tel.length !== 9) return erro(res, 400, 'Escreva o seu telemóvel: é por ele que a escola o contacta.');
  if (b.nascimento && !dataOk(b.nascimento)) return erro(res, 400, 'Data de nascimento inválida.');
  const email = txt(b.email, 120).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro(res, 400, 'O email não parece válido.');
  // v5.27: classe (ou curso e ano) pretendida, sexo, tipo de matrícula e documentos
  const nvL = CODIGO_NIVEL[l['Nivel']] || '', cfgM = configMatriculas(esc);
  if (!cfgM.abertas) return erro(res, 400, 'As matrículas desta escola estão fechadas de momento.');
  let classeI = '', cursoI = '', anoI = 0;
  if (CLASSES[nvL]) { classeI = l['Classe'] || classeNorm(nvL, b.classe); if (!CLASSES[nvL].includes(classeI)) return erro(res, 400, nvL === 'ESC' ? 'Escolha a sala (idade).' : 'Escolha a classe que o aluno vai frequentar.'); }
  if (nvL === 'TEC' || nvL === 'SUP') {
    cursoI = l['Curso'] || String(b.curso || '');
    const c = cursoI ? await obter('curso', cursoI).catch(() => null) : null;
    if (!c || c['Escola'] !== esc._id || c['Activo'] === false) return erro(res, 400, 'Escolha o curso.');
    anoI = Number(l['Ano Curso']) || Math.round(num(b.ano_curso, 1)) || 1;
    if (anoI < 1 || anoI > Number(c['Duracao'] || 1)) return erro(res, 400, 'Escolha o ano do curso.');
  }
  const tipoI = TIPOS_MAT[b.tipo] ? b.tipo : 'nova';
  if (tipoI === 'transferencia' && txt(b.escola_anterior, 120).length < 3) return erro(res, 400, 'Escreva o nome da escola de onde vem transferido.');
  const docsEnv = lerDocsEnviados(b.docs);
  if (docsEnv.filter(d => d.ficheiro).length > 8) return erro(res, 400, 'Envie no máximo 8 documentos.');
  const respostas = {};
  for (const c of lerCampos(l['Campos'])) {
    let v = (b.respostas || {})[c.id];
    v = c.tipo === 'simnao' ? (v === true || v === 'sim' ? 'Sim' : v === false || v === 'nao' ? 'Não' : '') : txt(v, 300);
    if (c.tipo === 'opcoes' && v && !c.opcoes.includes(v)) return erro(res, 400, 'Escolha uma opção válida em "' + c.rotulo + '".');
    if (c.obrigatorio && !v) return erro(res, 400, 'Responda a "' + c.rotulo + '".');
    if (v) respostas[c.rotulo] = v;
  }
  const preco = Number(l['Preco'] || 0);
  const metodo = String(b.metodo || '').toLowerCase(), numero = tel9(b.numero);
  if (preco && preco < MOZ_MIN) return erro(res, 400, 'Esta inscrição ainda não pode ser paga online: o valor mínimo é ' + MOZ_MIN + ' MT. Contacte a escola.');
  if (preco) {
    if (!['mpesa', 'emola', 'cartao'].includes(metodo)) return erro(res, 400, 'Escolha como vai pagar: M-Pesa, e-Mola ou cartão.');
    if (!MOZ_WALLET) return erro(res, 500, 'A escola ainda não pode receber pagamentos online.');
    if (metodo !== 'cartao') {
      if (numero.length !== 9) return erro(res, 400, 'Escreva o número que vai pagar, com 9 dígitos.');
      if (metodo === 'mpesa' && !['84', '85'].includes(numero.slice(0, 2))) return erro(res, 400, 'M-Pesa só funciona com números Vodacom (84 ou 85).');
      if (metodo === 'emola' && !['86', '87'].includes(numero.slice(0, 2))) return erro(res, 400, 'e-Mola só funciona com números Movitel (86 ou 87).');
    }
    if (travao('pub-insc-tel|' + (numero || tel || telEnc), 4, 30)) return erro(res, 429, 'Já houve vários pedidos para este número. Espere meia hora.');
  }
  const chave = require('crypto').randomBytes(12).toString('hex');
  const fmt = t => t ? t.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3') : '';
  const campos = { 'Escola': esc._id, 'Link': l._id, 'Nome': nome, 'Telefone': fmt(tel), 'Nascimento': b.nascimento || '', 'Encarregado Nome': (comEnc || encDado) ? txt(b.enc_nome, 100) : '',
    'Encarregado Telefone': (comEnc || encDado) ? fmt(telEnc) : '', 'Email': email, 'Respostas': JSON.stringify(respostas), 'Valor': preco, 'Metodo': preco ? metodo : 'gratis',
    'Estado': preco ? 'pendente' : 'paga', 'Chave': chave,
    'Classe': classeI, 'Curso': cursoI, 'Ano Curso': anoI, 'Sexo': b.sexo === 'F' ? 'F' : b.sexo === 'M' ? 'M' : '', 'Tipo Matricula': tipoI, 'Escola Anterior': txt(b.escola_anterior, 120) };
  if (docsEnv.length) campos['Documentos'] = JSON.stringify(await juntarDocs(esc._id, 'insc-' + chave.slice(0, 10), {}, docsEnv.filter(d => d.ficheiro).map(d => Object.assign(d, { entregue: true })), 'Inscrição online'));
  if (!preco) campos['Pago Em'] = new Date().toISOString();
  const id = await criar('inscricaoonline', campos);
  if (!preco) { const i = await obter('inscricaoonline', id); await confirmarInscricaoSMS(i, l, esc); return res.json({ ok: true, id, chave, estado: 'paga' }); }
  const produto = ('Inscricao ' + (l['Titulo'] || '') + ' · ' + nome).slice(0, 120);
  try {
    if (metodo === 'cartao') {
      const d = await mozPedido(MOZ_CARD_PATH, { valor: String(preco), nome_cliente: nome, carteira: MOZ_WALLET, nome_producto: produto });
      const link = acharLink(d);
      if (!link) throw new Error('sem link na resposta');
      const sessao = String(achar(d, ['session_id', 'sessionId', 'session']) || sessionDoLink(link) || '');
      await mudar('inscricaoonline', id, { 'Referencia': sessao });
      return res.json({ ok: true, id, chave, estado: 'pendente', checkout: link });
    }
    const c2b = await iniciarC2B(metodo, preco, numero, nome, 'Inscricao');
    await mudar('inscricaoonline', id, { 'Referencia': c2b.ref });
    res.json({ ok: true, id, chave, estado: 'pendente', iframe: c2b.iframe, embed: c2b.embed });
  } catch (e) {
    console.error('[inscricao] pagamento', e.message);
    if (e.semResposta) return res.json({ ok: true, id, chave, estado: 'pendente' });
    await mudar('inscricaoonline', id, { 'Estado': 'falhada' }).catch(() => {});
    erro(res, 502, 'O pagamento não foi iniciado: ' + String(e.message).slice(0, 200) + '. Tente de novo.');
  }
}));
app.post('/pub/inscricao-estado', rota(async (req, res) => {
  const b = req.body || {};
  const i = await obter('inscricaoonline', String(b.id || '')).catch(() => null);
  if (!i || !b.chave || i['Chave'] !== String(b.chave)) return erro(res, 404, 'Inscrição não encontrada.');
  res.json({ ok: true, estado: i['Estado'] === 'matriculada' ? 'paga' : (i['Estado'] || 'pendente'), nome: i['Nome'] || '', valor: Number(i['Valor'] || 0) });
}));
// chamado pelo webhook da MozPayment
async function aplicarInscricao(i, b, estado) {
  if (['paga', 'matriculada'].includes(i['Estado'])) return { ok: true, ja: 'aplicado' };
  const valor = Math.round(Number(String(b.amount || '').replace(',', '.')));
  if (estado === 'pago' && valor !== Math.round(Number(i['Valor'] || 0))) { console.warn('[webhook] inscrição: valor diferente'); await mudar('inscricaoonline', i._id, { 'Transacao': txt(b.transaction_id, 120) }); return { ok: true, revisao: true }; }
  if (estado !== 'pago') { await mudar('inscricaoonline', i._id, { 'Estado': 'falhada', 'Transacao': txt(b.transaction_id, 120) }); return { ok: true, estado }; }
  await mudar('inscricaoonline', i._id, { 'Estado': 'paga', 'Pago Em': new Date().toISOString(), 'Transacao': txt(b.transaction_id, 120) });
  const [l, esc] = await Promise.all([obter('linkinscricao', i['Link']).catch(() => ({})), obter('escola', i['Escola']).catch(() => ({}))]);
  await confirmarInscricaoSMS(i, l, esc);
  return { ok: true, estado: 'paga' };
}


// ============================================================
//  SALDO E LEVANTAMENTOS DA ESCOLA (v5.8)
//  O dinheiro pago online (propinas e inscrições) fica na carteira do Gescolar na MozPayment.
//  Cada escola vê o saldo por canal e levanta:
//   · M-Pesa → B2C  POST /wf/b2c-mpesa-imale  { carteira, valor, numero, secret_id, payment_metodo:"mpesa" }
//   · e-Mola → B2C  POST /wf/b2c-emola-imale  { carteira, valor, numero, secret_id, payment_metodo:"emola" }
//   · Cartão → não há B2C: a escola pede o saque e a Plataforma paga e marca como feito.
//  Mínimo 100 MT por levantamento. Pede a palavra-passe de quem levanta.
//  Render: MOZ_SECRET_ID (o secret_id da MozPayment) · LEVANTAMENTO_MIN (opcional, por defeito 100)
//  Bubble, campos novos em Transferencia: Canal (text) · Estado (text: pedido | pendente | concluida | falhada) · Numero (text)
//                                         · Pedido Por (text) · Raw (text)
// ============================================================
const MOZ_SECRET_ID = process.env.MOZ_SECRET_ID || '';
const LEV_MIN = Math.max(1, Number(process.env.LEVANTAMENTO_MIN || 100));
const CANAIS = { mpesa: 'M-Pesa', emola: 'e-Mola', cartao: 'Visa / Mastercard' };
// v5.21.2: os endpoints de levantamento podem ser mudados no Render sem mexer no código.
//   MOZ_B2C_MPESA (por defeito b2c-mpesa-imale) · MOZ_B2C_EMOLA (por defeito b2c-emola-imale)
//   Aceita só o nome (b2c-mpesa-novo) ou o endereço completo (https://mozpayment.co.mz/api/1.1/wf/b2c-mpesa-novo).
const caminhoB2C = (v, padrao) => String(v || padrao).trim().replace(/^https?:\/\/[^]*?\/wf\//i, '').replace(/^\/+|\/+$/g, '') || padrao;
const B2C = { mpesa: caminhoB2C(process.env.MOZ_B2C_MPESA, 'b2c-mpesa-imale'), emola: caminhoB2C(process.env.MOZ_B2C_EMOLA, 'b2c-emola-imale') };
const levando = new Set();   // uma operação de cada vez por escola
const contaTransf = t => !['falhada', 'cancelada'].includes(t['Estado'] || 'concluida');
async function saldoDaEscola(escola) {
  const f = daEscola(escola);
  const [pags, ins, trs] = await Promise.all([procurarTodos('pagamento', f, 50000), procurarTodos('inscricaoonline', f, 20000).catch(() => []), procurarTodos('transferencia', f, 5000)]);
  const C = {};
  for (const k of Object.keys(CANAIS)) C[k] = { canal: k, nome: CANAIS[k], entrou: 0, taxa: 0, saiu: 0, disponivel: 0, pagamentos: 0 };
  const soma = (canal, v) => { const c = C[canal]; if (!c || !(v > 0)) return; c.entrou = limpa(c.entrou + v); c.taxa = limpa(c.taxa + taxaDe(v)); c.pagamentos++; };
  pags.filter(p => p['Estado'] === 'pago').forEach(p => soma(String(p['Metodo'] || '').toLowerCase(), Number(p['Valor'] || 0)));
  ins.filter(i => ['paga', 'matriculada'].includes(i['Estado'])).forEach(i => soma(String(i['Metodo'] || '').toLowerCase(), Number(i['Valor'] || 0)));
  let antigas = 0;
  trs.filter(contaTransf).forEach(t => { const c = C[t['Canal']]; if (c) c.saiu = limpa(c.saiu + Number(t['Valor'] || 0)); else antigas = limpa(antigas + Number(t['Valor'] || 0)); });
  for (const k of ['cartao', 'mpesa', 'emola']) {   // transferências antigas (sem canal) abatem primeiro ao cartão
    const c = C[k], livre = c.entrou - c.taxa - c.saiu, tira = Math.min(Math.max(0, livre), antigas);
    c.saiu = limpa(c.saiu + tira); antigas = limpa(antigas - tira); c.disponivel = Math.max(0, limpa(c.entrou - c.taxa - c.saiu));
  }
  const historico = trs.map(t => ({ id: t._id, canal: t['Canal'] || 'manual', canal_nome: CANAIS[t['Canal']] || 'Transferência', valor: Number(t['Valor'] || 0), numero: t['Numero'] || '',
    estado: t['Estado'] || 'concluida', referencia: t['Referencia'] || '', data: t['Data'] || t['Created Date'] || null, por: t['Pedido Por'] || t['Feita Por'] || '', notas: t['Notas'] || '' }))
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  return { canais: Object.values(C), historico, taxa_pct: TAXA_PROPINAS };
}
async function confirmarSenha(req, senha) {
  const u = await obter('user', req.sessao.u).catch(() => null);
  const email = emailDoUser(u);
  if (!u || !email) throw pub('Não foi possível confirmar a sua conta.');
  if (!senha) throw pub('Escreva a sua palavra-passe para confirmar.');
  const chave = 'lev-senha|' + req.sessao.u, agora = Date.now();
  if ((tentativas.get(chave) || []).filter(t => agora - t < 15 * 60e3).length >= 5) { const e = new Error('Muitas tentativas erradas. Espere 15 minutos.'); e.publico = 429; throw e; }
  try { const r = await workflow('login', { email, password: String(senha) }); if (!r || !r.response || r.response.user_id !== req.sessao.u) throw new Error('outro'); }
  catch (e) { travao(chave, 5, 15); throw pub('A palavra-passe não está certa.'); }   // só as erradas contam
  return u;
}
app.post('/saldo', exigeSoDireccao, rota(async (req, res) => {
  const [s, esc] = await Promise.all([saldoDaEscola(req.escola), obter('escola', req.escola)]);
  res.json(Object.assign({ ok: true, minimo: LEV_MIN, b2c: !!MOZ_SECRET_ID, telefone: tel9(esc['Telefone']) }, s));
}));
// ---------- B2C partilhado (v5.22.2): levantamento da escola e transferência da Plataforma usam o mesmo envio ----------
// Envia o dinheiro de uma Transferencia (Canal mpesa|emola, Numero, Valor) e grava o resultado.
// Devolve { estado: 'concluida'|'pendente'|'falhada', ref, erro? }. Nunca dá como concluída só porque o pedido foi aceite.
const payoutEmCurso = new Set();
async function enviarPayout(tid, holder) {
  if (payoutEmCurso.has(tid)) return { estado: 'pendente', erro: 'Este envio já está a decorrer.' };
  payoutEmCurso.add(tid);
  try {
    const t = await obter('transferencia', tid);
    const canal = String(t['Canal'] || ''), numero = tel9(t['Numero']), valor = Number(t['Valor'] || 0);
    if (!B2C[canal]) return { estado: 'falhada', erro: 'Só M-Pesa ou e-Mola podem ser enviados automaticamente.' };
    if (numero.length !== 9) return { estado: 'falhada', erro: 'O número de destino não é válido.' };
    if (!MOZ_SECRET_ID || !MOZ_WALLET) return { estado: 'falhada', erro: 'Os envios ainda não estão configurados no servidor (MOZ_SECRET_ID / MOZ_WALLET).' };
    let d;
    try {
      d = MOZ_B2C_MODO === 'payout'
        ? await mozPedido(MOZ_PAYOUT_PATH, { phone: numMoz(numero), holder: String(holder || 'Gescolar').slice(0, 80), method: canal, amount: String(valor), wallet: MOZ_WALLET, secret_id: MOZ_SECRET_ID })
        : await mozPedido(B2C[canal], { carteira: MOZ_WALLET, valor: String(valor), numero: numMoz(numero), secret_id: MOZ_SECRET_ID, payment_metodo: canal });
    } catch (e) {
      console.error('[payout] ' + tid + ' ' + e.message);
      if (e.semResposta) { await mudar('transferencia', tid, { 'Estado': 'pendente', 'Raw': String(e.message).slice(0, 2000) }).catch(() => {}); return { estado: 'pendente', erro: 'A MozPayment está a demorar a responder. Fica pendente até confirmar.' }; }
      await mudar('transferencia', tid, { 'Estado': 'falhada', 'Raw': String(e.message).slice(0, 2000) }).catch(() => {});
      return { estado: 'falhada', erro: String(e.message).slice(0, 200) };
    }
    const interno = d && typeof d.response === 'object' && d.response ? d.response : d;
    const st = String(achar(interno, ['status', 'estado', 'payout_status']) || achar(d, ['status', 'estado']) || '').toLowerCase();
    const falhou = ['failed', 'falhou', 'error', 'erro', 'rejected', 'cancelled', 'canceled', 'declined', 'insuf'].some(x => st.includes(x));
    const pendente = !falhou && ['pending', 'pendente', 'processing', 'queued', 'initiated', 'accepted', 'aceite'].some(x => st.includes(x));
    const ref = String(achar(d, ['transaction_id', 'transactionId', 'payout_id', 'payoutId', 'idpayment', 'id_payment', 'reference', 'referencia', 'id']) || '');
    const estado = falhou ? 'falhada' : (pendente || !ref) ? 'pendente' : 'concluida';
    console.log('[payout] ' + tid + ' ' + canal + ' ' + numero + ' ' + valor + ' MT → ' + estado + (ref ? ' ref=' + ref : '') + ' (status=' + (st || '—') + ')');
    await mudar('transferencia', tid, { 'Estado': estado, 'Referencia': ref || t['Referencia'] || '', 'Raw': JSON.stringify(d).slice(0, 4000) });
    return { estado, ref, erro: falhou ? (achar(d, ['message', 'mensagem', 'erro']) || st) : undefined };
  } finally { payoutEmCurso.delete(tid); }
}
app.post('/levantar', exigeSoDireccao, rota(async (req, res) => {
  const b = req.body || {}, canal = String(b.canal || '');
  if (!B2C[canal]) return erro(res, 400, 'Escolha M-Pesa ou e-Mola.');
  if (!MOZ_SECRET_ID || !MOZ_WALLET) return erro(res, 500, 'Os levantamentos ainda não estão configurados no servidor (MOZ_SECRET_ID).');
  const valor = valorMT(b.valor);
  if (isNaN(valor)) return erro(res, 400, 'Escreva o valor em meticais, com até 2 casas decimais (ex.: 150 ou 150,50).');
  if (!(valor >= LEV_MIN)) return erro(res, 400, 'O valor mínimo de cada levantamento é ' + LEV_MIN + ' MT.');
  const numero = tel9(b.numero);
  if (numero.length !== 9) return erro(res, 400, 'Escreva o número que vai receber, com 9 dígitos.');
  if (canal === 'mpesa' && !['84', '85'].includes(numero.slice(0, 2))) return erro(res, 400, 'M-Pesa só envia para números Vodacom (84 ou 85).');
  if (canal === 'emola' && !['86', '87'].includes(numero.slice(0, 2))) return erro(res, 400, 'e-Mola só envia para números Movitel (86 ou 87).');
  if (levando.has(req.escola)) return erro(res, 409, 'Já está um levantamento em curso. Espere que termine.');
  const u = await confirmarSenha(req, b.senha);
  levando.add(req.escola);
  try {
    const s = await saldoDaEscola(req.escola), c = s.canais.find(x => x.canal === canal);
    if (valor > c.disponivel) return erro(res, 400, 'O saldo disponível em ' + CANAIS[canal] + ' é ' + mt(c.disponivel) + '.');
    const quem = u['Nome Completo'] || 'Direcção';
    const id = await criar('transferencia', { 'Escola': req.escola, 'Valor': valor, 'Data': new Date().toISOString(), 'Canal': canal, 'Estado': 'pendente', 'Numero': numero,
      'Metodo': CANAIS[canal] + ' (levantamento)', 'Pedido Por': quem, 'Feita Por': quem });
    let d;
    const titular = txt(b.titular, 80) || (await obter('escola', req.escola).catch(() => ({})))['Nome'] || quem;
    const rp = await enviarPayout(id, titular);
    const ref = rp.ref || '';
    if (rp.estado === 'falhada') return erro(res, 502, 'O levantamento não foi feito: ' + (rp.erro || 'a MozPayment recusou') + '. O valor continua no saldo.');
    if (rp.estado === 'pendente') return res.json({ ok: true, id, estado: 'pendente', referencia: ref, mensagem: rp.erro || 'O levantamento foi aceite e está a ser processado. Fica pendente até a MozPayment confirmar.' });
    const esc = await obter('escola', req.escola).catch(() => null);
    if (esc && tel9(esc['Telefone']).length === 9) enviarSMS([esc['Telefone']], 'Gescolar: levantamento de ' + mt(valor) + ' por ' + CANAIS[canal] + ' para o ' + numero + ' feito por ' + quem + '.').catch(() => {});
    res.json({ ok: true, id, estado: 'concluida', referencia: ref });
  } finally { levando.delete(req.escola); }
}));
app.post('/sacar-cartao', exigeSoDireccao, rota(async (req, res) => {
  const b = req.body || {};
  const valor = valorMT(b.valor);
  if (isNaN(valor)) return erro(res, 400, 'Escreva o valor em meticais, com até 2 casas decimais (ex.: 150 ou 150,50).');
  if (!(valor >= LEV_MIN)) return erro(res, 400, 'O valor mínimo de cada saque é ' + LEV_MIN + ' MT.');
  const destino = txt(b.destino, 200);
  if (destino.length < 6) return erro(res, 400, 'Escreva para onde enviar: banco e NIB, ou número M-Pesa / e-Mola.');
  if (levando.has(req.escola)) return erro(res, 409, 'Já está uma operação em curso. Espere que termine.');
  const u = await confirmarSenha(req, b.senha);
  levando.add(req.escola);
  try {
    const s = await saldoDaEscola(req.escola), c = s.canais.find(x => x.canal === 'cartao');
    if (valor > c.disponivel) return erro(res, 400, 'O saldo disponível de pagamentos com cartão é ' + mt(c.disponivel) + '.');
    const quem = u['Nome Completo'] || 'Direcção';
    const id = await criar('transferencia', { 'Escola': req.escola, 'Valor': valor, 'Data': new Date().toISOString(), 'Canal': 'cartao', 'Estado': 'pedido', 'Metodo': 'Saque de cartão',
      'Notas': 'Enviar para: ' + destino, 'Pedido Por': quem, 'Feita Por': quem });
    res.json({ ok: true, id, estado: 'pedido' });
  } finally { levando.delete(req.escola); }
}));
// Plataforma: pedidos de saque por pagar e levantamentos pendentes
app.post('/pl/saques', exigePlataforma, rota(async (req, res) => {
  const [trs, escolas] = await Promise.all([procurarTodos('transferencia', [], 20000), procurarTodos('escola', [], 5000)]);
  const EN = Object.fromEntries(escolas.map(e => [e._id, e['Nome'] || '']));
  res.json({ ok: true, saques: trs.filter(t => ['pedido', 'pendente'].includes(t['Estado'])).map(t => ({ id: t._id, escola: t['Escola'], escola_nome: EN[t['Escola']] || '', canal: t['Canal'] || '',
    canal_nome: CANAIS[t['Canal']] || '', valor: Number(t['Valor'] || 0), estado: t['Estado'], numero: t['Numero'] || '', notas: t['Notas'] || '', resposta: String(t['Raw'] || '').slice(0, 200), referencia: t['Referencia'] || '', por: t['Pedido Por'] || '', data: t['Data'] || t['Created Date'] || null }))
    .sort((a, b) => String(a.data || '').localeCompare(String(b.data || ''))) });
}));
app.post('/pl/saque-enviar', exigePlataforma, rota(async (req, res) => {
  const t = await obter('transferencia', String((req.body || {}).id || '')).catch(() => null);
  if (!t) return erro(res, 404, 'Pedido não encontrado.');
  if (!B2C[t['Canal']]) return erro(res, 400, 'Só levantamentos M-Pesa ou e-Mola podem ser enviados pela MozPayment.');
  if (t['Estado'] === 'concluida') return erro(res, 409, 'Este envio já está concluído.');
  const e = await obter('escola', t['Escola']).catch(() => ({}));
  const r = await enviarPayout(t._id, (e && e['Nome']) || 'Escola');
  if (r.estado === 'falhada') return erro(res, 502, 'O envio falhou: ' + (r.erro || 'a MozPayment recusou'));
  res.json({ ok: true, estado: r.estado, referencia: r.ref || '' });
}));
app.post('/pl/saque-estado', exigePlataforma, rota(async (req, res) => {
  const b = req.body || {};
  const t = await obter('transferencia', String(b.id || '')).catch(() => null);
  if (!t) return erro(res, 404, 'Pedido não encontrado.');
  if (!['concluida', 'falhada'].includes(b.estado)) return erro(res, 400, 'Estado inválido.');
  const eu = await obter('user', req.sessao.u).catch(() => null);
  await mudar('transferencia', t._id, { 'Estado': b.estado, 'Referencia': txt(b.referencia, 80) || t['Referencia'] || '', 'Feita Por': (eu && eu['Nome Completo']) || 'Plataforma' });
  const e = await obter('escola', t['Escola']).catch(() => null);
  if (b.estado === 'concluida' && e && tel9(e['Telefone']).length === 9) enviarSMS([e['Telefone']], 'Gescolar: o saque de ' + mt(Number(t['Valor'] || 0)) + ' foi pago' + (b.referencia ? '. Ref. ' + txt(b.referencia, 40) : '') + '.').catch(() => {});
  res.json({ ok: true });
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
  // a referência pode vir em reason, reference, payment_id ou dentro de um link /checkout/<código>
  const brutos = [b.reason, b.reference, b.payment_id, b.checkout_id, b.transaction_id].map(x => txt(x, 300)).filter(Boolean);
  const candidatos = [...new Set(brutos.flatMap(x => { const c = /\/checkout\//i.test(x) ? codigoCheckout(x) : null; return c ? [c, x] : [x]; }).map(x => String(x).trim().slice(0, 120)).filter(Boolean))];
  console.log('[webhook] reason=' + (b.reason || '') + ' reference=' + (b.reference || '') + ' status=' + b.status + ' metodo=' + (b.payment_method || '') + ' valor=' + (b.amount || ''));
  try {
    if (MOZ_WALLET && b.wallet && String(b.wallet) !== MOZ_WALLET) { console.warn('[webhook] carteira diferente: ' + b.wallet); return res.json({ ok: true, ignorado: 'carteira' }); }
    let p = null;
    for (const c of candidatos) { const l = await procurar('pagamento', [{ key: 'Referencia', constraint_type: 'equals', value: c }], 1); if (l[0]) { p = l[0]; break; } }
    if (!p) {
      for (const c of candidatos) { const l = await procurar('subscricao', [{ key: 'Referencia', constraint_type: 'equals', value: c }], 1); if (l[0]) return res.json(await aplicarSubscricao(l[0], b, estado)); }
      for (const c of candidatos) { const l = await procurar('recargasms', [{ key: 'Referencia', constraint_type: 'equals', value: c }], 1).catch(() => []); if (l[0]) return res.json(await aplicarRecargaSMS(l[0], b, estado)); }
      for (const c of candidatos) { const l = await procurar('inscricaoonline', [{ key: 'Referencia', constraint_type: 'equals', value: c }], 1).catch(() => []); if (l[0]) return res.json(await aplicarInscricao(l[0], b, estado)); }
      for (const c of candidatos) {   // levantamento (B2C payout) que ficou pendente
        const l = await procurar('transferencia', [{ key: 'Referencia', constraint_type: 'equals', value: c }], 1).catch(() => []);
        if (l[0]) {
          const t = l[0];
          if (['concluida', 'falhada'].includes(t['Estado'])) return res.json({ ok: true, ja: 'aplicado' });
          const novo = estado === 'pago' ? 'concluida' : (estado === 'falhado' || estado === 'expirado') ? 'falhada' : null;
          if (novo) await mudar('transferencia', t._id, { 'Estado': novo, 'Raw': JSON.stringify(b).slice(0, 4000) });
          return res.json({ ok: true, levantamento: novo || 'pendente' });
        }
      }
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

// ============================================================
//  CHAT DA TURMA (v5.14)
//  O professor cria um chat numa turma onde dá aulas. Os estudantes da turma conversam e enviam ficheiros.
//  Os encarregados só lêem (se o professor deixar). A Direcção vê todos, pode apagar mensagens e fechar chats.
//  Ficheiros: no Bunny Storage (zona própria do Gescolar, links que expiram) até CHAT_MAX_MB (por defeito 5 MB).
//  Sem as variáveis do Bunny, ficam no armazenamento do Bubble (/fileupload), como na 5.14.
//  Tabelas: Chat Turma (Escola, Turma, Professor, Nome, Encarregados, So Professor, Activo, Ultima, Ultimo Texto, Mensagens)
//           Mensagem Chat (Escola, Chat, Autor, Autor Nome, Papel, Texto, Ficheiro URL, Ficheiro Nome, Ficheiro Tipo, Tamanho, Apagada)
// ============================================================
const CHAT_MAX_MB = Math.max(1, Math.min(20, Number(process.env.CHAT_MAX_MB || 5)));
const CHAT_TIPOS = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain', csv: 'text/csv', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg', mp4: 'video/mp4' };
const PAPEL_CHAT = { professor: 'Professor', estudante: 'Estudante', encarregado: 'Encarregado', direccao: 'Direcção' };
const BUBBLE_UPLOAD = BUBBLE_BASE.replace(/\/api\/1\.1\/obj$/, '/fileupload');

async function exigeChat(req, res, next) {
  const s = sessaoDo(req);
  if (!s) return erro(res, 401, 'A sessão terminou. Entre outra vez.');
  if (!s.e) return erro(res, 403, 'Esta conta ainda não tem escola.');
  req.sessao = s; req.escola = s.e;
  try {
    if (s.t === 'portal') {
      if (s.p === 'Professor') req.papelChat = 'professor';
      else if (s.p === 'Estudante' || s.p === 'Encarregado') { req.papelChat = s.p === 'Estudante' ? 'estudante' : 'encarregado'; req.educandos = await educandosDe(s); }
      else return erro(res, 403, 'Sem acesso ao chat.');
    } else if (s.p === 'Direccao' || s.p === 'Secretaria') req.papelChat = 'direccao';
    else return erro(res, 403, 'Sem acesso ao chat.');
    next();
  } catch (e) { console.error('[chat]', e.message); erro(res, 500, 'Não foi possível concluir. Tente de novo.'); }
}
// turmas onde o professor dá aulas (pelo horário, pelas disciplinas ou como titular)
async function turmasDoProfessor(escola, prof) {
  const a = await atribuicoes(escola), DM = {};
  const discs = await procurarTodos('disciplina', daEscola(escola));
  discs.forEach(d => { DM[d._id] = d['Nome'] || ''; });
  const T = {};
  for (const t of a.turmas.filter(x => x['Activa'] !== false)) {
    const minhas = a.pares.filter(p => p.turma === t._id && p.professores.has(prof)).map(p => DM[p.disciplina]).filter(Boolean);
    const titular = t['Professor Titular'] === prof;
    if (minhas.length || titular) T[t._id] = { id: t._id, nome: t['Nome'] || '', disciplinas: minhas.sort((x, y) => x.localeCompare(y, 'pt')), titular };
  }
  return T;
}
// turmas dos educandos (portal); com estudante, só a turma desse educando
async function turmasDoPortal(req, estudante) {
  let ids = req.educandos || [];
  if (estudante) { if (!ids.includes(estudante)) { const e = new Error('Estudante não encontrado.'); e.publico = 404; throw e; } ids = [estudante]; }
  const ests = (await Promise.all(ids.map(id => obter('estudante', id).catch(() => null)))).filter(e => e && e['Escola'] === req.escola && e['Turma']);
  return [...new Set(ests.map(e => e['Turma']))];
}
function chatOut(c, extra) {
  return Object.assign({ id: c._id, nome: c['Nome'] || '', turma: c['Turma'] || '', professor: c['Professor'] || '',
    encarregados: c['Encarregados'] !== false, so_professor: c['So Professor'] === true, activo: c['Activo'] !== false,
    ultima: c['Ultima'] || c['Created Date'] || null, ultimo_texto: c['Ultimo Texto'] || '', mensagens: Number(c['Mensagens'] || 0) }, extra || {});
}
// carrega o chat e diz o que esta pessoa pode fazer nele
async function abrirChat(req, id) {
  const c = await obter('chatturma', String(id || '')).catch(() => null);
  const nao = () => { const e = new Error('Chat não encontrado.'); e.publico = 404; return e; };
  if (!c || c['Escola'] !== req.escola) throw nao();
  const p = req.papelChat, activo = c['Activo'] !== false, u = req.sessao.u;
  if (p === 'direccao') return { c, ler: true, escrever: activo, gerir: true };
  if (p === 'professor') {
    if (c['Professor'] !== u) throw nao();
    return { c, ler: true, escrever: activo, gerir: true };
  }
  if (!activo) throw nao();
  const turmas = await turmasDoPortal(req);
  if (!turmas.includes(c['Turma'])) throw nao();
  if (p === 'encarregado' && c['Encarregados'] === false) throw nao();
  return { c, ler: true, escrever: p === 'estudante' && c['So Professor'] !== true, gerir: false };
}
function msgOut(m, req, gerir) {
  const meu = m['Autor'] === req.sessao.u && (m['Papel'] || '') === req.papelChat;
  if (m['Apagada']) return { id: m._id, apagada: true, data: m['Created Date'], mod: m['Modified Date'] };
  return { id: m._id, autor: m['Autor Nome'] || '', papel: m['Papel'] || '', papel_nome: PAPEL_CHAT[m['Papel']] || '', eu: meu,
    texto: m['Texto'] || '', data: m['Created Date'], mod: m['Modified Date'],
    ficheiro: m['Ficheiro URL'] ? { url: linkFicheiro(m['Ficheiro URL']), nome: m['Ficheiro Nome'] || 'ficheiro', tipo: m['Ficheiro Tipo'] || '', tamanho: Number(m['Tamanho'] || 0) } : null,
    pode_apagar: meu || !!gerir };
}
// mensagens: as últimas (ou as mais antigas que «antes»), ou as mudadas depois de «depois» (para actualizar o ecrã)
async function mensagensDo(escola, chat, op) {
  const f = daEscola(escola).concat([{ key: 'Chat', constraint_type: 'equals', value: chat }]);
  if (op.depois) f.push({ key: 'Modified Date', constraint_type: 'greater than', value: op.depois });
  if (op.antes) f.push({ key: 'Created Date', constraint_type: 'less than', value: op.antes });
  const q = '?constraints=' + encodeURIComponent(JSON.stringify(f)) + '&limit=' + (op.limite || 60) + '&sort_field=' + encodeURIComponent(op.depois ? 'Modified Date' : 'Created Date') + '&descending=' + (op.depois ? 'false' : 'true');
  let d; try { d = await bubble('GET', '/mensagemchat' + q); } catch (e) { throw erroTabela('mensagemchat', e); }
  const r = (d && d.response) || {};
  const l = r.results || [];
  return { lista: l.sort((x, y) => String(x['Created Date']).localeCompare(String(y['Created Date']))), mais: !op.depois && !!r.remaining };
}
// envia o ficheiro para o armazenamento do Bubble e devolve o endereço
// ---------- Bunny Storage (v5.15): ficheiros do chat numa storage zone só do Gescolar ----------
//    STORAGE_ZONE      nome da storage zone (ex.: gescolar)
//    STORAGE_PASSWORD  password da storage zone (FTP & API Access → Password)
//    STORAGE_HOST      storage.bunnycdn.com (Falkenstein) ou o da região, ex.: jh.storage.bunnycdn.com
//    CDN_HOST          hostname da pull zone ligada à storage zone (ex.: gescolar.b-cdn.net)
//    CDN_TOKEN_KEY     Security → Token Authentication → Url Token Authentication Key (os links passam a expirar)
const STORAGE_ZONE = (process.env.STORAGE_ZONE || '').trim();
const STORAGE_PASSWORD = (process.env.STORAGE_PASSWORD || '').trim();
const STORAGE_HOST = (process.env.STORAGE_HOST || 'storage.bunnycdn.com').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
const CDN_HOST = (process.env.CDN_HOST || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
const CDN_TOKEN_KEY = (process.env.CDN_TOKEN_KEY || '').trim();
const BUNNY_OK = !!(STORAGE_ZONE && STORAGE_PASSWORD && CDN_HOST);
const LINK_HORAS = 24;   // cada link de ficheiro vale 24 horas; ao abrir o chat outra vez gera-se um novo
const caminhoUrl = c => c.split('/').map(encodeURIComponent).join('/');
async function guardarFicheiroBunny(caminho, base64) {
  const r = await fetch('https://' + STORAGE_HOST + '/' + STORAGE_ZONE + caminhoUrl(caminho), { method: 'PUT', headers: { 'AccessKey': STORAGE_PASSWORD, 'Content-Type': 'application/octet-stream' }, body: Buffer.from(base64, 'base64'), signal: AbortSignal.timeout(60000) })
    .catch(e => { console.error('[bunny] envio', e.message); throw pub('Não foi possível guardar o ficheiro. Tente outra vez.'); });
  if (!r.ok) { console.error('[bunny] envio', r.status, (await r.text().catch(() => '')).slice(0, 200)); throw pub(r.status === 401 ? 'O armazenamento recusou o ficheiro: confira STORAGE_ZONE, STORAGE_PASSWORD e STORAGE_HOST no Render.' : 'Não foi possível guardar o ficheiro (' + r.status + '). Tente outra vez.'); }
  return caminho;
}
async function apagarFicheiroBunny(caminho) {
  if (!BUNNY_OK || !caminho || !caminho.startsWith('/')) return;
  const r = await fetch('https://' + STORAGE_HOST + '/' + STORAGE_ZONE + caminhoUrl(caminho), { method: 'DELETE', headers: { 'AccessKey': STORAGE_PASSWORD }, signal: AbortSignal.timeout(20000) }).catch(e => ({ ok: false, status: e.message }));
  if (!r.ok && r.status !== 404) console.error('[bunny] apagar', r.status);
}
// link para abrir o ficheiro: com CDN_TOKEN_KEY é assinado e expira (Token Authentication do Bunny)
function linkFicheiro(guardado) {
  if (!guardado) return '';
  if (!guardado.startsWith('/')) return guardado;          // ficheiros antigos guardados no Bubble (5.14)
  const path = caminhoUrl(guardado), base = 'https://' + CDN_HOST + path;
  if (!CDN_TOKEN_KEY) return base;
  const expira = Math.floor(Date.now() / 1000) + LINK_HORAS * 3600;
  const token = crypto.createHash('sha256').update(CDN_TOKEN_KEY + path + expira).digest('base64').replace(/\n/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return base + '?token=' + token + '&expires=' + expira;
}
async function guardarFicheiroBubble(nome, base64) {
  if (!BUBBLE_UPLOAD || !BUBBLE_TOKEN) throw pub('O servidor ainda não está configurado (BUBBLE_BASE).');
  const r = await fetch(BUBBLE_UPLOAD, { method: 'POST', headers: { 'Authorization': 'Bearer ' + BUBBLE_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nome, contents: base64, private: false }) });
  const t = (await r.text()).trim();
  if (!r.ok) { console.error('[chat] fileupload', r.status, t.slice(0, 200)); throw pub('O Bubble não aceitou o ficheiro (' + r.status + '). Tente outra vez ou envie um ficheiro mais pequeno.'); }
  let url = t; try { const j = JSON.parse(t); if (typeof j === 'string') url = j; else if (j && (j.url || j.response)) url = j.url || j.response; } catch (e) {}
  url = String(url || '').replace(/^"+|"+$/g, '').trim();
  if (url.startsWith('//')) url = 'https:' + url;
  if (!/^https:\/\//.test(url)) { console.error('[chat] fileupload resposta', t.slice(0, 200)); throw pub('O Bubble não devolveu o endereço do ficheiro.'); }
  return url;
}
function nomeFicheiroLimpo(n) {
  const s = String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').replace(/^\.+/, '');
  return (s || 'ficheiro').slice(-80);
}

// lista de chats (cada papel vê os seus)
app.post('/chat/lista', exigeChat, rota(async (req, res) => {
  const b = req.body || {}, p = req.papelChat, f = daEscola(req.escola);
  if (p === 'professor') {
    const [T, cs] = await Promise.all([turmasDoProfessor(req.escola, req.sessao.u), procurarTodos('chatturma', f.concat([{ key: 'Professor', constraint_type: 'equals', value: req.sessao.u }]), 300)]);
    const chats = cs.filter(c => c['Activo'] !== false).map(c => chatOut(c, { turma_nome: (T[c['Turma']] || {}).nome || 'Turma', pode_gerir: true, pode_escrever: true }));
    return res.json({ ok: true, papel: p, pode_criar: true, max_mb: CHAT_MAX_MB, turmas: Object.values(T).sort((x, y) => x.nome.localeCompare(y.nome, 'pt')), chats: ordenarChats(chats) });
  }
  if (p === 'direccao') {
    const [cs, ts, ps] = await Promise.all([procurarTodos('chatturma', f, 1000), procurarTodos('turma', f), procurarTodos('professor', f)]);
    const TN = Object.fromEntries(ts.map(t => [t._id, t['Nome'] || ''])), PN = Object.fromEntries(ps.map(x => [x._id, x['Nome'] || '']));
    const chats = cs.map(c => chatOut(c, { turma_nome: TN[c['Turma']] || 'Turma', professor_nome: PN[c['Professor']] || '', pode_gerir: true, pode_escrever: c['Activo'] !== false }));
    return res.json({ ok: true, papel: p, pode_criar: false, max_mb: CHAT_MAX_MB, chats: ordenarChats(chats) });
  }
  const turmas = await turmasDoPortal(req, b.estudante ? String(b.estudante) : '');
  if (!turmas.length) return res.json({ ok: true, papel: p, pode_criar: false, max_mb: CHAT_MAX_MB, chats: [] });
  const listas = await Promise.all(turmas.map(t => procurarTodos('chatturma', f.concat([{ key: 'Turma', constraint_type: 'equals', value: t }]), 100)));
  const todos = [].concat(...listas).filter(c => c['Activo'] !== false && (p === 'estudante' || c['Encarregados'] !== false));
  const tIds = [...new Set(todos.map(c => c['Turma']))], pIds = [...new Set(todos.map(c => c['Professor']).filter(Boolean))];
  const [ts, ps] = await Promise.all([Promise.all(tIds.map(id => obter('turma', id).catch(() => null))), Promise.all(pIds.map(id => obter('professor', id).catch(() => null)))]);
  const TN = {}, PN = {}; ts.filter(Boolean).forEach(t => { TN[t._id] = t['Nome'] || ''; }); ps.filter(Boolean).forEach(x => { PN[x._id] = x['Nome'] || ''; });
  const chats = todos.map(c => chatOut(c, { turma_nome: TN[c['Turma']] || 'Turma', professor_nome: PN[c['Professor']] || '', pode_gerir: false, pode_escrever: p === 'estudante' && c['So Professor'] !== true }));
  res.json({ ok: true, papel: p, pode_criar: false, max_mb: CHAT_MAX_MB, chats: ordenarChats(chats) });
}));
function ordenarChats(l) { return l.sort((x, y) => (y.activo - x.activo) || String(y.ultima || '').localeCompare(String(x.ultima || ''))); }

// professor cria ou muda um chat
app.post('/chat/guardar', exigeChat, rota(async (req, res) => {
  const b = req.body || {}, p = req.papelChat;
  if (p !== 'professor' && p !== 'direccao') return erro(res, 403, 'Só o professor pode criar chats.');
  const nome = txt(b.nome, 80);
  if (nome.length < 2) return erro(res, 400, 'Dê um nome ao chat, por exemplo «10ª A · Matemática».');
  const campos = { 'Nome': nome, 'Encarregados': b.encarregados !== false, 'So Professor': b.so_professor === true };
  if (b.id) {
    const x = await abrirChat(req, b.id);
    if (!x.gerir) return erro(res, 403, 'Só o professor deste chat pode mudá-lo.');
    if (p === 'direccao' && typeof b.activo === 'boolean') campos['Activo'] = b.activo;
    await mudar('chatturma', x.c._id, campos);
    return res.json({ ok: true, id: x.c._id });
  }
  if (p !== 'professor') return erro(res, 403, 'Os chats são criados pelos professores.');
  const T = await turmasDoProfessor(req.escola, req.sessao.u), turma = String(b.turma || '');
  if (!T[turma]) return erro(res, 403, 'Só pode criar chats nas turmas onde dá aulas.');
  const meus = await procurarTodos('chatturma', daEscola(req.escola).concat([{ key: 'Professor', constraint_type: 'equals', value: req.sessao.u }]), 300);
  if (meus.filter(c => c['Activo'] !== false).length >= 40) return erro(res, 400, 'Já tem 40 chats abertos. Feche os que já não usa.');
  const id = await criar('chatturma', Object.assign(campos, { 'Escola': req.escola, 'Turma': turma, 'Professor': req.sessao.u, 'Activo': true, 'Ultima': new Date().toISOString(), 'Mensagens': 0, 'Ultimo Texto': '' }));
  res.json({ ok: true, id });
}));
// fechar (professor ou Direcção) — o chat sai da lista dos estudantes; a Direcção pode reabrir
app.post('/chat/fechar', exigeChat, rota(async (req, res) => {
  const b = req.body || {}, x = await abrirChat(req, b.id);
  if (!x.gerir) return erro(res, 403, 'Só o professor deste chat pode fechá-lo.');
  const abrir = req.papelChat === 'direccao' && b.reabrir === true;
  await mudar('chatturma', x.c._id, { 'Activo': abrir });
  res.json({ ok: true, activo: abrir });
}));

app.post('/chat/mensagens', exigeChat, rota(async (req, res) => {
  const b = req.body || {}, x = await abrirChat(req, b.chat);
  const iso = v => { const d = new Date(String(v || '')); return isNaN(d) ? '' : d.toISOString(); };
  const depois = iso(b.depois), antes = iso(b.antes);
  const r = await mensagensDo(req.escola, x.c._id, { depois, antes, limite: depois ? 100 : 60 });
  let marca = depois || '';
  r.lista.forEach(m => { if (String(m['Modified Date'] || '') > marca) marca = m['Modified Date']; });
  res.json({ ok: true, chat: chatOut(x.c, { pode_escrever: x.escrever, pode_gerir: x.gerir }), mensagens: r.lista.map(m => msgOut(m, req, x.gerir)), mais: r.mais, marca: marca || '2000-01-01T00:00:00.000Z', max_mb: CHAT_MAX_MB });
}));

app.post('/chat/enviar', exigeChat, rota(async (req, res) => {
  const b = req.body || {}, x = await abrirChat(req, b.chat);
  if (!x.escrever) return erro(res, 403, x.c['Activo'] === false ? 'Este chat está fechado.' : req.papelChat === 'encarregado' ? 'Os encarregados podem ler o chat, mas não escrever.' : 'Neste chat só o professor escreve.');
  if (travao('chat:' + req.sessao.u, 20, 1)) return erro(res, 429, 'Muitas mensagens seguidas. Espere um minuto.');
  const texto = txt(b.texto, 2000);
  const campos = { 'Escola': req.escola, 'Chat': x.c._id, 'Autor': req.sessao.u, 'Papel': req.papelChat, 'Texto': texto, 'Apagada': false };
  const fx = b.ficheiro;
  if (!texto && !(fx && fx.dados)) return erro(res, 400, 'Escreva uma mensagem ou escolha um ficheiro.');
  if (fx && fx.dados) {
    const nome = nomeFicheiroLimpo(fx.nome), ext = (nome.match(/\.([a-z0-9]{2,5})$/i) || [])[1];
    const tipo = ext && CHAT_TIPOS[ext.toLowerCase()];
    if (!tipo) return erro(res, 400, 'Este tipo de ficheiro não é aceite. Envie PDF, imagens, Word, Excel, PowerPoint, texto ou áudio.');
    const dados = String(fx.dados).replace(/^data:[^,]*,/, '').replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]+=*$/.test(dados)) return erro(res, 400, 'O ficheiro chegou estragado. Tente outra vez.');
    const bytes = Math.floor(dados.length * 3 / 4) - (dados.endsWith('==') ? 2 : dados.endsWith('=') ? 1 : 0);
    if (bytes > CHAT_MAX_MB * 1048576) return erro(res, 400, 'O ficheiro tem mais de ' + CHAT_MAX_MB + ' MB.');
    if (bytes < 1) return erro(res, 400, 'O ficheiro está vazio.');
    if (travao('chatfx:' + req.escola, 300, 60)) return erro(res, 429, 'A escola enviou muitos ficheiros na última hora. Tente mais tarde.');
    campos['Ficheiro URL'] = BUNNY_OK
      ? await guardarFicheiroBunny('/' + req.escola + '/chat/' + x.c._id + '/' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex') + '/' + nome, dados)
      : await guardarFicheiroBubble(nome, dados);
    Object.assign(campos, { 'Ficheiro Nome': nome, 'Ficheiro Tipo': tipo, 'Tamanho': bytes });
  }
  const tabela = { professor: 'professor', estudante: 'estudante', encarregado: 'encarregado' }[req.papelChat];
  const eu = tabela ? await obter(tabela, req.sessao.u).catch(() => null) : await obter('user', req.sessao.u).catch(() => null);
  campos['Autor Nome'] = txt((eu && (eu['Nome'] || eu['Nome Completo'])) || PAPEL_CHAT[req.papelChat], 80);
  const id = await criar('mensagemchat', campos);
  const resumo = (campos['Autor Nome'].split(' ')[0] + ': ' + (texto || '📎 ' + (campos['Ficheiro Nome'] || 'ficheiro'))).slice(0, 120);
  await mudar('chatturma', x.c._id, { 'Ultima': new Date().toISOString(), 'Ultimo Texto': resumo, 'Mensagens': Number(x.c['Mensagens'] || 0) + 1 }).catch(e => console.error('[chat] resumo', e.message));
  const m = await obter('mensagemchat', id).catch(() => null);
  res.json({ ok: true, mensagem: m ? msgOut(m, req, x.gerir) : { id, eu: true, texto, data: new Date().toISOString() } });
}));

app.post('/chat/apagar', exigeChat, rota(async (req, res) => {
  const b = req.body || {};
  const m = await obter('mensagemchat', String(b.id || '')).catch(() => null);
  if (!m || m['Escola'] !== req.escola) return erro(res, 404, 'Mensagem não encontrada.');
  const x = await abrirChat(req, m['Chat']);
  const meu = m['Autor'] === req.sessao.u && m['Papel'] === req.papelChat;
  if (!meu && !x.gerir) return erro(res, 403, 'Só pode apagar as suas mensagens.');
  await mudar('mensagemchat', m._id, { 'Apagada': true, 'Texto': '', 'Ficheiro URL': '' });
  if (m['Ficheiro URL']) await apagarFicheiroBunny(m['Ficheiro URL']);
  res.json({ ok: true });
}));

// ============================================================
//  IMPORTAR ESTUDANTES POR EXCEL (v5.18)
//  A página lê o Excel (modelo do Gescolar) e manda as linhas. Primeiro com testar:true (só valida, mostra os erros
//  linha a linha), depois sem testar para gravar. Os encarregados são reutilizados pelo telemóvel ou criados.
// ============================================================
async function criarEmLoteIds(tipo, lista) {
  const ids = [];
  for (let i = 0; i < lista.length; i += 200) {
    const fatia = lista.slice(i, i + 200);
    const r = await fetch(BUBBLE_BASE + '/' + tipo + '/bulk', { method: 'POST', headers: { 'Authorization': 'Bearer ' + BUBBLE_TOKEN, 'Content-Type': 'text/plain' }, body: fatia.map(x => JSON.stringify(x)).join('\n') });
    const t = await r.text();
    if (!r.ok) {
      let msg = t; try { const d = JSON.parse(t); msg = (d.body && d.body.message) || d.message || t; } catch (e) {}
      throw erroGravar(tipo, Object.assign(new Error(msg), { status: r.status === 404 ? 404 : 400, bubble: String(msg).slice(0, 200) }));
    }
    const linhas = t.split('\n').filter(Boolean);
    fatia.forEach((x, k) => { let id = null; try { const d = JSON.parse(linhas[k] || '{}'); if (d.status === 'success') id = d.id; else if (k === 0 && !ids.length && d.message) console.error('[lote] ' + tipo + ': ' + d.message); } catch (e) {} ids.push(id); });
  }
  return ids;
}
const normNome = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ºª]+/g, ' ').trim();
// aceita AAAA-MM-DD, DD/MM/AAAA, DD-MM-AAAA ou DD.MM.AAAA
function dataValida(iso) { const d = new Date(iso + 'T12:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === iso && +iso.slice(0, 4) > 1900 ? iso : null; }
function dataImport(v) {
  const s = String(v || '').trim(); if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return dataValida(m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0'));
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/); if (m) return dataValida(m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'));
  return null;
}
app.post('/importar-estudantes', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, testar = b.testar !== false, comSMS = b.sms === true;
  const linhas = Array.isArray(b.linhas) ? b.linhas.slice(0, 1000) : [];
  if (!linhas.length) return erro(res, 400, 'O ficheiro não tem estudantes. Preencha a folha «Estudantes» do modelo a partir da linha 2.');
  if (!testar && travao('importar|' + req.escola, 40, 60)) return erro(res, 429, 'Muitas importações seguidas. Espere um pouco.');
  const f = daEscola(req.escola);
  const [turmas, ests, encs, escola] = await Promise.all([procurarTodos('turma', f), procurarTodos('estudante', f), procurarTodos('encarregado', f), resumoEscola(req.escola)]);
  const TN = {}; turmas.filter(t => t['Activa'] !== false).forEach(t => { TN[normNome(t['Nome'])] = t; TN[t._id] = t; });
  const jaNaTurma = new Set(ests.filter(e => (e['Estado'] || 'activo') !== 'apagado').map(e => e['Turma'] + '|' + normNome(e['Nome'])));
  const encPorTel = {}; encs.forEach(e => { const t = tel9(e['Telefone']); if (t.length === 9) encPorTel[t] = e; });
  const novosEnc = {};   // telefone → {nome, email, parentesco}
  const vistos = new Set(), resultado = [], validas = [];
  linhas.forEach((l, i) => {
    const n = Number(l.linha) || i + 2, erros = [];
    const nome = txt(l.nome, 100).replace(/\s+/g, ' ');
    if (nome.split(' ').filter(Boolean).length < 2) erros.push('falta o nome e o apelido do estudante');
    const turma = TN[String(l.turma || '')] || TN[normNome(l.turma)];
    if (!turma) erros.push(l.turma ? 'a turma «' + txt(l.turma, 40) + '» não existe (veja a folha Turmas)' : 'falta a turma');
    const superior = turma && (turma['Nivel'] === NIVEIS.SUP || turma['Nivel'] === 'SUP');
    const sexo = String(l.sexo || '').trim().toUpperCase().charAt(0);
    if (sexo && sexo !== 'M' && sexo !== 'F') erros.push('sexo deve ser M ou F');
    const nasc = dataImport(l.nascimento);
    if (nasc === null) erros.push('data de nascimento inválida (use DD/MM/AAAA)');
    const telE = tel9(l.telefone);
    if (String(l.telefone || '').trim() && (telE.length !== 9 || !/^8[2-7]/.test(telE))) erros.push('telemóvel do estudante inválido');
    if (superior && telE.length !== 9) erros.push('no ensino superior o telemóvel do estudante é obrigatório');
    const encNome = txt(l.enc_nome, 100).replace(/\s+/g, ' '), telEnc = tel9(l.enc_telefone), encEmail = txt(l.enc_email, 120).toLowerCase();
    let enc = null;
    if (encNome || String(l.enc_telefone || '').trim()) {
      if (telEnc.length !== 9 || !/^8[2-7]/.test(telEnc)) erros.push('telemóvel do encarregado inválido (9 dígitos, começa por 82 a 87)');
      else if (encPorTel[telEnc]) enc = { id: encPorTel[telEnc]._id, tel: encPorTel[telEnc]['Recebe SMS'] === false ? '' : telEnc };
      else if (novosEnc[telEnc]) enc = { novo: telEnc, tel: telEnc };
      else if (encNome.split(' ').filter(Boolean).length < 2) erros.push('falta o nome completo do encarregado');
      else enc = { novo: telEnc, tel: telEnc, nome: encNome };
      if (encEmail && !emailOk(encEmail)) erros.push('email do encarregado inválido');
    } else if (turma && !superior) erros.push('encarregado obrigatório neste nível (nome e telemóvel)');
    const chave = turma ? turma._id + '|' + normNome(nome) : '';
    if (turma && nome && jaNaTurma.has(chave)) erros.push('já está matriculado nesta turma');
    else if (chave && vistos.has(chave)) erros.push('repetido no ficheiro');
    if (chave) vistos.add(chave);
    if (erros.length) { resultado.push({ linha: n, nome, ok: false, erro: erros.join('; ') }); return; }
    if (enc && enc.nome) novosEnc[telEnc] = { nome: encNome, email: encEmail, parentesco: txt(l.enc_parentesco, 30) };
    validas.push({ n, nome, turma, superior, sexo, nasc, telE, enc });
    resultado.push({ linha: n, nome, ok: true, turma: turma['Nome'] || '', novo_encarregado: !!(enc && enc.novo) });
  });
  const resumo = { total: linhas.length, validas: validas.length, com_erro: linhas.length - validas.length, novos_encarregados: Object.keys(novosEnc).length };
  if (testar || !validas.length) return res.json({ ok: true, testar: true, resumo, linhas: resultado });
  // 1) encarregados novos
  const telsNovos = Object.keys(novosEnc);
  const idsEnc = await criarEmLoteIds('encarregado', telsNovos.map(t => ({ 'Escola': req.escola, 'Nome': novosEnc[t].nome, 'Telefone': t.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3'), 'Email': novosEnc[t].email, 'Parentesco': novosEnc[t].parentesco, 'Recebe SMS': true, 'Activo': true })));
  const encId = {}; telsNovos.forEach((t, k) => { encId[t] = idsEnc[k]; });
  // 2) estudantes, com número ano-sequência
  const ano = (escola && escola.ano) || String(new Date().getFullYear());
  let maior = ests.map(e => String(e['Numero'] || '')).filter(x => x.startsWith(ano + '-')).map(x => parseInt(x.split('-')[1], 10) || 0).reduce((a, c) => Math.max(a, c), 0);
  const agora = new Date().toISOString();
  const lote = validas.map(v => {
    v.numero = ano + '-' + String(++maior).padStart(4, '0');
    const c = { 'Escola': req.escola, 'Numero': v.numero, 'Nome': v.nome, 'Sexo': v.sexo || '', 'Turma': v.turma._id, 'Classe': v.turma['Classe'] || '', 'Curso': v.turma['Curso'] || '', 'Ano Curso': Number(v.turma['Ano Curso'] || 0), 'Tipo Matricula': 'nova', 'Origem': 'importacao', 'Ano Lectivo': ano, 'Data Matricula': agora, 'Estado': 'activo' };
    if (v.nasc) c['Data Nascimento'] = new Date(v.nasc + 'T12:00:00Z').toISOString();
    if (v.telE.length === 9) c['Telefone'] = v.telE.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3');
    const eid = v.enc ? (v.enc.id || encId[v.enc.novo]) : null; if (eid) c['Encarregado'] = eid;
    return c;
  });
  const idsEst = await criarEmLoteIds('estudante', lote);
  let criados = 0, sms = 0;
  const esc = comSMS ? await obter('escola', req.escola).catch(() => null) : null;
  for (let k = 0; k < validas.length; k++) {
    const v = validas[k], r = resultado.find(x => x.linha === v.n);
    if (!idsEst[k]) { r.ok = false; r.erro = 'o Bubble não gravou esta linha'; continue; }
    criados++; r.numero = v.numero;
    if (esc) {
      const link = noGescolar(esc['Subdominio']), en = esc['Nome'] || 'A escola', tn = v.turma['Nome'] || '';
      if (v.telE.length === 9 && (await smsEscola(req.escola, [v.telE], en + ': ' + (v.superior ? 'bem-vindo(a), ' + v.nome.split(' ')[0] + '. Esta inscrito(a) em ' : v.nome + ' esta matriculado(a) na ') + tn + ' com o numero ' + v.numero + '. Veja notas, horario e propinas ' + link + ' (escolha Estudante e escreva ' + v.numero + ').')).ok) sms++;
      if (v.enc && v.enc.tel && v.enc.tel !== v.telE && (await smsEscola(req.escola, [v.enc.tel], en + ': ' + v.nome + ' foi matriculado(a) na ' + tn + ' com o numero ' + v.numero + '. Veja propinas, recibos e notas e pague por M-Pesa ou e-Mola ' + link + ' (escolha Encarregado e use este numero de telemovel).')).ok) sms++;
    }
  }
  cachePainel.delete(req.escola);
  res.json({ ok: true, testar: false, resumo: Object.assign(resumo, { criados, sms }), linhas: resultado });
}));

// ============================================================
//  PLANOS DE AULA (v5.18) — modelo usado nas escolas moçambicanas
//  Cabeçalho (unidade temática, tema, objectivos, meios, métodos…) e as quatro funções didácticas:
//  Introdução e Motivação · Mediação e Assimilação · Domínio e Consolidação · Controlo e Avaliação.
//  O professor faz (à mão ou com rascunho da IA, opcional), submete; a Direcção dá o visto ou devolve com comentário.
//  Bubble: Plano Aula — Escola (Escola), Professor, Turma, Disciplina, Data, Tema, Estado, Dados, Comentario, Visto Por (text), Visto Em, Submetido Em (date)
// ============================================================
const FUNCOES_DIDACTICAS = ['Introdução e Motivação', 'Mediação e Assimilação', 'Domínio e Consolidação', 'Controlo e Avaliação'];
const ESTADOS_PLANO = { rascunho: 'Rascunho', submetido: 'Submetido', aprovado: 'Aprovado', devolvido: 'Devolvido' };
function lerDadosPlano(d) {
  d = d && typeof d === 'object' ? d : {};
  const t = (k, m) => txt(d[k], m || 600);
  const dur = Math.max(10, Math.min(300, Math.round(Number(d.duracao) || 45)));
  const fases = FUNCOES_DIDACTICAS.map((f, i) => { const x = (Array.isArray(d.fases) ? d.fases[i] : null) || {};
    return { funcao: f, tempo: Math.max(0, Math.min(300, Math.round(Number(x.tempo) || 0))), conteudo: txt(x.conteudo, 1500), professor: txt(x.professor, 1500), aluno: txt(x.aluno, 1500), metodos: txt(x.metodos, 300), meios: txt(x.meios, 300) }; });
  return { trimestre: Math.max(0, Math.min(3, Number(d.trimestre) || 0)), licao: txt(d.licao, 10), unidade: t('unidade', 200), tema: t('tema', 200), tipo: t('tipo', 80), duracao: dur,
    objectivos: t('objectivos', 1500), competencias: t('competencias', 1000), meios: t('meios', 400), metodos: t('metodos', 400), bibliografia: t('bibliografia', 600), observacoes: t('observacoes', 1000), fases };
}
function planoOut(p, N) {
  N = N || {};
  return { id: p._id, professor: p['Professor'] || '', professor_nome: (N.prof || {})[p['Professor']] || '', turma: p['Turma'] || '', turma_nome: (N.turma || {})[p['Turma']] || '', classe: (N.classe || {})[p['Turma']] || '',
    disciplina: p['Disciplina'] || '', disciplina_nome: (N.disc || {})[p['Disciplina']] || '', data: p['Data'] || '', tema: p['Tema'] || '', estado: p['Estado'] || 'rascunho',
    comentario: p['Comentario'] || '', visto_por: p['Visto Por'] || '', visto_em: p['Visto Em'] || null, submetido_em: p['Submetido Em'] || null, actualizado: p['Modified Date'] || null,
    dados: N.semDados ? undefined : lerDadosPlano(lerJSON(p['Dados'], {})) };
}
async function nomesPlanos(escola) {
  const f = daEscola(escola);
  const [ts, ds, ps, esc] = await Promise.all([procurarTodos('turma', f), procurarTodos('disciplina', f), procurarTodos('professor', f), obter('escola', escola).catch(() => null)]);
  const N = { turma: {}, classe: {}, disc: {}, prof: {}, escola: (esc && esc['Nome']) || '', logotipo: (esc && esc['Logotipo']) || '' };
  ts.forEach(t => { N.turma[t._id] = t['Nome'] || ''; N.classe[t._id] = t['Classe'] || ''; }); ds.forEach(d => { N.disc[d._id] = d['Nome'] || ''; }); ps.forEach(p => { N.prof[p._id] = p['Nome'] || ''; });
  return N;
}
function validarSubmissao(d) {
  if (!d.tema) return 'Escreva o tema da aula.';
  if (!d.objectivos) return 'Escreva os objectivos da aula.';
  const vazias = d.fases.filter(f => !f.conteudo && !f.professor && !f.aluno).map(f => f.funcao);
  if (vazias.length) return 'Preencha as funções didácticas: falta ' + vazias.join(', ') + '.';
  return null;
}
// professor: os seus planos e as turmas/disciplinas que dá
app.post('/prof/planos', exigeProfessor, rota(async (req, res) => {
  const [a, N, ps] = await Promise.all([atribuicoes(req.escola), nomesPlanos(req.escola), procurarTodos('planoaula', daEscola(req.escola).concat([{ key: 'Professor', constraint_type: 'equals', value: req.sessao.u }]), 1000)]);
  const pares = a.pares.filter(p => p.professores.has(req.sessao.u) && N.turma[p.turma] && N.disc[p.disciplina])
    .map(p => ({ turma: p.turma, turma_nome: N.turma[p.turma], classe: N.classe[p.turma], disciplina: p.disciplina, disciplina_nome: N.disc[p.disciplina] }))
    .sort((x, y) => x.turma_nome.localeCompare(y.turma_nome, 'pt') || x.disciplina_nome.localeCompare(y.disciplina_nome, 'pt'));
  res.json({ ok: true, escola: N.escola, logotipo: N.logotipo, professor: N.prof[req.sessao.u] || '', ia: !!OPENAI_KEY, pares,
    planos: ps.map(p => planoOut(p, Object.assign({ semDados: true }, N))).sort((x, y) => String(y.data).localeCompare(String(x.data)) || String(y.actualizado).localeCompare(String(x.actualizado))) });
}));
app.post('/prof/plano', exigeProfessor, rota(async (req, res) => {
  const p = await daMinhaEscola('planoaula', String((req.body || {}).id || ''), req.escola);
  if (p['Professor'] !== req.sessao.u) return erro(res, 404, 'Plano não encontrado.');
  res.json({ ok: true, plano: planoOut(p, await nomesPlanos(req.escola)) });
}));
app.post('/prof/plano-guardar', exigeProfessor, rota(async (req, res) => {
  const b = req.body || {}, turma = String(b.turma || ''), disc = String(b.disciplina || '');
  if (!await podeLancar(req, turma, disc)) return erro(res, 403, 'Só pode fazer planos das disciplinas e turmas onde dá aulas.');
  const data = dataImport(b.data); if (!data) return erro(res, 400, 'Escolha a data da aula.');
  const d = lerDadosPlano(b.dados);
  if (b.submeter) { const e = validarSubmissao(d); if (e) return erro(res, 400, e); }
  const campos = { 'Turma': turma, 'Disciplina': disc, 'Data': data, 'Tema': d.tema || 'Sem tema', 'Dados': JSON.stringify(d) };
  if (b.submeter) Object.assign(campos, { 'Estado': 'submetido', 'Submetido Em': new Date().toISOString() });
  let id = b.id ? String(b.id) : '';
  if (id) {
    const p = await daMinhaEscola('planoaula', id, req.escola);
    if (p['Professor'] !== req.sessao.u) return erro(res, 404, 'Plano não encontrado.');
    if (p['Estado'] === 'aprovado') return erro(res, 409, 'Este plano já tem o visto da Direcção e não pode ser mudado. Faça uma cópia.');
    if (!b.submeter && p['Estado'] === 'submetido') campos['Estado'] = 'rascunho';   // mexeu depois de submeter: volta a rascunho até submeter outra vez
    await mudar('planoaula', id, campos);
  } else {
    if (travao('plano|' + req.sessao.u, 60, 60)) return erro(res, 429, 'Muitos planos seguidos. Espere um pouco.');
    id = await criar('planoaula', Object.assign({ 'Escola': req.escola, 'Professor': req.sessao.u, 'Estado': b.submeter ? 'submetido' : 'rascunho', 'Comentario': '' }, campos));
  }
  res.json({ ok: true, id, estado: campos['Estado'] || (b.submeter ? 'submetido' : 'rascunho') });
}));
app.post('/prof/plano-apagar', exigeProfessor, rota(async (req, res) => {
  const p = await daMinhaEscola('planoaula', String((req.body || {}).id || ''), req.escola);
  if (p['Professor'] !== req.sessao.u) return erro(res, 404, 'Plano não encontrado.');
  if (p['Estado'] === 'aprovado') return erro(res, 409, 'Um plano com o visto da Direcção não pode ser apagado.');
  await apagar('planoaula', p._id);
  res.json({ ok: true });
}));
// rascunho com IA (opcional): o professor revê e corrige tudo antes de guardar
const IA_PLANO = 'És um professor experiente em Moçambique e preparas planos de aula no modelo usado nas escolas moçambicanas (MINEDH).\n' +
  'Escreve em português de Moçambique (norma europeia: «actividade», «objectivo», «facto»).\n' +
  'Responde só com JSON neste formato:\n' +
  '{"objectivos":"…","competencias":"…","meios":"…","metodos":"…","bibliografia":"…","fases":[{"tempo":5,"conteudo":"…","professor":"…","aluno":"…","metodos":"…","meios":"…"}, …4 fases]}\n' +
  'As 4 fases são, por esta ordem: Introdução e Motivação; Mediação e Assimilação; Domínio e Consolidação; Controlo e Avaliação.\n' +
  'Regras:\n' +
  '- A soma dos tempos das 4 fases é igual à duração da aula.\n' +
  '- Objectivos específicos, mensuráveis, cada um numa linha começada por «- » e por um verbo no infinitivo (identificar, explicar, resolver…).\n' +
  '- Actividades do professor e do aluno concretas, em frases curtas, uma por linha começada por «- ».\n' +
  '- Usa meios simples que existem numa escola moçambicana (quadro, giz, livro do aluno, cartazes, objectos do dia-a-dia).\n' +
  '- Adequa ao nível da classe indicada e ao programa de ensino de Moçambique. Não inventes números de página nem títulos de livros: na bibliografia escreve só «Livro do aluno da X.ª classe» e «Programa de Ensino da disciplina».\n' +
  '- Não escrevas nomes de pessoas.';
app.post('/prof/plano-ia', exigeProfessor, rota(async (req, res) => {
  const b = req.body || {}, turma = String(b.turma || ''), disc = String(b.disciplina || '');
  if (!await podeLancar(req, turma, disc)) return erro(res, 403, 'Só pode fazer planos das disciplinas e turmas onde dá aulas.');
  const tema = txt(b.tema, 200); if (tema.length < 3) return erro(res, 400, 'Escreva primeiro o tema da aula.');
  if (travao('plano-ia|' + req.sessao.u, 10, 60)) return erro(res, 429, 'Muitos pedidos à IA seguidos. Espere um pouco.');
  const u = await iaReservar(req.escola);
  const [t, d] = await Promise.all([obter('turma', turma), obter('disciplina', disc)]);
  const dur = Math.max(10, Math.min(300, Math.round(Number(b.duracao) || 45)));
  const pedido = 'Disciplina: ' + (d['Nome'] || '') + '\nClasse: ' + (t['Classe'] || t['Nome'] || '') + ' (nível: ' + (t['Nivel'] || '') + ')\n' +
    (b.unidade ? 'Unidade temática: ' + txt(b.unidade, 200) + '\n' : '') + 'Tema da aula: ' + tema + '\n' + (b.tipo ? 'Tipo de aula: ' + txt(b.tipo, 80) + '\n' : '') + 'Duração: ' + dur + ' minutos';
  const r = await openaiJSON(IA_PLANO, pedido, 3500);
  const usados = await iaContar(req.escola, u);
  const dados = lerDadosPlano(Object.assign({}, r, { tema, unidade: b.unidade, tipo: b.tipo, duracao: dur }));
  res.json({ ok: true, dados, usados, limite: IA_LIMITE });
}));
// Direcção: ver, dar o visto ou devolver
app.post('/planos', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, f = daEscola(req.escola).concat(b.estado && ESTADOS_PLANO[b.estado] ? [{ key: 'Estado', constraint_type: 'equals', value: b.estado }] : []);
  const [N, ps] = await Promise.all([nomesPlanos(req.escola), procurarTodos('planoaula', f, 2000)]);
  const L = ps.filter(p => b.estado ? true : p['Estado'] !== 'rascunho').map(p => planoOut(p, Object.assign({ semDados: true }, N)))
    .sort((x, y) => (x.estado === 'submetido' ? 0 : 1) - (y.estado === 'submetido' ? 0 : 1) || String(y.submetido_em || y.data).localeCompare(String(x.submetido_em || x.data)));
  res.json({ ok: true, escola: N.escola, logotipo: N.logotipo, planos: L, por_ver: ps.filter(p => p['Estado'] === 'submetido').length });
}));
app.post('/plano', exigeDireccao, rota(async (req, res) => {
  const p = await daMinhaEscola('planoaula', String((req.body || {}).id || ''), req.escola);
  res.json({ ok: true, plano: planoOut(p, await nomesPlanos(req.escola)) });
}));
app.post('/plano-visto', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, decisao = b.decisao === 'aprovado' ? 'aprovado' : b.decisao === 'devolvido' ? 'devolvido' : '';
  if (!decisao) return erro(res, 400, 'Escolha: dar o visto ou devolver.');
  const p = await daMinhaEscola('planoaula', String(b.id || ''), req.escola);
  if (p['Estado'] === 'rascunho') return erro(res, 409, 'Este plano ainda é um rascunho do professor.');
  const comentario = txt(b.comentario, 800);
  if (decisao === 'devolvido' && comentario.length < 3) return erro(res, 400, 'Escreva ao professor o que deve corrigir.');
  const eu = await obter('user', req.sessao.u).catch(() => null);
  await mudar('planoaula', p._id, { 'Estado': decisao, 'Comentario': comentario, 'Visto Por': (eu && eu['Nome Completo']) || 'Direcção', 'Visto Em': new Date().toISOString() });
  res.json({ ok: true, estado: decisao });
}));

// ============================================================
//  COBRANÇAS POR SMS (v5.19)
//  Automático (se a escola ligar): aviso X dias antes de vencer e avisos depois do atraso
//  (no dia seguinte e depois de 7 em 7 dias, no máximo 3). Um SMS por destinatário, juntando os educandos.
//  Botão «Avisar devedores»: a Direcção manda quando quiser (uma vez por dia).
//  Bubble: Escola → Cobranca Auto (yes/no), Cobranca Dias (number)
//          Propina → Aviso Antes (date), Avisos Atraso (number), Ultimo Aviso (date)
// ============================================================
const COBRANCA_HORA = Math.max(6, Math.min(20, Number(process.env.COBRANCA_HORA || 9)));   // hora de Maputo a partir da qual saem os avisos
const COBRANCA_MAX = 3, COBRANCA_INTERVALO = 7;
const mtSMS = v => Number(v || 0).toLocaleString('pt-PT', { maximumFractionDigits: 2 }).replace(/\s/g, ' ') + ' MT';
const dataMZ = iso => new Date(new Date(iso).getTime() + 2 * 3600e3).toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
const listaNomes = l => l.length <= 1 ? (l[0] || '') : l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1];
// junta as propinas por telefone de destino (encarregado que aceita SMS; senão o próprio estudante)
async function destinosCobranca(escolaId, propinas) {
  const f = daEscola(escolaId);
  const [ests, encs] = await Promise.all([procurarTodos('estudante', f), procurarTodos('encarregado', f)]);
  const EM = Object.fromEntries(ests.map(e => [e._id, e])), NM = Object.fromEntries(encs.map(e => [e._id, e]));
  const grupos = {};
  for (const x of propinas) {
    const e = EM[x.p['Estudante']]; if (!e || (e['Estado'] || 'activo') !== 'activo') continue;
    const en = NM[e['Encarregado']];
    let tel = en && en['Activo'] !== false && en['Recebe SMS'] !== false ? tel9(en['Telefone']) : '';
    if (tel.length !== 9) tel = tel9(e['Telefone']);
    if (tel.length !== 9) continue;
    (grupos[tel] = grupos[tel] || { tel, itens: [] }).itens.push(Object.assign({ nome: String(e['Nome'] || '').split(/\s+/)[0] }, x));
  }
  return Object.values(grupos);
}
function smsAntes(esc, g) {
  const nomes = [...new Set(g.itens.map(i => i.nome))], total = g.itens.reduce((s, i) => s + i.c.total, 0), venc = g.itens.map(i => i.venc).sort()[0];
  const tipo = g.itens.every(i => (i.p['Tipo'] || 'propina') === 'prestacao') ? 'a prestacao' : (g.itens.length > 1 ? 'as propinas' : 'a propina');
  const mes = g.itens.length === 1 && g.itens[0].p['Mes'] ? ' de ' + MESES_NOME[g.itens[0].p['Mes']] : '';
  return (esc['Nome'] || 'A escola') + ': lembrete - ' + tipo + mes + ' de ' + listaNomes(nomes) + ' (' + mtSMS(total) + ') vence' + (g.itens.length > 1 ? 'm' : '') + ' a ' + dmCurto(venc) +
    '. Pague ' + noGescolar(esc['Subdominio']) + ' por M-Pesa ou e-Mola, ou na secretaria.';
}
function smsAtraso(esc, g) {
  const nomes = [...new Set(g.itens.map(i => i.nome))], total = g.itens.reduce((s, i) => s + i.c.total, 0), multa = g.itens.reduce((s, i) => s + i.c.multa, 0);
  return (esc['Nome'] || 'A escola') + ': ' + listaNomes(nomes) + ' tem ' + (g.itens.length > 1 ? g.itens.length + ' pagamentos' : 'um pagamento') + ' em atraso: ' + mtSMS(total) + (multa ? ' (inclui multa)' : '') +
    '. Pague ' + noGescolar(esc['Subdominio']) + ' por M-Pesa ou e-Mola, ou na secretaria. Se ja pagou, ignore esta mensagem.';
}
async function propinasEmAberto(escolaId) {
  const esc = await obter('escola', escolaId);
  const regras = (await resumoEscola(escolaId) || {}).regras || {};
  const ps = (await procurarTodos('propina', daEscola(escolaId), 20000)).filter(p => p['Estado'] !== 'paga' && p['Estado'] !== 'anulada' && p['Vencimento']);
  return { esc, lista: ps.map(p => ({ p, c: calcPropina(p, regras), venc: dataMZ(p['Vencimento']) })) };
}
let cobrancasDia = '', cobrancasAgora = false;
async function cobrancasAutomaticas() {
  if (cobrancasAgora || !BUBBLE_BASE || !BUBBLE_TOKEN || !SMS_TOKEN) return;
  const agora = new Date(Date.now() + 2 * 3600e3), hoje = agora.toISOString().slice(0, 10);
  if (agora.getUTCHours() < COBRANCA_HORA || cobrancasDia === hoje) return;
  cobrancasAgora = true;
  try {
    const escolas = (await procurarTodos('escola', [{ key: 'Cobranca Auto', constraint_type: 'equals', value: true }], 2000)).filter(e => e['Estado'] !== 'suspensa');
    let n = 0;
    for (const e of escolas) {
      try {
        const dias = Math.max(1, Math.min(15, Number(e['Cobranca Dias'] || 3)));
        const { esc, lista } = await propinasEmAberto(e._id);
        const antes = lista.filter(x => x.c.estado === 'aberta' && !x.p['Aviso Antes'] && diasEntre(hoje, x.venc) >= 0 && diasEntre(hoje, x.venc) <= dias);
        const atraso = lista.filter(x => x.c.estado === 'atrasada' && Number(x.p['Avisos Atraso'] || 0) < COBRANCA_MAX && diasEntre(x.venc, hoje) >= 1 &&
          (!x.p['Ultimo Aviso'] || diasEntre(dataMZ(x.p['Ultimo Aviso']), hoje) >= COBRANCA_INTERVALO));
        for (const g of await destinosCobranca(e._id, antes)) {
          if ((await smsEscola(e._id, [g.tel], smsAntes(esc, g))).ok) n++;
          for (const i of g.itens) await mudar('propina', i.p._id, { 'Aviso Antes': new Date().toISOString() }).catch(() => {});
        }
        for (const g of await destinosCobranca(e._id, atraso)) {
          if ((await smsEscola(e._id, [g.tel], smsAtraso(esc, g))).ok) n++;
          for (const i of g.itens) await mudar('propina', i.p._id, { 'Avisos Atraso': Number(i.p['Avisos Atraso'] || 0) + 1, 'Ultimo Aviso': new Date().toISOString() }).catch(() => {});
        }
      } catch (err) { console.error('[cobrancas] escola ' + e._id + ':', err.message); }
    }
    cobrancasDia = hoje;
    console.log('[cobrancas] ' + hoje + ': ' + n + ' SMS em ' + escolas.length + ' escola(s)');
  } catch (err) { console.error('[cobrancas]', err.message); }
  finally { cobrancasAgora = false; }
}
setInterval(() => { cobrancasAutomaticas(); }, 15 * 60e3);
setTimeout(() => { cobrancasAutomaticas(); }, 90e3);

// estado e definições (página Propinas da Direcção)
app.post('/cobranca', exigeDireccao, rota(async (req, res) => {
  const { esc, lista } = await propinasEmAberto(req.escola);
  const atraso = lista.filter(x => x.c.estado === 'atrasada'), g = await destinosCobranca(req.escola, atraso);
  res.json({ ok: true, auto: esc['Cobranca Auto'] === true, dias: Number(esc['Cobranca Dias'] || 3), hora: COBRANCA_HORA, sms: !!(SMS_TOKEN && SMS_ORIGEM),
    devedores: g.length, valor: atraso.reduce((s, x) => s + x.c.total, 0), sem_telefone: new Set(atraso.map(x => x.p['Estudante'])).size - new Set([].concat(...g.map(z => z.itens.map(i => i.p['Estudante'])))).size,
    exemplo: g[0] ? smsAtraso(esc, g[0]) : '' });
}));
app.post('/cobranca-guardar', exigeDireccao, rota(async (req, res) => {
  const b = req.body || {}, dias = Math.max(1, Math.min(15, Math.round(Number(b.dias) || 3)));
  await mudar('escola', req.escola, { 'Cobranca Auto': b.auto === true, 'Cobranca Dias': dias });
  res.json({ ok: true, auto: b.auto === true, dias });
}));
app.post('/avisar-devedores', exigeDireccao, rota(async (req, res) => {
  if (!SMS_TOKEN || !SMS_ORIGEM) return erro(res, 500, 'O SMS ainda não está configurado no servidor.');
  if (travao('devedores|' + req.escola, 1, 20 * 60)) return erro(res, 429, 'Os devedores já foram avisados hoje. Pode voltar a avisar amanhã.');
  const { esc, lista } = await propinasEmAberto(req.escola);
  const atraso = lista.filter(x => x.c.estado === 'atrasada');
  const grupos = await destinosCobranca(req.escola, atraso);
  if (!grupos.length) return res.json({ ok: true, enviados: 0, destinatarios: 0 });
  let enviados = 0;
  for (const g of grupos) {
    if ((await smsEscola(req.escola, [g.tel], smsAtraso(esc, g))).ok) enviados++;
    for (const i of g.itens) await mudar('propina', i.p._id, { 'Ultimo Aviso': new Date().toISOString() }).catch(() => {});
  }
  res.json({ ok: true, enviados, destinatarios: grupos.length });
}));

// ============================================================
//  AULAS ONLINE (v5.20) — só no plano Pro (e Rede), e durante o período de teste
//  1) Aulas gravadas no Bunny Stream: o professor ou a Direcção carregam do browser (TUS, com retoma), a turma vê no portal.
//     STREAM_LIBRARY, STREAM_KEY (API key da library), STREAM_CDN (opcional, miniaturas), STREAM_TOKEN_KEY (opcional: links do leitor que expiram)
//  2) Aulas ao vivo com Agora.io: o professor transmite, os alunos vêem, escrevem e levantam a mão; o professor deixa falar.
//     AGORA_APP_ID, AGORA_CERT
//  Bubble: Aula Video  — Escola (Escola), Turma, Disciplina, Titulo, Descricao, Video, Estado, Autor, Autor Nome, Papel (text), Duracao, Tamanho (number)
//          Aula Ao Vivo — Escola (Escola), Turma, Disciplina, Titulo, Canal, Estado, Autor, Autor Nome (text), Inicio, Fim (date)
// ============================================================
const STREAM_LIBRARY = (process.env.STREAM_LIBRARY || '').trim(), STREAM_KEY = (process.env.STREAM_KEY || '').trim();
const STREAM_CDN = (process.env.STREAM_CDN || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''), STREAM_TOKEN_KEY = (process.env.STREAM_TOKEN_KEY || '').trim();
const STREAM_OK = !!(STREAM_LIBRARY && STREAM_KEY), STREAM_API = (process.env.STREAM_API_BASE || 'https://video.bunnycdn.com') + '/library/' + STREAM_LIBRARY;
const AGORA_APP_ID = (process.env.AGORA_APP_ID || '').trim(), AGORA_CERT = (process.env.AGORA_CERT || '').trim(), AGORA_OK = !!(AGORA_APP_ID && AGORA_CERT);
const VIDEO_MAX_GB = Math.max(1, Math.min(10, Number(process.env.VIDEO_MAX_GB || 2)));
const LIVE_HORAS = 4;

// --- token RTC do Agora (AccessToken2, «007»), igual ao do pacote oficial agora-token ---
function agoraToken(canal, uid, publicar, segundos) {
  const u16 = v => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }, u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
  const str = s => { const b = Buffer.isBuffer(s) ? s : Buffer.from(String(s)); return Buffer.concat([u16(b.length), b]); };
  const hmac = (k, m) => crypto.createHmac('sha256', k).update(m).digest();
  const ts = Math.floor(Date.now() / 1000), salt = crypto.randomInt(1, 99999999), privs = publicar ? [1, 2, 3, 4] : [1];
  const svc = Buffer.concat([u16(1), u16(privs.length)].concat(...privs.map(p => [u16(p), u32(segundos)]), [str(canal), str(uid ? String(uid) : '')]));
  const info = Buffer.concat([str(AGORA_APP_ID), u32(ts), u32(segundos), u32(salt), u16(1), svc]);
  const signing = hmac(u32(salt), hmac(u32(ts), AGORA_CERT));
  return '007' + require('zlib').deflateSync(Buffer.concat([str(hmac(signing, info)), info])).toString('base64');
}
const uidAgora = (u, papel) => (parseInt(crypto.createHash('sha1').update(papel + '|' + u).digest('hex').slice(0, 8), 16) % 2000000000) + 1000;

// --- plano ---
async function aulasOnlineOk(escolaId) {
  const e = await obter('escola', escolaId).catch(() => null);
  if (!e) return false;
  const s = situacaoEscola(e);
  return s.estado === 'teste' || ['Pro', 'Rede'].includes(e['Plano']);
}
async function exigirPro(req) { if (!await aulasOnlineOk(req.escola)) throw Object.assign(new Error('As aulas online (gravadas e ao vivo) fazem parte do plano Pro. Mude de plano em «Assinatura do Gescolar».'), { publico: 402 }); }

// --- quem pode o quê ---
async function paresAulas(req) {
  const a = await atribuicoes(req.escola);
  const ps = req.papelChat === 'professor' ? a.pares.filter(p => p.professores.has(req.sessao.u)) : a.pares;
  return ps.map(p => p.turma + '|' + p.disciplina);
}
async function podeVerAula(req, turma) {
  const p = req.papelChat;
  if (p === 'direccao') return true;
  if (p === 'professor') return (await paresAulas(req)).some(k => k.startsWith(turma + '|'));
  return (await turmasDoPortal(req)).includes(turma);
}
async function podeGerirAula(req, reg) {
  if (req.papelChat === 'direccao') return true;
  if (req.papelChat === 'professor') return reg['Autor'] === req.sessao.u || (await paresAulas(req)).includes(reg['Turma'] + '|' + reg['Disciplina']);
  return false;
}
async function nomeDe(req) {
  const t = { professor: 'professor', estudante: 'estudante', encarregado: 'encarregado' }[req.papelChat];
  const eu = t ? await obter(t, req.sessao.u).catch(() => null) : await obter('user', req.sessao.u).catch(() => null);
  return txt((eu && (eu['Nome'] || eu['Nome Completo'])) || PAPEL_CHAT[req.papelChat] || '', 80);
}

// --- Bunny Stream ---
async function stream(method, caminho, corpo) {
  if (!STREAM_OK) throw pub('As aulas gravadas ainda não estão ligadas: faltam STREAM_LIBRARY e STREAM_KEY no Render.');
  const r = await fetch(STREAM_API + caminho, { method, headers: { 'AccessKey': STREAM_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(30000) })
    .catch(e => { console.error('[stream]', e.message); throw pub('O Bunny Stream não respondeu. Tente de novo.'); });
  const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) {}
  if (!r.ok) { console.error('[stream]', method, caminho, r.status, t.slice(0, 200)); throw pub(r.status === 401 ? 'O Bunny Stream recusou a chave: confira STREAM_KEY e STREAM_LIBRARY no Render.' : 'O Bunny Stream respondeu ' + r.status + '. Tente de novo.'); }
  return d;
}
async function colecaoDaEscola(escolaId) {
  const e = await obter('escola', escolaId);
  if (e['Stream Colecao']) return e['Stream Colecao'];
  const c = await stream('POST', '/collections', { name: 'Gescolar · ' + (e['Subdominio'] || escolaId) });
  await mudar('escola', escolaId, { 'Stream Colecao': c.guid }).catch(err => console.error('[stream] coleção', err.message));
  return c.guid;
}
function linkLeitor(guid) {
  const base = 'https://iframe.mediadelivery.net/embed/' + STREAM_LIBRARY + '/' + guid;
  const q = 'autoplay=false&preload=true&responsive=true';
  if (!STREAM_TOKEN_KEY) return base + '?' + q;
  const exp = Math.floor(Date.now() / 1000) + 6 * 3600;
  return base + '?token=' + crypto.createHash('sha256').update(STREAM_TOKEN_KEY + guid + exp).digest('hex') + '&expires=' + exp + '&' + q;
}
const ESTADO_STREAM = { 0: 'enviando', 1: 'processando', 2: 'processando', 3: 'processando', 4: 'pronto', 5: 'erro', 6: 'erro', 7: 'processando' };
function videoOut(v, N, gerir) {
  return { id: v._id, titulo: v['Titulo'] || '', descricao: v['Descricao'] || '', turma: v['Turma'] || '', turma_nome: (N.turma || {})[v['Turma']] || '', disciplina: v['Disciplina'] || '', disciplina_nome: (N.disc || {})[v['Disciplina']] || '',
    estado: v['Estado'] || 'enviando', duracao: Number(v['Duracao'] || 0), autor: v['Autor Nome'] || '', papel: v['Papel'] || '', data: v['Created Date'] || null,
    miniatura: STREAM_CDN && v['Video'] && v['Estado'] === 'pronto' ? 'https://' + STREAM_CDN + '/' + v['Video'] + '/thumbnail.jpg' : '', pode_apagar: !!gerir };
}
function liveOut(l, N, gerir) {
  let estado = l['Estado'] || 'agendada';
  if (estado === 'aovivo' && l['Inicio'] && Date.now() - Date.parse(l['Inicio']) > LIVE_HORAS * 3600e3) estado = 'terminada';
  const st = LIVES.get(l._id);
  return { id: l._id, titulo: l['Titulo'] || '', turma: l['Turma'] || '', turma_nome: (N.turma || {})[l['Turma']] || '', disciplina: l['Disciplina'] || '', disciplina_nome: (N.disc || {})[l['Disciplina']] || '',
    estado, inicio: l['Inicio'] || null, fim: l['Fim'] || null, autor: l['Autor Nome'] || '', pode_gerir: !!gerir, online: st ? presentes(st).length : 0 };
}

// lista para cada papel: vídeos, aulas ao vivo e (para quem carrega) as turmas e disciplinas
app.post('/aulas/lista', exigeChat, rota(async (req, res) => {
  const b = req.body || {}, p = req.papelChat, f = daEscola(req.escola);
  const pro = await aulasOnlineOk(req.escola);
  const N = await nomesPlanos(req.escola);
  let turmas = null, pares = [];
  if (p === 'professor' || p === 'direccao') {
    pares = (await paresAulas(req)).map(k => { const [t, d] = k.split('|'); return { turma: t, turma_nome: N.turma[t] || '', disciplina: d, disciplina_nome: N.disc[d] || '' }; })
      .filter(x => x.turma_nome && x.disciplina_nome).sort((x, y) => x.turma_nome.localeCompare(y.turma_nome, 'pt') || x.disciplina_nome.localeCompare(y.disciplina_nome, 'pt'));
    if (p === 'professor') turmas = [...new Set(pares.map(x => x.turma))];
  } else turmas = await turmasDoPortal(req, b.estudante ? String(b.estudante) : '');
  const filtroT = l => turmas === null ? l : l.filter(x => turmas.includes(x['Turma']));
  const [vs, ls] = await Promise.all([procurarTodos('aulavideo', f, 3000).catch(e => { if (e.publico) throw e; return []; }), procurarTodos('aulaaovivo', f, 2000).catch(e => { if (e.publico) throw e; return []; })]);
  const meusPares = new Set(pares.map(x => x.turma + '|' + x.disciplina));
  const gere = r => p === 'direccao' || (p === 'professor' && (r['Autor'] === req.sessao.u || meusPares.has(r['Turma'] + '|' + r['Disciplina'])));
  const videos = filtroT(vs).filter(v => p === 'direccao' || p === 'professor' || v['Estado'] === 'pronto').map(v => videoOut(v, N, gere(v))).sort((x, y) => String(y.data).localeCompare(String(x.data)));
  const lives = filtroT(ls).map(l => liveOut(l, N, gere(l))).filter(l => l.estado !== 'terminada' || p !== 'estudante' && p !== 'encarregado')
    .sort((x, y) => (x.estado === 'aovivo' ? 0 : x.estado === 'agendada' ? 1 : 2) - (y.estado === 'aovivo' ? 0 : y.estado === 'agendada' ? 1 : 2) || String(x.inicio).localeCompare(String(y.inicio)));
  res.json({ ok: true, papel: p, pro, stream: STREAM_OK, agora: AGORA_OK, max_gb: VIDEO_MAX_GB, pares, videos, lives: lives.slice(0, 100) });
}));

// --- aulas gravadas ---
app.post('/videos/criar', exigeChat, rota(async (req, res) => {
  const b = req.body || {}, turma = String(b.turma || ''), disc = String(b.disciplina || '');
  if (req.papelChat !== 'professor' && req.papelChat !== 'direccao') return erro(res, 403, 'Só os professores e a Direcção carregam aulas.');
  await exigirPro(req);
  if (!(await paresAulas(req)).includes(turma + '|' + disc)) return erro(res, 403, 'Só pode carregar aulas das turmas e disciplinas onde dá aulas.');
  const titulo = txt(b.titulo, 120); if (titulo.length < 3) return erro(res, 400, 'Escreva o título da aula.');
  const tamanho = Number(b.tamanho) || 0;
  if (tamanho > VIDEO_MAX_GB * 1073741824) return erro(res, 400, 'O vídeo tem mais de ' + VIDEO_MAX_GB + ' GB. Corte-o em partes ou reduza a qualidade.');
  if (!/^video\//.test(String(b.tipo || 'video/'))) return erro(res, 400, 'Escolha um ficheiro de vídeo (mp4, mov, webm…).');
  if (travao('video|' + req.escola, 60, 60)) return erro(res, 429, 'Muitos vídeos seguidos. Espere um pouco.');
  const colecao = await colecaoDaEscola(req.escola);
  const v = await stream('POST', '/videos', { title: titulo, collectionId: colecao });
  const id = await criar('aulavideo', { 'Escola': req.escola, 'Turma': turma, 'Disciplina': disc, 'Titulo': titulo, 'Descricao': txt(b.descricao, 600), 'Video': v.guid, 'Estado': 'enviando',
    'Autor': req.sessao.u, 'Autor Nome': await nomeDe(req), 'Papel': req.papelChat, 'Duracao': 0, 'Tamanho': tamanho });
  const expira = Math.floor(Date.now() / 1000) + 24 * 3600;
  res.json({ ok: true, id, tus: { endpoint: 'https://video.bunnycdn.com/tusupload', biblioteca: STREAM_LIBRARY, video: v.guid, expira,
    assinatura: crypto.createHash('sha256').update(STREAM_LIBRARY + STREAM_KEY + expira + v.guid).digest('hex') } });
}));
async function actualizarVideo(v) {
  if (!v['Video'] || v['Estado'] === 'pronto' || v['Estado'] === 'erro') return v;
  const d = await stream('GET', '/videos/' + v['Video']).catch(() => null);
  if (!d) return v;
  const estado = ESTADO_STREAM[d.status] || 'processando';
  const campos = { 'Estado': estado === 'enviando' && v['Estado'] === 'processando' ? 'processando' : estado, 'Duracao': Number(d.length || 0) };
  if (campos['Estado'] !== v['Estado'] || campos['Duracao'] !== Number(v['Duracao'] || 0)) { await mudar('aulavideo', v._id, campos).catch(() => {}); Object.assign(v, campos); }
  v.progresso = Number(d.encodeProgress || 0);
  return v;
}
app.post('/videos/enviado', exigeChat, rota(async (req, res) => {
  const v = await daMinhaEscola('aulavideo', String((req.body || {}).id || ''), req.escola);
  if (v['Autor'] !== req.sessao.u) return erro(res, 403, 'Sem acesso.');
  if (v['Estado'] === 'enviando') await mudar('aulavideo', v._id, { 'Estado': 'processando' });
  res.json({ ok: true });
}));
app.post('/videos/estado', exigeChat, rota(async (req, res) => {
  const ids = (Array.isArray((req.body || {}).ids) ? req.body.ids : []).slice(0, 20).map(String);
  const out = [];
  for (const id of ids) { const v = await obter('aulavideo', id).catch(() => null); if (!v || v['Escola'] !== req.escola) continue; const x = await actualizarVideo(v); out.push({ id, estado: x['Estado'], duracao: Number(x['Duracao'] || 0), progresso: x.progresso || 0 }); }
  res.json({ ok: true, videos: out });
}));
app.post('/videos/ver', exigeChat, rota(async (req, res) => {
  const v = await daMinhaEscola('aulavideo', String((req.body || {}).id || ''), req.escola);
  if (!await podeVerAula(req, v['Turma'])) return erro(res, 404, 'Aula não encontrada.');
  await exigirPro(req);
  if (v['Estado'] !== 'pronto') { await actualizarVideo(v); if (v['Estado'] !== 'pronto') return erro(res, 409, v['Estado'] === 'erro' ? 'O Bunny não conseguiu converter este vídeo. Apague-o e carregue de novo.' : 'O vídeo ainda está a ser preparado. Tente daqui a alguns minutos.'); }
  res.json({ ok: true, url: linkLeitor(v['Video']), titulo: v['Titulo'] || '' });
}));
app.post('/videos/apagar', exigeChat, rota(async (req, res) => {
  const v = await daMinhaEscola('aulavideo', String((req.body || {}).id || ''), req.escola);
  if (!await podeGerirAula(req, v)) return erro(res, 403, 'Só quem carregou o vídeo, o professor da disciplina ou a Direcção o pode apagar.');
  if (v['Video'] && STREAM_OK) await stream('DELETE', '/videos/' + v['Video']).catch(e => console.error('[stream] apagar', e.message));
  await apagar('aulavideo', v._id);
  res.json({ ok: true });
}));

// --- aulas ao vivo ---
const LIVES = new Map();   // id → { nomes: Map(uid→{nome,papel,visto}), maos: Map(uid→ts), falar: Set(uid), msgs: [], seq }
function estadoLive(id) { let s = LIVES.get(id); if (!s) { s = { nomes: new Map(), maos: new Map(), falar: new Set(), msgs: [], seq: 0, criado: Date.now() }; LIVES.set(id, s); } return s; }
const presentes = s => [...s.nomes.entries()].filter(([, v]) => Date.now() - v.visto < 25000);
setInterval(() => { for (const [id, s] of LIVES) if (Date.now() - s.criado > (LIVE_HORAS + 1) * 3600e3) LIVES.delete(id); }, 600e3).unref();
async function abrirLive(req, id) {
  const l = await daMinhaEscola('aulaaovivo', String(id || ''), req.escola);
  if (!await podeVerAula(req, l['Turma'])) throw Object.assign(new Error('Aula não encontrada.'), { publico: 404 });
  return { l, host: req.papelChat === 'direccao' || req.papelChat === 'professor' && await podeGerirAula(req, l) };
}
app.post('/aovivo/criar', exigeChat, rota(async (req, res) => {
  const b = req.body || {}, turma = String(b.turma || ''), disc = String(b.disciplina || '');
  if (req.papelChat !== 'professor' && req.papelChat !== 'direccao') return erro(res, 403, 'Só os professores e a Direcção dão aulas ao vivo.');
  await exigirPro(req);
  if (!AGORA_OK) return erro(res, 500, 'As aulas ao vivo ainda não estão ligadas: faltam AGORA_APP_ID e AGORA_CERT no Render.');
  if (!(await paresAulas(req)).includes(turma + '|' + disc)) return erro(res, 403, 'Só pode dar aulas ao vivo nas turmas e disciplinas onde dá aulas.');
  const titulo = txt(b.titulo, 120); if (titulo.length < 3) return erro(res, 400, 'Escreva o tema da aula.');
  const agora = b.agora !== false;
  let inicio = new Date().toISOString();
  if (!agora) { const d = new Date(String(b.inicio || '')); if (isNaN(d) || d.getTime() < Date.now() - 300e3) return erro(res, 400, 'Escolha a data e a hora da aula.'); inicio = d.toISOString(); }
  const id = await criar('aulaaovivo', { 'Escola': req.escola, 'Turma': turma, 'Disciplina': disc, 'Titulo': titulo, 'Estado': agora ? 'aovivo' : 'agendada', 'Inicio': inicio, 'Autor': req.sessao.u, 'Autor Nome': await nomeDe(req) });
  await mudar('aulaaovivo', id, { 'Canal': 'gs_' + id }).catch(() => {});
  res.json({ ok: true, id });
}));
app.post('/aovivo/comecar', exigeChat, rota(async (req, res) => {
  const { l, host } = await abrirLive(req, (req.body || {}).id);
  if (!host) return erro(res, 403, 'Só o professor pode começar a aula.');
  await mudar('aulaaovivo', l._id, { 'Estado': 'aovivo', 'Inicio': new Date().toISOString() });
  res.json({ ok: true });
}));
app.post('/aovivo/terminar', exigeChat, rota(async (req, res) => {
  const { l, host } = await abrirLive(req, (req.body || {}).id);
  if (!host) return erro(res, 403, 'Só o professor pode terminar a aula.');
  await mudar('aulaaovivo', l._id, { 'Estado': 'terminada', 'Fim': new Date().toISOString() });
  const s = LIVES.get(l._id); if (s) { s.terminada = true; s.seq++; }
  res.json({ ok: true });
}));
app.post('/aovivo/apagar', exigeChat, rota(async (req, res) => {
  const { l, host } = await abrirLive(req, (req.body || {}).id);
  if (!host) return erro(res, 403, 'Sem acesso.');
  if (l['Estado'] === 'aovivo') return erro(res, 409, 'Termine primeiro a aula.');
  await apagar('aulaaovivo', l._id); res.json({ ok: true });
}));
app.post('/aovivo/entrar', exigeChat, rota(async (req, res) => {
  const { l, host } = await abrirLive(req, (req.body || {}).id);
  await exigirPro(req);
  if (!AGORA_OK) return erro(res, 500, 'As aulas ao vivo ainda não estão ligadas no servidor.');
  const est = liveOut(l, {}, host).estado;
  if (est !== 'aovivo') return erro(res, 409, est === 'agendada' ? 'A aula ainda não começou. Espere pelo professor.' : 'Esta aula já terminou.');
  const uid = uidAgora(req.sessao.u, req.papelChat), s = estadoLive(l._id);
  s.nomes.set(uid, { nome: await nomeDe(req), papel: req.papelChat, host, visto: Date.now() });
  if (host) s.host = uid;
  const canal = l['Canal'] || 'gs_' + l._id;
  res.json({ ok: true, app: AGORA_APP_ID, canal, uid, host, token: agoraToken(canal, uid, host, LIVE_HORAS * 3600), titulo: l['Titulo'] || '', pode_mao: req.papelChat === 'estudante', seq: s.seq });
}));
app.post('/aovivo/eventos', exigeChat, rota(async (req, res) => {
  const b = req.body || {}, { l, host } = await abrirLive(req, b.id);
  const uid = uidAgora(req.sessao.u, req.papelChat), s = estadoLive(l._id);
  const eu = s.nomes.get(uid); if (eu) eu.visto = Date.now();
  const depois = Number(b.depois) || 0;
  res.json({ ok: true, seq: s.seq, terminada: !!s.terminada || l['Estado'] === 'terminada', host_uid: s.host || null,
    msgs: s.msgs.filter(m => m.n > depois), maos: [...s.maos.keys()], falar: [...s.falar], eu_falo: s.falar.has(uid),
    pessoas: presentes(s).map(([u, v]) => ({ uid: u, nome: v.nome, papel: v.papel, host: !!v.host })), sou_host: host });
}));
app.post('/aovivo/sinal', exigeChat, rota(async (req, res) => {
  const b = req.body || {}, { l } = await abrirLive(req, b.id);
  const uid = uidAgora(req.sessao.u, req.papelChat), s = estadoLive(l._id), eu = s.nomes.get(uid);
  if (!eu) return erro(res, 409, 'Entre primeiro na aula.');
  if (b.tipo === 'mao') { if (req.papelChat !== 'estudante') return erro(res, 403, 'Só os estudantes levantam a mão.'); s.maos.set(uid, Date.now()); }
  else if (b.tipo === 'baixar') { s.maos.delete(uid); s.falar.delete(uid); }
  else if (b.tipo === 'msg') {
    const texto = txt(b.texto, 400); if (!texto) return erro(res, 400, 'Escreva a mensagem.');
    if (req.papelChat === 'encarregado') return erro(res, 403, 'Os encarregados podem assistir, mas não escrever.');
    if (travao('live-msg|' + uid, 12, 1)) return erro(res, 429, 'Muitas mensagens seguidas.');
    s.msgs.push({ n: ++s.seq, uid, nome: eu.nome, papel: eu.papel, host: !!eu.host, texto, ts: Date.now() }); if (s.msgs.length > 300) s.msgs.shift();
  } else return erro(res, 400, 'Sinal desconhecido.');
  s.seq++; res.json({ ok: true });
}));
app.post('/aovivo/permitir', exigeChat, rota(async (req, res) => {
  const b = req.body || {}, { l, host } = await abrirLive(req, b.id);
  if (!host) return erro(res, 403, 'Só o professor decide quem fala.');
  const s = estadoLive(l._id), uid = Number(b.uid);
  if (b.falar) { if (s.falar.size >= 3) return erro(res, 400, 'Já há 3 alunos a falar. Tire a palavra a um antes de dar a outro.'); s.falar.add(uid); s.maos.delete(uid); }
  else { s.falar.delete(uid); s.maos.delete(uid); }
  s.seq++; res.json({ ok: true });
}));
app.post('/aovivo/token-falar', exigeChat, rota(async (req, res) => {
  const { l } = await abrirLive(req, (req.body || {}).id);
  const uid = uidAgora(req.sessao.u, req.papelChat), s = estadoLive(l._id);
  if (!s.falar.has(uid)) return erro(res, 403, 'O professor ainda não lhe deu a palavra.');
  res.json({ ok: true, token: agoraToken(l['Canal'] || 'gs_' + l._id, uid, true, LIVE_HORAS * 3600) });
}));

app.use((req, res) => erro(res, 404, 'Rota não encontrada.'));
app.listen(PORT, () => console.log(VERSAO + ' a ouvir na porta ' + PORT));
