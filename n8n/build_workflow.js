// Builds n8n/wbr_workflow.json, reusing computeWbr from WBR.gs so the two versions never drift.
const fs = require('fs'), path = require('path');
const P = process.argv[2] || path.join(__dirname, '..');
const gs = fs.readFileSync(path.join(P, 'apps_script/WBR.gs'), 'utf8');
const fnSrc = gs.slice(gs.indexOf('const STAGE_PROB'), gs.indexOf('function readTab_'));

const metricsCode = `// Same metric logic as apps_script/WBR.gs (data-quality checks first, then coverage and forecast).
${fnSrc.trim()}

const opps = $('Read Opportunities').all().map(i => i.json);
const reps = $('Read Reps').all().map(i => i.json);
const wbr = computeWbr(opps, reps, $now.toFormat('yyyy-MM-dd'));

const prompt = 'You are a revenue operations analyst. Write exactly five bullets for the VP of Sales from this weekly ' +
  'business review data: where the quarter lands, the biggest risk, who needs attention, the data-quality fix ' +
  'to make first, and one recommendation. Use the numbers.\\n\\n' + JSON.stringify(wbr);

return [{ json: { wbr, request_body: {
  model: 'meta-llama/Llama-3.1-8B-Instruct:fastest', max_tokens: 800, temperature: 0.2,
  messages: [{ role: 'user', content: prompt }],
} } }];`;

const summaryCode = `// Use the LLM summary if the call worked; otherwise send a rule-based one so the review still goes out.
const wbr = $('Compute WBR metrics').first().json.wbr;
const res = $input.first().json;
let text = '';
if (res && Array.isArray(res.choices) && res.choices[0] && res.choices[0].message) {
  text = String(res.choices[0].message.content || '').trim();
}
const source = text ? 'Hugging Face LLM' : 'rule-based fallback';
if (!text) {
  text = wbr.segments.map(s => \`- \${s.segment}: \${s.coverage_x}x coverage, commit forecast \${Math.round(s.forecast_commit)} vs quota \${s.quota}\`).join('\\n');
  const dq = Object.entries(wbr.dataQuality).sort((a, b) => b[1] - a[1])[0];
  text += \`\\n- Data quality: fix \${dq[0]} first (\${dq[1]} records).\`;
}
const table = wbr.segments.map(s => \`\${s.segment}: quota \${s.quota}, booked \${s.booked_qtd}, open \${s.open_pipeline}, coverage \${s.coverage_x}x\`).join('\\n');
return [{ json: { subject: 'Weekly Business Review ' + wbr.today, body: \`\${text}\\n\\n\${table}\\n\\nSummary source: \${source}\` } }];`;

const sheet = (name, tab, pos, extra = {}) => ({
  id: name.toLowerCase().replace(/ /g, '-'), name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: pos,
  parameters: {
    documentId: { __rl: true, mode: 'url', value: 'PASTE_YOUR_GOOGLE_SHEET_URL' },
    sheetName: { __rl: true, mode: 'name', value: tab }, options: {},
  },
  credentials: { googleSheetsOAuth2Api: { id: '', name: 'Google Sheets account' } }, ...extra,
});

const wf = {
  name: 'Weekly Business Review autopilot',
  nodes: [
    { id: 'schedule', name: 'Every Monday 8am', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 0],
      parameters: { rule: { interval: [{ field: 'weeks', triggerAtDay: [1], triggerAtHour: 8 }] } } },
    sheet('Read Opportunities', 'Opportunities', [220, 0]),
    sheet('Read Reps', 'Reps', [440, 0], { executeOnce: true }),
    { id: 'metrics', name: 'Compute WBR metrics', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 0],
      parameters: { jsCode: metricsCode } },
    { id: 'llm', name: 'LLM summary (Hugging Face)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [880, 0],
      onError: 'continueRegularOutput',
      parameters: {
        method: 'POST', url: 'https://router.huggingface.co/v1/chat/completions',
        authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
        sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.request_body) }}',
        options: { timeout: 120000 },
      },
      credentials: { httpHeaderAuth: { id: '', name: 'Hugging Face token (header Authorization: Bearer hf_...)' } } },
    { id: 'summary', name: 'Build email', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1100, 0],
      parameters: { jsCode: summaryCode } },
    { id: 'gmail', name: 'Email sales leadership', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [1320, 0],
      parameters: { sendTo: 'PASTE_RECIPIENT_EMAIL', subject: '={{ $json.subject }}', emailType: 'text', message: '={{ $json.body }}', options: {} },
      credentials: { gmailOAuth2: { id: '', name: 'Gmail account' } } },
  ],
  connections: {},
  settings: { executionOrder: 'v1' },
};
const order = wf.nodes.map(n => n.name);
for (let i = 0; i < order.length - 1; i++) wf.connections[order[i]] = { main: [[{ node: order[i + 1], type: 'main', index: 0 }]] };
fs.writeFileSync(path.join(P, 'n8n/wbr_workflow.json'), JSON.stringify(wf, null, 2) + '\n');
module.exports = { metricsCode, summaryCode };
