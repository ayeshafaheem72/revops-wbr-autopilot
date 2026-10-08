const fs = require('fs'), path = require('path');
const P = process.argv[2] || path.join(__dirname, '..');
const src = fs.readFileSync(path.join(P, 'apps_script/WBR.gs'), 'utf8');
const m = { exports: {} }; new Function('module', src)(m);
const csv = f => { const [h, ...rows] = fs.readFileSync(path.join(P, 'data', f), 'utf8').trim().split(/\r?\n/).map(l => l.split(','));
  return rows.map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
console.log(JSON.stringify(m.exports.computeWbr(csv('opportunities.csv'), csv('reps.csv'), '2026-11-16'), null, 1));
