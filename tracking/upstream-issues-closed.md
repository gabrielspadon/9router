

## Issue #3606 — enhancement: Cloudflare Workers AI 有文本/图像模型但没有嵌入(embeddings)模型

- url: https://github.com/decolua/9router/issues/3606
- upstream-state: open (discovered 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: implemented
- closed: 2026-08-28
- detail: commit 2e38a457e on branch upstream-issue-3606, merged to master; added embedding service kind + BGE bge-base/large/m3 models to cloudflare-ai registry, dedicated adapter resolving account-scoped URL from providerSpecificData.accountId (no silent fallback); 4 new tests pass; provider baseline byte-identical; full-suite gate green 1813 pass / 90 known-fail / 0 new

