/**
 * Weekly Business Review inside Google Sheets (Google Apps Script).
 *
 * Setup: paste the CRM export into tabs named "Opportunities" and "Reps"
 * (same columns as data/*.csv), then run installWeeklyTrigger() once.
 * Every Monday at 8am it rebuilds the "WBR" tab, adds an AI summary from a
 * free Hugging Face model (if an HF_TOKEN script property is set) and emails the result.
 */

const STAGE_PROB = { 'Prospecting': 0.1, 'Discovery': 0.2, 'Solution Fit': 0.4, 'Proposal': 0.6, 'Negotiation': 0.8 };

/** Pure function: CRM rows in, WBR metrics out. Kept free of Sheets calls so it can be tested in Node. */
function computeWbr(opps, reps, todayIso) {
  const today = new Date(todayIso + 'T00:00:00Z');
  const q = Math.floor(today.getUTCMonth() / 3);
  const qStart = new Date(Date.UTC(today.getUTCFullYear(), q * 3, 1));
  const qEnd = new Date(Date.UTC(today.getUTCFullYear(), q * 3 + 3, 0));
  const d = s => new Date(s + 'T00:00:00Z');
  const daysSince = s => (today - d(s)) / 86400000;

  // Data quality first: duplicates, missing amounts, past close dates, stale deals.
  const seen = new Set();
  const dq = { duplicates: 0, missingAmount: 0, pastCloseDate: 0, stale30d: 0 };
  const clean = [];
  for (const o of opps) {
    const key = [o.account_id, o.owner_id, o.amount, o.created_date].join('|');
    if (seen.has(key)) { dq.duplicates++; continue; }
    seen.add(key);
    if (o.amount === '' || o.amount === null || o.amount === undefined) { dq.missingAmount++; continue; }
    const open = !String(o.stage).startsWith('Closed');
    if (open && d(o.close_date) < today) dq.pastCloseDate++;
    if (open && daysSince(o.last_activity_date) > 30) dq.stale30d++;
    clean.push({ ...o, amount: Number(o.amount), open });
  }

  const repById = Object.fromEntries(reps.map(r => [r.rep_id, r]));
  const seg = {};
  for (const r of reps) {
    seg[r.segment] = seg[r.segment] || { quota: 0, booked: 0, open: 0, commit: 0, weighted: 0 };
    seg[r.segment].quota += Number(r.quarterly_quota);
  }
  const bookedByRep = {};
  for (const o of clean) {
    const s = seg[(repById[o.owner_id] || {}).segment];
    if (!s) continue;
    const close = d(o.close_date);
    if (o.stage === 'Closed Won' && close >= qStart && close <= today) {
      s.booked += o.amount;
      bookedByRep[o.owner_id] = (bookedByRep[o.owner_id] || 0) + o.amount;
    } else if (o.open && close >= today && close <= qEnd) {
      s.open += o.amount;
      s.weighted += o.amount * (STAGE_PROB[o.stage] || 0);
      if (o.forecast_category === 'Commit') s.commit += o.amount;
    }
  }

  const segments = Object.entries(seg).map(([name, s]) => ({
    segment: name, quota: s.quota, booked_qtd: s.booked, remaining_quota: s.quota - s.booked,
    open_pipeline: s.open,
    coverage_x: s.quota - s.booked > 0 ? Math.round(100 * s.open / (s.quota - s.booked)) / 100 : null,
    forecast_commit: s.booked + s.commit, forecast_weighted: Math.round(s.booked + s.weighted),
  }));
  const repsAtRisk = reps
    .map(r => ({ rep: r.rep_name, segment: r.segment, attainment_pct: Math.round(1000 * (bookedByRep[r.rep_id] || 0) / r.quarterly_quota) / 10 }))
    .sort((a, b) => a.attainment_pct - b.attainment_pct).slice(0, 5);

  return { today: todayIso, quarter: [qStart.toISOString().slice(0, 10), qEnd.toISOString().slice(0, 10)], dataQuality: dq, segments, repsAtRisk };
}

function readTab_(name) {
  const values = SpreadsheetApp.getActive().getSheetByName(name).getDataRange().getValues();
  const head = values.shift();
  const fmt = v => v instanceof Date ? Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd') : v;
  return values.map(row => Object.fromEntries(head.map((h, i) => [h, fmt(row[i])])));
}

/** Ask a free open-source LLM on Hugging Face for a five-bullet summary (OpenAI-compatible chat API). */
const LLM_URL = 'https://router.huggingface.co/v1/chat/completions';
const LLM_MODEL = 'meta-llama/Llama-3.1-8B-Instruct:fastest';

function llmSummary_(wbr) {
  const token = PropertiesService.getScriptProperties().getProperty('HF_TOKEN');
  if (!token) return null;
  const res = UrlFetchApp.fetch(LLM_URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({
      model: LLM_MODEL, max_tokens: 800, temperature: 0.2,
      messages: [{ role: 'user', content:
        'You are a revenue operations analyst. Write exactly five bullets for the VP of Sales from this weekly ' +
        'business review data: where the quarter lands, the biggest risk, who needs attention, the data-quality fix ' +
        'to make first, and one recommendation. Use the numbers.\n\n' + JSON.stringify(wbr) }],
    }),
  });
  if (res.getResponseCode() !== 200) return null;
  const body = JSON.parse(res.getContentText());
  const text = body.choices && body.choices[0] && body.choices[0].message.content;
  return (text || '').trim() || null;
}

function buildWeeklyReview() {
  const todayIso = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  const wbr = computeWbr(readTab_('Opportunities'), readTab_('Reps'), todayIso);
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('WBR') || ss.insertSheet('WBR');
  sheet.clear();
  const rows = [['Weekly Business Review', wbr.today, 'Quarter ' + wbr.quarter.join(' to ')], [],
    ['Data quality', 'Records'], ...Object.entries(wbr.dataQuality), [],
    ['Segment', 'Quota', 'Booked QTD', 'Remaining', 'Open pipeline', 'Coverage (x)', 'Commit forecast', 'Weighted forecast'],
    ...wbr.segments.map(s => [s.segment, s.quota, s.booked_qtd, s.remaining_quota, s.open_pipeline, s.coverage_x, s.forecast_commit, s.forecast_weighted]),
    [], ['Reps most behind', 'Segment', 'Attainment %'], ...wbr.repsAtRisk.map(r => [r.rep, r.segment, r.attainment_pct])];
  const width = Math.max(...rows.map(r => r.length));
  sheet.getRange(1, 1, rows.length, width).setValues(rows.map(r => r.concat(Array(width - r.length).fill(''))));

  const summary = llmSummary_(wbr) ||
    wbr.segments.map(s => `- ${s.segment}: ${s.coverage_x}x coverage, commit forecast ${Math.round(s.forecast_commit)} vs quota ${s.quota}`).join('\n');
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Weekly Business Review ' + wbr.today, summary + '\n\nFull tables: ' + ss.getUrl());
}

function installWeeklyTrigger() {
  ScriptApp.newTrigger('buildWeeklyReview').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
}

if (typeof module !== 'undefined') module.exports = { computeWbr };
