// Runs the two Code nodes from the exported workflow with a fake n8n context.
const fs = require('fs'), path = require('path');
const P = process.argv[2] || path.join(__dirname, '..');
const wf = JSON.parse(fs.readFileSync(path.join(P, 'n8n/wbr_workflow.json'), 'utf8'));
const code = n => wf.nodes.find(x => x.name === n).parameters.jsCode;
const csv = f => { const [h, ...rows] = fs.readFileSync(path.join(P, 'data', f), 'utf8').trim().split(/\r?\n/).map(l => l.split(','));
  return rows.map(r => ({ json: Object.fromEntries(h.map((k, i) => [k, r[i]])) })); };
const store = { 'Read Opportunities': csv('opportunities.csv'), 'Read Reps': csv('reps.csv') };
const $ = n => ({ all: () => store[n], first: () => store[n][0] });
const $now = { toFormat: () => '2026-11-16' };
const run = (src, input) => new Function('$', '$now', '$input', `return (async () => { ${src} })()`)($, $now, { first: () => ({ json: input }) });
(async () => {
  const [m] = await run(code('Compute WBR metrics'));
  store['Compute WBR metrics'] = [m];
  console.log('coverage', m.json.wbr.segments.map(s => s.segment + ' ' + s.coverage_x).join(', '), 'dq', JSON.stringify(m.json.wbr.dataQuality));
  console.log('request keys', Object.keys(m.json.request_body).join(','));
  const [fallback] = await run(code('Build email'), { error: { message: 'no key' } });
  console.log('--- fallback email ---\n' + fallback.json.subject + '\n' + fallback.json.body);
  const [ok] = await run(code('Build email'), { choices: [{ message: { role: 'assistant', content: '- bullet from the LLM' } }] });
  console.log('--- LLM email ---\n' + ok.json.body.split('\n').slice(0, 2).join('\n'), '...', ok.json.body.split('\n').pop());
})();
