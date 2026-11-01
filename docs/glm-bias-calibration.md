# GLM-5.3 / GLM-5.3-Flash distribution references

This operator tool collects **new answer-frequency data**, using the same nine discriminator prompts as the bundled GLM-5/5.1/5.2 cluster. It does not copy GLM-5.2's frequencies, infer labels from a target's model claim, or enable new models in the runtime classifier.

All output artifacts are **drafts**. Independent policy calibration, cross-family controls, and runner integration are still required before exact-model coverage is enabled.

## Build and preview — no model calls

```bash
npm run build
npm run calibrate:bias -- collect --model z-ai/glm-5.3 --purpose reference
npm run calibrate:bias -- collect --model z-ai/glm-5.3-flash --purpose reference
npm run calibrate:bias -- collect --model z-ai/glm-5.3 --purpose validation
```

Dry-run is the default. Only `--execute` sends requests.

| Collection | Per prompt | Prompts | Requests/model |
| --- | ---: | ---: | ---: |
| Reference | 60 | 9 | 540 |
| Separate validation | 50 | 9 | 450 |
| Total | | | 990 |

Both new models: **1,980 requests** for this initial experiment. This excludes refreshed older sibling references, sibling holdouts, out-of-family controls, and repeated relay/noise tests. It is NOT a calibrated accuracy guarantee.

Output cap defaults to 128 tokens/request: the two-model experiment allows up to 253,440 completion tokens under the request cap, plus input tokens. Actual billing, reasoning tokens, and support for the cap depend on the endpoint. No automatic retry multiplier is present. Preview with the exact intended settings before agreeing a budget.

## Explicit execution

Do not run these examples until endpoint provenance, sampling settings, and spend have been approved. Use an actual trusted official inference base and verified account model selectors, not a multi-model fallback combo. The canonical artifact identities are `z-ai/glm-5.3` and `z-ai/glm-5.3-flash`; `--request-model` can select a different documented upstream route without changing those identities.

Supply the credential through `PROBE_CALIBRATION_API_KEY` (or choose another variable with `--api-key-env`). Do not put a key in command history or commit artifacts containing credentials.

```bash
# Examples only. Requires a credential already present in the environment.
npm run calibrate:bias -- collect \
  --model z-ai/glm-5.3 --purpose reference \
  --base-url https://OFFICIAL-API.example/v1 \
  --output /PRIVATE-DIRECTORY/glm53-reference.json \
  --max-requests 540 --execute

# Start a NEW collection after reference collection finishes.
npm run calibrate:bias -- collect \
  --model z-ai/glm-5.3 --purpose validation \
  --base-url https://OFFICIAL-API.example/v1 \
  --output /PRIVATE-DIRECTORY/glm53-validation.json \
  --max-requests 450 --execute
```

Repeat for `z-ai/glm-5.3-flash`, with separate output paths. No directories are created automatically; output files must be new. Files are reserved with exclusive creation and mode 0600 before any billable call. On fatal error/cancellation the reserved file can remain empty; it is not a usable artifact. Long collection jobs should use an operator-controlled foreground process. Do not start a duplicate collection if an earlier process is still running.

## Sampling contract and safety

- Nine prompts from the existing GLM policy; collect the same chosen sample count for each prompt.
- One user message, no system prompt, `temperature: 1`, `stream: false`, explicit `max_tokens`. No seed and no extra provider-specific reasoning settings.
- The original bundled GLM references do not fully document their request settings. Reusing their shape is not proof that the new data is comparable. Refresh sibling references with the same protocol before final calibration.
- Default 128-token cap may be insufficient for reasoning-enabled routes. Truncated answers are failures, not samples. If settings need adjustment, recollect reference and validation with the SAME settings; the protocol hash rejects mismatches.
- Requests run sequentially, with no retries, and per-call timeout. HTTP 400/401/403/404 stops collection immediately; other failed slots are counted, not substituted with empty answers.
- A successful empty string is stored as the classifier's `(blank)` observation. HTTP errors, invalid shapes, credential echoes, oversized bodies, and length-truncated outputs are not treated as blank observations.
- Explicit max-request budget is mandatory for execution. Budgets smaller than the plan are rejected before network access.
- HTTPS only; URL credentials/query/fragment and redirects are rejected. This is an operator CLI for an explicitly trusted endpoint, not a remotely exposed fetch API. Existing sidecar SSRF rules are unchanged.
- Raw answers, provider error bodies, response headers, API keys, and returned model claims are not persisted. Artifacts contain compact normalized tokens, counts, endpoint provenance, settings, timestamps, and available token usage. Treat them as private until reviewed.
- Collection ID, independent time windows, purpose, counts, and protocol compatibility are checked. Metadata is operator-supplied provenance, not cryptographic proof of model identity. Never relabel or recycle test answers as an independent reference.

## Held-out diagnostics — entirely offline

```bash
npm run calibrate:bias -- validate \
  --references /PRIVATE-DIRECTORY/glm53-reference.json /PRIVATE-DIRECTORY/glm53flash-reference.json \
  --holdouts /PRIVATE-DIRECTORY/glm53-validation.json /PRIVATE-DIRECTORY/glm53flash-validation.json \
  --output /PRIVATE-DIRECTORY/glm-expanded-diagnostics.json
```

The checker:

1. Rebuilds distributions from saved observations and rejects inconsistent counts.
2. Requires complete reference collections of at least 60 samples/prompt and independent validation collections of at least 50 samples/prompt.
3. Adds draft references alongside bundled GLM siblings (or replaces older sibling data if matching fresh reference artifacts are supplied).
4. Splits validation data into **disjoint** run-sized batches: day ×3, each of the other eight prompts ×6. Fifty validation answers/prompt gives eight full batches, not hundreds of independent tests.
5. Reports correct/wrong/abstained calls using provisional inherited gates, candidate IDs, missing holdouts, and limitations. It does not report this as independently established system accuracy.
6. Always returns `experimental-not-validated` and `eligibleForPromotion: false`. No runtime policy or generated bundled baseline file is modified.

Before activation, collect older-sibling validation and independently known out-of-family controls, test relay/wrapper effects and missing/noisy observations, tune the expanded GLM policy with data separate from its final evaluation, assess uncertainty from enough independent runs, and review. Existing policy accuracy claims do not automatically transfer to the five-model candidate set.

Saved-run rejudge must not invoke this collector. It can only rescore existing saved evidence; fresh sampling is a separately budgeted operation.
