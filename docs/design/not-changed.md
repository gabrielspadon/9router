# Intentionally unchanged

Areas this presentation pass left alone, and why. "Unchanged" here is a
decision on the record, not something overlooked.

| Area | Why it was left alone |
|---|---|
| `open-sse/`, `src/sse/`, `src/lib/`, `src/app/api/`, `src/models/`, `src/store/`, `src/mitm/`, `tests/`, `scripts/`, `cli/` source | Owned by the parallel backend session and read-only for this work. The fingerprint checker asserts they are untouched across both committed history and the working tree, so a slip fails the gate rather than reaching review. |
| Request, response and retry behaviour on every route | This is a redesign, not a behavioural rewrite. The repository-wide fingerprint holds the multiset of hook call sites, handler bodies, fetch calls, request paths, state setters and navigation calls identical to the merge base. |
| Provider brand colours in `src/shared/constants/colors.js` and `cliTools.js` | A vendor's own colour is data about that vendor, not styling of this product. Forcing them onto the token palette would make providers harder to tell apart, which is the opposite of the goal. |
| Chart series colours bound to API-supplied categories | Where a colour maps to a category the backend defines, the mapping belongs with whoever owns the category. Recorded as finding 4 in `backend-handoff.md`; the token ratchet stops the count growing meanwhile. |
| The many provider authentication modals (Kiro, Cursor, GitLab, iFlow and the rest) | Each is a behaviour-dense OAuth flow where the risk of a presentation edit is high and the visual payoff is low. They inherit the new foundation through the token layer without being restructured. |
| The header search, donate, theme and language cluster | Every capability stays exactly where a returning user expects it. Moving them would spend the reader's familiarity for no gain in answering the four product jobs. |
| Route-level data fetching and loading orchestration | Any change here is behaviour by definition. Loading states were improved only where a presentational component (Skeleton, EmptyState, ErrorState) could be substituted without touching what triggers them. |
| Translated message catalogues | Layout was made to survive long and dense translations, which is a presentation concern. Editing the translations themselves is a content task with a different owner and review path. |
| The endpoint, CLI tools and Claude compatibility page bodies | They already answer their single question directly. They gain the new foundation and the reworked shell; restructuring them further would be change without a finding behind it. |
