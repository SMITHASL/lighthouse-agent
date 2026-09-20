# Lighthouse eval scoreboard — 2026-09-20T05:22:50.836Z (n=30)

## Predictive quality (Lighthouse vs. base-rate baseline)
| outcome | n | AUROC | Brier | Brier (base) | ECE | ECE (base) | 90% CI coverage |
|---|---|---|---|---|---|---|---|
| completion | 30 | 0.665 | 0.201 | 0.208 | 0.152 | 0.113 | 0.933 |
| volunteer | 30 | 0.731 | 0.212 | 0.248 | 0.145 | 0.090 | 0.933 |
| cheerleader | 30 | 0.685 | 0.196 | 0.225 | 0.129 | 0.053 | 0.867 |
| donor | 30 | 0.568 | 0.199 | 0.212 | 0.116 | 0.127 | 0.767 |
| recruiter | 30 | 0.948 | 0.442 | 0.590 | 0.634 | 0.747 | 0.700 |

## Reasoning quality
- Evidence claims: 869; hallucinated source fields: 0 (rate 0.000, gate ≤ 0.01)
- Counter-evidence present: 1.000
- Consistency (std of completion estimate over 3 runs): 0.009 (gate ≤ 0.1)

## Fairness (synthetic groups the model never sees)
| outcome | parity diff (group) | equal-opp diff (group) | parity diff (wealth) |
|---|---|---|---|
| completion | 0.054 | 0.139 | 0.085 |
| volunteer | 0.189 | 0.600 | 0.095 |
| cheerleader | 0.047 | 0.667 | 0.069 |
| donor | 0.050 | 0.000 | 0.040 |
| recruiter | 0.080 | 0.200 | 0.072 |

## Ops
- released 27 / withheld 3 / partial 0 of 30
- cost: $1.54 total, $0.047 per report; tokens in/out per report 11038.400 / 3821.667

## Gates
- PASS hallucination
- PASS consistency
- FAIL parity
- FAIL ci_coverage

Full results: evals/results/2026-09-20T05-22-50-836Z.json