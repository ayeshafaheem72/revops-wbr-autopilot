-- Weekly Business Review queries.
-- Parameters: :today (review date), :q_start, :q_end (current quarter).
-- Each block starts with "-- name: <key>"; src/run_wbr.py runs them in order.
-- Every metric reads from clean_opps, so duplicates and bad rows never reach a KPI.

-- name: clean_opps
-- Deduplicate (same account, owner, amount, created date) and keep a flag per issue.
CREATE TEMP VIEW clean_opps AS
WITH ranked AS (
  SELECT o.*,
         ROW_NUMBER() OVER (
           PARTITION BY account_id, owner_id, amount, created_date
           ORDER BY opportunity_id
         ) AS dup_rank
  FROM opportunities o
)
SELECT r.*,
       CASE WHEN stage IN ('Closed Won', 'Closed Lost') THEN 1 ELSE 0 END AS is_closed,
       CASE WHEN stage = 'Closed Won' THEN 1 ELSE 0 END AS is_won,
       CASE stage WHEN 'Prospecting' THEN 0.10 WHEN 'Discovery' THEN 0.20
                  WHEN 'Solution Fit' THEN 0.40 WHEN 'Proposal' THEN 0.60
                  WHEN 'Negotiation' THEN 0.80 WHEN 'Closed Won' THEN 1.0 ELSE 0 END AS stage_probability
FROM ranked r
WHERE dup_rank = 1 AND amount IS NOT NULL;

-- name: data_quality
-- What would make this week's numbers wrong, counted before anyone reads them.
WITH dq AS (
  SELECT 'Duplicate opportunities' AS issue,
         (SELECT COUNT(*) FROM (
            SELECT ROW_NUMBER() OVER (PARTITION BY account_id, owner_id, amount, created_date
                                      ORDER BY opportunity_id) AS rn
            FROM opportunities) WHERE rn > 1) AS records,
         'Excluded from all metrics; merge in CRM' AS action
  UNION ALL
  SELECT 'Missing amount',
         (SELECT COUNT(*) FROM opportunities WHERE amount IS NULL),
         'Excluded from pipeline; owner to add amount'
  UNION ALL
  SELECT 'Open deal with close date in the past',
         (SELECT COUNT(*) FROM clean_opps WHERE is_closed = 0 AND close_date < :today),
         'Owner to update close date or close out'
  UNION ALL
  SELECT 'Open deal with no activity in 30+ days',
         (SELECT COUNT(*) FROM clean_opps
           WHERE is_closed = 0 AND julianday(:today) - julianday(last_activity_date) > 30),
         'Flag in rep 1:1s; likely forecast risk'
)
SELECT * FROM dq ORDER BY records DESC;

-- name: quota_attainment
-- QTD bookings vs quota per rep, ranked within segment, with territory roll-up.
WITH bookings AS (
  SELECT owner_id, SUM(amount) AS booked
  FROM clean_opps
  WHERE is_won = 1 AND close_date BETWEEN :q_start AND :today
  GROUP BY owner_id
)
SELECT r.rep_id, r.rep_name, r.segment, r.territory, r.quarterly_quota,
       COALESCE(b.booked, 0) AS booked_qtd,
       ROUND(100.0 * COALESCE(b.booked, 0) / r.quarterly_quota, 1) AS attainment_pct,
       RANK() OVER (PARTITION BY r.segment ORDER BY COALESCE(b.booked, 0) * 1.0 / r.quarterly_quota DESC) AS rank_in_segment,
       ROUND(100.0 * SUM(COALESCE(b.booked, 0)) OVER (PARTITION BY r.territory)
             / SUM(r.quarterly_quota) OVER (PARTITION BY r.territory), 1) AS territory_attainment_pct
FROM reps r
LEFT JOIN bookings b ON b.owner_id = r.rep_id
ORDER BY r.segment, rank_in_segment;

