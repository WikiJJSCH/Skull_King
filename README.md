# Skull King - Comptage des points

Application pour comptabiliser les points du jeu de société Skull King, pensée pour être utilisée
sur un smartphone (un seul appareil partagé pendant la partie).

- Frontend : HTML/CSS/JS pur (aucun build), installable comme PWA
- Stockage : Firebase Firestore
- Hébergement prévu : GitHub Pages

## 1. Créer le projet Firebase

1. Aller sur https://console.firebase.google.com/ et créer un nouveau projet (Google Analytics non nécessaire).
2. Dans le projet : **Créer une base de données Firestore** (mode production).
3. Aller dans **Paramètres du projet > Vos applications > Ajouter une application Web** (icône `</>`).
4. Copier la configuration fournie (`apiKey`, `authDomain`, `projectId`, etc.) et la coller dans
   [`js/firebase-config.js`](js/firebase-config.js) à la place des valeurs `REMPLACE_MOI`.

## 2. Règles de sécurité Firestore

L'application n'utilise pas d'authentification (usage simple, un seul appareil partagé). Appliquer ces
règles dans **Firestore Database > Règles** :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /games/{gameId} {
      allow read, write: if true;
    }
  }
}
```

⚠️ Ces règles sont ouvertes : toute personne connaissant la configuration du projet peut lire/écrire
les parties. Acceptable pour un usage privé/familial, mais à garder en tête. Une évolution possible
serait d'ajouter Firebase App Check ou une authentification anonyme si besoin.

## 3. Tester en local

Les modules JS (`type="module"`) et le service worker nécessitent d'être servis en HTTP (pas `file://`).

```bash
# depuis le dossier du projet
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000` dans un navigateur.

Pour tester depuis un smartphone sur le même réseau Wi-Fi que l'ordinateur : récupérer l'IP locale de
l'ordinateur (`ipconfig` sous Windows, chercher "Adresse IPv4"), puis ouvrir sur le téléphone
`http://<IP-ORDINATEUR>:8000`.

Note : l'installation PWA complète ("Ajouter à l'écran d'accueil") nécessite HTTPS, donc à tester
plutôt une fois déployé sur GitHub Pages (voir ci-dessous). `localhost` fonctionne aussi pour ça sur
l'ordinateur.

## 4. Déployer sur GitHub Pages

1. Pousser ce dépôt sur GitHub (`git push`).
2. Dans le dépôt GitHub : **Settings > Pages**.
3. Source : **Deploy from a branch**, branche `main`, dossier `/ (root)`.
4. L'application sera accessible à `https://<utilisateur>.github.io/<nom-du-repo>/`.

## 5. Installer sur smartphone

Ouvrir l'URL GitHub Pages sur le téléphone, puis :
- **Android (Chrome)** : menu ⋮ > "Ajouter à l'écran d'accueil" / une bannière d'installation peut
  apparaître automatiquement.
- **iOS (Safari)** : bouton Partager > "Sur l'écran d'accueil".

L'app s'ouvre alors en plein écran comme une app native, et l'interface de base reste utilisable même
avec une connexion instable (l'app shell est mise en cache par le service worker ; la sauvegarde des
scores nécessite en revanche une connexion réseau pour joindre Firestore).

## Règles de score implémentées

- Annonce = 0 réussie : `+10 × numéro de manche` (valeur configurable)
- Annonce = 0 ratée : `-10 × numéro de manche`
- Annonce ≠ 0 réussie : `+20 × plis annoncés`
- Annonce ≠ 0 ratée : `-10 × écart entre annonce et plis réalisés`
- Bonus (activables/désactivables et paramétrables avant chaque partie, dans "Règles de score") :
  Skull King capture un Pirate (+30/pirate), Pirate capture une Sirène (+20/sirène), Sirène capture le
  Skull King (+40), carte "14" bonus couleur (+10) et noire/Jolly Roger (+20)

Ces valeurs par défaut correspondent aux règles officielles du livret ; elles sont éditables en début
de partie pour s'adapter à une variante ou une édition différente.

