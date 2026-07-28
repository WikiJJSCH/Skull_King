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

### Règles avancées (Léviathans et cartes Butin)

Ces cartes sont retirées du jeu de base par défaut (voir la mise en place, p.4 du livret) et ne sont
utilisées que si votre groupe joue avec les règles avancées :

- **Kraken / Baleine blanche** : annulent entièrement un pli (personne ne le remporte). Si la case
  "Autoriser les plis annulés" est cochée en configuration, un champ "Plis annulés" apparaît lors de la
  saisie de chaque manche ; la validation attend alors `plis remportés + plis annulés = numéro de manche`
  au lieu de `plis remportés = numéro de manche`.
- **Cartes Butin** : alliance entre le joueur qui la joue et celui qui remporte le pli — si les deux
  ont misé juste ce tour, chacun gagne un bonus (+20 par défaut, configurable comme les autres bonus).

## Limites connues (v1)

- Pas de synchronisation multi-appareils : un seul téléphone sert de "marqueur de points" pendant la
  partie (choix assumé, voir plan d'implémentation).
- Les compteurs de bonus par joueur ne sont pas croisés entre joueurs (ex: rien n'empêche de saisir la
  capture du Skull King par une sirène pour deux joueurs différents sur la même manche) : on fait
  confiance à la saisie des joueurs.
