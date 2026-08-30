# 9Router

> Résumé traduit et abrégé. La documentation de référence est en anglais, dans
> [README.md](../README.md) et [docs/README.md](../docs/README.md).

9Router est une passerelle locale de routage d'IA accompagnée d'un tableau de
bord. Elle expose un seul point d'entrée compatible OpenAI sur `/v1/*`, traduit
chaque requête vers le format attendu par le fournisseur choisi et bascule
entre modèles et comptes, de sorte qu'une seule configuration côté client
continue de fonctionner lorsqu'un fournisseur épuise son quota, applique une
limitation de débit ou tombe en panne.

<p align="center">
  <img src="../images/9router.png" alt="Tableau de bord 9Router" width="800"/>
</p>

## Installation

```bash
npm install -g 9router
9router
```

Le tableau de bord est servi sur `http://localhost:20128/dashboard` et l'API
compatible OpenAI sur `http://localhost:20128/v1`. La première connexion
utilise `INITIAL_PASSWORD`, dont la valeur par défaut est `123456`. Changez-la.

La procédure complète se trouve dans
[docs/getting-started.md](../docs/getting-started.md).

## Statut du fork

Ce dépôt est un fork maintenu de façon indépendante de
[decolua/9router](https://github.com/decolua/9router). Il suit le projet
d'origine tout en portant ses propres correctifs et intégrations, à son propre
rythme. Le nom 9Router, l'historique du projet d'origine, la licence et
l'attribution des auteurs sont préservés.

Le projet d'origine sert de référence en lecture seule et tout le développement
a lieu ici. Ce fork n'est pas approuvé par le projet d'origine et ne parle pas
en son nom.

Le texte complet, y compris le processus de synchronisation, figure dans la
section "Fork status" du [README.md](../README.md) en anglais.

## Documentation

- [README.md](../README.md), la page principale en anglais.
- [docs/README.md](../docs/README.md), l'index de la documentation.

## Licence

MIT. Voir [LICENSE](../LICENSE).
