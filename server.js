// ============================================================
//  Gescolar — container (versão 1)
//  Toda a lógica fica aqui. O Bubble guarda os dados e faz o login.
//  Rotas desta versão:
//    GET  /          estado e versão
//    POST /registo   cria a Escola e liga-a à conta da Direcção
//    POST /sessao    diz quem é o utilizador, a escola e a página dele
// ============================================================
'use strict';
const express = require('express');

const VERSAO = 'gescolar-proxy 1.0.0';
const PORT = process.env.PORT || 8080;
const BUBBLE_BASE = (process.env.BUBBLE_BASE || '').replace(/\/+$/, '');   // https://gescolar.bubbleapps.io/api/1.1/obj
const BUBBLE_TOKEN = process.env.BUBBLE_TOKEN || '';
const ORIGENS = (process.env.ORIGENS || 'https://gescolar.co.mz,https://www.gescolar.co.mz,https://gescolar.bubbleapps.io')
  .split(',').map(s => s.trim()).filter(Boolean);

const NIVEIS = { ESC: 'Escolinha', PRI: 'Ensino Primario', SEC: 'Ensino Secundario', TEC: 'Tecnico Profissional', SUP: 'Ensino Superior', CON: 'Escola de Conducao' };
const PAPEIS = { Direccao: 'direccao', Secretaria: 'direccao', Professor: 'professor', Estudante: 'estudante', Encarregado: 'encarregado', Plataforma: 'plataforma' };
const PROVINCIAS = ['Maputo Cidade', 'Maputo Província', 'Gaza', 'Inhambane', 'Sofala', 'Manica', 'Tete', 'Zambézia', 'Nampula', 'Cabo Delgado', 'Niassa'];
const PLANOS = ['Essencial', 'Pro', 'Rede'];

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------- CORS: só as origens do Gescolar ----------
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && (ORIGENS.includes(o) || /^https:\/\/[a-z0-9-]+\.gescolar\.co\.mz$/.test(o))) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- Bubble Data API ----------
async function bubble(method, path, body) {
  if (!BUBBLE_BASE || !BUBBLE_TOKEN) throw new Error('BUBBLE_BASE ou BUBBLE_TOKEN em falta no container');
  const r = await fetch(BUBBLE_BASE + path, {
    method,
    headers: { 'Authorization': 'Bearer ' + BUBBLE_TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const txt = await r.text();
  let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = { raw: txt }; }
  if (!r.ok) {
    const msg = (data && data.body && data.body.message) || (data && data.message) || txt || ('HTTP ' + r.status);
    const err = new Error('Bubble ' + method + ' ' + path + ': ' + msg); err.status = r.status; throw err;
  }
  return data;
}
const obter = (tipo, id) => bubble('GET', '/' + tipo + '/' + encodeURIComponent(id)).then(d => d && d.response);
const criar = (tipo, campos) => bubble('POST', '/' + tipo, campos).then(d => d && d.id);
const mudar = (tipo, id, campos) => bubble('PATCH', '/' + tipo + '/' + encodeURIComponent(id), campos);
async function procurar(tipo, filtros, limite) {
  const q = '?constraints=' + encodeURIComponent(JSON.stringify(filtros || [])) + '&limit=' + (limite || 100);
  const d = await bubble('GET', '/' + tipo + q);
  return (d && d.response && d.response.results) || [];
}

// ---------- utilidades ----------
const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
const soDigitos = v => String(v || '').replace(/\D/g, '');
function slug(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}
function erro(res, status, mensagem) { return res.status(status).json({ ok: false, erro: mensagem }); }
function idValido(id) { return /^\d{10,}x\d{10,}$/.test(String(id || '')); }

// ============================================================
//  GET /  — estado
// ============================================================
app.get('/', (req, res) => {
  res.json({ ok: true, versao: VERSAO, bubble: BUBBLE_BASE ? 'configurado' : 'em falta', hora: new Date().toISOString() });
});

// ============================================================
//  POST /registo — cria a escola
//  Corpo: { owner, nome, nuit, provincia, cidade, telefone, email,
//           subdominio, niveis:["ESC","PRI",...], plano, admin_nome, admin_tel }
//  O "owner" é o unique id do User que o Bubble acabou de criar
//  com "Sign the user up".
// ============================================================
app.post('/registo', async (req, res) => {
  try {
    const b = req.body || {};
    const owner = txt(b.owner, 60);
    if (!idValido(owner)) return erro(res, 400, 'Conta inválida. Volte a tentar o registo.');

    const nome = txt(b.nome, 120);
    const nuit = soDigitos(b.nuit);
    const provincia = txt(b.provincia, 40);
    const niveis = Array.isArray(b.niveis) ? [...new Set(b.niveis.map(x => String(x).toUpperCase()))].filter(k => NIVEIS[k]) : [];
    const plano = PLANOS.includes(b.plano) ? b.plano : 'Pro';
    const adminNome = txt(b.admin_nome, 120);

    if (nome.length < 4) return erro(res, 400, 'Escreva o nome da instituição.');
    if (nuit.length !== 9) return erro(res, 400, 'O NUIT tem 9 dígitos.');
    if (!PROVINCIAS.includes(provincia)) return erro(res, 400, 'Escolha a província.');
    if (!niveis.length) return erro(res, 400, 'Escolha pelo menos um tipo de ensino.');
    if (adminNome.split(/\s+/).length < 2) return erro(res, 400, 'Escreva o nome completo do administrador.');

    // 1. a conta existe e ainda não tem escola (impede usar o registo para mudar a escola de outra pessoa)
    const user = await obter('user', owner).catch(() => null);
    if (!user) return erro(res, 404, 'Conta não encontrada.');
    if (user['Escola']) return erro(res, 409, 'Esta conta já tem uma escola registada.');

    // 2. subdomínio livre
    let sub = slug(b.subdominio || nome) || 'escola';
    const iguais = await procurar('escola', [{ key: 'Subdominio', constraint_type: 'equals', value: sub }], 1);
    if (iguais.length) sub = (sub + '-' + Math.random().toString(36).slice(2, 6)).slice(0, 34);

    // 3. NUIT não repetido
    const mesmoNuit = await procurar('escola', [{ key: 'NUIT', constraint_type: 'equals', value: nuit }], 1);
    if (mesmoNuit.length) return erro(res, 409, 'Já existe uma instituição registada com este NUIT. Contacte o suporte Gescolar.');

    // 4. criar a Escola com as regras por defeito
    const hoje = new Date();
    const testeAte = new Date(hoje.getTime() + 30 * 24 * 3600 * 1000);
    const escolaId = await criar('escola', {
      'Nome': nome,
      'NUIT': nuit,
      'Provincia': provincia,
      'Cidade': txt(b.cidade, 80),
      'Telefone': txt(b.telefone, 30),
      'Email': txt(b.email || user.authentication && user.authentication.email && user.authentication.email.email, 120),
      'Subdominio': sub,
      'Niveis': niveis.map(k => NIVEIS[k]),
      'Plano': plano,
      'Estado': 'teste',
      'Teste Ate': testeAte.toISOString(),
      'Ano Lectivo': String(hoje.getFullYear()),
      'Dia Limite': 10,
      'Multa Percent': 10,
      'Multa Max': 25,
      'Nota Aprovacao': 10,
      'Nota Dispensa': 14,
      'Formula Media': 'MT = (2 x MACS + ACP) / 3'
    });

    // 5. ligar a conta à escola como Direcção
    await mudar('user', owner, {
      'Escola': escolaId,
      'Papel': 'Direccao',
      'Nome Completo': adminNome,
      'Telefone': txt(b.admin_tel, 30),
      'Activo': true
    });

    res.json({ ok: true, escola: escolaId, subdominio: sub, pagina: 'direccao', teste_ate: testeAte.toISOString().slice(0, 10) });
  } catch (e) {
    console.error('[registo]', e.message);
    erro(res, 500, 'Não foi possível criar a escola agora. Tente de novo dentro de um minuto.');
  }
});

// ============================================================
//  POST /sessao — quem é, que escola, que página
//  Corpo: { owner }
// ============================================================
app.post('/sessao', async (req, res) => {
  try {
    const owner = txt((req.body || {}).owner, 60);
    if (!idValido(owner)) return erro(res, 400, 'Sessão inválida.');
    const user = await obter('user', owner).catch(() => null);
    if (!user) return erro(res, 404, 'Conta não encontrada.');
    if (user['Activo'] === false) return erro(res, 403, 'Esta conta está desactivada. Fale com a escola.');

    const papel = user['Papel'] || null;
    let escola = null;
    if (user['Escola']) {
      const e = await obter('escola', user['Escola']).catch(() => null);
      if (e) {
        const codigos = Object.fromEntries(Object.entries(NIVEIS).map(([k, v]) => [v, k]));
        escola = {
          id: e._id, nome: e['Nome'], subdominio: e['Subdominio'], estado: e['Estado'], plano: e['Plano'],
          niveis: (e['Niveis'] || []).map(n => codigos[n] || n), ano: e['Ano Lectivo'],
          regras: { dia_limite: e['Dia Limite'], multa: e['Multa Percent'], multa_max: e['Multa Max'], aprovacao: e['Nota Aprovacao'], dispensa: e['Nota Dispensa'], formula: e['Formula Media'] }
        };
        if (e['Estado'] === 'suspensa' && papel !== 'Plataforma') return erro(res, 402, 'O acesso desta escola está suspenso. A Direcção deve regularizar a subscrição.');
      }
    }
    mudar('user', owner, { 'Ultimo Acesso': new Date().toISOString() }).catch(() => {});
    res.json({ ok: true, nome: user['Nome Completo'] || '', papel, pagina: PAPEIS[papel] || (escola ? 'direccao' : 'registo'), escola });
  } catch (e) {
    console.error('[sessao]', e.message);
    erro(res, 500, 'Não foi possível confirmar a sessão.');
  }
});

app.use((req, res) => erro(res, 404, 'Rota não encontrada.'));

app.listen(PORT, () => console.log(VERSAO + ' a ouvir na porta ' + PORT));