-- name: coverage_forecast
-- Pipeline coverage and forecast for the rest of the quarter, by segment.
WITH quota AS (
  SELECT segment, SUM(quarterly_quota) AS quota FROM reps GROUP BY segment
),
booked AS (
  SELECT r.segment, SUM(o.amount) AS booked
  FROM clean_opps o JOIN reps r ON r.rep_id = o.owner_id
  WHERE o.is_won = 1 AND o.close_date BETWEEN :q_start AND :today
  GROUP BY r.segment
),
open_q AS (
  SELECT r.segment,
         SUM(o.amount) AS open_pipeline,
         SUM(CASE WHEN o.forecast_category = 'Commit' THEN o.amount ELSE 0 END) AS commit_amt,
         SUM(CASE WHEN o.forecast_category = 'Best Case' THEN o.amount ELSE 0 END) AS best_case_amt,
         SUM(o.amount * o.stage_probability) AS weighted_pipeline
  FROM clean_opps o JOIN reps r ON r.rep_id = o.owner_id
  WHERE o.is_closed = 0 AND o.close_date BETWEEN :today AND :q_end
  GROUP BY r.segment
)
SELECT q.segment, q.quota,
       COALESCE(b.booked, 0) AS booked_qtd,
       q.quota - COALESCE(b.booked, 0) AS remaining_quota,
       COALESCE(p.open_pipeline, 0) AS open_pipeline,
       ROUND(COALESCE(p.open_pipeline, 0) / NULLIF(q.quota - COALESCE(b.booked, 0), 0), 2) AS coverage_x,
       ROUND(COALESCE(b.booked, 0) + COALESCE(p.commit_amt, 0)) AS forecast_commit,
       ROUND(COALESCE(b.booked, 0) + COALESCE(p.commit_amt, 0) + COALESCE(p.best_case_amt, 0)) AS forecast_best_case,
       ROUND(COALESCE(b.booked, 0) + COALESCE(p.weighted_pipeline, 0)) AS forecast_weighted
FROM quota q
LEFT JOIN booked b ON b.segment = q.segment
LEFT JOIN open_q p ON p.segment = q.segment
ORDER BY q.quota DESC;

-- name: funnel
-- Stage-to-stage conversion over the trailing four quarters, using LAG.
WITH stage_order(stage, n) AS (
  VALUES ('Prospecting', 1), ('Discovery', 2), ('Solution Fit', 3), ('Proposal', 4), ('Negotiation', 5)
),
reached AS (
  SELECT s.stage, s.n,
         (SELECT COUNT(*) FROM clean_opps o JOIN stage_order s2 ON s2.stage = o.max_stage_reached
           WHERE s2.n >= s.n AND o.created_date >= date(:today, '-12 months')) AS deals
  FROM stage_order s
)
SELECT stage, deals,
       ROUND(100.0 * deals / LAG(deals) OVER (ORDER BY n), 1) AS conversion_from_prev_pct,
       ROUND(100.0 * deals / FIRST_VALUE(deals) OVER (ORDER BY n), 1) AS pct_of_top
FROM reached ORDER BY n;

-- name: win_rate
-- Win rate and average deal size by segment and lead source, trailing four quarters.
SELECT r.segment, o.lead_source,
       COUNT(*) AS closed_deals,
       ROUND(100.0 * SUM(o.is_won) / COUNT(*), 1) AS win_rate_pct,
       ROUND(AVG(CASE WHEN o.is_won = 1 THEN o.amount END)) AS avg_won_deal
FROM clean_opps o JOIN reps r ON r.rep_id = o.owner_id
WHERE o.is_closed = 1 AND o.close_date >= date(:today, '-12 months')
GROUP BY r.segment, o.lead_source
ORDER BY r.segment, win_rate_pct DESC;

-- name: pipeline_trend
-- New pipeline created per week, week-over-week change and 4-week moving average.
WITH weekly AS (
  SELECT date(created_date, '-6 days', 'weekday 1') AS week_start, SUM(amount) AS new_pipeline
  FROM clean_opps
  WHERE created_date >= date(:today, '-84 days') AND created_date < :today
  GROUP BY week_start
)
SELECT week_start, ROUND(new_pipeline) AS new_pipeline,
       ROUND(100.0 * (new_pipeline - LAG(new_pipeline) OVER (ORDER BY week_start))
             / LAG(new_pipeline) OVER (ORDER BY week_start), 1) AS wow_change_pct,
       ROUND(AVG(new_pipeline) OVER (ORDER BY week_start ROWS BETWEEN 3 PRECEDING AND CURRENT ROW)) AS moving_avg_4wk
FROM weekly ORDER BY week_start;
