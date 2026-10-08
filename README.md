# Weekly Business Review Autopilot

Sales teams lose most of Monday morning building the weekly business review (WBR) by hand: export from the CRM, clean the sheet, recalculate coverage and forecast, then write the summary for leadership. This project automates the whole thing. It checks data quality before any number is reported, calculates the revenue KPIs, asks a free open-source LLM on Hugging Face for a five-bullet executive summary and emails it out.

The same logic ships in three forms, so it fits whatever stack a team already runs:

| Version | Where it runs | Good for |
|---|---|---|
| `src/` + `sql/` (Python + SQL) | Laptop, server or a scheduled job | Full analysis: funnel, win rate, weekly trend, CSV outputs |
| `apps_script/WBR.gs` | Inside Google Sheets | Teams that live in Sheets. Rebuilds a `WBR` tab every Monday at 8am and emails it |
| `n8n/wbr_workflow.json` | n8n (cloud or self-hosted) | No-code ops teams. Google Sheets → metrics → Hugging Face LLM → Gmail |

## What the review contains

1. **Data quality first.** Duplicates, missing amounts, open deals with a close date in the past, and deals with no activity in 30+ days. Duplicates and missing amounts are excluded from every metric, so they can't inflate pipeline.
2. **Coverage and forecast by segment.** Quota, booked quarter to date, remaining quota, open pipeline, coverage (x), and commit, best-case and weighted forecasts.
3. **Quota attainment by rep**, ranked within segment, with a territory roll-up.
4. **Funnel conversion** stage to stage over the trailing 12 months.
5. **Win rate and average deal size** by segment and lead source.
6. **New pipeline by week**, with week-over-week change and a 4-week moving average.
7. **Executive summary** from an open-source LLM (Llama 3.1 8B through Hugging Face by default): where the quarter lands, the biggest risk, who needs attention, which data fix comes first, and one recommendation. If the token is missing or the call fails, a rule-based summary goes out instead, so the review always ships.

The SQL uses CTEs and window functions throughout (`ROW_NUMBER` for de-duplication, `RANK` within segment, `SUM() OVER` for territory roll-ups, `LAG` and `FIRST_VALUE` for the funnel, a `ROWS BETWEEN` moving average for the trend).

## Sample output (week ending 16 Nov 2026)

From `output/wbr_report.md`, run on the included sample data:

| Segment | Quota | Booked QTD | Open pipeline | Coverage | Commit forecast |
|---|---|---|---|---|---|
| Enterprise | 16,000,000 | 9,564,800 | 24,545,300 | 3.81x | 11,958,500 |
| Mid-Market | 4,800,000 | 1,770,700 | 5,098,700 | 1.68x | 2,331,900 |
| SMB | 1,440,000 | 640,800 | 1,295,500 | 1.62x | 805,200 |

Data-quality checks caught 110 open deals with past close dates, 60 stale deals, 40 missing amounts and 15 duplicates before any KPI was calculated. Mid-Market and SMB sit below the 3x coverage rule of thumb, so the review flags them for pipeline generation.

## Run it

**Python + SQL**
```bash
# no pip install needed: standard library only
python src/generate_data.py          # creates data/*.csv (sample Salesforce-style export)
export HF_TOKEN=hf_...                # optional, free; without it you get the rule-based summary
python src/run_wbr.py --today 2026-11-16
```
Results land in `output/` (one CSV per query plus `wbr_report.md`).

**Google Sheets (Apps Script)**
1. Create a sheet with two tabs, `Opportunities` and `Reps`, and paste in `data/opportunities.csv` and `data/reps.csv` (or your own CRM export with the same columns).
2. Extensions → Apps Script, paste `apps_script/WBR.gs`.
3. Optional: Project Settings → Script properties → add `HF_TOKEN` (a free Hugging Face token).
4. Run `buildWeeklyReview` once to test, then `installWeeklyTrigger` to schedule it for Mondays at 8am.

**n8n**
1. Workflows → Import from file → `n8n/wbr_workflow.json`.
2. Set the Google Sheet URL on both Sheets nodes and the recipient on the Gmail node.
3. Add credentials: Google Sheets, Gmail, and a Header Auth credential with name `Authorization` and value `Bearer hf_...` (your free Hugging Face token).
4. Activate. It runs every Monday at 8am.

The metric code in the n8n Code node is generated from `WBR.gs` by `n8n/build_workflow.js`, so the two versions can't drift apart.

**Zapier alternative.** The same flow works as a Zap: Schedule by Zapier (weekly) → Google Sheets (lookup rows) → Code by Zapier (paste `computeWbr` from `WBR.gs`) → Webhooks by Zapier (POST to the Hugging Face chat API) → Gmail (send email).

## Tests

```bash
node tests/test_apps_script.js      # runs computeWbr from WBR.gs on the sample data
node tests/test_n8n_code_nodes.js   # runs both n8n Code nodes, including the fallback path
```
Both reproduce the Python/SQL numbers exactly (coverage 3.81x / 1.68x / 1.62x, the same data-quality counts).

## Project layout

```
data/          sample CRM export (reps, accounts, 3,215 opportunities with seeded data issues)
sql/wbr.sql    all WBR queries, data-quality checks first
src/           data generator and the Python runner (SQLite + Hugging Face LLM)
apps_script/   Google Sheets version
n8n/           importable n8n workflow and the script that builds it
tests/         Node checks for the Apps Script and n8n logic
output/        results from the last run
```

## Notes

- The data is synthetic. Field names follow a standard Salesforce opportunity export, so a real export drops in with little or no mapping.
- **Cost: free.** The summary uses Hugging Face Inference Providers, whose free tier easily covers one short call a week. Get a token at huggingface.co/settings/tokens with the "Make calls to Inference Providers" permission.
- **Any free model works.** The endpoint is OpenAI-compatible, so set `LLM_MODEL` to another model (for example `Qwen/Qwen2.5-7B-Instruct:fastest`), or point `LLM_BASE_URL` at a local Ollama server (`http://localhost:11434/v1`, `LLM_MODEL=llama3.1`) to run fully offline with no token.
