'use strict';

// ---- helpers ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function idr(n) {
  const num = Number(n) || 0;
  return 'Rp ' + num.toLocaleString('id-ID');
}

// very small, safe markdown -> HTML (headings, bold, lists, paragraphs)
function renderMarkdown(md) {
  if (!md) return '<em>Surat tidak tersedia.</em>';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = String(md).replace(/```[a-z]*\n?/gi, '').split(/\r?\n/);
  let html = '', inList = false;
  for (let raw of lines) {
    let line = esc(raw.trim());
    line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (/^#{1,6}\s/.test(raw.trim())) {
      if (inList) { html += '</ul>'; inList = false; }
      const level = raw.trim().match(/^#+/)[0].length;
      html += `<h${Math.min(level + 1, 4)}>${line.replace(/^#+\s/, '')}</h${Math.min(level + 1, 4)}>`;
    } else if (/^[-*]\s/.test(raw.trim())) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${line.replace(/^[-*]\s/, '')}</li>`;
    } else if (line === '') {
      if (inList) { html += '</ul>'; inList = false; }
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${line}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

function setStatusPill(status, band) {
  const pill = $('statusPill');
  let text = status, cls = '';
  const finalStatus = band; // finalStatus from output
  if (finalStatus === 'APPROVED') { text = 'DISETUJUI'; cls = 'ok'; }
  else if (finalStatus === 'REJECTED') { text = 'DITOLAK'; cls = 'bad'; }
  else if (status === 'RUNNING') { text = 'DIPROSES'; cls = 'warn'; }
  else if (status === 'COMPLETED') { text = 'SELESAI'; cls = 'ok'; }
  else if (status === 'FAILED' || status === 'TERMINATED') { text = 'GAGAL'; cls = 'bad'; }
  pill.textContent = text;
  pill.className = 'status-pill ' + cls;
}

// ---- state -----------------------------------------------------------------
let currentId = null;
let polling = null;

function showProgress(msg) {
  $('progress').hidden = false;
  $('progressText').textContent = msg || 'Memproses pengajuan…';
  $('decision').hidden = true;
  $('reviewPanel').hidden = true;
  $('errorBox').hidden = true;
}
function showError(msg) {
  $('progress').hidden = true;
  const box = $('errorBox');
  box.hidden = false;
  box.textContent = 'Terjadi kesalahan: ' + msg;
}

// Empty when served by server.js locally (same origin serves /api/*); set to the
// Lambda Function URL by the Amplify build. See public/config.js.
const API_BASE = ((window.APP_CONFIG && window.APP_CONFIG.apiBase) || '').replace(/\/+$/, '');

async function api(url, opts) {
  const res = await fetch(API_BASE + url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ---- flows -----------------------------------------------------------------
async function submitApplication(e) {
  e.preventDefault();
  const form = $('applicationForm');
  const fd = new FormData(form);
  const input = {};
  for (const [k, v] of fd.entries()) {
    input[k] = ['fullName', 'applicantId'].includes(k) ? v : Number(v);
  }

  $('resultCard').hidden = false;
  $('resultCard').scrollIntoView({ behavior: 'smooth' });
  setStatusPill('RUNNING');
  showProgress('Mengirim pengajuan ke Conductor…');
  $('submitBtn').disabled = true;

  try {
    const { workflowId } = await api('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    currentId = workflowId;
    startPolling();
  } catch (err) {
    showError(err.message);
    $('submitBtn').disabled = false;
  }
}

function startPolling() {
  clearInterval(polling);
  polling = setInterval(poll, 1500);
  poll();
}

async function poll() {
  if (!currentId) return;
  try {
    const wf = await api('/api/applications/' + currentId);
    if (wf.awaitingReview) {
      clearInterval(polling);
      showProgress('Menunggu tinjauan manual…');
      $('progress').hidden = true;
      renderDecision(wf.output, wf.status, true);
      return;
    }
    if (wf.status === 'RUNNING') {
      showProgress('Menghitung skor & menyusun surat keputusan…');
      return;
    }
    // terminal
    clearInterval(polling);
    $('submitBtn').disabled = false;
    if (wf.status === 'COMPLETED') {
      renderDecision(wf.output, wf.status, false);
    } else {
      renderDecision(wf.output, wf.status, false);
      showError('Alur kerja berakhir dengan status: ' + wf.status);
    }
  } catch (err) {
    clearInterval(polling);
    $('submitBtn').disabled = false;
    showError(err.message);
  }
}

function renderDecision(o, status, awaitingReview) {
  $('progress').hidden = true;
  $('decision').hidden = false;
  o = o || {};
  setStatusPill(status, o.finalStatus);

  $('mScore').textContent = o.score != null ? o.score : '—';
  $('mBand').textContent = o.band || '—';
  $('mTier').textContent = o.tier || '—';
  $('mLimit').textContent = o.creditLimit != null ? idr(o.creditLimit) : '—';
  $('mApr').textContent = o.interestRate != null ? o.interestRate + '%' : '—';
  $('mDti').textContent = o.dti != null ? o.dti : '—';

  const reasons = o.reasonCodes || [];
  $('reasonList').innerHTML = reasons.length
    ? reasons.map((r) => `<li>${r}</li>`).join('')
    : '<li>Tidak ada faktor tercatat.</li>';

  $('letterBody').innerHTML = renderMarkdown(o.decisionLetterMarkdown);

  $('reviewPanel').hidden = !awaitingReview;
}

async function submitReview() {
  const decision = {
    decision: $('rvDecision').value,
    creditLimit: Number($('rvLimit').value),
    interestRate: Number($('rvApr').value),
    tier: $('rvTier').value,
    note: $('rvNote').value,
  };
  $('submitReview').disabled = true;
  try {
    await api('/api/applications/' + currentId + '/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decision),
    });
    $('reviewPanel').hidden = true;
    showProgress('Menerapkan keputusan & menyusun surat…');
    startPolling();
  } catch (err) {
    showError(err.message);
  } finally {
    $('submitReview').disabled = false;
  }
}

// ---- sample fillers --------------------------------------------------------
function fill(values) {
  const form = $('applicationForm');
  for (const [k, v] of Object.entries(values)) {
    if (form.elements[k]) form.elements[k].value = v;
  }
}
const SAMPLES = {
  reject: { fullName: 'Andi Pratama', applicantId: 'APP-2002', requestedAmount: 100000000, annualIncome: 48000000, monthlyDebt: 2500000, employmentYears: 1, creditHistoryYears: 2, delinquencies: 3 },
  review: { fullName: 'Siti Rahmawati', applicantId: 'APP-3003', requestedAmount: 40000000, annualIncome: 120000000, monthlyDebt: 2900000, employmentYears: 3, creditHistoryYears: 4, delinquencies: 1 },
};

function resetForNew() {
  clearInterval(polling);
  currentId = null;
  $('resultCard').hidden = true;
  $('submitBtn').disabled = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- wire up ---------------------------------------------------------------
$('applicationForm').addEventListener('submit', submitApplication);
$('submitReview').addEventListener('click', submitReview);
$('newApp').addEventListener('click', resetForNew);
$('fillReject').addEventListener('click', () => fill(SAMPLES.reject));
$('fillReview').addEventListener('click', () => fill(SAMPLES.review));
