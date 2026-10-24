# Décisions de schalappe (table close, appliquées le 2026-10-24, non commitées)

Règle : aucune modification des skills, d'AGENTS.md ou des commandes avant le feu vert explicite.

| # | Chantier | Décision | Précisions |
|---|---|---|---|
| 1 | Commande `/ship` | Validé | Branche si besoin, ne stage que les fichiers de la tâche, commit via `caveman-commit`, push, PR via `pr` vers la base déclarée par le dépôt, draft par défaut, args `ready` / `no-pr`, worktree supprimé après push. |
| 2 | Refonte de `triage` en boucle ticket | Validé | Lire le ticket, vérifier dans l'appli, verdict (corrigé / réel / needs-info / won't fix) avec preuve, corriger si petit via `implement`, sinon brief via `agent-ready-issue`, clôture commentée. Retirer AGENT-BRIEF.md, OUT-OF-SCOPE.md, PR externes, avertissement IA. GitHub par défaut ; YouTrack seulement si `docs/agents/issue-tracker.md` du dépôt le déclare. Nom `triage` conservé. |
| 3 | wayfinder, grill-with-docs, improve-codebase-architecture, prototype, to-spec, to-tickets | Refusé : on garde tout | |
| 3b | `setup-matt-pocock-skills` | Validé : garder et adapter | Section A : ajouter YouTrack. Section B : labels réduits aux verdicts du nouveau `triage`. Section C : inchangée. Retirer l'option PR externes. Sortir du lock. **Ajouter un mode mise à jour** pour les dépôts déjà configurés (kari-banking, fily-verify…) : lire l'existant, montrer le diff, réécrire en gardant les ajouts faits à la main. Renommage : non tranché, nom actuel conservé par défaut. |
| 4 | `review-round` | Validé | Grille interrogate dans `REVIEW_TASK` ; motifs de rejet du fixer ; 5 raccourcis vers le vert ; pas de ready sans preuve navigateur si l'UI change ; décisions métier groupées en fin de run. |
| 5 | `verify-app` | Validé | Générateur qui écrit `verify-<app>` dans le dépôt (Launch, Doctor, Drive, Evidence, Cleanup + 3-5 fiches). Maintenance : (1) recette périmée réparée dans la même PR, distincte d'une régression ; (2) le reviewer vérifie les recettes quand une PR touche démarrage, routes ou seeds ; (3) Doctor en premier. |
| 6 | `explain` (how + why) | Validé | ~400 mots, invoqué par l'utilisateur. |
| 7 | `hardening` | Validé, déclenché par l'agent | ~1 000 mots, avec section écritures monétaires (idempotence). |
| 8 | Retouches : unslop, diagnosing-bugs, tdd, branch-review, implement, retro, bro, find-docs, verifier, logging-best-practices, grilling | Validé pour tout | `diagnosing-bugs` et `grilling` sortis du lock. unslop à taille constante. |
| 9 | 5 phrases dans AGENTS.md | Validé | |
| 10 | Label `ready-for-human` | Supprimé | `/setup-repo` en mode mise à jour propose un nouveau label pour chaque ticket qui le porte, puis supprime le label du tracker et des docs, sur accord. |
