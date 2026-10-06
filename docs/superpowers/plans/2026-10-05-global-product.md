# Global product implementation plan

Execute incrementally on the merged editing foundation; preserve existing public
contracts and add optional fields and focused endpoints.

1. Close four correctness reviews with regression tests; record honest Resolve
   evidence; merge only after CI. **Completed before this branch.**
2. Add Vue internationalization, locale resolution, runtime preferences, Intl
   formatting, pseudo messages and key/placeholder coverage gates.
3. Add optional film locale/settings and template text ownership, with legacy,
   custom-title, save/reopen and atomic-update coverage.
4. Add default film creation, recent availability, selected-file/browser upload
   import and real MP4 export through existing application services. Expose stable
   structured errors without changing diagnostic/CLI behavior.
5. Integrate Welcome/Create Film, navigation/progress, Library, Story, Edit,
   recovery, Export and functional Settings. Keep the existing editor mounted and
   preserve flush/conflict guards.
6. Apply shared editorial tokens and accessible interaction states; validate all
   three languages plus expanded pseudo text at the requested desktop sizes.
7. Run an actual localized full film workflow plus lighter locale smoke journeys;
   preserve existing browser and engine regressions. Update documentation and
   checked task states only from working implementation and evidence.
8. Run format, lint, typecheck, tests, build, E2E, interchange, native and i18n
   gates; inspect the final diff and publish a reviewable PR with exact CI state.

Work is partitioned by file ownership: application/API; content contracts/templates;
app orchestration/components; editor; media/recovery/compatibility; styles/visual
QA; and root i18n/integration/docs. Changes share one checkout and are committed
only by the root agent. Browser ports are reserved for one runner at a time.