**Mode simplifié des bonus** : en alternative à la liste détaillée ci-dessus, un réglage ("Mode de
saisie des bonus" dans la configuration de partie) permet de saisir un simple ajustement de score par
pas de 5 (+/-) pour chaque joueur à chaque manche, sans détail par type de bonus. Ce réglage est fixé
pour toute la durée de la partie.

### Règles avancées (Léviathans et cartes Butin)

Ces cartes sont retirées du jeu de base par défaut (voir la mise en place, p.4 du livret) et ne sont
utilisées que si votre groupe joue avec les règles avancées :

- **Kraken / Baleine blanche** : annulent entièrement un pli (personne ne le remporte). Si la case
  "Autoriser les plis annulés" est cochée en configuration, un champ "Plis annulés" apparaît lors de la
  saisie de chaque manche ; la validation attend alors `plis remportés + plis annulés = numéro de manche`
  au lieu de `plis remportés = numéro de manche`.
- **Cartes Butin** : alliance entre le joueur qui la joue et celui qui remporte le pli — si les deux
  ont misé juste ce tour, chacun gagne un bonus (+20 par défaut, configurable comme les autres bonus).

### Extension officielle

Bonus de l'extension, activables/désactivables et paramétrables comme les autres ("Règles de score",
section "Bonus extension") :

- **Carte 7** remportée avec annonce réussie ce tour : -5 points (malus)
- **Carte 8** remportée avec annonce réussie ce tour : +5 points
- **Casier de Davy Jones** : +20 points par Léviathan détruit (Kraken/Baleine blanche/Raie tachetée)
- **Second** capturé par le Skull King ou une Sirène : +30 points

Les bonus carte 7/8 ne sont ajoutés au score que si l'annonce du joueur est respectée ce tour-là ;
l'application le vérifie automatiquement (pas besoin de laisser le compteur à 0 soi-même). Les autres
cartes de l'extension (0/14, 15 joker, Raie tachetée, Dernière salve, Supplice de la planche, nouvelle
carte Pirate Mary Throne) changent uniquement le déroulement d'un pli et n'ont pas d'impact sur le calcul
des points.

## Fonctionnalités complémentaires

- **Correction d'une manche passée** : dans le tableau des scores (en cours de partie ou une fois la
  partie terminée), touche une ligne de manche pour rouvrir sa saisie, la corriger et recalculer les
  totaux automatiquement.
- **Suppression d'une partie** : dans l'historique, un bouton 🗑 par partie permet de la supprimer
  définitivement (avec confirmation).
- **Liste des parties en cours** : l'écran d'accueil affiche **toutes** les parties non terminées (et
  pas seulement la plus récente), chacune avec ses joueurs et sa manche actuelle. Touche une partie pour
  la reprendre, ou son bouton 🗑 pour l'abandonner définitivement (avec confirmation).
- **Donneur et ordre d'annonce** : à chaque manche, le donneur (qui tourne automatiquement selon l'ordre
  des joueurs défini à la création de la partie) est indiqué, ainsi que l'ordre d'annonce de chaque
  joueur.
- **Compteur de plis en direct** : pendant la saisie d'une manche, un compteur affiche le total des plis
  remportés (+ plis annulés) saisis jusqu'ici par rapport au numéro de la manche, pour repérer une
  erreur avant de valider.
- **Statistiques par joueur** : un écran "Statistiques", accessible depuis l'accueil, regroupe les
  parties terminées par nom de joueur (parties jouées, victoires et taux de victoire, score moyen,
  meilleure et pire manche). Le regroupement se fait par nom exact, faute d'identité de joueur
  persistante entre les parties.
- **Partage du résultat** : en fin de partie, un bouton "Partager le résultat" génère un résumé texte du
  classement, via l'API Web Share si disponible (sinon copie dans le presse-papiers).

## Limites connues (v1)

- Pas de synchronisation multi-appareils : un seul téléphone sert de "marqueur de points" pendant la
  partie (choix assumé, voir plan d'implémentation).
- La cohérence entre joueurs est vérifiée au niveau du **total par bonus sur la manche** (ex: impossible
  que deux joueurs déclarent chacun avoir capturé le Skull King le même tour, puisque le total ne peut
  pas dépasser 1 pour ce bonus). En revanche, l'application ne sait pas *laquelle* des cartes physiques a
  été capturée par qui exactement : elle fait confiance à la répartition saisie par les joueurs tant que
  le total reste cohérent avec le nombre de cartes en jeu.
