/* Gescolar · aulas online: gravadas (Bunny Stream) e ao vivo (Agora) — usado em professor.html, portal.html e direccao.html (v5.20)
   GSAulas.montar(el, { api, papel: 'professor'|'estudante'|'encarregado'|'direccao', estudante, aviso })
   Aulas gravadas: o professor ou a Direcção carregam do browser direto para o Bunny (TUS, com retoma); a turma vê no portal.
   Ao vivo: o professor transmite (câmara, microfone, ecrã); os alunos vêem, escrevem e levantam a mão; o professor deixa falar. */
(function(){
'use strict';
var TUS_URL='https://cdn.jsdelivr.net/npm/tus-js-client@4.3.1/dist/tus.min.js';
var AGORA_URL='https://cdn.jsdelivr.net/npm/agora-rtc-sdk-ng@4.24.9/AgoraRTC_N-production.js';
var CSS=''+
'.ga-top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:4px 0 12px}.ga-top h3{margin:0;font:800 18px var(--f-display)}'+
'.ga-sub{color:var(--muted);font-size:13.5px;margin:-6px 2px 14px;line-height:1.45}'+
'.ga-sec{font:800 15px var(--f-display);margin:18px 2px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}'+
'.ga-bts{display:flex;gap:8px;flex-wrap:wrap}'+
'.ga-live{display:flex;gap:12px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-bottom:8px;flex-wrap:wrap}'+
'.ga-live.on{border-color:#C0392B;box-shadow:0 0 0 3px rgba(192,57,43,.12)}'+
'.ga-live .tx{flex:1;min-width:180px}.ga-live b{display:block}.ga-live small{color:var(--muted);font-size:13px}'+
'.ga-dot{display:inline-flex;align-items:center;gap:6px;font:800 11px var(--f-body);letter-spacing:.06em;color:#fff;background:#C0392B;border-radius:99px;padding:3px 9px}'+
'.ga-dot:before{content:"";width:7px;height:7px;border-radius:50%;background:#fff;animation:gaP 1.2s infinite}@keyframes gaP{50%{opacity:.25}}'+
'.ga-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}'+
'.ga-v{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}'+
'.ga-th{position:relative;aspect-ratio:16/9;background:#0B2A4A;display:grid;place-items:center;cursor:pointer;border:0;padding:0;width:100%}'+
'.ga-th img{width:100%;height:100%;object-fit:cover;display:block}.ga-th .pl{position:absolute;width:46px;height:46px;border-radius:50%;background:rgba(0,0,0,.55);display:grid;place-items:center}'+
'.ga-th .pl:after{content:"";border-left:15px solid #fff;border-top:9px solid transparent;border-bottom:9px solid transparent;margin-left:4px}'+
'.ga-th .du{position:absolute;right:8px;bottom:8px;background:rgba(0,0,0,.7);color:#fff;font:700 11.5px var(--f-body);padding:2px 6px;border-radius:5px}'+
'.ga-v .bd{padding:10px 12px;flex:1}.ga-v b{display:block;font-size:14.5px;line-height:1.3}.ga-v small{display:block;color:var(--muted);font-size:12.5px;margin-top:2px}'+
'.ga-v .ac{padding:0 12px 10px;display:flex;gap:6px;justify-content:flex-end}'+
'.ga-pill{display:inline-block;font:700 11.5px var(--f-body);padding:2px 8px;border-radius:99px;background:#FFF4D6;color:#8A6D00;margin-top:6px}.ga-pill.bad{background:#FDE8E6;color:#C0392B}'+
'.ga-form{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px}'+
'.ga-f{display:block;font-weight:600;font-size:13.5px;margin-bottom:12px}.ga-f input,.ga-f select,.ga-f textarea{display:block;width:100%;box-sizing:border-box;margin-top:5px;border:1px solid var(--line);border-radius:10px;padding:9px 11px;font:14.5px var(--f-body);color:var(--ink);background:var(--surface)}'+
'.ga-f input,.ga-f select{height:42px;padding-top:0;padding-bottom:0}.ga-f input[type=file]{height:auto;padding:9px}'+
'.ga-bar{height:10px;border-radius:5px;background:var(--line);overflow:hidden;margin:8px 0 4px}.ga-bar i{display:block;height:100%;background:var(--blue);width:0;transition:width .3s}'+
'.ga-err{color:#C0392B;font-size:13.5px;margin:0 2px 10px}'+
'.ga-vazio{text-align:center;padding:26px 16px;color:var(--muted);background:var(--surface);border:1px dashed var(--line);border-radius:14px;font-size:14px}.ga-vazio b{display:block;color:var(--ink);font:800 15px var(--f-display);margin-bottom:4px}'+
'.ga-pro{background:linear-gradient(135deg,#0B2A4A,#0A64DC);color:#fff;border-radius:16px;padding:20px}.ga-pro b{display:block;font:800 18px var(--f-display);margin-bottom:6px}'+
'.ga-ov{position:fixed;inset:0;z-index:200;background:rgba(5,12,22,.92);display:flex;flex-direction:column}'+
'.ga-ov-h{display:flex;align-items:center;gap:10px;padding:10px 14px;color:#fff}.ga-ov-h b{flex:1;font:800 15px var(--f-display);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
'.ga-x{background:rgba(255,255,255,.12);border:0;color:#fff;border-radius:10px;height:38px;padding:0 14px;font:700 14px var(--f-body);cursor:pointer}'+
'.ga-play{flex:1;display:grid;place-items:center;padding:0 12px 12px}.ga-play iframe{width:min(100%,calc((100vh - 90px)*16/9));aspect-ratio:16/9;border:0;border-radius:12px;background:#000}'+
/* sala ao vivo */
'.gl{position:fixed;inset:0;z-index:210;background:#0A1320;color:#fff;display:flex;flex-direction:column;font-family:var(--f-body)}'+
'.gl-h{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08)}.gl-h b{flex:1;min-width:0;font:800 15px var(--f-display);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
'.gl-h small{color:rgba(255,255,255,.7);font-size:13px;white-space:nowrap}'+
'.gl-m{flex:1;display:flex;min-height:0}'+
'.gl-st{flex:1;position:relative;display:flex;flex-direction:column;min-width:0;padding:10px}'+
'.gl-main{flex:1;position:relative;background:#000;border-radius:12px;overflow:hidden;min-height:180px}'+
'.gl-main .msg{position:absolute;inset:0;display:grid;place-items:center;text-align:center;color:rgba(255,255,255,.75);font-size:14.5px;padding:20px}'+
'.gl-tiles{display:flex;gap:8px;margin-top:8px;overflow-x:auto}.gl-tile{flex:none;width:150px;aspect-ratio:4/3;background:#111;border-radius:10px;overflow:hidden;position:relative}'+
'.gl-tile span{position:absolute;left:6px;bottom:6px;font:700 11.5px var(--f-body);background:rgba(0,0,0,.6);padding:2px 6px;border-radius:5px}'+
'.gl-side{width:320px;border-left:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;min-height:0;background:#0E1A2B}'+
'.gl-tabs{display:flex}.gl-tabs button{flex:1;background:none;border:0;border-bottom:2px solid transparent;color:rgba(255,255,255,.65);font:700 13.5px var(--f-body);padding:10px 4px;cursor:pointer}.gl-tabs button.on{color:#fff;border-bottom-color:#F5B400}'+
'.gl-list{flex:1;overflow-y:auto;padding:10px}.gl-msg{margin-bottom:8px;font-size:14px;line-height:1.4}.gl-msg b{font-size:12.5px;color:#9CC3FF;display:block}.gl-msg.h b{color:#F5B400}'+
'.gl-p{display:flex;align-items:center;gap:8px;padding:8px 6px;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px}.gl-p span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+
'.gl-in{display:flex;gap:6px;padding:8px;border-top:1px solid rgba(255,255,255,.08)}.gl-in input{flex:1;min-width:0;height:40px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0A1320;color:#fff;padding:0 10px;font:14px var(--f-body)}'+
'.gl-c{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;padding:10px;border-top:1px solid rgba(255,255,255,.08)}'+
'.gl-b{background:rgba(255,255,255,.1);border:0;color:#fff;border-radius:12px;height:44px;padding:0 14px;font:700 14px var(--f-body);cursor:pointer;display:inline-flex;align-items:center;gap:6px}'+
'.gl-b.off{background:#C0392B}.gl-b.on{background:#168A52}.gl-b.sun{background:#F5B400;color:#0A1320}.gl-b.red{background:#C0392B}.gl-b:disabled{opacity:.5}'+
'.gl-sm{height:30px;border-radius:8px;padding:0 10px;font-size:12.5px}'+
'.gl-ban{background:#F5B400;color:#0A1320;border-radius:10px;padding:8px 12px;margin-bottom:8px;font:700 14px var(--f-body);display:flex;gap:10px;align-items:center;flex-wrap:wrap}'+
'@media (max-width:820px){.gl-m{flex-direction:column}.gl-side{width:auto;height:42%;border-left:0;border-top:1px solid rgba(255,255,255,.08)}.gl-main{min-height:0}}';

function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function dois(n){ return String(n).padStart(2,'0'); }
function dataHora(iso){ var d=new Date(iso); if(isNaN(d)) return ''; return dois(d.getDate())+'/'+dois(d.getMonth()+1)+' às '+dois(d.getHours())+':'+dois(d.getMinutes()); }
function data(iso){ var d=new Date(iso); return isNaN(d)?'':dois(d.getDate())+'/'+dois(d.getMonth()+1)+'/'+d.getFullYear(); }
function duracao(s){ s=Math.round(s||0); if(!s) return ''; var h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60; return (h?h+':'+dois(m):m)+':'+dois(x); }
function css(){ if(!document.getElementById('ga-css')){ var s=document.createElement('style'); s.id='ga-css'; s.textContent=CSS; document.head.appendChild(s); } }
var carregados={};
function script(url, pronto){ if(carregados[url]==='ok') return pronto(); if(carregados[url]) { carregados[url].push(pronto); return; }
  carregados[url]=[pronto]; var s=document.createElement('script'); s.src=url;
  s.onload=function(){ var l=carregados[url]; carregados[url]='ok'; l.forEach(function(f){ f(); }); };
  s.onerror=function(){ var l=carregados[url]; carregados[url]=null; l.forEach(function(f){ f('erro'); }); };
  document.head.appendChild(s); }

function montar(el, op){
  css(); op=op||{};
  var api=op.api, papel=op.papel, gere=papel==='professor'||papel==='direccao', S={ d:null, envio:null, vivo:true, timer:null };
  function aviso(t){ if(op.aviso) op.aviso(t); }
  function ligado(){ return S.vivo && document.body.contains(el); }
  function corpo(x){ if(op.estudante) x.estudante=op.estudante; return x; }
  function carregar(){
    if(S.envio) return desenhar();
    el.innerHTML='<div class="ga-vazio">A abrir as aulas online…</div>';
    api('/aulas/lista',corpo({})).then(function(r){ if(!ligado()) return; if(!r.ok){ el.innerHTML='<div class="ga-err">'+esc(r.erro)+'</div>'; return; } S.d=r; desenhar(); vigiar(); });
  }
  function vigiar(){
    if(S.timer) clearInterval(S.timer);
    S.timer=setInterval(function(){
      if(!ligado()){ clearInterval(S.timer); return; }
      if(document.hidden || !S.d) return;
      var pend=S.d.videos.filter(function(v){ return v.estado==='processando'||v.estado==='enviando'; }).map(function(v){ return v.id; }).slice(0,10);
      if(!pend.length || S.envio) return;
      api('/videos/estado',{ids:pend}).then(function(r){ if(!r.ok||!ligado()) return; var mudou=false;
        r.videos.forEach(function(x){ S.d.videos.forEach(function(v){ if(v.id===x.id){ if(v.estado!==x.estado) mudou=true; v.estado=x.estado; v.duracao=x.duracao; v.progresso=x.progresso; } }); });
        if(mudou) carregar(); else desenhar(); });
    }, 12000);
  }
  function desenhar(){
    var r=S.d; if(!r) return;
    if(!r.pro){ el.innerHTML='<div class="ga-top"><h3>Aulas online</h3></div>'+(gere?'<div class="ga-pro"><b>Aulas gravadas e ao vivo</b>Carregue vídeos das aulas e dê aulas ao vivo pelo telemóvel ou computador. Faz parte do plano Pro: mude de plano em «Assinatura do Gescolar».</div>':'<div class="ga-vazio"><b>Ainda sem aulas online</b>A escola ainda não activou as aulas gravadas e ao vivo.</div>'); return; }
    var vivas=r.lives.filter(function(l){ return l.estado==='aovivo'; }), agend=r.lives.filter(function(l){ return l.estado==='agendada'; }), fim=r.lives.filter(function(l){ return l.estado==='terminada'; }).slice(0,5);
    var sub={ professor:'Carregue vídeos das aulas para as suas turmas e dê aulas ao vivo. Os estudantes vêem no portal, no telemóvel.', direccao:'Aulas gravadas e ao vivo de todas as turmas. A Direcção também pode carregar e transmitir.', estudante:'As aulas que os professores gravaram e as aulas ao vivo da sua turma.', encarregado:'As aulas gravadas e ao vivo da turma do seu educando. Pode assistir com ele.' }[papel]||'';
    var h='<div class="ga-top"><h3>Aulas online</h3></div><p class="ga-sub">'+esc(sub)+'</p>';
    h+='<div class="ga-sec"><span>Ao vivo</span>'+(gere&&r.pares.length?'<div class="ga-bts"><button class="btn sm" data-ag>Agendar</button><button class="btn sm pri" data-nl>● Começar aula ao vivo</button></div>':'')+'</div>';
    if(gere && !r.agora) h+='<div class="ga-err">As aulas ao vivo ainda não estão ligadas no servidor (faltam as chaves do Agora).</div>';
    h+=(vivas.length||agend.length?vivas.concat(agend).map(function(l){ var on=l.estado==='aovivo';
      return '<div class="ga-live'+(on?' on':'')+'">'+(on?'<span class="ga-dot">AO VIVO</span>':'<span class="ga-pill" style="margin:0">'+esc(dataHora(l.inicio))+'</span>')+
        '<div class="tx"><b>'+esc(l.titulo)+'</b><small>'+esc(l.turma_nome+' · '+l.disciplina_nome+' · '+l.autor)+(on&&l.online?' · '+l.online+' na sala':'')+'</small></div>'+
        '<div class="ga-bts">'+(on?(l.pode_gerir?'<button class="btn sm" data-tl="'+l.id+'">Terminar</button>':'')+'<button class="btn sm pri" data-en="'+l.id+'">Entrar</button>'
          :(l.pode_gerir?'<button class="btn sm" data-al="'+l.id+'">Apagar</button><button class="btn sm pri" data-cl="'+l.id+'">Começar agora</button>':''))+'</div></div>'; }).join('')
      :'<div class="ga-vazio">'+(gere?'Nenhuma aula ao vivo marcada. Carregue em «Começar aula ao vivo» para dar uma agora.':'Não há aulas ao vivo agora. Quando o professor começar, aparece aqui.')+'</div>');
    if(gere && fim.length) h+='<p class="small muted" style="margin:6px 2px 0">Últimas: '+fim.map(function(l){ return esc(l.titulo)+' ('+esc(data(l.inicio))+')'; }).join(' · ')+'</p>';
    h+='<div class="ga-sec"><span>Aulas gravadas</span>'+(gere&&r.pares.length?'<button class="btn sm pri" data-nv>Carregar vídeo</button>':'')+'</div>';
    if(gere && !r.stream) h+='<div class="ga-err">As aulas gravadas ainda não estão ligadas no servidor (faltam as chaves do Bunny Stream).</div>';
    if(S.envio) h+=htmlEnvio();
    var V=r.videos;
    h+=V.length?'<div class="ga-grid">'+V.map(function(v,i){ var pronto=v.estado==='pronto';
      return '<div class="ga-v"><button class="ga-th" data-pv="'+i+'"'+(pronto?'':' disabled')+'>'+(v.miniatura?'<img src="'+esc(v.miniatura)+'" alt="" loading="lazy">':'')+(pronto?'<span class="pl"></span>':'')+(v.duracao?'<span class="du">'+duracao(v.duracao)+'</span>':'')+'</button>'+
        '<div class="bd"><b>'+esc(v.titulo)+'</b><small>'+esc(v.disciplina_nome+' · '+v.turma_nome)+'</small><small>'+esc(v.autor+' · '+data(v.data))+'</small>'+
        (pronto?'':v.estado==='erro'?'<span class="ga-pill bad">Erro na conversão</span>':'<span class="ga-pill">'+(v.estado==='enviando'?'A enviar ou envio interrompido':'A preparar'+(v.progresso?' · '+v.progresso+'%':'…'))+'</span>')+
        (v.descricao?'<small style="margin-top:6px;color:var(--ink)">'+esc(v.descricao)+'</small>':'')+'</div>'+
        (v.pode_apagar?'<div class="ac"><button class="btn sm" data-dv="'+i+'" style="color:#C0392B">Apagar</button></div>':'')+'</div>'; }).join('')+'</div>'
      :'<div class="ga-vazio">'+(gere?'Ainda não há vídeos. Carregue em «Carregar vídeo».':'Os professores ainda não carregaram aulas gravadas.')+'</div>';
    el.innerHTML=h; ligar();
  }
  function q(s){ return el.querySelector(s); }
  function qa(s){ return Array.prototype.slice.call(el.querySelectorAll(s)); }
  function ligar(){
    var r=S.d;
    qa('[data-pv]').forEach(function(b){ b.onclick=function(){ ver(r.videos[+b.getAttribute('data-pv')]); }; });
    qa('[data-dv]').forEach(function(b){ b.onclick=function(){ var v=r.videos[+b.getAttribute('data-dv')]; if(!confirm('Apagar a aula «'+v.titulo+'»? O vídeo é apagado de vez.')) return; b.disabled=true;
      api('/videos/apagar',{id:v.id}).then(function(x){ if(!x.ok){ b.disabled=false; aviso(x.erro); return; } aviso('Vídeo apagado'); carregar(); }); }; });
    var nv=q('[data-nv]'); if(nv) nv.onclick=function(){ formVideo(); };
    var nl=q('[data-nl]'); if(nl) nl.onclick=function(){ formLive(true); };
    var ag=q('[data-ag]'); if(ag) ag.onclick=function(){ formLive(false); };
    qa('[data-en]').forEach(function(b){ b.onclick=function(){ sala(b.getAttribute('data-en')); }; });
    qa('[data-cl]').forEach(function(b){ b.onclick=function(){ b.disabled=true; api('/aovivo/comecar',{id:b.getAttribute('data-cl')}).then(function(x){ b.disabled=false; if(!x.ok){ aviso(x.erro); return; } sala(b.getAttribute('data-cl')); }); }; });
    qa('[data-tl]').forEach(function(b){ b.onclick=function(){ if(!confirm('Terminar esta aula ao vivo para todos?')) return; b.disabled=true; api('/aovivo/terminar',{id:b.getAttribute('data-tl')}).then(function(x){ if(!x.ok){ b.disabled=false; aviso(x.erro); return; } aviso('Aula terminada'); carregar(); }); }; });
    qa('[data-al]').forEach(function(b){ b.onclick=function(){ if(!confirm('Apagar esta aula agendada?')) return; b.disabled=true; api('/aovivo/apagar',{id:b.getAttribute('data-al')}).then(function(x){ if(!x.ok){ b.disabled=false; aviso(x.erro); return; } carregar(); }); }; });
    var ce=q('[data-ce]'); if(ce) ce.onclick=function(){ if(S.envio && S.envio.up){ S.envio.up.abort(); } S.envio=null; carregar(); };
  }
  function opcoesPares(){ return S.d.pares.map(function(p,i){ return '<option value="'+i+'">'+esc(p.turma_nome+' — '+p.disciplina_nome)+'</option>'; }).join(''); }

  /* ---------- carregar vídeo ---------- */
  function formVideo(){
    var r=S.d;
    el.innerHTML='<div class="ga-top"><h3>Carregar aula gravada</h3></div><div class="ga-form">'+
      '<label class="ga-f">Turma e disciplina<select data-p>'+opcoesPares()+'</select></label>'+
      '<label class="ga-f">Título da aula<input data-t maxlength="120" placeholder="Ex.: Equações do 1.º grau — exercícios resolvidos"></label>'+
      '<label class="ga-f">Descrição <span class="small muted" style="font-weight:400">(opcional)</span><textarea data-d rows="2" maxlength="600"></textarea></label>'+
      '<label class="ga-f">Vídeo <span class="small muted" style="font-weight:400">(mp4, mov ou webm, até '+r.max_gb+' GB)</span><input type="file" data-f accept="video/*"></label>'+
      '<p class="small muted" style="margin:-4px 0 12px">O vídeo vai directamente para o servidor de vídeo. Se a rede cair, o envio continua quando voltar. Mantenha esta página aberta até terminar.</p>'+
      '<div class="ga-err" data-e></div><div class="ga-bts" style="justify-content:flex-end"><button class="btn" data-x>Cancelar</button><button class="btn pri" data-ok>Enviar vídeo</button></div></div>';
    q('[data-x]').onclick=function(){ desenhar(); };
    q('[data-ok]').onclick=function(){
      var b=this, f=q('[data-f]').files[0], p=S.d.pares[+q('[data-p]').value], t=q('[data-t]').value.trim(), e=q('[data-e]');
      e.textContent='';
      if(t.length<3){ e.textContent='Escreva o título da aula.'; return; }
      if(!f){ e.textContent='Escolha o ficheiro do vídeo.'; return; }
      if(f.size>r.max_gb*1073741824){ e.textContent='O vídeo tem mais de '+r.max_gb+' GB.'; return; }
      b.disabled=true; b.textContent='A preparar…';
      script(TUS_URL,function(falhou){
        if(falhou||!window.tus){ b.disabled=false; b.textContent='Enviar vídeo'; e.textContent='Não foi possível abrir o enviador de vídeo. Verifique a internet.'; return; }
        api('/videos/criar',{turma:p.turma, disciplina:p.disciplina, titulo:t, descricao:q('[data-d]').value, tamanho:f.size, tipo:f.type||'video/mp4'}).then(function(x){
          if(!x.ok){ b.disabled=false; b.textContent='Enviar vídeo'; e.textContent=x.erro; return; }
          enviar(f, x, t);
        });
      });
    };
  }
  function htmlEnvio(){ var s=S.envio, pct=s.total?Math.floor(s.feito/s.total*100):0;
    return '<div class="ga-form"><b>'+esc(s.titulo)+'</b><div class="ga-bar"><i style="width:'+pct+'%"></i></div><div class="small" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><span>'+
      esc(s.erro?s.erro:s.pausa?'Sem rede: o envio continua quando a internet voltar…':pct+'% · '+(s.feito/1048576).toFixed(1).replace('.',',')+' de '+(s.total/1048576).toFixed(1).replace('.',',')+' MB')+
      '</span><button class="btn sm" data-ce>'+(s.erro?'Fechar':'Cancelar')+'</button></div></div>'; }
  function enviar(f, x, titulo){
    S.envio={ titulo:titulo, total:f.size, feito:0, id:x.id };
    var up=new window.tus.Upload(f,{ endpoint:x.tus.endpoint, retryDelays:[0,3000,10000,30000,60000,120000], chunkSize:50*1048576,
      headers:{ AuthorizationSignature:x.tus.assinatura, AuthorizationExpire:String(x.tus.expira), VideoId:x.tus.video, LibraryId:String(x.tus.biblioteca) },
      metadata:{ filetype:f.type||'video/mp4', title:titulo },
      onProgress:function(a,t){ if(!S.envio) return; S.envio.feito=a; S.envio.total=t; S.envio.pausa=false; actualizarEnvio(); },
      onError:function(err){ if(!S.envio) return; S.envio.erro='O envio falhou: '+String(err&&err.message||err).slice(0,120); actualizarEnvio(); },
      onSuccess:function(){ api('/videos/enviado',{id:x.id}).then(function(){ S.envio=null; aviso('Vídeo enviado. O servidor está a prepará-lo; fica disponível dentro de alguns minutos.'); carregar(); }); } });
    S.envio.up=up;
    window.addEventListener('offline',function(){ if(S.envio){ S.envio.pausa=true; actualizarEnvio(); } });
    window.addEventListener('online',function(){ if(S.envio && S.envio.up && !S.envio.erro){ S.envio.up.start(); } });
    up.findPreviousUploads().then(function(prev){ if(prev.length) up.resumeFromPreviousUpload(prev[0]); up.start(); });
    window.scrollTo(0,0); desenhar();
  }
  function actualizarEnvio(){ if(!ligado()) return; var box=q('[data-ce]'); if(!box){ return; } var form=box.closest('.ga-form'); if(form) form.outerHTML=htmlEnvio(); var ce=q('[data-ce]'); if(ce) ce.onclick=function(){ if(S.envio&&S.envio.up&&!S.envio.erro) S.envio.up.abort(); S.envio=null; carregar(); }; }

  /* ---------- ver vídeo ---------- */
  function ver(v){
    api('/videos/ver',{id:v.id}).then(function(r){ if(!r.ok){ aviso(r.erro); return; }
      var o=document.createElement('div'); o.className='ga-ov'; o.innerHTML='<div class="ga-ov-h"><b>'+esc(r.titulo)+'</b><button class="ga-x">Fechar</button></div><div class="ga-play"><iframe src="'+esc(r.url)+'" allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture" allowfullscreen></iframe></div>';
      document.body.appendChild(o); o.querySelector('.ga-x').onclick=function(){ o.remove(); };
      o.addEventListener('click',function(e){ if(e.target===o) o.remove(); }); });
  }

  /* ---------- marcar ou começar aula ao vivo ---------- */
  function formLive(agora){
    var hoje=new Date(Date.now()+3600e3), ini=hoje.getFullYear()+'-'+dois(hoje.getMonth()+1)+'-'+dois(hoje.getDate())+'T'+dois(hoje.getHours())+':00';
    el.innerHTML='<div class="ga-top"><h3>'+(agora?'Começar aula ao vivo':'Agendar aula ao vivo')+'</h3></div><div class="ga-form">'+
      '<label class="ga-f">Turma e disciplina<select data-p>'+opcoesPares()+'</select></label>'+
      '<label class="ga-f">Tema da aula<input data-t maxlength="120" placeholder="Ex.: Revisão para o teste de Matemática"></label>'+
      (agora?'':'<label class="ga-f">Data e hora<input type="datetime-local" data-i value="'+ini+'"></label>')+
      '<p class="small muted" style="margin:-4px 0 12px">'+(agora?'A aula começa já. Os estudantes da turma vêem «AO VIVO» no portal e entram com um toque. Vai precisar da câmara e do microfone.':'A aula aparece no portal da turma com a data e a hora. No dia, carregue em «Começar agora».')+'</p>'+
      '<div class="ga-err" data-e></div><div class="ga-bts" style="justify-content:flex-end"><button class="btn" data-x>Cancelar</button><button class="btn pri" data-ok>'+(agora?'● Começar agora':'Agendar')+'</button></div></div>';
    q('[data-x]').onclick=function(){ desenhar(); };
    q('[data-ok]').onclick=function(){ var b=this, p=S.d.pares[+q('[data-p]').value], i=q('[data-i]');
      b.disabled=true; q('[data-e]').textContent='';
      api('/aovivo/criar',{turma:p.turma, disciplina:p.disciplina, titulo:q('[data-t]').value, agora:agora, inicio:i?new Date(i.value).toISOString():''}).then(function(x){
        b.disabled=false; if(!x.ok){ q('[data-e]').textContent=x.erro; return; }
        if(agora){ carregar(); sala(x.id); } else { aviso('Aula agendada'); carregar(); } });
    };
  }

  /* ---------- sala ao vivo ---------- */
  function sala(id){
    api('/aovivo/entrar',{id:id}).then(function(r){
      if(!r.ok){ aviso(r.erro); return; }
      var o=document.createElement('div'); o.className='gl';
      o.innerHTML='<div class="gl-h"><span class="ga-dot">AO VIVO</span><b>'+esc(r.titulo)+'</b><small data-n></small><button class="gl-b gl-sm" data-sair>Sair</button></div>'+
        '<div class="gl-m"><div class="gl-st"><div data-ban></div><div class="gl-main" data-main><div class="msg">'+(r.host?'A ligar a câmara…':'A ligar à aula…')+'</div></div><div class="gl-tiles" data-tiles></div></div>'+
        '<div class="gl-side"><div class="gl-tabs"><button class="on" data-tab="c">Chat</button><button data-tab="p">Na sala <span data-mn></span></button></div><div class="gl-list" data-l></div>'+
        (papel==='encarregado'?'':'<div class="gl-in"><input data-msg maxlength="400" placeholder="Escreva uma mensagem"><button class="gl-b gl-sm" data-env>Enviar</button></div>')+'</div></div>'+
        '<div class="gl-c" data-c></div>';
      document.body.appendChild(o);
      var E={ client:null, mic:null, cam:null, ecra:null, micOn:true, camOn:true, falar:[], falando:false, mao:false, poupar:false, soAudio:false, host_uid:null, seq:0, msgs:[], pessoas:[], maos:[], tab:'c', fim:false, poll:null, users:{} };
      function $o(s){ return o.querySelector(s); }
      function msgMain(t){ var m=$o('[data-main]'); if(!m.querySelector('video')) m.innerHTML='<div class="msg">'+esc(t)+'</div>'; }
      function controles(){
        var c=$o('[data-c]'), h='';
        if(r.host){ h+='<button class="gl-b '+(E.micOn?'on':'off')+'" data-mic>'+(E.micOn?'🎙 Microfone ligado':'🔇 Microfone desligado')+'</button>'+
          '<button class="gl-b '+(E.camOn?'on':'off')+'" data-cam>'+(E.camOn?'📷 Câmara ligada':'📷 Câmara desligada')+'</button>'+
          '<button class="gl-b'+(E.ecra?' sun':'')+'" data-ecra>'+(E.ecra?'Parar partilha':'🖥 Partilhar ecrã')+'</button><button class="gl-b red" data-fim>Terminar aula</button>'; }
        else { if(r.pode_mao) h+=E.falando?'<button class="gl-b '+(E.micOn?'on':'off')+'" data-mic>'+(E.micOn?'🎙 A falar':'🔇 Microfone desligado')+'</button>':'<button class="gl-b'+(E.mao?' sun':'')+'" data-mao>'+(E.mao?'✋ Mão levantada':'✋ Levantar a mão')+'</button>';
          h+='<button class="gl-b'+(E.poupar?' sun':'')+'" data-poupar>'+(E.poupar?'Poupar dados: ligado':'Poupar dados')+'</button><button class="gl-b'+(E.soAudio?' sun':'')+'" data-audio>'+(E.soAudio?'Só áudio: ligado':'Só áudio')+'</button>'; }
        c.innerHTML=h;
        var b;
        if((b=$o('[data-mic]'))) b.onclick=function(){ if(!E.mic) return; E.micOn=!E.micOn; E.mic.setEnabled(E.micOn); controles(); };
        if((b=$o('[data-cam]'))) b.onclick=function(){ if(!E.cam){ aviso('Sem câmara disponível.'); return; } E.camOn=!E.camOn; E.cam.setEnabled(E.camOn); if(!E.camOn && !E.ecra) msgMain('Câmara desligada: os alunos ouvem-no.'); else if(E.camOn && !E.ecra) E.cam.play($o('[data-main]'),{fit:'contain'}); controles(); };
        if((b=$o('[data-ecra]'))) b.onclick=partilhar;
        if((b=$o('[data-fim]'))) b.onclick=function(){ if(!confirm('Terminar a aula para todos?')) return; api('/aovivo/terminar',{id:id}).then(function(){ sair('Aula terminada.'); carregar(); }); };
        if((b=$o('[data-mao]'))) b.onclick=function(){ E.mao=!E.mao; api('/aovivo/sinal',{id:id, tipo:E.mao?'mao':'baixar'}); controles(); };
        if((b=$o('[data-poupar]'))) b.onclick=function(){ E.poupar=!E.poupar; if(E.client && E.host_uid) E.client.setRemoteVideoStreamType(E.host_uid, E.poupar?1:0).catch(function(){}); controles(); };
        if((b=$o('[data-audio]'))) b.onclick=function(){ E.soAudio=!E.soAudio; var u=E.users[E.host_uid]; if(E.client && u){ if(E.soAudio){ E.client.unsubscribe(u,'video').catch(function(){}); msgMain('Só áudio: está a ouvir o professor sem imagem (gasta muito menos dados).'); } else if(u.hasVideo) E.client.subscribe(u,'video').then(function(){ if(u.videoTrack) { $o('[data-main]').innerHTML=''; u.videoTrack.play($o('[data-main]'),{fit:'contain'}); } }).catch(function(){}); } controles(); };
      }
      function lado(){
        var l=$o('[data-l]'); if(!l) return;
        $o('[data-mn]').textContent='('+E.pessoas.length+')'+(r.host&&E.maos.length?' ✋'+E.maos.length:'');
        o.querySelectorAll('[data-tab]').forEach(function(b){ b.className=b.getAttribute('data-tab')===E.tab?'on':''; });
        if(E.tab==='c'){ var fundo=l.scrollHeight-l.scrollTop-l.clientHeight<60;
          l.innerHTML=E.msgs.length?E.msgs.map(function(m){ return '<div class="gl-msg'+(m.host?' h':'')+'"><b>'+esc(m.nome)+(m.host?' · Professor':'')+'</b>'+esc(m.texto)+'</div>'; }).join(''):'<p style="color:rgba(255,255,255,.55);font-size:13.5px">As mensagens da aula aparecem aqui.</p>';
          if(fundo) l.scrollTop=l.scrollHeight; }
        else { var P=E.pessoas.slice().sort(function(a,b){ return (b.host-a.host)||((E.maos.indexOf(b.uid)>=0)-(E.maos.indexOf(a.uid)>=0)); });
          l.innerHTML=P.map(function(p){ var mao=E.maos.indexOf(p.uid)>=0, fala=E.falar.indexOf(p.uid)>=0;
            return '<div class="gl-p"><span>'+(mao?'✋ ':'')+(fala?'🎙 ':'')+esc(p.nome)+(p.host?' · Professor':p.papel==='encarregado'?' · Encarregado':'')+'</span>'+
              (r.host&&!p.host&&p.papel==='estudante'?(fala?'<button class="gl-b gl-sm red" data-cala="'+p.uid+'">Tirar a palavra</button>':mao?'<button class="gl-b gl-sm on" data-fala="'+p.uid+'">Deixar falar</button>':''):'')+'</div>'; }).join('');
          l.querySelectorAll('[data-fala]').forEach(function(b){ b.onclick=function(){ b.disabled=true; api('/aovivo/permitir',{id:id, uid:+b.getAttribute('data-fala'), falar:true}).then(function(x){ if(!x.ok) aviso(x.erro); puxar(); }); }; });
          l.querySelectorAll('[data-cala]').forEach(function(b){ b.onclick=function(){ b.disabled=true; api('/aovivo/permitir',{id:id, uid:+b.getAttribute('data-cala'), falar:false}).then(function(){ puxar(); }); }; }); }
      }
      o.querySelectorAll('[data-tab]').forEach(function(b){ b.onclick=function(){ E.tab=b.getAttribute('data-tab'); lado(); }; });
      var inp=$o('[data-msg]');
      function enviarMsg(){ var t=inp.value.trim(); if(!t) return; inp.value=''; api('/aovivo/sinal',{id:id, tipo:'msg', texto:t}).then(function(x){ if(!x.ok) aviso(x.erro); puxar(); }); }
      if(inp){ inp.onkeydown=function(e){ if(e.key==='Enter') enviarMsg(); }; $o('[data-env]').onclick=enviarMsg; }
      $o('[data-sair]').onclick=function(){ if(r.host && !confirm('Sair da sala? A aula continua para os alunos até carregar em «Terminar aula».')) return; sair(); };
      function puxar(){
        api('/aovivo/eventos',{id:id, depois:E.seq}).then(function(x){
          if(!x.ok || E.fim) return;
          if(x.terminada && !r.host){ sair('O professor terminou a aula.'); return; }
          x.msgs.forEach(function(m){ E.msgs.push(m); }); if(x.msgs.length) E.seq=x.msgs[x.msgs.length-1].n;
          E.pessoas=x.pessoas; E.maos=x.maos; E.falar=x.falar; if(x.host_uid) E.host_uid=x.host_uid;
          $o('[data-n]').textContent=E.pessoas.length+' na sala';
          if(!r.host){ E.mao=x.maos.indexOf(r.uid)>=0;
            if(x.eu_falo && !E.falando) comecarAFalar(); else if(!x.eu_falo && E.falando) pararDeFalar(); else controles(); }
          lado();
        });
      }
      function sair(motivo){
        E.fim=true; clearInterval(E.poll);
        [E.mic,E.cam,E.ecra].forEach(function(t){ if(t){ try{ t.stop(); t.close(); }catch(e){} } });
        if(E.client) E.client.leave().catch(function(){});
        if(!r.host && E.mao) api('/aovivo/sinal',{id:id, tipo:'baixar'});
        o.remove(); if(motivo) aviso(motivo);
      }
      async function comecarAFalar(){
        try{
          var t=await api('/aovivo/token-falar',{id:id}); if(!t.ok){ aviso(t.erro); return; }
          await E.client.renewToken(t.token); await E.client.setClientRole('host');
          E.mic=await window.AgoraRTC.createMicrophoneAudioTrack(); await E.client.publish([E.mic]);
          E.falando=true; E.micOn=true; $o('[data-ban]').innerHTML='<div class="gl-ban">🎙 O professor deu-lhe a palavra. Já está a falar para a turma.</div>'; controles();
        }catch(e){ aviso('Não foi possível ligar o microfone: '+(e&&e.message||e)); }
      }
      async function pararDeFalar(){
        try{ if(E.mic){ await E.client.unpublish([E.mic]); E.mic.close(); E.mic=null; } await E.client.setClientRole('audience',{level:1}); }catch(e){}
        E.falando=false; $o('[data-ban]').innerHTML=''; controles();
      }
      async function partilhar(){
        if(E.ecra){ await E.client.unpublish([E.ecra]).catch(function(){}); E.ecra.close(); E.ecra=null; if(E.cam){ await E.client.publish([E.cam]).catch(function(){}); $o('[data-main]').innerHTML=''; E.cam.play($o('[data-main]'),{fit:'contain'}); } else msgMain('Câmara desligada.'); controles(); return; }
        try{
          var s=await window.AgoraRTC.createScreenVideoTrack({encoderConfig:'1080p_1', optimizationMode:'detail'},'disable');
          if(E.cam) await E.client.unpublish([E.cam]).catch(function(){});
          E.ecra=s; await E.client.publish([s]); $o('[data-main]').innerHTML=''; s.play($o('[data-main]'),{fit:'contain'});
          s.on('track-ended',function(){ if(E.ecra) partilhar(); }); controles();
        }catch(e){ aviso('A partilha do ecrã foi cancelada ou não é suportada neste aparelho.'); }
      }
      controles(); lado();
      script(AGORA_URL, async function(falhou){
        if(falhou || !window.AgoraRTC){ msgMain('Não foi possível abrir a aula ao vivo. Verifique a internet e tente de novo.'); return; }
        try{
          window.AgoraRTC.setLogLevel(3);
          var c=E.client=window.AgoraRTC.createClient({mode:'live', codec:'vp8'});
          c.on('user-published', async function(user, tipo){
            E.users[user.uid]=user;
            if(tipo==='video' && E.soAudio && user.uid===E.host_uid) return;
            await c.subscribe(user, tipo);
            if(tipo==='audio') user.audioTrack.play();
            if(tipo==='video'){
              if(E.host_uid==null || user.uid===E.host_uid){ var m=$o('[data-main]'); m.innerHTML=''; user.videoTrack.play(m,{fit:'contain'}); if(E.poupar) c.setRemoteVideoStreamType(user.uid,1).catch(function(){}); }
              else { var t=document.createElement('div'); t.className='gl-tile'; t.id='glt-'+user.uid; $o('[data-tiles]').appendChild(t); user.videoTrack.play(t); }
            }
          });
          c.on('user-unpublished', function(user, tipo){ if(tipo==='video'){ var t=document.getElementById('glt-'+user.uid); if(t) t.remove(); if(user.uid===E.host_uid) msgMain('O professor desligou a câmara. Continua a ouvi-lo.'); } });
          c.on('user-left', function(user){ if(user.uid===E.host_uid && !r.host) msgMain('O professor saiu da sala por um momento…'); });
          c.on('token-privilege-will-expire', function(){ api('/aovivo/entrar',{id:id}).then(function(x){ if(x.ok) c.renewToken(x.token); }); });
          if(r.host){
            await c.setClientRole('host'); await c.join(r.app, r.canal, r.token, r.uid);
            c.enableDualStream().catch(function(){});
            try{ E.mic=await window.AgoraRTC.createMicrophoneAudioTrack(); }catch(e){ aviso('Sem acesso ao microfone. Autorize o microfone no navegador.'); }
            try{ E.cam=await window.AgoraRTC.createCameraVideoTrack({encoderConfig:'480p_1'}); }catch(e){ E.camOn=false; aviso('Sem acesso à câmara: a aula segue só com voz (ou partilhe o ecrã).'); }
            var pub=[E.mic,E.cam].filter(Boolean); if(pub.length) await c.publish(pub);
            if(E.cam){ var m=$o('[data-main]'); m.innerHTML=''; E.cam.play(m,{fit:'contain'}); } else msgMain('Câmara desligada: os alunos ouvem-no.');
            controles();
          } else {
            await c.setClientRole('audience',{level:1}); await c.join(r.app, r.canal, r.token, r.uid);
            msgMain('Ligado. À espera da imagem do professor…');
          }
        }catch(e){ msgMain('Não foi possível ligar à aula: '+(e&&e.message||e)); }
      });
      puxar(); E.poll=setInterval(function(){ if(!document.body.contains(o)){ clearInterval(E.poll); return; } puxar(); }, 2500);
    });
  }

  carregar();
  return { parar:function(){ S.vivo=false; if(S.timer) clearInterval(S.timer); } };
}
window.GSAulas={ montar:montar };
})();
