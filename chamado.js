/* ============================================================
   Sistema de Chamadas — Burle Marx & Perimetral
   Vanilla JS. Dados em localStorage. PDF via jsPDF + autoTable.
   ============================================================ */
'use strict';

(() => {
  const STORAGE = {
    ATTENDANCE: 'chamadas.attendance.v2',
    YEAR: 'chamadas.schoolYear',
    YEAR_START: 'chamadas.yearStart',
    LEGACY_ATTENDANCE: 'attendanceData',
  };

  const SCHOOLS = {
    burle:      { name: 'Burle Marx', dayLabel: 'Terça',  weekday: 2, color: '#BF625A' },
    perimetral: { name: 'Perimetral', dayLabel: 'Quinta', weekday: 4, color: '#5EAA80' },
  };

  const ROOMS = 'ABCDEFGHIJKLMNOPQR'.split('');
  const ROOMS_MANHA = ROOMS.slice(0, 9);
  const ROOMS_TARDE = ROOMS.slice(9);
  const KEY_SEP = '|';

  let attendanceData = {};
  let currentDate = new Date();
  let currentYear = new Date().getFullYear();
  let lastReport = { rows: [], totals: null, filters: null };

  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const pad = (n) => String(n).padStart(2, '0');
  const formatISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const formatBR  = (d) => d.toLocaleDateString('pt-BR');
  const parseISO  = (s) => {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const getMonthName = (m, y) =>
    new Date(y, m, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const isPast = (d) => startOfDay(d) < startOfDay(new Date());

  const buildKey = (school, dateStr) => `${school}${KEY_SEP}${dateStr}`;
  const parseKey = (key) => {
    const i = key.indexOf(KEY_SEP);
    if (i === -1) {
      const j = key.indexOf('-');
      return j === -1 ? { school: key, dateStr: '' } : { school: key.slice(0, j), dateStr: key.slice(j + 1) };
    }
    return { school: key.slice(0, i), dateStr: key.slice(i + 1) };
  };
  const getSchoolDayInfo = (date) => {
    const wd = date.getDay();
    for (const [key, info] of Object.entries(SCHOOLS)) {
      if (info.weekday === wd) return { school: key, ...info };
    }
    return null;
  };

  function saveData() {
    try {
      localStorage.setItem(STORAGE.ATTENDANCE, JSON.stringify(attendanceData));
      localStorage.setItem(STORAGE.YEAR, String(currentYear));
      const ys = $('#yearStart').value;
      if (ys) localStorage.setItem(STORAGE.YEAR_START, ys);
    } catch (e) {
      console.error('Falha ao salvar:', e);
      showToast('Erro ao salvar no navegador (armazenamento cheio?)', 'error');
    }
  }

  function loadData() {
    try {
      const v2 = localStorage.getItem(STORAGE.ATTENDANCE);
      if (v2) {
        attendanceData = JSON.parse(v2) || {};
      } else {
        const legacy = localStorage.getItem(STORAGE.LEGACY_ATTENDANCE);
        if (legacy) {
          const old = JSON.parse(legacy) || {};
          const migrated = {};
          for (const [k, v] of Object.entries(old)) {
            const idx = k.indexOf('-');
            if (idx === -1) continue;
            migrated[buildKey(k.slice(0, idx), k.slice(idx + 1))] = v;
          }
          attendanceData = migrated;
          localStorage.setItem(STORAGE.ATTENDANCE, JSON.stringify(attendanceData));
        }
      }
    } catch (e) {
      console.error('Falha ao carregar dados:', e);
      attendanceData = {};
    }
    const y = localStorage.getItem(STORAGE.YEAR);
    if (y) { currentYear = parseInt(y, 10); $('#schoolYear').value = y; }
    const ys = localStorage.getItem(STORAGE.YEAR_START);
    if (ys) $('#yearStart').value = ys;
  }

  function showToast(msg, type = 'info') {
    const container = $('#toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, 2800);
  }

  function confirmDialog(message) {
    return new Promise((resolve) => {
      const modal = $('#confirmModal');
      $('#confirmMessage').textContent = message;
      modal.hidden = false;
      const cleanup = (result) => {
        modal.hidden = true;
        yes.removeEventListener('click', onYes);
        no.removeEventListener('click', onNo);
        close.removeEventListener('click', onNo);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        resolve(result);
      };
      const yes = $('#confirmYes'), no = $('#confirmNo'), close = $('#closeConfirmModal');
      const onYes = () => cleanup(true);
      const onNo  = () => cleanup(false);
      const onBackdrop = (e) => { if (e.target === modal) cleanup(false); };
      const onKey = (e) => { if (e.key === 'Escape') cleanup(false); };
      yes.addEventListener('click', onYes);
      no.addEventListener('click', onNo);
      close.addEventListener('click', onNo);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);
      yes.focus();
    });
  }

  function updateCounter() {
    const el = $('#savedCounter');
    if (!el) return;
    let total = 0;
    for (const day of Object.values(attendanceData)) total += Object.keys(day).length;
    el.textContent = total;
  }

  function switchTab(name) {
    $$('.tab').forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $$('[role="tabpanel"]').forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
    if (name === 'attendance') renderClassroomGrid();
    if (name === 'reports')    generateReport();
    if (name === 'settings')   renderSettingsGrid();
    updateCounter();
  }

  function renderCalendar() {
    const grid = $('#calendarGrid');
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    $('#monthTitle').textContent = getMonthName(month, year);
    const headers = Array.from(grid.querySelectorAll('.cal-day-header'));
    grid.innerHTML = '';
    headers.forEach((h) => grid.appendChild(h));
    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay();
    const today = startOfDay(new Date());
    const yearStart = parseISO($('#yearStart').value) || new Date(year, 0, 1);
    for (let i = 0; i < startOffset; i++) {
      const div = document.createElement('div');
      div.className = 'cal-day empty';
      grid.appendChild(div);
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d);
      const div = document.createElement('div');
      div.className = 'cal-day';
      div.dataset.date = formatISO(date);
      const schoolInfo = getSchoolDayInfo(date);
      const hasData = schoolInfo && !!attendanceData[buildKey(schoolInfo.school, formatISO(date))];
      if (isSameDay(date, today)) div.classList.add('today');
      if (isPast(date) && !isSameDay(date, today)) div.classList.add('past');
      if (schoolInfo) {
        div.classList.add(`${schoolInfo.school}-day`);
        div.title = `${schoolInfo.name} — ${schoolInfo.dayLabel}`;
      }
      if (hasData) div.classList.add('has-data');
      div.innerHTML = `
        <span class="cal-day-number">${d}</span>
        <div class="cal-day-indicator">
          ${schoolInfo ? `<span class="indicator-dot ${schoolInfo.school}"></span>` : ''}
        </div>`;
      if (schoolInfo && date >= yearStart) {
        div.classList.add('clickable');
        div.addEventListener('click', () => openAttendanceForDate(date, schoolInfo.school));
      }
      grid.appendChild(div);
    }
  }

  function openAttendanceForDate(date, school) {
    switchTab('attendance');
    $('#attSchool').value = school;
    $('#attDate').value = formatISO(date);
    renderClassroomGrid();
  }

  function renderClassroomGrid() {
    const grid = $('#classroomGrid');
    const summary = $('#attendanceSummary');
    const school = $('#attSchool').value;
    const dateStr = $('#attDate').value;
    const period = $('#attPeriod').value;
    if (!dateStr) {
      grid.innerHTML = '<p class="muted" style="grid-column:1/-1; text-align:center;">Selecione uma data.</p>';
      summary.textContent = '';
      return;
    }
    const date = parseISO(dateStr);
    const wd = date.getDay();
    const expected = SCHOOLS[school].weekday;
    const rooms = period === 'manha' ? ROOMS_MANHA : ROOMS_TARDE;
    const saved = attendanceData[buildKey(school, dateStr)] || {};
    const filledCount = rooms.reduce((acc, r) => acc + (saved[r]?.present ? 1 : 0), 0);
    const childrenCount = rooms.reduce((acc, r) => acc + (saved[r]?.present ? (saved[r].count || 0) : 0), 0);
    let warning = '';
    if (wd !== expected) {
      warning = `<strong style="color:var(--warning);">⚠ Atenção:</strong> esta data não cai em ${SCHOOLS[school].dayLabel.toLowerCase()}-feira. `;
    }
    summary.innerHTML = `
      ${warning}
      <strong>${SCHOOLS[school].name}</strong> · ${formatBR(date)} · turno da ${period === 'manha' ? 'manhã' : 'tarde'} —
      <strong>${filledCount}</strong>/<strong>${rooms.length}</strong> salas com aula
      ${childrenCount ? `· <strong>${childrenCount}</strong> crianças` : ''}.`;
    grid.innerHTML = '';
    rooms.forEach((room) => {
      const data = saved[room] || { present: false, count: 0 };
      const card = document.createElement('div');
      card.className = `classroom-card ${data.present ? 'filled' : ''}`;
      card.dataset.room = room;
      card.innerHTML = `
        <div class="classroom-header">
          <span class="classroom-label">Sala ${room}</span>
          <span class="classroom-period period-${period}">${period === 'manha' ? 'Manhã' : 'Tarde'}</span>
        </div>
        <div class="classroom-inputs">
          <div class="checkbox-group">
            <input type="checkbox" id="pres-${room}" ${data.present ? 'checked' : ''} data-room="${room}">
            <label for="pres-${room}" style="font-weight:500; cursor:pointer;">Teve aula</label>
          </div>
          <div class="input-row" id="countRow-${room}" ${data.present ? '' : 'hidden'}>
            <input type="number" id="count-${room}" value="${data.count || ''}"
                   min="0" max="50" placeholder="Qtd. crianças" data-room="${room}">
          </div>
        </div>`;
      grid.appendChild(card);
      const check = card.querySelector(`#pres-${room}`);
      const countInput = card.querySelector(`#count-${room}`);
      const countRow = card.querySelector(`#countRow-${room}`);
      check.addEventListener('change', (e) => {
        const show = e.target.checked;
        countRow.hidden = !show;
        card.classList.toggle('filled', show);
        if (show) { countInput.focus(); countInput.select(); }
        else countInput.value = '';
      });
    });
  }

  function saveAttendance() {
    const school = $('#attSchool').value;
    const dateStr = $('#attDate').value;
    const period = $('#attPeriod').value;
    if (!dateStr) { showToast('Selecione uma data antes de salvar.', 'error'); return; }
    const key = buildKey(school, dateStr);
    const rooms = period === 'manha' ? ROOMS_MANHA : ROOMS_TARDE;
    let touched = false;
    rooms.forEach((room) => {
      const presentEl = $(`#pres-${room}`);
      const countEl = $(`#count-${room}`);
      if (!presentEl) return;
      const present = presentEl.checked;
      const count = Math.max(0, Math.min(50, parseInt(countEl.value, 10) || 0));
      if (present || count > 0) {
        if (!attendanceData[key]) attendanceData[key] = {};
        attendanceData[key][room] = { present, count };
        touched = true;
      } else if (attendanceData[key]?.[room]) {
        delete attendanceData[key][room];
        touched = true;
      }
    });
    if (attendanceData[key] && Object.keys(attendanceData[key]).length === 0) delete attendanceData[key];
    if (!touched) { showToast('Nenhuma alteração para salvar.', 'info'); return; }
    saveData(); updateCounter(); renderCalendar(); renderClassroomGrid();
    showToast('Chamada salva com sucesso!', 'success');
  }

  async function clearCurrentAttendance() {
    const dateStr = $('#attDate').value;
    const school = $('#attSchool').value;
    const period = $('#attPeriod').value;
    if (!dateStr) return;
    const ok = await confirmDialog(
      `Limpar todos os registros do turno da ${period === 'manha' ? 'manhã' : 'tarde'} ` +
      `da ${SCHOOLS[school].name} em ${formatBR(parseISO(dateStr))}?`
    );
    if (!ok) return;
    const key = buildKey(school, dateStr);
    const rooms = period === 'manha' ? ROOMS_MANHA : ROOMS_TARDE;
    if (attendanceData[key]) {
      rooms.forEach((r) => delete attendanceData[key][r]);
      if (Object.keys(attendanceData[key]).length === 0) delete attendanceData[key];
    }
    saveData(); updateCounter(); renderCalendar(); renderClassroomGrid();
    showToast('Turno limpo.', 'success');
  }

  function computeFilterRange() {
    const periodFilter = $('#repPeriod').value;
    const now = new Date();
    if (periodFilter === 'month') {
      return { start: new Date(now.getFullYear(), now.getMonth(), 1),
               end: new Date(now.getFullYear(), now.getMonth() + 1, 0) };
    }
    if (periodFilter === 'year') {
      return { start: new Date(now.getFullYear(), 0, 1),
               end: new Date(now.getFullYear(), 11, 31) };
    }
    let start = parseISO($('#repStartDate').value);
    let end   = parseISO($('#repEndDate').value);
    if (!start) { start = new Date(now.getFullYear(), now.getMonth(), 1); $('#repStartDate').value = formatISO(start); }
    if (!end)   { end   = new Date(now.getFullYear(), now.getMonth() + 1, 0); $('#repEndDate').value = formatISO(end); }
    if (start > end) [start, end] = [end, start];
    return { start, end };
  }

  function collectRows() {
    const schoolFilter = $('#repSchool').value;
    const roomFilter = ($('#repRoom')?.value || '').trim().toUpperCase();
    const { start, end } = computeFilterRange();
    const rows = [];
    const totals = {
      burle:      { days: new Set(), children: 0, classes: 0 },
      perimetral: { days: new Set(), children: 0, classes: 0 },
    };
    if (!start || !end) return { rows, totals, valid: false, start, end };
    const startISO = formatISO(start);
    const endISO   = formatISO(end);
    for (const [key, data] of Object.entries(attendanceData)) {
      const { school, dateStr } = parseKey(key);
      if (!SCHOOLS[school]) continue;
      if (schoolFilter !== 'both' && school !== schoolFilter) continue;
      if (dateStr < startISO || dateStr > endISO) continue;
      let dayHasRecord = false;
      for (const [room, info] of Object.entries(data)) {
        if (!info.present) continue;
        if (roomFilter && room !== roomFilter) continue;
        rows.push({ date: dateStr, school, room, count: info.count || 0 });
        totals[school].children += info.count || 0;
        totals[school].classes++;
        dayHasRecord = true;
      }
      if (dayHasRecord) totals[school].days.add(dateStr);
    }
    return { rows, totals, valid: true, start, end };
  }

  function generateReport() {
    const { rows, totals, valid, start, end } = collectRows();
    if (!valid) showToast('Defina o período personalizado (início e fim).', 'error');
    const cleanTotals = {
      burle:      { days: totals.burle.days.size,      children: totals.burle.children,      classes: totals.burle.classes },
      perimetral: { days: totals.perimetral.days.size, children: totals.perimetral.children, classes: totals.perimetral.classes },
    };
    const schoolFilter = $('#repSchool').value;
    const periodLabel = $('#repPeriod').options[$('#repPeriod').selectedIndex].text;
    const roomFilter = ($('#repRoom')?.value || '').trim().toUpperCase();
    lastReport = {
      rows, totals: cleanTotals,
      filters: { schoolFilter, periodLabel, roomFilter, start, end },
    };
    renderSummaryCards(cleanTotals, schoolFilter);
    renderReportTable(rows);
  }

  function renderSummaryCards(totals, filter) {
    const container = $('#summaryCards');
    const showBoth = filter === 'both';
    let html = '';
    if (showBoth || filter === 'burle') {
      html += `
        <div class="summary-card">
          <div class="summary-label">Burle Marx · Dias com chamada</div>
          <div class="summary-value">${totals.burle.days}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Burle Marx · Crianças atendidas</div>
          <div class="summary-value">${totals.burle.children}</div>
        </div>`;
    }
    if (showBoth || filter === 'perimetral') {
      html += `
        <div class="summary-card perimetral">
          <div class="summary-label">Perimetral · Dias com chamada</div>
          <div class="summary-value">${totals.perimetral.days}</div>
        </div>
        <div class="summary-card perimetral">
          <div class="summary-label">Perimetral · Crianças atendidas</div>
          <div class="summary-value">${totals.perimetral.children}</div>
        </div>`;
    }
    if (showBoth) {
      html += `
        <div class="summary-card total">
          <div class="summary-label">TOTAL · Dias com chamada</div>
          <div class="summary-value">${totals.burle.days + totals.perimetral.days}</div>
        </div>
        <div class="summary-card total">
          <div class="summary-label">TOTAL · Crianças atendidas</div>
          <div class="summary-value">${totals.burle.children + totals.perimetral.children}</div>
        </div>`;
    }
    container.innerHTML = html;
  }

  function renderReportTable(rows) {
    const tbody = $('#reportBody');
    const empty = $('#emptyReport');
    if (rows.length === 0) { tbody.innerHTML = ''; empty.hidden = false; return; }
    empty.hidden = true;
    rows.sort((a, b) =>
      a.date.localeCompare(b.date) || a.school.localeCompare(b.school) || a.room.localeCompare(b.room)
    );
    tbody.innerHTML = rows.map((r) => {
      const isMorning = ROOMS_MANHA.includes(r.room);
      return `
        <tr>
          <td>${formatBR(parseISO(r.date))}</td>
          <td><span class="school-badge ${r.school === 'burle' ? 'badge-burle' : 'badge-perimetral'}">${SCHOOLS[r.school].name}</span></td>
          <td><span class="classroom-period ${isMorning ? 'period-manha' : 'period-tarde'}">${isMorning ? 'Manhã' : 'Tarde'}</span></td>
          <td><strong>Sala ${r.room}</strong></td>
          <td><span style="color:var(--sage-dark); font-weight:700;">✓ Presente</span></td>
          <td class="text-right font-mono">${r.count}</td>
        </tr>`;
    }).join('');
  }

  // ----------------------- PDF -------------------------------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src; s.async = true; s.dataset.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Falha ao carregar ' + src));
      document.head.appendChild(s);
    });
  }

  async function ensurePDFLibs() {
    if (!window.jspdf) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    }
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF indisponível');
    // autoTable
    const test = new window.jspdf.jsPDF();
    if (typeof test.autoTable !== 'function') {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
    }
  }

  async function generatePDF() {
    const btn = $('#generateReport');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ Gerando PDF…';
    try {
      generateReport(); // refresh data
      const { rows, totals, filters } = lastReport;
      if (!rows || rows.length === 0) {
        showToast('Nenhum registro para gerar PDF.', 'error');
        return;
      }
      await ensurePDFLibs();

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 40;

      // Paleta
      const C = {
        terracotta: [191, 98, 90],
        sage: [94, 170, 128],
        coral: [255, 73, 57],
        brown: [128, 95, 92],
        brownDark: [92, 69, 67],
        text: [42, 31, 29],
        muted: [122, 102, 99],
        bgSoft: [243, 236, 230],
        border: [236, 224, 216],
      };

      const setFill = (rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
      const setText = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
      const setDraw = (rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);

      // ---------- Cabeçalho ----------
      setFill(C.brownDark);
      doc.rect(0, 0, pageW, 90, 'F');
      setFill(C.terracotta);
      doc.rect(0, 90, pageW, 6, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      setText([255, 255, 255]);
      doc.text('Relatório de Chamadas Escolares', margin, 42);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      setText([255, 220, 210]);
      doc.text('Escolas Burle Marx & Perimetral', margin, 60);

      doc.setFontSize(9);
      const gerado = `Gerado em ${formatBR(new Date())} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      doc.text(gerado, pageW - margin - doc.getTextWidth(gerado), 42);

      let y = 120;

      // ---------- Filtros aplicados ----------
      const schoolLabel = filters.schoolFilter === 'both' ? 'Ambas as escolas'
        : filters.schoolFilter === 'burle' ? 'Burle Marx' : 'Perimetral';
      const periodoStr = `${formatBR(filters.start)} a ${formatBR(filters.end)}`;
      const salaStr = filters.roomFilter ? `Sala ${filters.roomFilter}` : 'Todas as salas';

      setFill(C.bgSoft);
      doc.roundedRect(margin, y, pageW - margin * 2, 64, 8, 8, 'F');
      setText(C.brownDark);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('FILTROS APLICADOS', margin + 14, y + 18);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      setText(C.text);
      const filterLines = [
        ['Escola:',  schoolLabel],
        ['Período:', `${filters.periodLabel} (${periodoStr})`],
        ['Sala:',    salaStr],
      ];
      filterLines.forEach(([k, v], i) => {
        const yy = y + 34 + i * 12;
        doc.setFont('helvetica', 'bold'); setText(C.muted);
        doc.text(k, margin + 14, yy);
        doc.setFont('helvetica', 'normal'); setText(C.text);
        doc.text(String(v), margin + 70, yy);
      });
      y += 80;

      // ---------- Cards de resumo ----------
      const showBurle      = filters.schoolFilter === 'both' || filters.schoolFilter === 'burle';
      const showPerimetral = filters.schoolFilter === 'both' || filters.schoolFilter === 'perimetral';
      const cards = [];
      if (showBurle) {
        cards.push({ label: 'Burle Marx · Dias',     value: totals.burle.days,        color: C.terracotta });
        cards.push({ label: 'Burle Marx · Crianças', value: totals.burle.children,    color: C.terracotta });
      }
      if (showPerimetral) {
        cards.push({ label: 'Perimetral · Dias',     value: totals.perimetral.days,     color: C.sage });
        cards.push({ label: 'Perimetral · Crianças', value: totals.perimetral.children, color: C.sage });
      }
      if (filters.schoolFilter === 'both') {
        cards.push({ label: 'TOTAL · Dias',     value: totals.burle.days + totals.perimetral.days,         color: C.coral });
        cards.push({ label: 'TOTAL · Crianças', value: totals.burle.children + totals.perimetral.children, color: C.coral });
      }

      const colsPerRow = cards.length >= 4 ? (cards.length % 3 === 0 ? 3 : 2) : cards.length;
      const cardW = (pageW - margin * 2 - (colsPerRow - 1) * 10) / colsPerRow;
      const cardH = 56;
      cards.forEach((c, i) => {
        const col = i % colsPerRow;
        const row = Math.floor(i / colsPerRow);
        const cx = margin + col * (cardW + 10);
        const cy = y + row * (cardH + 10);
        setFill([255, 255, 255]);
        setDraw(C.border); doc.setLineWidth(1);
        doc.roundedRect(cx, cy, cardW, cardH, 6, 6, 'FD');
        setFill(c.color);
        doc.rect(cx, cy, 4, cardH, 'F');
        setText(C.muted);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
        doc.text(c.label.toUpperCase(), cx + 14, cy + 18);
        setText(C.brownDark);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(22);
        doc.text(String(c.value), cx + 14, cy + 44);
      });
      const rowsUsed = Math.ceil(cards.length / colsPerRow);
      y += rowsUsed * (cardH + 10) + 14;

      // ---------- Tabela detalhada ----------
      setText(C.brownDark);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text(`Detalhamento · ${rows.length} registro${rows.length === 1 ? '' : 's'}`, margin, y);
      y += 8;

      const sorted = [...rows].sort((a, b) =>
        a.date.localeCompare(b.date) || a.school.localeCompare(b.school) || a.room.localeCompare(b.room)
      );

      const body = sorted.map((r) => {
        const isMorning = ROOMS_MANHA.includes(r.room);
        return [
          formatBR(parseISO(r.date)),
          SCHOOLS[r.school].name,
          isMorning ? 'Manhã' : 'Tarde',
          `Sala ${r.room}`,
          'Presente',
          String(r.count),
        ];
      });

      doc.autoTable({
        head: [['Data', 'Escola', 'Turno', 'Sala', 'Status', 'Crianças']],
        body,
        startY: y + 6,
        margin: { left: margin, right: margin },
        styles: {
          font: 'helvetica', fontSize: 9, cellPadding: 6,
          textColor: C.text, lineColor: C.border, lineWidth: 0.5,
        },
        headStyles: {
          fillColor: C.brownDark, textColor: [255, 255, 255],
          fontStyle: 'bold', fontSize: 8.5, halign: 'left',
        },
        alternateRowStyles: { fillColor: [250, 246, 242] },
        columnStyles: {
          0: { cellWidth: 70 },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 55 },
          3: { cellWidth: 60 },
          4: { cellWidth: 60, textColor: C.sage, fontStyle: 'bold' },
          5: { cellWidth: 55, halign: 'right', fontStyle: 'bold' },
        },
        didParseCell: (data) => {
          if (data.section !== 'body') return;
          if (data.column.index === 1) {
            const isBurle = data.cell.raw === 'Burle Marx';
            data.cell.styles.textColor = isBurle ? C.terracotta : C.sage;
            data.cell.styles.fontStyle = 'bold';
          }
        },
        didDrawPage: (data) => {
          // Footer
          const str = `Página ${doc.internal.getNumberOfPages()}`;
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
          setText(C.muted);
          doc.text(str, pageW - margin, pageH - 18, { align: 'right' });
          doc.text('Sistema de Chamadas · Burle Marx & Perimetral', margin, pageH - 18);
          setDraw(C.border); doc.setLineWidth(0.5);
          doc.line(margin, pageH - 30, pageW - margin, pageH - 30);
        },
      });

      // ---------- Resumo final ----------
      let endY = doc.lastAutoTable.finalY + 18;
      if (endY > pageH - 100) { doc.addPage(); endY = 60; }
      setFill(C.brownDark);
      doc.roundedRect(margin, endY, pageW - margin * 2, 60, 8, 8, 'F');
      setText([255, 255, 255]);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text('RESUMO GERAL', margin + 14, endY + 20);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      setText([255, 220, 210]);
      const totalDias = totals.burle.days + totals.perimetral.days;
      const totalCriancas = totals.burle.children + totals.perimetral.children;
      const totalAulas = totals.burle.classes + totals.perimetral.classes;
      const mediaCriancas = totalAulas ? (totalCriancas / totalAulas).toFixed(1) : '0';
      doc.text(
        `${totalDias} dias com chamada  ·  ${totalAulas} aulas registradas  ·  ${totalCriancas} crianças atendidas  ·  Média de ${mediaCriancas} crianças por aula`,
        margin + 14, endY + 42
      );

      const filename = `relatorio-chamadas-${formatISO(new Date())}.pdf`;
      doc.save(filename);
      showToast(`PDF gerado: ${rows.length} registros.`, 'success');
    } catch (e) {
      console.error(e);
      showToast('Erro ao gerar PDF. Tente novamente.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  // ----------------------- EXPORT/IMPORT ---------------------
  function downloadBlob(content, mime, filename) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function csvEscape(v) {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function exportCSV() {
    const { rows } = collectRows();
    if (rows.length === 0) { showToast('Nenhum dado para exportar.', 'error'); return; }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.school.localeCompare(b.school) || a.room.localeCompare(b.room));
    let csv = 'Data,Escola,Turno,Sala,Presença,Crianças\n';
    for (const r of rows) {
      const period = ROOMS_MANHA.includes(r.room) ? 'Manhã' : 'Tarde';
      csv += [
        csvEscape(formatBR(parseISO(r.date))),
        csvEscape(SCHOOLS[r.school].name),
        csvEscape(period),
        csvEscape(`Sala ${r.room}`),
        'Sim', r.count,
      ].join(',') + '\n';
    }
    downloadBlob('\uFEFF' + csv, 'text/csv;charset=utf-8;', `relatorio-chamadas-${formatISO(new Date())}.csv`);
    showToast(`${rows.length} registros exportados.`, 'success');
  }
  function exportAllData() {
    const data = {
      attendance: attendanceData, year: currentYear,
      yearStart: $('#yearStart').value, exportedAt: new Date().toISOString(), version: 2,
    };
    downloadBlob(JSON.stringify(data, null, 2), 'application/json', `backup-chamadas-${formatISO(new Date())}.json`);
    showToast('Backup exportado.', 'success');
  }
  function importData(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (!data || typeof data !== 'object') throw new Error('Estrutura inválida.');
      if (data.attendance && typeof data.attendance === 'object') {
        const normalized = {};
        for (const [k, v] of Object.entries(data.attendance)) {
          if (k.includes(KEY_SEP)) normalized[k] = v;
          else {
            const idx = k.indexOf('-');
            if (idx === -1) continue;
            normalized[buildKey(k.slice(0, idx), k.slice(idx + 1))] = v;
          }
        }
        attendanceData = normalized;
      }
      if (data.year)      { currentYear = parseInt(data.year, 10); $('#schoolYear').value = String(data.year); }
      if (data.yearStart) { $('#yearStart').value = data.yearStart; }
      saveData(); updateCounter(); renderCalendar(); renderClassroomGrid(); generateReport();
      $('#importModal').hidden = true; $('#importTextarea').value = '';
      showToast('Dados importados com sucesso!', 'success');
    } catch (e) {
      console.error(e);
      showToast('Erro ao importar: JSON inválido.', 'error');
    }
  }
  async function clearAllData() {
    const ok = await confirmDialog('Isso apagará TODOS os registros de chamada deste navegador. Esta ação não pode ser desfeita. Continuar?');
    if (!ok) return;
    attendanceData = {};
    saveData(); updateCounter(); renderCalendar(); renderClassroomGrid(); generateReport();
    showToast('Todos os dados foram apagados.', 'success');
  }

  function renderSettingsGrid() {
    const grid = $('#settingsGrid');
    grid.innerHTML = '';
    Object.entries(SCHOOLS).forEach(([key, info]) => {
      const card = document.createElement('div');
      card.className = 'settings-school-card';
      const tags = ROOMS.map((room, i) => {
        const morning = i < 9;
        const cls = morning ? 'period-manha' : 'period-tarde';
        return `<span class="room-tag ${cls}">${room} (${morning ? 'M' : 'T'})</span>`;
      }).join('');
      card.innerHTML = `
        <h4 style="color:${info.color}">${info.name} (${info.dayLabel}s)</h4>
        <div class="room-tags">${tags}</div>`;
      grid.appendChild(card);
    });
  }

  function initEvents() {
    $$('.tab').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
    $('#prevMonth').addEventListener('click', () => { currentDate.setDate(1); currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); });
    $('#nextMonth').addEventListener('click', () => { currentDate.setDate(1); currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); });
    $('#todayBtn').addEventListener('click', () => { currentDate = new Date(); renderCalendar(); });
    ['#attSchool', '#attDate', '#attPeriod'].forEach((id) => $(id).addEventListener('change', renderClassroomGrid));
    $('#saveAttendance').addEventListener('click', saveAttendance);
    $('#clearAttendance').addEventListener('click', clearCurrentAttendance);
    const onPeriodChange = () => {
      const custom = $('#repPeriod').value === 'custom';
      $('#customStartGroup').hidden = !custom;
      $('#customEndGroup').hidden = !custom;
      if (custom && !$('#repStartDate').value) {
        const y = currentDate.getFullYear(), m = currentDate.getMonth();
        $('#repStartDate').value = formatISO(new Date(y, m, 1));
        $('#repEndDate').value   = formatISO(new Date(y, m + 1, 0));
      }
      generateReport();
    };
    ['#repSchool', '#repPeriod'].forEach((id) => $(id).addEventListener('change', onPeriodChange));
    ['#repStartDate', '#repEndDate', '#repRoom'].forEach((id) => $(id).addEventListener('change', generateReport));
    $('#repRoom').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-R]/g, '').slice(0, 1);
    });
    // ⬇ Gerar agora gera PDF
    $('#generateReport').addEventListener('click', generatePDF);
    $('#exportCSV').addEventListener('click', exportCSV);
    $('#printReport').addEventListener('click', () => window.print());
    $('#schoolYear').addEventListener('change', (e) => {
      currentYear = parseInt(e.target.value, 10);
      currentDate = new Date(currentYear, currentDate.getMonth(), 1);
      saveData(); renderCalendar();
    });
    $('#yearStart').addEventListener('change', () => { saveData(); renderCalendar(); });
    $('#exportData').addEventListener('click', exportAllData);
    $('#importDataBtn').addEventListener('click', () => { $('#importModal').hidden = false; $('#importTextarea').focus(); });
    ['#closeImportModal', '#cancelImport'].forEach((id) =>
      $(id).addEventListener('click', () => { $('#importModal').hidden = true; }));
    $('#confirmImport').addEventListener('click', () => importData($('#importTextarea').value));
    $('#clearAllData').addEventListener('click', clearAllData);
    $('#importModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) $('#importModal').hidden = true;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#importModal').hidden) $('#importModal').hidden = true;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (!e.target.matches('#classroomGrid input[type="number"]')) return;
      e.preventDefault();
      const inputs = $$('#classroomGrid input[type="number"]:not([hidden])').filter((i) => !i.closest('[hidden]'));
      const idx = inputs.indexOf(e.target);
      if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus();
      else saveAttendance();
    });
  }

  function init() {
    loadData();
    initEvents();
    if (!$('#attDate').value) $('#attDate').value = formatISO(new Date());
    renderCalendar(); renderClassroomGrid(); renderSettingsGrid(); generateReport(); updateCounter();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();