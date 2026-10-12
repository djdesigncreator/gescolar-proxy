/* Gescolar · chat da turma (usado em professor.html, portal.html e direccao.html) — v5.14
   GSChat.montar(elemento, { api: function(rota, corpo){ return Promise<{ok, erro, …}> }, papel: 'professor'|'estudante'|'encarregado'|'direccao',
                             estudante: id (só no portal: chats da turma desse educando), chave: texto (para lembrar o que já foi lido), aviso: function(texto){} })
   O professor cria um chat em cada turma onde dá aulas. Os estudantes escrevem e enviam ficheiros; os encarregados só lêem.
   A Direcção vê todos os chats, pode apagar mensagens e fechar ou reabrir chats. */
(function(){
'use strict';
var CSS = '' +
'.gc-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:4px 0 12px;flex-wrap:wrap}' +
'.gc-top h3{margin:0;font:800 18px var(--f-display)}' +
'.gc-sub{color:var(--muted);font-size:13.5px;margin:-6px 2px 12px;line-height:1.45}' +
'.gc-lista{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}' +
'.gc-it{display:flex;width:100%;gap:12px;align-items:center;padding:13px 14px;border:0;border-bottom:1px solid var(--line);background:var(--surface);color:var(--ink);text-align:left;cursor:pointer;font:inherit}' +
'.gc-it:last-child{border-bottom:0}.gc-it:hover{background:var(--bg)}' +
'.gc-av{flex:none;width:42px;height:42px;border-radius:12px;background:var(--navy);color:#fff;display:grid;place-items:center;font:800 14px var(--f-display)}' +
'.gc-it .tx{flex:1;min-width:0}.gc-it b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
'.gc-it small{display:block;color:var(--muted);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
'.gc-it .hr{flex:none;font-size:12px;color:var(--muted);text-align:right}' +
'.gc-dot{display:inline-block;min-width:10px;height:10px;border-radius:5px;background:var(--blue);margin-top:6px}' +
'.gc-pill{display:inline-block;font:700 11px var(--f-body);padding:2px 7px;border-radius:99px;background:var(--bg);color:var(--muted);vertical-align:1px;margin-left:4px}' +
'.gc-pill.p{background:var(--blue-soft,#E6F0FC);color:var(--blue)}.gc-pill.d{background:#FFF4D6;color:#8A6D00}.gc-pill.f{background:#FDE8E6;color:#C0392B}' +
'.gc-box{background:var(--surface);border:1px solid var(--line);border-radius:14px;display:flex;flex-direction:column;height:calc(100vh - 200px);height:calc(100dvh - 200px);min-height:420px;overflow:hidden}' +
'@media (max-width:720px){.gc-box{height:calc(100vh - 210px);height:calc(100dvh - 210px);min-height:360px}}' +
'.gc-cab{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line)}' +
'.gc-cab .tx{flex:1;min-width:0}.gc-cab b{display:block;font:800 15.5px/1.2 var(--f-display);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
'.gc-cab small{color:var(--muted);font-size:12.5px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
'.gc-ib{flex:none;width:38px;height:38px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);display:grid;place-items:center;cursor:pointer;padding:0}' +
'.gc-ib svg{width:19px;height:19px}.gc-ib:disabled{opacity:.5;cursor:default}' +
'.gc-msgs{flex:1;overflow-y:auto;padding:12px 12px 6px;background:var(--bg);-webkit-overflow-scrolling:touch}' +
'.gc-dia{text-align:center;margin:10px 0}.gc-dia span{display:inline-block;font:700 11.5px var(--f-body);color:var(--muted);background:var(--surface);border:1px solid var(--line);padding:3px 10px;border-radius:99px}' +
'.gc-m{display:flex;margin:3px 0}.gc-m.eu{justify-content:flex-end}' +
'.gc-b{max-width:min(78%,520px);background:var(--surface);border:1px solid var(--line);border-radius:14px 14px 14px 4px;padding:7px 10px 5px;position:relative;word-wrap:break-word;overflow-wrap:anywhere}' +
'.gc-m.eu .gc-b{background:var(--blue);border-color:var(--blue);color:#fff;border-radius:14px 14px 4px 14px}' +
'.gc-m.prof .gc-b{border-color:var(--blue)}' +
'.gc-au{font:700 12.5px var(--f-body);color:var(--blue);margin-bottom:2px}' +
'.gc-tx{white-space:pre-wrap;font-size:15px;line-height:1.4}' +
'.gc-ft{display:flex;justify-content:flex-end;align-items:center;gap:8px;font-size:11px;color:var(--muted);margin-top:2px}' +
'.gc-m.eu .gc-ft{color:rgba(255,255,255,.78)}' +
'.gc-del{background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:0;opacity:.75;text-decoration:underline}' +
'.gc-apag{font-style:italic;color:var(--muted);font-size:13.5px}.gc-m.eu .gc-apag{color:rgba(255,255,255,.85)}' +
'.gc-img{display:block;margin:2px 0 4px;border-radius:10px;overflow:hidden;background:rgba(0,0,0,.05)}.gc-img img{display:block;max-width:100%;width:260px;max-height:300px;object-fit:cover}' +
'.gc-fx{display:flex;gap:10px;align-items:center;text-decoration:none;color:inherit;padding:8px;border-radius:10px;background:rgba(0,0,0,.05);margin:2px 0 4px;min-width:200px}' +
'.gc-m.eu .gc-fx{background:rgba(255,255,255,.16)}' +
'.gc-ext{flex:none;width:38px;height:44px;border-radius:7px;background:#C0392B;color:#fff;display:grid;place-items:center;font:800 10px var(--f-body);text-transform:uppercase}' +
'.gc-fx .n{font-weight:700;font-size:13.5px;display:block;word-break:break-all}.gc-fx .s{font-size:12px;opacity:.75}' +
'.gc-b audio{display:block;width:240px;max-width:100%;margin:2px 0 4px}' +
'.gc-mais{text-align:center;margin:4px 0 10px}' +
'.gc-comp{border-top:1px solid var(--line);padding:8px;background:var(--surface)}' +
'.gc-row{display:flex;gap:8px;align-items:flex-end}' +
'.gc-row textarea{flex:1;resize:none;min-height:42px;max-height:140px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font:15px/1.35 var(--f-body);color:var(--ink);background:var(--bg);outline:none}' +
'.gc-row textarea:focus{border-color:var(--blue)}' +
'.gc-env{background:var(--blue);border-color:var(--blue);color:#fff}' +
'.gc-anexo{display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:6px 8px 6px 10px;margin-bottom:8px;font-size:13.5px}' +
'.gc-anexo svg{width:16px;height:16px;flex:none}.gc-anexo .gc-ib svg{width:15px;height:15px}' +
'.gc-anexo span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
'.gc-so{padding:12px 14px;text-align:center;color:var(--muted);font-size:13.5px;border-top:1px solid var(--line);background:var(--surface)}' +
'.gc-err{color:#C0392B;font-size:13px;margin:0 2px 6px}' +
'.gc-vazio{text-align:center;padding:36px 18px;color:var(--muted)}.gc-vazio b{display:block;color:var(--ink);font:800 16px var(--f-display);margin-bottom:4px}' +
'.gc-form{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px}' +
'.gc-form label.f{display:block;font-weight:600;font-size:14px;margin-bottom:12px}' +
'.gc-form label.f select,.gc-form label.f input{display:block;width:100%;margin-top:5px;height:44px;border:1px solid var(--line);border-radius:10px;padding:0 12px;font:15px var(--f-body);background:var(--surface);color:var(--ink);box-sizing:border-box}' +
'.gc-form label.c{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border:1px solid var(--line);border-radius:10px;margin-bottom:10px;cursor:pointer;font-size:14px}' +
'.gc-form label.c input{margin-top:3px}.gc-form label.c small{display:block;color:var(--muted);font-size:12.5px;margin-top:1px}' +
'.gc-bts{display:flex;gap:8px;justify-content:flex-end;margin-top:6px;flex-wrap:wrap}';

var IC = {
  clip: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  back: 'M15 18l-6-6 6-6',
  cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8.6 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3 14.08H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9.92 3H10a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 21 9.92V10a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  x: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'
};
function ic(n){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="'+IC[n]+'"/></svg>'; }
function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function iniciais(n){ var p=String(n||'?').trim().split(/\s+/); return ((p[0]||'?')[0]+((p.length>1?p[p.length-1]:'')[0]||'')).toUpperCase(); }
function dois(n){ return String(n).padStart(2,'0'); }
function hora(iso){ var d=new Date(iso); return isNaN(d)?'':dois(d.getHours())+':'+dois(d.getMinutes()); }
function diaChave(iso){ var d=new Date(iso); return isNaN(d)?'':d.getFullYear()+'-'+dois(d.getMonth()+1)+'-'+dois(d.getDate()); }
function diaNome(iso){ var d=new Date(iso), h=new Date(); if(isNaN(d)) return '';
  var k=diaChave(iso); if(k===diaChave(h.toISOString())) return 'Hoje';
  var o=new Date(h.getTime()-864e5); if(k===diaChave(o.toISOString())) return 'Ontem';
  return dois(d.getDate())+'/'+dois(d.getMonth()+1)+'/'+d.getFullYear(); }
function quando(iso){ if(!iso) return ''; var n=diaNome(iso); return n==='Hoje'?hora(iso):n; }
function tamanho(b){ b=Number(b||0); return b>=1048576?(b/1048576).toFixed(1).replace('.',',')+' MB':Math.max(1,Math.round(b/1024))+' KB'; }
function extDe(n){ var m=String(n||'').match(/\.([a-z0-9]{2,5})$/i); return m?m[1].toLowerCase():''; }
var COR_EXT={pdf:'#C0392B',doc:'#1E5BB8',docx:'#1E5BB8',odt:'#1E5BB8',xls:'#168A52',xlsx:'#168A52',ods:'#168A52',csv:'#168A52',ppt:'#C2410C',pptx:'#C2410C',odp:'#C2410C'};
var ACEITES='.pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.csv,.mp3,.m4a,.ogg,.opus,.mp4';
var toque=false; try{ toque=window.matchMedia('(pointer:coarse)').matches; }catch(e){}

function vistos(chave){ try{ return JSON.parse(localStorage.getItem('gs_chat_'+chave)||'{}')||{}; }catch(e){ return {}; } }
function marcarVisto(chave,id,iso){ if(!iso) return; try{ var v=vistos(chave); if(!v[id] || v[id]<iso){ v[id]=iso; localStorage.setItem('gs_chat_'+chave,JSON.stringify(v)); } }catch(e){} }

// imagens grandes ficam mais leves antes de enviar (poupa dados móveis)
function prepararFicheiro(f){
  return new Promise(function(ok){
    var img=/^image\/(jpeg|png|webp)$/.test(f.type) && f.size>400*1024;
    var rd=new FileReader();
    rd.onerror=function(){ ok(null); };
    rd.onload=function(){
      var url=rd.result;
      if(!img) return ok({nome:f.name, dados:String(url).split(',')[1]||'', tamanho:f.size});
      var im=new Image();
      im.onerror=function(){ ok({nome:f.name, dados:String(url).split(',')[1]||'', tamanho:f.size}); };
      im.onload=function(){
        var max=1600, w=im.width, h=im.height, k=Math.min(1, max/Math.max(w,h));
        var c=document.createElement('canvas'); c.width=Math.round(w*k); c.height=Math.round(h*k);
        var x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); x.drawImage(im,0,0,c.width,c.height);
        var out=c.toDataURL('image/jpeg',0.82), dados=out.split(',')[1]||'', bytes=Math.floor(dados.length*3/4);
        if(bytes>=f.size) return ok({nome:f.name, dados:String(url).split(',')[1]||'', tamanho:f.size});
        ok({nome:String(f.name).replace(/\.[a-z0-9]+$/i,'')+'.jpg', dados:dados, tamanho:bytes});
      };
      im.src=url;
    };
    rd.readAsDataURL(f);
  });
}

function montar(el, op){
  op=op||{};
  if(!document.getElementById('gc-css')){ var st=document.createElement('style'); st.id='gc-css'; st.textContent=CSS; document.head.appendChild(st); }
  var api=op.api, papel=op.papel||'estudante', chave=op.chave||papel;
  var S={ lista:null, chat:null, msgs:[], ids:{}, marca:'', mais:false, timer:null, anexo:null, enviando:false, vivo:true };
  function aviso(t){ if(op.aviso) op.aviso(t); }
  function parar(){ if(S.timer){ clearInterval(S.timer); S.timer=null; } }
  function ligado(){ return S.vivo && document.body.contains(el); }
  function corpoBase(x){ if(op.estudante) x.estudante=op.estudante; return x; }

  /* ---------- lista ---------- */
  function lista(){
    parar(); S.chat=null;
    el.innerHTML='<div class="gc-top"><h3>Chat da turma</h3></div><div class="gc-vazio">A abrir os chats…</div>';
    api('/chat/lista', corpoBase({})).then(function(r){
      if(!ligado()) return;
      if(!r.ok){ el.innerHTML='<div class="gc-top"><h3>Chat da turma</h3></div><div class="gc-err">'+esc(r.erro)+'</div>'; return; }
      S.lista=r; desenharLista();
    });
  }
  function desenharLista(){
    var r=S.lista, v=vistos(chave), L=r.chats||[];
    var sub={ professor:'Crie um chat em cada turma onde dá aulas. Os estudantes conversam consigo e enviam trabalhos e ficheiros (até '+r.max_mb+' MB).',
      estudante:'Os chats que os professores criaram para a sua turma. Pode escrever e enviar ficheiros (até '+r.max_mb+' MB).',
      encarregado:'Os chats dos professores com a turma do seu educando. Os encarregados podem ler, mas não escrever.',
      direccao:'Todos os chats das turmas. A Direcção pode ler, escrever, apagar mensagens e fechar ou reabrir chats.' }[papel]||'';
    el.innerHTML='<div class="gc-top"><h3>Chat da turma</h3>'+(r.pode_criar?'<button class="btn pri" data-novo>'+ic('plus')+'Novo chat</button>':'')+'</div>'+
      '<p class="gc-sub">'+esc(sub)+'</p>'+
      (L.length?'<div class="gc-lista">'+L.map(function(c,i){
        var novo=c.mensagens>0 && c.ultima && (!v[c.id] || v[c.id]<c.ultima);
        return '<button type="button" class="gc-it" data-ch="'+i+'"><span class="gc-av">'+esc(iniciais(c.turma_nome))+'</span><span class="tx"><b>'+esc(c.nome)+(c.activo?'':'<span class="gc-pill f">Fechado</span>')+(c.so_professor?'<span class="gc-pill">Avisos</span>':'')+'</b>'+
          '<small>'+esc(c.turma_nome+(c.professor_nome?' · Prof. '+c.professor_nome:''))+'</small><small'+(novo?' style="color:var(--ink);font-weight:600"':'')+'>'+esc(c.ultimo_texto||'Ainda sem mensagens')+'</small></span>'+
          '<span class="hr">'+esc(quando(c.ultima))+(novo?'<br><span class="gc-dot"></span>':'')+'</span></button>';
      }).join('')+'</div>'
      : '<div class="gc-lista"><div class="gc-vazio"><b>'+(papel==='professor'?'Ainda não criou chats':'Ainda não há chats')+'</b>'+
          esc(papel==='professor'?(r.turmas&&r.turmas.length?'Carregue em «Novo chat» e escolha a turma.':'Quando a Direcção o ligar a turmas, pode criar chats aqui.'):papel==='direccao'?'Os professores criam os chats nas turmas onde dão aulas.':'Quando um professor criar um chat para a turma, aparece aqui.')+'</div></div>');
    var nb=el.querySelector('[data-novo]'); if(nb) nb.onclick=function(){ form(null); };
    Array.prototype.forEach.call(el.querySelectorAll('[data-ch]'),function(b){ b.onclick=function(){ abrir(L[+b.getAttribute('data-ch')]); }; });
  }

  /* ---------- criar e mudar (professor e Direcção) ---------- */
  function form(c){
    parar();
    var T=(S.lista&&S.lista.turmas)||[], novo=!c;
    if(novo && !T.length){ aviso('Ainda não está ligado a nenhuma turma.'); return; }
    var opcoes=[]; T.forEach(function(t){ if(t.disciplinas.length) t.disciplinas.forEach(function(d){ opcoes.push({turma:t.id, nome:t.nome+' · '+d, rot:t.nome+' — '+d}); });
      if(t.titular || !t.disciplinas.length) opcoes.push({turma:t.id, nome:t.nome, rot:t.nome+(t.titular?' — turma toda (titular)':'')}); });
    el.innerHTML='<div class="gc-top"><h3>'+(novo?'Novo chat':'Definições do chat')+'</h3></div><div class="gc-form">'+
      (novo?'<label class="f">Turma<select data-f="t">'+opcoes.map(function(o,i){ return '<option value="'+i+'">'+esc(o.rot)+'</option>'; }).join('')+'</select></label>':'<p class="gc-sub" style="margin:0 0 12px">Turma: <b>'+esc(c.turma_nome)+'</b></p>')+
      '<label class="f">Nome do chat<input data-f="n" maxlength="80" value="'+esc(novo?(opcoes[0]?opcoes[0].nome:''):c.nome)+'"></label>'+
      '<label class="c"><input type="checkbox" data-f="e"'+(novo||c.encarregados?' checked':'')+'><span><b>Os encarregados podem ler</b><small>Vêem as mensagens e os ficheiros, mas não escrevem.</small></span></label>'+
      '<label class="c"><input type="checkbox" data-f="s"'+(!novo&&c.so_professor?' checked':'')+'><span><b>Só o professor escreve</b><small>Para avisos e materiais. Os estudantes lêem e descarregam os ficheiros.</small></span></label>'+
      '<div class="gc-err" data-f="err"></div>'+
      '<div class="gc-bts">'+(!novo?'<button class="btn" data-f="fx" style="margin-right:auto;color:#C0392B">'+(c.activo?'Fechar o chat':'Reabrir o chat')+'</button>':'')+'<button class="btn" data-f="cancel">Cancelar</button><button class="btn pri" data-f="ok">'+(novo?'Criar chat':'Guardar')+'</button></div></div>';
    function q(k){ return el.querySelector('[data-f="'+k+'"]'); }
    if(novo) q('t').onchange=function(){ q('n').value=opcoes[+q('t').value].nome; };
    q('cancel').onclick=function(){ if(novo) desenharLista(); else abrir(c); };
    q('ok').onclick=function(){ var b=this; b.disabled=true; q('err').textContent='';
      var corpo={ nome:q('n').value, encarregados:q('e').checked, so_professor:q('s').checked };
      if(novo) corpo.turma=opcoes[+q('t').value].turma; else corpo.id=c.id;
      api('/chat/guardar',corpo).then(function(r){ if(!ligado()) return; b.disabled=false; if(!r.ok){ q('err').textContent=r.erro; return; }
        aviso(novo?'Chat criado':'Chat actualizado');
        if(novo){ api('/chat/lista',corpoBase({})).then(function(l){ if(!ligado()) return; if(l.ok){ S.lista=l; var x=l.chats.filter(function(z){ return z.id===r.id; })[0]; if(x) return abrir(x); } lista(); }); }
        else { c.nome=corpo.nome; c.encarregados=corpo.encarregados; c.so_professor=corpo.so_professor; abrir(c); } }); };
    var fx=q('fx'); if(fx) fx.onclick=function(){
      if(c.activo && !confirm('Fechar este chat? Sai da lista dos estudantes e ninguém pode escrever.'+(papel==='direccao'?'':' Só a Direcção o pode reabrir.'))) return;
      fx.disabled=true;
      api('/chat/fechar',{id:c.id, reabrir:!c.activo}).then(function(r){ if(!ligado()) return; fx.disabled=false; if(!r.ok){ q('err').textContent=r.erro; return; } aviso(r.activo?'Chat reaberto':'Chat fechado'); lista(); }); };
  }

  /* ---------- conversa ---------- */
  function abrir(c){
    parar(); S.chat=c; S.msgs=[]; S.ids={}; S.marca=''; S.mais=false; S.anexo=null;
    el.innerHTML='<div class="gc-box"><div class="gc-cab"><button class="gc-ib" data-v title="Voltar">'+ic('back')+'</button><span class="gc-av" style="width:38px;height:38px;border-radius:10px;font-size:13px">'+esc(iniciais(c.turma_nome))+'</span>'+
      '<div class="tx"><b>'+esc(c.nome)+'</b><small>'+esc(c.turma_nome+(c.professor_nome?' · Prof. '+c.professor_nome:''))+'</small></div>'+
      (c.pode_gerir?'<button class="gc-ib" data-g title="Definições">'+ic('cog')+'</button>':'')+'</div>'+
      '<div class="gc-msgs" data-m><div class="gc-vazio">A abrir as mensagens…</div></div><div data-c></div></div>';
    el.querySelector('[data-v]').onclick=function(){ lista(); };
    var g=el.querySelector('[data-g]'); if(g) g.onclick=function(){ form(S.chat); };
    api('/chat/mensagens',{chat:c.id}).then(function(r){
      if(!ligado() || S.chat!==c) return;
      if(!r.ok){ el.querySelector('[data-m]').innerHTML='<div class="gc-vazio"><b>Não foi possível abrir</b>'+esc(r.erro)+'</div>'; return; }
      Object.assign(c, {pode_escrever:r.chat.pode_escrever, pode_gerir:r.chat.pode_gerir, so_professor:r.chat.so_professor, activo:r.chat.activo});
      S.marca=r.marca; S.mais=r.mais; juntar(r.mensagens); compositor(); desenhar(true);
      S.timer=setInterval(actualizar, 5000);
    });
  }
  function juntar(L){
    var novas=0;
    (L||[]).forEach(function(m){ if(S.ids[m.id]){ var i=S.msgs.indexOf(S.ids[m.id]); if(i>=0) S.msgs[i]=m; S.ids[m.id]=m; } else if(!m.apagada){ S.msgs.push(m); S.ids[m.id]=m; novas++; } });
    S.msgs.sort(function(a,b){ return String(a.data).localeCompare(String(b.data)); });
    var u=S.msgs[S.msgs.length-1]; if(u && S.chat) marcarVisto(chave, S.chat.id, u.data>(S.chat.ultima||'')?u.data:S.chat.ultima);
    return novas;
  }
  function actualizar(){
    if(!ligado() || !S.chat){ parar(); return; }
    if(document.hidden) return;
    var c=S.chat;
    api('/chat/mensagens',{chat:c.id, depois:S.marca}).then(function(r){
      if(!ligado() || S.chat!==c || !r.ok) return;
      if(r.marca) S.marca=r.marca;
      if(!r.mensagens.length) return;
      var box=el.querySelector('[data-m]'), noFundo=box && (box.scrollHeight-box.scrollTop-box.clientHeight<80);
      juntar(r.mensagens); desenhar(noFundo);
    });
  }
  function desenhar(fundo){
    var box=el.querySelector('[data-m]'); if(!box) return;
    var h=S.mais?'<div class="gc-mais"><button class="btn sm" data-ant>Ver mensagens anteriores</button></div>':'', dia='';
    if(!S.msgs.length) h+='<div class="gc-vazio"><b>Ainda sem mensagens</b>'+(S.chat.pode_escrever?'Escreva a primeira mensagem ou envie um ficheiro.':'As mensagens do professor aparecem aqui.')+'</div>';
    S.msgs.forEach(function(m){
      var d=diaChave(m.data); if(d!==dia){ dia=d; h+='<div class="gc-dia"><span>'+esc(diaNome(m.data))+'</span></div>'; }
      h+='<div class="gc-m'+(m.eu?' eu':'')+(m.papel==='professor'||m.papel==='direccao'?' prof':'')+'"><div class="gc-b">';
      if(m.apagada){ h+='<div class="gc-apag">Mensagem apagada</div><div class="gc-ft">'+hora(m.data)+'</div></div></div>'; return; }
      if(!m.eu) h+='<div class="gc-au">'+esc(m.autor)+(m.papel==='professor'?'<span class="gc-pill p">Professor</span>':m.papel==='direccao'?'<span class="gc-pill d">Direcção</span>':'')+'</div>';
      if(m.ficheiro) h+=htmlFicheiro(m.ficheiro);
      if(m.texto) h+='<div class="gc-tx">'+ligacoes(esc(m.texto))+'</div>';
      h+='<div class="gc-ft">'+(m.pode_apagar?'<button class="gc-del" data-del="'+esc(m.id)+'">Apagar</button>':'')+'<span>'+hora(m.data)+'</span></div></div></div>';
    });
    var antes=box.scrollHeight-box.scrollTop, st=box.scrollTop;
    box.innerHTML=h;
    if(fundo) box.scrollTop=box.scrollHeight; else if(fundo===false) box.scrollTop=box.scrollHeight-antes; else box.scrollTop=st;
    var a=box.querySelector('[data-ant]'); if(a) a.onclick=anteriores;
    Array.prototype.forEach.call(box.querySelectorAll('[data-del]'),function(b){ b.onclick=function(){ apagar(b.getAttribute('data-del'), b); }; });
    Array.prototype.forEach.call(box.querySelectorAll('img'),function(im){ im.onload=function(){ if(fundo) box.scrollTop=box.scrollHeight; }; });
  }
  function ligacoes(t){ return t.replace(/(https?:\/\/[^\s<]+)/g,function(u){ return '<a href="'+u+'" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">'+u+'</a>'; }); }
  function htmlFicheiro(f){
    var url=esc(f.url), e=extDe(f.nome);
    if(/^image\//.test(f.tipo)) return '<a class="gc-img" href="'+url+'" target="_blank" rel="noopener"><img src="'+url+'" alt="'+esc(f.nome)+'"></a>';
    if(/^audio\//.test(f.tipo)) return '<audio controls preload="none" src="'+url+'"></audio>';
    return '<a class="gc-fx" href="'+url+'" target="_blank" rel="noopener" download="'+esc(f.nome)+'"><span class="gc-ext" style="background:'+(COR_EXT[e]||'#5F6B7A')+'">'+esc(e||'fx')+'</span><span><span class="n">'+esc(f.nome)+'</span><span class="s">'+tamanho(f.tamanho)+' · Abrir</span></span></a>';
  }
  function anteriores(){
    var c=S.chat, b=this, pri=S.msgs[0]; if(!pri) return; b.disabled=true; b.textContent='A abrir…';
    api('/chat/mensagens',{chat:c.id, antes:pri.data}).then(function(r){ if(!ligado() || S.chat!==c) return; if(!r.ok){ b.disabled=false; b.textContent='Tentar outra vez'; return; }
      S.mais=r.mais; juntar(r.mensagens); desenhar(false); });
  }
  function apagar(id, b){
    if(!confirm('Apagar esta mensagem para todos?')) return;
    b.disabled=true;
    api('/chat/apagar',{id:id}).then(function(r){ if(!ligado()) return; if(!r.ok){ b.disabled=false; aviso(r.erro); return; }
      var m=S.ids[id]; if(m){ m.apagada=true; m.texto=''; m.ficheiro=null; } desenhar(null); });
  }
  function compositor(){
    var c=S.chat, cx=el.querySelector('[data-c]'); if(!cx) return;
    if(!c.pode_escrever){
      cx.innerHTML='<div class="gc-so">'+esc(!c.activo?'Este chat está fechado.':papel==='encarregado'?'Os encarregados podem ler o chat, mas não escrever.':'Neste chat só o professor escreve.')+'</div>'; return; }
    cx.innerHTML='<div class="gc-comp"><div data-a></div><div class="gc-err" data-e style="display:none"></div><div class="gc-row">'+
      '<button class="gc-ib" data-fx title="Enviar ficheiro">'+ic('clip')+'</button><input type="file" data-in accept="'+ACEITES+'" style="display:none">'+
      '<textarea data-t rows="1" maxlength="2000" placeholder="Escreva uma mensagem"></textarea>'+
      '<button class="gc-ib gc-env" data-s title="Enviar">'+ic('send')+'</button></div></div>';
    var t=cx.querySelector('[data-t]'), inp=cx.querySelector('[data-in]');
    function altura(){ t.style.height='auto'; t.style.height=Math.min(140,t.scrollHeight+2)+'px'; }
    t.oninput=altura;
    t.onkeydown=function(e){ if(e.key==='Enter' && !e.shiftKey && !toque){ e.preventDefault(); enviar(); } };
    cx.querySelector('[data-fx]').onclick=function(){ inp.click(); };
    inp.onchange=function(){ var f=inp.files&&inp.files[0]; inp.value=''; if(!f) return; escolher(f); };
    cx.querySelector('[data-s]').onclick=enviar;
  }
  function erroComp(t){ var e=el.querySelector('[data-e]'); if(!e) return; e.textContent=t||''; e.style.display=t?'block':'none'; }
  function mostrarAnexo(){
    var a=el.querySelector('[data-a]'); if(!a) return;
    if(!S.anexo){ a.innerHTML=''; return; }
    a.innerHTML='<div class="gc-anexo">'+ic('clip')+'<span>'+esc(S.anexo.nome)+' · '+tamanho(S.anexo.tamanho)+'</span><button class="gc-ib" data-ax style="width:30px;height:30px" title="Tirar">'+ic('x')+'</button></div>';
    a.querySelector('[data-ax]').onclick=function(){ S.anexo=null; mostrarAnexo(); };
  }
  function escolher(f){
    erroComp('');
    var max=((S.lista&&S.lista.max_mb)||5)*1048576, e=extDe(f.name);
    if(ACEITES.split(',').indexOf('.'+e)<0){ erroComp('Este tipo de ficheiro não é aceite. Envie PDF, imagens, Word, Excel, PowerPoint, texto ou áudio.'); return; }
    var img=/^image\/(jpeg|png|webp)$/.test(f.type);
    if(!img && f.size>max){ erroComp('O ficheiro tem mais de '+(max/1048576)+' MB.'); return; }
    S.anexo={nome:f.name, tamanho:f.size, carregar:true}; mostrarAnexo();
    prepararFicheiro(f).then(function(x){ if(!ligado()) return;
      if(!x){ S.anexo=null; mostrarAnexo(); erroComp('Não foi possível ler o ficheiro.'); return; }
      if(x.tamanho>max){ S.anexo=null; mostrarAnexo(); erroComp('O ficheiro tem mais de '+(max/1048576)+' MB.'); return; }
      S.anexo=x; mostrarAnexo(); });
  }
  function enviar(){
    if(S.enviando) return;
    var c=S.chat, t=el.querySelector('[data-t]'), b=el.querySelector('[data-s]'); if(!t) return;
    var texto=t.value.trim();
    if(S.anexo && S.anexo.carregar){ erroComp('Espere um momento: o ficheiro ainda está a ser preparado.'); return; }
    if(!texto && !S.anexo) return;
    erroComp(''); S.enviando=true; b.disabled=true;
    var corpo={chat:c.id, texto:texto}; if(S.anexo) corpo.ficheiro={nome:S.anexo.nome, dados:S.anexo.dados};
    var a=el.querySelector('[data-a]'); if(S.anexo && a) a.innerHTML='<div class="gc-anexo">'+ic('clip')+'<span>A enviar '+esc(S.anexo.nome)+'…</span></div>';
    api('/chat/enviar',corpo).then(function(r){
      S.enviando=false; if(!ligado() || S.chat!==c) return; b.disabled=false;
      if(!r.ok){ erroComp(r.erro); mostrarAnexo(); return; }
      t.value=''; t.style.height=''; S.anexo=null; mostrarAnexo();
      if(r.mensagem && r.mensagem.id && !S.ids[r.mensagem.id]){ S.msgs.push(r.mensagem); S.ids[r.mensagem.id]=r.mensagem; }
      c.ultima=r.mensagem&&r.mensagem.data; marcarVisto(chave,c.id,c.ultima);
      desenhar(true); if(!toque) t.focus();
    });
  }

  lista();
  return { parar:function(){ S.vivo=false; parar(); }, lista:lista };
}
window.GSChat = { montar: montar };
})();
