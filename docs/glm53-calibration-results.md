# GLM-5.3 / GLM-5.3-Flash initial calibration results

Collection completed 2026-11-01. The local runtime now uses this pack for qualified five-model estimates; it is not an independently validated authenticity detector. The offline results below describe the original raw-count comparison, not the later equal-mass runtime method.

## Collection

| Canonical model | Reference | Separate validation |
| --- | ---: | ---: |
| z-ai/glm-5.3 | 540 | 450 |
| z-ai/glm-5.3-flash | 540 | 450 |

Exactly 1,980 successful observations were saved. The request journal contains 80 HTTP 429 results, two HTTP 405 results, and two unknown-outcome attempts acknowledged for separate replacement; these do not count as successful observations. Two additional failed 405 diagnostic calls are saved outside the journal. Two successful diagnostic calls were imported into validation rather than repeated. Successful collection slots were not intentionally recollected.

References: nine GLM discriminator prompts, 60 observations each. Validation: independent calls, 50 observations each. Settings: temperature 1, max_tokens 128, stream false, one user message. Validation split into eight disjoint 51-observation batches per model (day x3 and eight other prompts x6), leaving unused held-out residue. No validation observation contributes to reference counts.

These are **9Router GLM Start Plan route** observations, not guaranteed bare-inference fingerprints. The route injects ZCode system content and default thinking. Reference collection did not record per-call proxy/account provenance. Validation resumed after a user-reported proxy change to decode5. Two separately saved validation diagnostics have explicit direct/decode5 labels; their input usage differed (3380 vs 2036). The route-specific/unknown-cohort limitation must accompany any use of this pack.

## Offline comparison

Candidate set: bundled GLM-5 / GLM-5.1 / GLM-5.2 plus the two newly collected reference distributions.

| Expected model | Batches | Expected model ranked first | Gate accepted | Abstained | Wrong accepted |
| --- | ---: | ---: | ---: | ---: | ---: |
| GLM-5.3 | 8 | 8 | 4 | 4 | 0 |
| GLM-5.3-Flash | 8 | 8 | 8 | 0 | 0 |

Inherited gates used only as provisional diagnostics: confidence >= .94, log-likelihood gap >= 2.5, per-prompt vote margin >=3, average log likelihood >= -3.2. Thresholds were not adjusted after viewing validation.

GLM-5.3 vote margins: 3, 3, 2, 4, 2, 3, 2, 0. Its four abstentions are explained by the vote-margin gate, despite all top-ranked models being GLM-5.3. GLM-5.3-Flash margins: 4, 3, 6, 6, 6, 6, 6, 6.

The expanded candidate set has `policyId: null` and `strongPass: false`: no existing validated policy matches all five model IDs. This correctly prevents inheriting the old three-model policy's strong-pass exemption and accuracy claim. Do not enable one merely to remove the observed abstentions.

No fresh older-sibling holdouts, independently collected out-of-family controls, or wrapper/noise robustness evaluation were performed. Eight batches/model cannot establish a high accuracy bound. Conditional posteriors near one are not probabilities of real-world identity correctness. No provider calls beyond this completed initial experiment are automatically authorized by this report.

## Private artifacts

Stored outside the repository at `/home/ubuntu/.9router/calibration/glm53-2026-11-01/`:

- `glm-5.3-reference.json`
- `glm-5.3-flash-reference.json`
- `glm-5.3-validation.json`
- `glm-5.3-flash-validation.json`
- `calls.jsonl`, `session.json`, separate diagnostic records
- `diagnostics.json`, `offline-audit.json`

SHA-256 for the four completed artifacts:

- GLM-5.3 reference: `78d78a973dc9670fd27a65bb52fac946960f58024fa1b9212c6dcde9fbeca2f4`
- Flash reference: `f0b5cf89e554cb36dd755f7b21fe03a352553877528001e4f362c89e3a4ed80c`
- GLM-5.3 validation: `a2b828a8f5d2fc112bf47a3390420d8b153ad6c0742cc1fde096c4c6f053c530`
- Flash validation: `99b76afa0ab77833a24ae7c7ea8ffcb2f568fb7bc5ff285d67cad98752b0192f`

Reported successful-call usage: 4,042,232 input tokens and 22,417 completion tokens. This is reported usage, not verified billing or a money estimate, and excludes failed/unknown-attempt billing.

## State

All four artifacts passed structural/count validation. Local integration bundles the credential-free reference pack and computes V2, family-fusion, V3 scoped/global, V3E/F and V4 diagnostics. Chinese contradiction-guard parity, IKP corpus, independent controls and expanded-policy calibration remain missing.

New/full runs targeting GLM-5, 5.1, 5.2, 5.3 or 5.3-Flash automatically include up to 51 sequential distribution requests; there is no opt-in checkbox. Sampling uses the existing safe-fetch egress path and target headers, no transport retries, and stops after the first failed slot. Saved evidence is bounded, credential-echo checked and bound to the target selector. Retry and rejudge reuse it without sampling, even if evidence is partial or absent; only a full rerun collects new evidence. Progress events keep the persisted run live during sampling. The gateway requires the `glm-distribution-v1` sidecar capability before starting an applicable run. Standalone selected-task calls do not add sampling implicitly.

The runtime uses common-minimum reference weighting (retaining the original masses/digest separately) and the same fixed standard/strong-pass predicates for all five candidates. An estimate requires every one of the 51 answers, family confidence >=.65 from observed evidence, no conflicting creator assertions, and acceptance gates. The claim is compared only after scoring and never selects a winner. Qualifying results use `likely_match`, `likely_submodel_mismatch`, or `model_estimate`, not `clean_match`/verified authenticity. Missing/partial/conflicting evidence remains unconfirmed. Both dashboard cards consume the same persisted verdict and omit misleading percentage confidence for these estimates. The original three-model registry policy and its historical accuracy claims are not extended.

Verification: the full engine suite passed 665 tests across 54 files and focused gateway contract/persistence tests passed 59 tests across four files during this iteration. Final build/lint verification is recorded in the delivery report. UI has not been browser-verified. No further provider calls, commits, pushes or deployment occurred during integration. All changes remain local.

Security: existing gateway-scoped key used only in memory. No keys created, rotated, printed, or saved. Reference artifacts contain compact normalized observations and provenance; keep private pending review. Known Aliyun security-block responses were not counted as model observations. No proxy settings were changed by the collector.
