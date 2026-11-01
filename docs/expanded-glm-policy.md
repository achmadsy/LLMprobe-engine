# Expanded GLM policy and orchestration status

This is local implementation work, not a claim of BazaarLink web-app parity or independently verified accuracy. No new live collection is performed by the evaluation command.

## Current local runtime (2026-11-01)

At the user's request there is no opt-in switch. New/full runs on the five supported GLM selectors automatically sample up to 51 answers; retry/rejudge reuse saved evidence. `glm-distribution-assessment.ts` uses equal-mass weighting plus the fixed shared standard/strong-pass gates, requires all nine prompt groups/51 slots and corroborating observed family confidence >=.65, and blocks conflicting creator evidence. It preserves original source masses and digest separately from transformed weights. It reports a **likely/provisional** model result, never verified authenticity, and never uses the claim to choose a candidate. Summary and detail share that persisted qualified verdict.

The historical investigation below remains useful evidence, not a claim that this method completed independent accuracy calibration. The offline release evaluator's proposed gates do not disable private qualified estimates. No original V3H policy is registered for five models and no historical accuracy guarantee is transferred. No additional provider calls were made to implement the runtime integration. See `glm53-calibration-results.md` for the current operational contract.

## Frozen candidate policy

`expanded-glm-policy.ts` records the five GLM candidates and inherited diagnostic thresholds. Thresholds remain unchanged after inspection of final holdouts. It does not register the candidate set in `V3H_ACTIVE_PROMPT_POLICIES`, so it cannot inherit strong-pass behavior or historical three-model accuracy claims.

The offline `evaluate-policy` command adds explicit **locally proposed** release criteria. These are engineering defaults, not statistically guaranteed sufficiency or published BazaarLink requirements:

- Fresh, protocol-compatible references for all five siblings.
- At least 60 independent run-sized evaluation batches per sibling.
- At least 90% accepted-correct recall and a 95% Wilson lower bound >=90% on correct decisions, counting abstention as non-success.
- No observed wrong sibling decisions.
- At least three distinct out-of-family model families, with at least 75 independent 51-answer batches per control model.
- Per-control-model false-accept 95% Wilson upper bound <=5%. At 75 trials with zero false accepts, that upper bound is below 5%; 60 would not suffice under this two-sided interval.
- Provenance, cohort comparability and robustness review. This final gate is intentionally not automatically approved by input metadata.

Confidence intervals assume independent trials; sequential grouped prompts and routing/account shifts can violate this. Passing numeric criteria does not remove provenance or model-drift limitations. No automated output activates a policy.

## Evaluate saved data

```bash
node dist/bias-calibration-cli.js evaluate-policy \
  --references /PRIVATE/glm-5.3-reference.json /PRIVATE/glm-5.3-flash-reference.json \
  --holdouts /PRIVATE/glm-5.3-validation.json /PRIVATE/glm-5.3-flash-validation.json \
  --output /PRIVATE/expanded-policy-evaluation.json
```

Optionally supply independent control files using `--controls <files...>`. These require the same sampling protocol hash, unique collection IDs, known model provenance, explicit non-synthetic origin, and full disjoint 51-answer batches (day x3, eight other prompts x6). Synthetic unit fixtures are never accepted as real controls by the evaluation workflow; a caller can still lie in JSON, so provenance review remains mandatory. Control output should contain normalized answers only, not credentials or unreviewed upstream payloads.

Current collection has eight batches for each new model and none for the three older siblings. GLM-5.3 accepted 4/8, abstained 4/8; Flash accepted 8/8. All batches ranked their expected model first, with zero wrong accepted results. This is an initial separation experiment, not a completed expanded-policy calibration.

The existing 1,980-successful-call budget is exhausted. Further independent controls require separate explicit authorization and available trusted model routes. The proposed full gate matrix can be substantially more expensive than the initial experiment; do not start it automatically, imply it is covered by the earlier budget, or promise that collecting it will resolve 5.3 abstentions. Better discriminatory prompts or a separately developed/calibrated policy may be necessary.

## Local orchestration guards

`identity-orchestration.ts` adds:

1. Creator assertions from fixed creator/self-knowledge probes. Only explicit maker assertions are considered; negated, hypothetical, quoted and multi-maker assertions are ignored.
2. A creator-family override requires at least two supporting prompts, at least one Chinese creator probe, no competing creator assertion, and behavioral family support >=0.4. A claimed route/model selector is never evidence. These are conservative local heuristics, not a reproduced SaaS rule or calibrated probability. Model text can imitate them.
3. Cluster-fit diagnostics require every candidate's baseline to cover every observed prompt. Historical policies that score fewer observations are excluded, preventing comparison of incompatible average likelihoods. The comparison is diagnostic only and cannot overturn a verdict.
4. A stored decision-path trace for coverage, family, submodel arbitration, experimental twin recheck and claim comparison. It uses local stage names, not fabricated SaaS branch IDs.

The existing V3/V3E/F/V4 public components remain diagnostic. IKP factual-reference corpus, exact Chinese SaaS contradiction logic, native empty-refusal corroboration and calibrated claim-first cross-cluster arbitration are not yet reproduced. The public-component diagnostics remain separate; the qualified GLM distribution result now supplies the primary provisional model verdict when its coverage, family and scoring gates pass.

## Reference-only development investigation

