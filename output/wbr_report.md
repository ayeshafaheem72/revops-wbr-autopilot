# Weekly Business Review: week ending 2026-11-16

Quarter: 2026-10-01 to 2026-12-31

## Executive summary
_Source: rule-based (no HF_TOKEN set)_

- Enterprise: 3.81x coverage on $6,435,200 remaining quota; commit forecast $11,958,500 vs quota $16,000,000.
- Mid-Market: 1.68x coverage on $3,029,300 remaining quota; commit forecast $2,331,900 vs quota $4,800,000.
- SMB: 1.62x coverage on $799,200 remaining quota; commit forecast $805,200 vs quota $1,440,000.
- Recommendation: build pipeline in Mid-Market, SMB (below the 3x coverage rule of thumb) before pushing late-stage deals.
- Data quality: fix 'Open deal with close date in the past' first (110 records). Owner to update close date or close out.

## Data quality (checked before any metric)
| issue | records | action |
|---|---|---|
| Open deal with close date in the past | 110 | Owner to update close date or close out |
| Open deal with no activity in 30+ days | 60 | Flag in rep 1:1s; likely forecast risk |
| Missing amount | 40 | Excluded from pipeline; owner to add amount |
| Duplicate opportunities | 15 | Excluded from all metrics; merge in CRM |

## Coverage and forecast by segment
| segment | quota | booked_qtd | remaining_quota | open_pipeline | coverage_x | forecast_commit | forecast_best_case | forecast_weighted |
|---|---|---|---|---|---|---|---|---|
| Enterprise | 16,000,000 | 9,564,800 | 6,435,200 | 24,545,300 | 3.81 | 11,958,500 | 14,449,100 | 17,205,650 |
| Mid-Market | 4,800,000 | 1,770,700 | 3,029,300 | 5,098,700 | 1.68 | 2,331,900 | 3,074,400 | 3,545,190 |
| SMB | 1,440,000 | 640,800 | 799,200 | 1,295,500 | 1.62 | 805,200 | 1,051,700 | 1,105,110 |

## Quota attainment, bottom 8 reps
| rep_id | rep_name | segment | territory | quarterly_quota | booked_qtd | attainment_pct | rank_in_segment | territory_attainment_pct |
|---|---|---|---|---|---|---|---|---|
| R024 | Usman Ahmed | Enterprise | Canada | 2,000,000 | 0 | 0.0 | 8 | 38.7 |
| R020 | Sara Rehman | Mid-Market | Canada | 600,000 | 75,600 | 12.6 | 8 | 38.7 |
| R011 | Grace Lopez | Mid-Market | East | 600,000 | 114,700 | 19.1 | 7 | 47.7 |
| R017 | Omar Iqbal | Mid-Market | West | 600,000 | 117,600 | 19.6 | 6 | 81.7 |
| R015 | Grace Lopez | Enterprise | East | 2,000,000 | 426,400 | 21.3 | 7 | 47.7 |
| R004 | Omar Ahmed | SMB | Canada | 180,000 | 44,700 | 24.8 | 8 | 38.7 |
| R001 | Daniel Ahmed | SMB | West | 180,000 | 50,900 | 28.3 | 7 | 81.7 |
| R023 | Hamza Ahmed | Mid-Market | East | 600,000 | 184,600 | 30.8 | 5 | 47.7 |

## Funnel conversion, trailing 12 months
| stage | deals | conversion_from_prev_pct | pct_of_top |
|---|---|---|---|
| Prospecting | 2727 |  | 100.0 |
| Discovery | 1911 | 70.1 | 70.1 |
| Solution Fit | 1210 | 63.3 | 44.4 |
| Proposal | 723 | 59.8 | 26.5 |
| Negotiation | 322 | 44.5 | 11.8 |

## Win rate by segment and lead source, trailing 12 months
| segment | lead_source | closed_deals | win_rate_pct | avg_won_deal |
|---|---|---|---|---|
| Enterprise | Event | 183 | 30.6 | 243,189 |
| Enterprise | Partner | 195 | 30.3 | 246,497 |
| Enterprise | Outbound | 186 | 29.0 | 235,702 |
| Enterprise | Inbound | 204 | 27.0 | 247,489 |
| Mid-Market | Partner | 206 | 33.5 | 56,114 |
| Mid-Market | Event | 192 | 32.3 | 56,074 |
| Mid-Market | Outbound | 207 | 29.0 | 52,992 |
| Mid-Market | Inbound | 203 | 24.6 | 52,500 |
| SMB | Outbound | 207 | 31.4 | 14,494 |
| SMB | Partner | 203 | 28.1 | 13,695 |
| SMB | Event | 222 | 27.9 | 15,098 |
| SMB | Inbound | 211 | 26.1 | 13,956 |

## New pipeline by week
| week_start | new_pipeline | wow_change_pct | moving_avg_4wk |
|---|---|---|---|
| 2026-08-24 | 3,383,100 |  | 3,383,100 |
| 2026-08-31 | 6,108,700 | 80.6 | 4,745,900 |
| 2026-09-07 | 4,641,700 | -24.0 | 4,711,167 |
| 2026-09-14 | 5,281,100 | 13.8 | 4,853,650 |
| 2026-09-21 | 4,374,600 | -17.2 | 5,101,525 |
| 2026-09-28 | 5,105,100 | 16.7 | 4,850,625 |
| 2026-10-05 | 5,649,300 | 10.7 | 5,102,525 |
| 2026-10-12 | 4,316,700 | -23.6 | 4,861,425 |
| 2026-10-19 | 4,685,900 | 8.6 | 4,939,250 |
| 2026-10-26 | 6,426,800 | 37.2 | 5,269,675 |
| 2026-11-02 | 5,859,300 | -8.8 | 5,322,175 |
| 2026-11-09 | 4,946,800 | -15.6 | 5,479,700 |
