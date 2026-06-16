/* ============================================================
     Sistema de Chamadas — Burle Marx & Perimetral
     Versão: Supabase + GitHub Pages
     PDF via window.print(). Dados no Supabase.
     ============================================================ */
  'use strict';

  (() => {
    /* ---- Supabase REST API ---- */
    const SUPA = (() => {
      function cfg() {
        const c = window.SUPABASE_CONFIG;
        if (!c?.url || !c?.anonKey || c.anonKey === 'COLE_SUA_CHAVE_ANONIMA_AQUI') {
          throw new Error('Configure window.SUPABASE_CONFIG em config.js com url e anonKey.');
        }
        return c;
      }
      async function req(path, options) {
        options = options || {};
        const { url, anonKey } = cfg();
        const res = await fetch(url + '/rest/v1/' + path, Object.assign({}, options, {
          headers: Object.assign({ 'apikey': anonKey, 'Authorization': 'Bearer ' + anonKey, 'Content-Type': 'application/json' }, options.headers || {}),
        }));
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'HTTP ' + res.status);
        }
        const text = await res.text();
        return text ? JSON.parse(text) : [];
      }
      return {
        fetchAll:  ()        => req('chamadas?select=*&order=data.asc,escola.asc'),
        upsert:    (body)    => req('chamadas?on_conflict=escola,data,turno', { method: 'POST', headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body) }),
        deleteRow: (e, d, t) => req('chamadas?escola=eq.' + e + '&data=eq.' + d + '&turno=eq.' + t, { method: 'DELETE' }),
        deleteAll: ()        => req('chamadas?id=not.is.null', { method: 'DELETE' }),
      };
    })();

    /* ---- Constants ---- */
    const SCHOOLS = {
      burle:      { name: 'Burle Marx', dayLabel: 'Terça',  weekday: 2, color: '#FC1B0F' },
      perimetral: { name: 'Perimetral', dayLabel: 'Quinta', weekday: 4, color: '#2897FC' },
    };
    const ROOMS       = 'ABCDEFGHIJKLMNOPQR'.split('');
    const ROOMS_MANHA = ROOMS.slice(0, 9);
    const ROOMS_TARDE = ROOMS.slice(9);
    const KEY_SEP     = '|';
    const ST_YEAR     = 'chamadas.schoolYear';
    const ST_YS       = 'chamadas.yearStart';

    /* ---- State ---- */
    let attendanceData = {};
    let currentDate    = new Date();
    let currentYear    = new Date().getFullYear();
    let lastReport     = { rows: [], totals: null, filters: null };

    /* ---- Utils ---- */
    const $  = (s, c) => (c || document).querySelector(s);
    const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));
    const pad      = (n) => String(n).padStart(2, '0');
    const fISO     = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const fBR      = (d) => d.toLocaleDateString('pt-BR');
    const pISO     = (s) => { if (!s) return null; const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); };
    const getMonthName = (m, y) => new Date(y,m,1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const isSameDay    = (a, b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
    const startOfDay   = (d) => { const x=new Date(d); x.setHours(0,0,0,0); return x; };
    const isPast       = (d) => startOfDay(d) < startOfDay(new Date());
    const buildKey     = (sc, dt) => sc + KEY_SEP + dt;
    const parseKey     = (k) => { const i=k.indexOf(KEY_SEP); return i===-1 ? {school:k,dateStr:''} : {school:k.slice(0,i),dateStr:k.slice(i+1)}; };
    const getSchoolDay = (date) => { const wd=date.getDay(); for (const [k,v] of Object.entries(SCHOOLS)) { if (v.weekday===wd) return Object.assign({school:k},v); } return null; };

    /* ---- Supabase rows -> memory ---- */
    function rowsToMemory(rows) {
      const data = {};
      for (const row of rows) {
        const key = buildKey(row.escola, row.data);
        if (!data[key]) data[key] = {};
        for (const [room, count] of Object.entries(row.salas || {})) {
          if (count > 0) data[key][room] = { present: true, count };
        }
      }
      return data;
    }

    /* ---- Loading overlay ---- */
    const setLoading = (on) => { const el = $('#loadingOverlay'); if (el) el.hidden = !on; };

    /* ---- Toast ---- */
    function showToast(msg, type) {
      type = type || 'info';
      const c = $('#toastContainer'); if (!c) return;
      const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
      c.appendChild(t);
      setTimeout(() => { t.classList.add('fade-out'); t.addEventListener('animationend', () => t.remove(), { once: true }); }, 3200);
    }

    /* ---- Confirm dialog ---- */
    function confirmDialog(message) {
      return new Promise((resolve) => {
        const modal = $('#confirmModal');
        $('#confirmMessage').textContent = message; modal.hidden = false;
        const yes=$('#confirmYes'), no=$('#confirmNo'), cls=$('#closeConfirmModal');
        const cleanup = (r) => { modal.hidden=true; yes.removeEventListener('click',onY); no.removeEventListener('click',onN); cls.removeEventListener('click',onN); modal.removeEventListener('click',onBd); document.removeEventListener('keydown',onKey); resolve(r); };
        const onY=()=>cleanup(true), onN=()=>cleanup(false);
        const onBd=(e)=>{ if(e.target===modal) cleanup(false); };
        const onKey=(e)=>{ if(e.key==='Escape') cleanup(false); };
        yes.addEventListener('click',onY); no.addEventListener('click',onN); cls.addEventListener('click',onN); modal.addEventListener('click',onBd); document.addEventListener('keydown',onKey); yes.focus();
      });
    }

    /* ---- Counter ---- */
    function updateCounter() {
      const el = $('#savedCounter'); if (!el) return;
      let total = 0;
      for (const day of Object.values(attendanceData)) total += Object.values(day).filter(r => r.present).length;
      el.textContent = total;
    }

    /* ---- Sync badge ---- */
    function setSyncBadge(state) {
      const dot=$('#syncDot'), lbl=$('#syncLabel'); if (!dot||!lbl) return;
      if (state==='ok')     { dot.className='sync-dot'; lbl.textContent='Sincronizado'; }
      if (state==='saving') { dot.className='sync-dot'; lbl.textContent='Salvando...'; }
      if (state==='error')  { dot.className='sync-dot offline'; lbl.textContent='Erro de conexao'; }
    }

    /* ---- Tab switching ---- */
    function switchTab(name) {
      $$('.tab').forEach((t) => { const a=t.dataset.tab===name; t.classList.toggle('active',a); t.setAttribute('aria-selected',a?'true':'false'); });
      $$('[role="tabpanel"]').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
      if (name==='attendance') renderClassroomGrid();
      if (name==='reports')    generateReport();
      if (name==='settings')   renderSettingsGrid();
      updateCounter();
    }

    /* ---- Calendar ---- */
    function renderCalendar() {
      const grid=$('#calendarGrid'), year=currentDate.getFullYear(), month=currentDate.getMonth();
      $('#monthTitle').textContent = getMonthName(month, year);
      const headers=$$('.cal-day-header', grid);
      grid.innerHTML = ''; headers.forEach((h) => grid.appendChild(h));
      const firstDay=new Date(year,month,1), lastDay=new Date(year,month+1,0);
      const today=startOfDay(new Date()), yearStart=pISO($('#yearStart').value) || new Date(year,0,1);
      for (let i=0; i<firstDay.getDay(); i++) { const div=document.createElement('div'); div.className='cal-day empty'; grid.appendChild(div); }
      for (let d=1; d<=lastDay.getDate(); d++) {
        const date=new Date(year,month,d), div=document.createElement('div');
        div.className='cal-day'; div.dataset.date=fISO(date);
        const info=getSchoolDay(date), key=info ? buildKey(info.school,fISO(date)) : null;
        const hasData=key && !!attendanceData[key] && Object.values(attendanceData[key]).some(r=>r.present);
        if (isSameDay(date,today)) div.classList.add('today');
        if (isPast(date) && !isSameDay(date,today)) div.classList.add('past');
        if (info) { div.classList.add(info.school+'-day'); div.title=info.name+' - '+info.dayLabel; }
        if (hasData) div.classList.add('has-data');
        div.innerHTML = '<span class="cal-day-number">'+d+'</span><div class="cal-day-indicator">'+(info?'<span class="indicator-dot '+info.school+'"></span>':'')+'</div>';
        if (info && date>=yearStart) {
          div.classList.add('clickable');
          div.addEventListener('click', (function(d2,info2){ return function(){ switchTab('attendance'); $('#attSchool').value=info2.school; $('#attDate').value=fISO(d2); renderClassroomGrid(); }; })(date, info));
        }
        grid.appendChild(div);
      }
    }

    /* ---- Classroom grid ---- */
    function renderClassroomGrid() {
      const grid=$('#classroomGrid'), summary=$('#attendanceSummary');
      const school=$('#attSchool').value, dateStr=$('#attDate').value, period=$('#attPeriod').value;
      if (!dateStr) { grid.innerHTML='<p class="muted" style="grid-column:1/-1;text-align:center;padding:20px;">Selecione uma data.</p>'; summary.textContent=''; return; }
      const date=pISO(dateStr), rooms=period==='manha'?ROOMS_MANHA:ROOMS_TARDE;
      const saved=attendanceData[buildKey(school,dateStr)]||{};
      const filled=rooms.reduce((a,r)=>a+(saved[r]&&saved[r].present?1:0),0);
      const children=rooms.reduce((a,r)=>a+(saved[r]&&saved[r].present?(saved[r].count||0):0),0);
      let warn='';
      if (date.getDay() !== SCHOOLS[school].weekday) warn='<strong style="color:var(--warning);">Atencao:</strong> esta data nao cai em '+SCHOOLS[school].dayLabel+'-feira. ';
      summary.innerHTML=warn+'<strong>'+SCHOOLS[school].name+'</strong> - '+fBR(date)+' - turno da '+(period==='manha'?'manha':'tarde')+' - <strong>'+filled+'</strong>/<strong>'+rooms.length+'</strong> salas com aula'+(children?' - <strong>'+children+'</strong> criancas':'')+'.<br><em style="font-size:0.82rem;color:var(--text-muted)">Clique em "Salvar Chamada" para gravar no Supabase.</em>';
      grid.innerHTML='';
      rooms.forEach(function(room) {
        const data=saved[room]||{present:false,count:0};
        const card=document.createElement('div'); card.className='classroom-card'+(data.present?' filled':''); card.dataset.room=room;
        card.innerHTML='<div class="classroom-header"><span class="classroom-label">Sala '+room+'</span><span class="classroom-period period-'+period+'">'+(period==='manha'?'Manha':'Tarde')+'</span></div><div class="classroom-inputs"><div class="checkbox-group"><input type="checkbox" id="pres-'+room+'"'+(data.present?' checked':'')+' data-room="'+room+'"><label for="pres-'+room+'" style="font-weight:500;cursor:pointer;">Teve aula</label></div><div class="input-row" id="countRow-'+room+'"'+(data.present?'':' hidden')+'><input type="number" id="count-'+room+'" value="'+(data.count||'')+'" min="0" max="100" placeholder="Qtd. criancas" data-room="'+room+'"></div></div>';
        grid.appendChild(card);
        const chk=card.querySelector('#pres-'+room), cnt=card.querySelector('#count-'+room), row=card.querySelector('#countRow-'+room);
        chk.addEventListener('change', function(e){ const show=e.target.checked; row.hidden=!show; card.classList.toggle('filled',show); if(show){cnt.focus();cnt.select();}else cnt.value=''; });
      });
    }

    /* ---- Save to Supabase ---- */
    async function saveAttendance() {
      const btn=$('#saveAttendance'); btn.disabled=true;
      const school=$('#attSchool').value, dateStr=$('#attDate').value, period=$('#attPeriod').value;
      if (!dateStr) { showToast('Selecione uma data antes de salvar.','error'); btn.disabled=false; return; }
      const rooms=period==='manha'?ROOMS_MANHA:ROOMS_TARDE;
      const salas={};
      let hasAny=false;
      rooms.forEach(function(room){
        const pEl=$('#pres-'+room), cEl=$('#count-'+room); if (!pEl) return;
        if (pEl.checked) { const count=Math.max(0,Math.min(100,parseInt(cEl.value,10)||0)); salas[room]=count; hasAny=true; }
      });
      const key=buildKey(school,dateStr);
      try {
        setSyncBadge('saving');
        if (hasAny) {
          const total=Object.values(salas).reduce(function(a,b){return a+b;},0);
          await SUPA.upsert({escola:school,data:dateStr,turno:period,salas:salas,total_criancas:total});
          if (!attendanceData[key]) attendanceData[key]={};
          for (const room of rooms) {
            if (salas[room]!==undefined) attendanceData[key][room]={present:true,count:salas[room]};
            else delete attendanceData[key][room];
          }
          if (Object.keys(attendanceData[key]).length===0) delete attendanceData[key];
        } else {
          await SUPA.deleteRow(school,dateStr,period);
          if (attendanceData[key]) { rooms.forEach(function(r){delete attendanceData[key][r];}); if (Object.keys(attendanceData[key]).length===0) delete attendanceData[key]; }
        }
        setSyncBadge('ok'); updateCounter(); renderCalendar(); renderClassroomGrid();
        showToast('Chamada salva com sucesso!','success');
      } catch(e) { setSyncBadge('error'); showToast('Erro ao salvar: '+e.message,'error'); }
      finally { btn.disabled=false; }
    }

    /* ---- Clear turno ---- */
    async function clearCurrentAttendance() {
      const dateStr=$('#attDate').value, school=$('#attSchool').value, period=$('#attPeriod').value;
      if (!dateStr) return;
      const ok=await confirmDialog('Limpar o turno da '+(period==='manha'?'manha':'tarde')+' da '+SCHOOLS[school].name+' em '+fBR(pISO(dateStr))+'?');
      if (!ok) return;
      try {
        setSyncBadge('saving'); await SUPA.deleteRow(school,dateStr,period);
        const key=buildKey(school,dateStr), rooms=period==='manha'?ROOMS_MANHA:ROOMS_TARDE;
        if (attendanceData[key]) { rooms.forEach(function(r){delete attendanceData[key][r];}); if (Object.keys(attendanceData[key]).length===0) delete attendanceData[key]; }
        setSyncBadge('ok'); updateCounter(); renderCalendar(); renderClassroomGrid();
        showToast('Turno limpo.','success');
      } catch(e) { setSyncBadge('error'); showToast('Erro: '+e.message,'error'); }
    }

    /* ---- Report data ---- */
    function computeFilterRange() {
      const pf=$('#repPeriod').value, now=new Date();
      if (pf==='month') return { start:new Date(now.getFullYear(),now.getMonth(),1), end:new Date(now.getFullYear(),now.getMonth()+1,0) };
      if (pf==='year')  return { start:new Date(now.getFullYear(),0,1), end:new Date(now.getFullYear(),11,31) };
      let s=pISO($('#repStartDate').value), e=pISO($('#repEndDate').value);
      if (!s) { s=new Date(now.getFullYear(),now.getMonth(),1); $('#repStartDate').value=fISO(s); }
      if (!e) { e=new Date(now.getFullYear(),now.getMonth()+1,0); $('#repEndDate').value=fISO(e); }
      if (s>e) { const tmp=s; s=e; e=tmp; }
      return { start:s, end:e };
    }

    function collectRows() {
      const sf=$('#repSchool').value, rf=($('#repRoom')?$('#repRoom').value:'').trim().toUpperCase();
      const range=computeFilterRange(), start=range.start, end=range.end;
      const rows=[], totals={burle:{days:new Set(),children:0,classes:0},perimetral:{days:new Set(),children:0,classes:0}};
      if (!start||!end) return {rows,totals,valid:false,start,end};
      const sISO=fISO(start), eISO=fISO(end);
      for (const key of Object.keys(attendanceData)) {
        const pk=parseKey(key), school=pk.school, dateStr=pk.dateStr;
        if (!SCHOOLS[school]) continue;
        if (sf!=='both' && school!==sf) continue;
        if (dateStr<sISO || dateStr>eISO) continue;
        let dayHas=false;
        for (const room of Object.keys(attendanceData[key])) {
          const info=attendanceData[key][room];
          if (!info.present) continue;
          if (rf && room!==rf) continue;
          rows.push({date:dateStr,school,room,count:info.count||0});
          totals[school].children+=info.count||0; totals[school].classes++; dayHas=true;
        }
        if (dayHas) totals[school].days.add(dateStr);
      }
      return {rows,totals,valid:true,start,end};
    }

    function generateReport() {
      const res=collectRows();
      if (!res.valid) showToast('Defina o periodo personalizado.','error');
      const clean={burle:{days:res.totals.burle.days.size,children:res.totals.burle.children,classes:res.totals.burle.classes},perimetral:{days:res.totals.perimetral.days.size,children:res.totals.perimetral.children,classes:res.totals.perimetral.classes}};
      const sf=$('#repSchool').value, pl=$('#repPeriod').options[$('#repPeriod').selectedIndex].text, rf=($('#repRoom')?$('#repRoom').value:'').trim().toUpperCase();
      lastReport={rows:res.rows,totals:clean,filters:{sf,pl,rf,start:res.start,end:res.end}};
      renderSummaryCards(clean,sf); renderReportTable(res.rows);
    }

    function renderSummaryCards(totals,filter) {
      let html='';
      if (filter==='both'||filter==='burle') { html+='<div class="summary-card"><div class="summary-label">Burle Marx - Dias</div><div class="summary-value">'+totals.burle.days+'</div></div><div class="summary-card"><div class="summary-label">Burle Marx - Criancas</div><div class="summary-value">'+totals.burle.children+'</div></div>'; }
      if (filter==='both'||filter==='perimetral') { html+='<div class="summary-card perimetral"><div class="summary-label">Perimetral - Dias</div><div class="summary-value">'+totals.perimetral.days+'</div></div><div class="summary-card perimetral"><div class="summary-label">Perimetral - Criancas</div><div class="summary-value">'+totals.perimetral.children+'</div></div>'; }
      if (filter==='both') { html+='<div class="summary-card total"><div class="summary-label">TOTAL - Dias</div><div class="summary-value">'+(totals.burle.days+totals.perimetral.days)+'</div></div><div class="summary-card total"><div class="summary-label">TOTAL - Criancas</div><div class="summary-value">'+(totals.burle.children+totals.perimetral.children)+'</div></div>'; }
      $('#summaryCards').innerHTML=html;
    }

    function renderReportTable(rows) {
      const tbody=$('#reportBody'), empty=$('#emptyReport');
      if (rows.length===0) { tbody.innerHTML=''; empty.hidden=false; return; }
      empty.hidden=true;
      rows.sort(function(a,b){ return a.date.localeCompare(b.date)||a.school.localeCompare(b.school)||a.room.localeCompare(b.room); });
      tbody.innerHTML=rows.map(function(r){
        const morning=ROOMS_MANHA.includes(r.room);
        return '<tr><td>'+fBR(pISO(r.date))+'</td><td><span class="school-badge '+(r.school==='burle'?'badge-burle':'badge-perimetral')+'">'+SCHOOLS[r.school].name+'</span></td><td><span class="classroom-period '+(morning?'period-manha':'period-tarde')+'">'+(morning?'Manha':'Tarde')+'</span></td><td><strong>Sala '+r.room+'</strong></td><td><span style="color:var(--blue);font-weight:700;">Presente</span></td><td class="text-right font-mono">'+r.count+'</td></tr>';
      }).join('');
    }

    /* ---- PDF via window.print ---- */
    function generatePDF() {
      generateReport();
      const {rows,totals,filters}=lastReport;
      if (!rows||rows.length===0) { showToast('Nenhum registro para gerar PDF.','error'); return; }
      const sf=filters.sf, pl=filters.pl, rf=filters.rf, start=filters.start, end=filters.end;
      const schoolLabel=sf==='both'?'Ambas as escolas':sf==='burle'?'Burle Marx':'Perimetral';
      const salaLabel=rf?'Sala '+rf:'Todas as salas';
      const periodoStr=fBR(start)+' a '+fBR(end);
      const now=new Date(), geradoEm=fBR(now)+' '+now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      const totalDias=totals.burle.days+totals.perimetral.days;
      const totalCriancas=totals.burle.children+totals.perimetral.children;
      const totalAulas=totals.burle.classes+totals.perimetral.classes;
      const media=totalAulas?(totalCriancas/totalAulas).toFixed(1):'0';
      const sorted=[].concat(rows).sort(function(a,b){return a.date.localeCompare(b.date)||a.school.localeCompare(b.school)||a.room.localeCompare(b.room);});
      const rowsHtml=sorted.map(function(r,i){
        const morning=ROOMS_MANHA.includes(r.room), isBurle=r.school==='burle';
        return '<tr style="background:'+(i%2===0?'#fff':'#f0f4fc')+'"><td style="padding:7px 12px;border-bottom:1px solid #dde6f4">'+fBR(pISO(r.date))+'</td><td style="padding:7px 12px;border-bottom:1px solid #dde6f4;font-weight:700;color:'+(isBurle?'#C41507':'#1A6BC0')+'">'+SCHOOLS[r.school].name+'</td><td style="padding:7px 12px;border-bottom:1px solid #dde6f4">'+(morning?'Manha':'Tarde')+'</td><td style="padding:7px 12px;border-bottom:1px solid #dde6f4">Sala '+r.room+'</td><td style="padding:7px 12px;border-bottom:1px solid #dde6f4;color:#0A5A3A;font-weight:600">Presente</td><td style="padding:7px 12px;border-bottom:1px solid #dde6f4;text-align:right;font-weight:700;color:#05447D">'+r.count+'</td></tr>';
      }).join('');
      const cards=[];
      if (sf==='both'||sf==='burle') { cards.push({label:'Burle Marx - Dias',value:totals.burle.days,color:'#FC1B0F'}); cards.push({label:'Burle Marx - Criancas',value:totals.burle.children,color:'#FC1B0F'}); }
      if (sf==='both'||sf==='perimetral') { cards.push({label:'Perimetral - Dias',value:totals.perimetral.days,color:'#2897FC'}); cards.push({label:'Perimetral - Criancas',value:totals.perimetral.children,color:'#2897FC'}); }
      if (sf==='both') { cards.push({label:'TOTAL - Dias',value:totalDias,color:'#C8D400'}); cards.push({label:'TOTAL - Criancas',value:totalCriancas,color:'#C8D400'}); }
      const cardsHtml=cards.map(function(c){ return '<div style="flex:1;min-width:140px;background:#fff;border-radius:10px;padding:14px 18px;border-left:4px solid '+c.color+';box-shadow:0 2px 8px rgba(5,68,125,0.10)"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#5A7090;margin-bottom:6px">'+c.label+'</div><div style="font-size:26px;font-weight:800;color:#05447D">'+c.value+'</div></div>'; }).join('');
      const html='<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><title>Relatorio de Chamadas</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap"/><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Inter,sans-serif;color:#081828;background:#fff;padding:32px}@media print{body{padding:16px}button{display:none}}</style></head><body>'+
        '<div style="background:linear-gradient(135deg,#05447D,#0A6ED1);color:#fff;padding:24px 32px;border-radius:12px;margin-bottom:24px">'+
          '<div style="font-size:22px;font-weight:800;letter-spacing:-0.5px">Relatorio de Chamadas Escolares</div>'+
          '<div style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:4px">Burle Marx &amp; Perimetral - Gerado em '+geradoEm+'</div>'+
          '<div style="display:flex;flex-wrap:wrap;gap:20px;margin-top:14px;font-size:12px;color:rgba(255,255,255,0.85)">'+
            '<span>Escola: <strong>'+schoolLabel+'</strong></span>'+
            '<span>Periodo: <strong>'+pl+' ('+periodoStr+')</strong></span>'+
            '<span>Sala: <strong>'+salaLabel+'</strong></span>'+
          '</div>'+
        '</div>'+
        '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:24px">'+cardsHtml+'</div>'+
        '<div style="margin-bottom:20px;text-align:right"><button onclick="window.print()" style="background:#05447D;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Imprimir / Salvar PDF</button></div>'+
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#5A7090;margin-bottom:8px">Detalhamento - '+rows.length+' registro'+(rows.length===1?'':'s')+'</div>'+
        '<table style="width:100%;border-collapse:collapse;font-size:13px">'+
          '<thead><tr style="background:#05447D;color:#fff">'+
            '<th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Data</th>'+
            '<th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Escola</th>'+
            '<th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Turno</th>'+
            '<th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Sala</th>'+
            '<th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Presenca</th>'+
            '<th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Criancas</th>'+
          '</tr></thead>'+
          '<tbody>'+rowsHtml+'</tbody>'+
        '</table>'+
        '<div style="margin-top:20px;background:linear-gradient(135deg,#032D52,#05447D);color:#fff;border-radius:10px;padding:16px 20px;font-size:13px">'+
          '<strong>'+totalDias+'</strong> dias com chamada &nbsp;&middot;&nbsp; <strong>'+totalAulas+'</strong> aulas &nbsp;&middot;&nbsp; <strong>'+totalCriancas+'</strong> criancas &nbsp;&middot;&nbsp; Media <strong>'+media+'</strong> por aula'+
        '</div>'+
        '<div style="margin-top:14px;font-size:11px;color:#5A7090;text-align:right">Sistema de Chamadas - Burle Marx &amp; Perimetral</div>'+
        '</body></html>';
      const blob=new Blob([html],{type:'text/html;charset=utf-8'});
      const url=URL.createObjectURL(blob);
      const win=window.open(url,'_blank');
      if (!win) { showToast('Permita pop-ups para gerar o PDF.','error'); }
    }

    /* ---- CSV ---- */
    function csvEscape(v){ const s=String(v||""); return /[",;\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }
    function exportCSV() {
      const {rows}=collectRows(); if (rows.length===0) { showToast('Nenhum dado para exportar.','error'); return; }
      rows.sort(function(a,b){return a.date.localeCompare(b.date)||a.school.localeCompare(b.school)||a.room.localeCompare(b.room);});
      let csv='Data,Escola,Turno,Sala,Presenca,Criancas\n';
      for (const r of rows) { const p=ROOMS_MANHA.includes(r.room)?'Manha':'Tarde'; csv+=[csvEscape(fBR(pISO(r.date))),csvEscape(SCHOOLS[r.school].name),csvEscape(p),csvEscape('Sala '+r.room),'Sim',r.count].join(',')+'\n'; }
      const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'});
      const url=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=url; a.download='relatorio-chamadas-'+fISO(new Date())+'.csv'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){URL.revokeObjectURL(url);},1000);
      showToast(rows.length+' registros exportados.','success');
    }

    function exportAllData() {
      const data={attendance:attendanceData,year:currentYear,yearStart:$('#yearStart').value,exportedAt:new Date().toISOString(),version:2};
      const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=url; a.download='backup-chamadas-'+fISO(new Date())+'.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){URL.revokeObjectURL(url);},1000);
      showToast('Backup exportado.','success');
    }

    async function importData(jsonStr) {
      try {
        const data=JSON.parse(jsonStr);
        if (!data||typeof data!=='object') throw new Error('Estrutura invalida.');
        if (data.attendance && typeof data.attendance==='object') {
          setLoading(true);
          const upsertRows=[];
          for (const k of Object.keys(data.attendance)) {
            const sep=k.indexOf('|'), school=sep===-1?k.slice(0,k.indexOf('-')):k.slice(0,sep), dateStr=sep===-1?k.slice(k.indexOf('-')+1):k.slice(sep+1);
            if (!SCHOOLS[school]) continue;
            const dayData=data.attendance[k], manha={}, tarde={};
            for (const room of Object.keys(dayData)) { const info=dayData[room]; if (!info.present) continue; if (ROOMS_MANHA.includes(room)) manha[room]=info.count||0; else tarde[room]=info.count||0; }
            if (Object.keys(manha).length>0) upsertRows.push({escola:school,data:dateStr,turno:'manha',salas:manha,total_criancas:Object.values(manha).reduce(function(a,b){return a+b;},0)});
            if (Object.keys(tarde).length>0) upsertRows.push({escola:school,data:dateStr,turno:'tarde',salas:tarde,total_criancas:Object.values(tarde).reduce(function(a,b){return a+b;},0)});
          }
          if (upsertRows.length>0) await SUPA.upsert(upsertRows);
          attendanceData=rowsToMemory(await SUPA.fetchAll());
          setLoading(false);
        }
        if (data.year) { currentYear=parseInt(data.year,10); $('#schoolYear').value=String(data.year); localStorage.setItem(ST_YEAR,String(data.year)); }
        if (data.yearStart) { $('#yearStart').value=data.yearStart; localStorage.setItem(ST_YS,data.yearStart); }
        updateCounter(); renderCalendar(); renderClassroomGrid(); generateReport();
        $('#importModal').hidden=true; $('#importTextarea').value='';
        showToast('Dados importados com sucesso!','success');
      } catch(e) { setLoading(false); showToast('Erro ao importar: '+e.message,'error'); }
    }

    async function clearAllData() {
      const ok=await confirmDialog('Isso apagara TODOS os registros do Supabase. Esta acao nao pode ser desfeita. Continuar?');
      if (!ok) return;
      try { setLoading(true); await SUPA.deleteAll(); attendanceData={}; setLoading(false); updateCounter(); renderCalendar(); renderClassroomGrid(); generateReport(); showToast('Todos os dados foram apagados.','success'); }
      catch(e) { setLoading(false); showToast('Erro ao limpar: '+e.message,'error'); }
    }

    /* ---- Settings ---- */
    function renderSettingsGrid() {
      const grid=$('#settingsGrid'); grid.innerHTML='';
      for (const k of Object.keys(SCHOOLS)) {
        const info=SCHOOLS[k], card=document.createElement('div'); card.className='settings-school-card';
        const tags=ROOMS.map(function(room,i){ const m=i<9; return '<span class="room-tag '+(m?'period-manha':'period-tarde')+'">'+room+' ('+(m?'M':'T')+')</span>'; }).join('');
        card.innerHTML='<h4 style="color:'+info.color+'">'+info.name+' ('+info.dayLabel+'s)</h4><div class="room-tags">'+tags+'</div>';
        grid.appendChild(card);
      }
    }

    /* ---- Events ---- */
    function initEvents() {
      $$('.tab').forEach(function(tab){ tab.addEventListener('click',function(){ switchTab(tab.dataset.tab); }); });
      $('#prevMonth').addEventListener('click',function(){ currentDate.setDate(1); currentDate.setMonth(currentDate.getMonth()-1); renderCalendar(); });
      $('#nextMonth').addEventListener('click',function(){ currentDate.setDate(1); currentDate.setMonth(currentDate.getMonth()+1); renderCalendar(); });
      $('#todayBtn').addEventListener('click',function(){ currentDate=new Date(); renderCalendar(); });
      ['#attSchool','#attDate','#attPeriod'].forEach(function(id){ $(id).addEventListener('change',renderClassroomGrid); });
      $('#saveAttendance').addEventListener('click',saveAttendance);
      $('#clearAttendance').addEventListener('click',clearCurrentAttendance);
      function onPeriodChange(){ const custom=$('#repPeriod').value==='custom'; $('#customStartGroup').hidden=!custom; $('#customEndGroup').hidden=!custom; if(custom&&!$('#repStartDate').value){const y=currentDate.getFullYear(),m=currentDate.getMonth();$('#repStartDate').value=fISO(new Date(y,m,1));$('#repEndDate').value=fISO(new Date(y,m+1,0));} generateReport(); }
      ['#repSchool','#repPeriod'].forEach(function(id){ $(id).addEventListener('change',onPeriodChange); });
      ['#repStartDate','#repEndDate','#repRoom'].forEach(function(id){ $(id).addEventListener('change',generateReport); });
      $('#repRoom').addEventListener('input',function(e){ e.target.value=e.target.value.toUpperCase().replace(/[^A-R]/g,'').slice(0,1); });
      $('#generateReport').addEventListener('click',generatePDF);
      $('#exportCSV').addEventListener('click',exportCSV);
      $('#printReport').addEventListener('click',function(){ window.print(); });
      $('#schoolYear').addEventListener('change',function(e){ currentYear=parseInt(e.target.value,10); currentDate=new Date(currentYear,currentDate.getMonth(),1); localStorage.setItem(ST_YEAR,String(currentYear)); renderCalendar(); });
      $('#yearStart').addEventListener('change',function(e){ localStorage.setItem(ST_YS,e.target.value); renderCalendar(); });
      $('#exportData').addEventListener('click',exportAllData);
      $('#importDataBtn').addEventListener('click',function(){ $('#importModal').hidden=false; $('#importTextarea').focus(); });
      ['#closeImportModal','#cancelImport'].forEach(function(id){ $(id).addEventListener('click',function(){ $('#importModal').hidden=true; }); });
      $('#confirmImport').addEventListener('click',function(){ importData($('#importTextarea').value); });
      $('#clearAllData').addEventListener('click',clearAllData);
      $('#importModal').addEventListener('click',function(e){ if(e.target===e.currentTarget) $('#importModal').hidden=true; });
      document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&!$('#importModal').hidden) $('#importModal').hidden=true; });
      document.addEventListener('keydown',function(e){
        if (e.key!=='Enter'||!e.target.matches('#classroomGrid input[type="number"]')) return;
        e.preventDefault();
        const inputs=$$('#classroomGrid input[type="number"]').filter(function(i){ return !i.closest('[hidden]'); });
        const idx=inputs.indexOf(e.target);
        if (idx>=0 && idx<inputs.length-1) inputs[idx+1].focus(); else saveAttendance();
      });
    }

    /* ---- Init ---- */
    async function init() {
      const savedYear=localStorage.getItem(ST_YEAR), savedYS=localStorage.getItem(ST_YS);
      if (savedYear) { currentYear=parseInt(savedYear,10); $('#schoolYear').value=savedYear; }
      if (savedYS) { $('#yearStart').value=savedYS; }
      if (!$('#attDate').value) $('#attDate').value=fISO(new Date());
      initEvents(); renderSettingsGrid();
      /* Render immediately so calendar/tabs appear before Supabase loads */
      renderCalendar(); renderClassroomGrid(); generateReport(); updateCounter();
      /* Then load data from Supabase */
      setLoading(true);
      try { const rows=await SUPA.fetchAll(); attendanceData=rowsToMemory(rows); setSyncBadge('ok'); }
      catch(e) { setSyncBadge('error'); showToast('Erro ao carregar: '+e.message+'. Verifique o anonKey em config.js.','error'); }
      finally { setLoading(false); }
      /* Re-render with loaded data */
      renderCalendar(); renderClassroomGrid(); generateReport(); updateCounter();
    }

    if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
  })();
  