`develop-policy --references <files...>` rejects validation-purpose artifacts. It deterministically partitions each reference prompt into two disjoint halves and evaluates each half against the other, while keeping older bundled sibling references unchanged. Every answer is excluded from its fold's training distribution; the two folds are nevertheless dependent because they swap source observations, so their aggregate is NOT an independent accuracy test.

The saved new-model references yielded ten development batches/model:

- GLM-5.3 fixed gates: 2 accepted-correct, 8 abstentions, 0 wrong. A historical strong-pass-shaped *development hypothesis*: 10 accepted-correct, 0 abstentions, 0 wrong.
- Flash: 10 accepted-correct under both variants.
- GLM-5.3 won dwarf/city/number prompts in all ten batches, but lost individual gemstone/month/bird/element comparisons to older siblings. Aggregated likelihood can therefore favor 5.3 while the single-winner prompt vote margin remains small.

**Important confound:** old sibling references have 200 observations/prompt; the new references have 60, and the twofold training halves only 30. The scorer's fixed additive smoothing shrinks smaller reference distributions more strongly. Unequal training mass and unrecorded older request settings can bias individual prompt comparisons. This experiment cannot isolate genuine model similarity from those effects and does not justify removing the vote-margin gate.

The report records per-prompt reference mass, source collection IDs, deterministic partition seed, per-prompt winners and limitations. It never activates a policy or applies a newly selected rule to the already-viewed validation set as though it were untouched. Further development should compare sample-mass-aware scoring alternatives on development-only data and use untouched empirical evaluation/controls before promotion. No recollection was performed.

## Equal-mass scoring experiment

`reference-mass-normalization.ts` was initially development-only and is now reused by the qualified runtime path described above. For each prompt it reweights each model's answer counts to the smallest reference mass among candidates, preserving answer proportions. It does not add observations or claim the references have the same statistical certainty. The transformed weights intentionally omit empirical sample-count/freshness metadata to prevent treating them as new provenance-bearing runtime baselines.

In the twofold experiment, every training distribution has effective mass 30 after normalization. Using the exact same provisional gates:

| Model | Original accepted / abstained / wrong | Equal-mass accepted / abstained / wrong |
| --- | --- | --- |
| GLM-5.3 | 2 / 8 / 0 | 10 / 0 / 0 |
| GLM-5.3-Flash | 10 / 0 / 0 | 10 / 0 / 0 |

GLM-5.3 prompt vote margins changed to 7–9 in these development batches. This establishes that changing reference mass while holding the observed answers and gates fixed materially changes this experiment. It does NOT isolate vendor/model differences, prove independent accuracy, validate older-sibling behavior, or establish the normalization as a safe runtime policy. Missing-answer frequencies, unequal empirical certainty, absent independent controls, and unknown older collection settings remain limitations.

A proportional-frequency invariance test verifies that identical distributions with n=200 and n=60 receive identical scores after normalization. Tests also verify no source mutation, no runtime provenance carryover, and rejection of invalid counts. No runtime scorer, V3H policy registration, or final-validation result was changed. The saved report is `reference-policy-mass-normalized.json` in the private collection directory.

## Controlled three-versus-five candidate comparison

The first reverse-direction report accidentally compared the registered three-model policy (which can strong-pass) with the unregistered five-model set (which cannot). Its 10/10 -> 3/10 GLM-5 comparison confounded candidate addition with policy membership. `glm-controlled-comparison.ts` now computes raw likelihood evidence without automatic policy selection and applies identical predicates to both candidate sets, keeping standard-only and shared-strong-pass outcomes separate. Every paired comparison uses identical observation hashes, effective reference mass=30, and sample count=51. It does not register the five-model set or claim historical validation transfers to it.

| Expected model | Standard-only, 3 candidates | Standard-only, 5 candidates | Shared historical strong-pass, 3 candidates | Same strong-pass predicate, 5 candidates |
| --- | ---: | ---: | ---: | ---: |
| GLM-5 | 8/10 | 3/10 | 10/10 | 10/10 |
| GLM-5.1 | 10/10 | 9/10 | 10/10 | 10/10 |
| GLM-5.2 | 7/10 | 7/10 | 10/10 | 10/10 |
| GLM-5.3 | Not included | 10/10 | Not included | 10/10 |
| GLM-5.3-Flash | Not included | 10/10 | Not included | 10/10 |

All accepted decisions in this reconstructed-data sanity check were correct. Adding new candidates changes individual prompt votes, decreasing standard-only acceptance for GLM-5 and 5.1, but does not change any older-model top ranking or top-vs-runner likelihood gap. The three-model strong-pass rule already waives prompt-vote disagreement on decisive aggregate evidence; the hypothetical equal-rule five-model comparison recovers those decisions without lowering confidence, gap, fit or sample floors.

This isolates two effects: a real vote-based sensitivity to added candidates and a misleading comparison caused by different policy paths. It is NOT proof the hypothetical five-model strong-pass policy is safe on fresh models, out-of-family impostors, missing observations, or current wrapper/proxy cohorts. It remains development-only, and the original deployed scorer is unchanged. Historical final holdouts were not rerun or used to select thresholds in this comparison.

Report: `five-way-controlled-rules.json` in the private collection directory. Tests cover threshold boundary equivalence to the original strong-pass helper, paired observation equality, preservation of sample floors, deterministic known-reference outcomes, and no runtime registration.

## Verification

Final engine tests/build rerun with the controlled comparison; no further provider calls, policy activation, commit, push or deployment.
