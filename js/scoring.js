// Moteur de score Skull King - fonctions pures, sans dépendance UI/DB.

export const BONUS_KEYS = [
  "skullKingCapturesPirate",
  "pirateCapturesMermaid",
  "mermaidCapturesSkullKing",
  "bonus14Normal",
  "bonus14Black",
  "butinAlliance",
  "card7Malus",
  "card8Bonus",
  "davyJonesLocker",
  "secondCaptured",
];

// Bonus de l'extension qui ne s'appliquent que si l'annonce du joueur est réussie ce tour-là.
const BID_SUCCESS_ONLY_KEYS = new Set(["card7Malus", "card8Bonus"]);

export const DEFAULT_RULES = {
  bidZeroSuccess: 10,       // par numéro de manche, si annonce=0 et 0 pli remporté
  bidZeroFail: 10,          // (magnitude, appliqué en négatif) si annonce=0 et au moins 1 pli remporté
  bidSuccessPerTrick: 20,   // par pli, si annonce != 0 et annonce respectée
  bidFailPerTrickDiff: 10,  // (magnitude, appliqué en négatif) par pli d'écart, si annonce != 0 non respectée
  skullKingCapturesPirate: 30, // par pirate capturé par le Skull King (max 3 dans le jeu)
  pirateCapturesMermaid: 20,   // par sirène capturée par un pirate (max 2 dans le jeu)
  mermaidCapturesSkullKing: 40, // Skull King capturé par une sirène (max 1 dans le jeu)
  bonus14Normal: 10,        // par carte "14" bonus d'une couleur normale (max 3: jaune/violet/vert)
  bonus14Black: 20,         // carte "14" bonus noire (Jolly Roger) (max 1)
  butinAlliance: 20,        // règle avancée : alliance Butin réussie (max 2 cartes Butin dans le jeu)
  card7Malus: -5,           // extension : carte 7 remportée, uniquement si annonce réussie (max 4 : une par couleur)
  card8Bonus: 5,            // extension : carte 8 remportée, uniquement si annonce réussie (max 4 : une par couleur)
  davyJonesLocker: 20,      // extension : par Léviathan détruit par le Casier de Davy Jones (max 3)
  secondCaptured: 30,       // extension : Second capturé par le Skull King ou une Sirène (max 1)
  enableVoidedTricks: true, // règle avancée : le Kraken / la Baleine blanche peuvent annuler un pli
  enabled: {
    skullKingCapturesPirate: true,
    pirateCapturesMermaid: true,
    mermaidCapturesSkullKing: true,
    bonus14Normal: true,
    bonus14Black: true,
    butinAlliance: true,
    card7Malus: true,
    card8Bonus: true,
    davyJonesLocker: true,
    secondCaptured: true,
  },
};

export const BONUS_MAX = {
  skullKingCapturesPirate: 3,
  pirateCapturesMermaid: 2,
  mermaidCapturesSkullKing: 1,
  bonus14Normal: 3,
  bonus14Black: 1,
  butinAlliance: 2,
  card7Malus: 4,
  card8Bonus: 4,
  davyJonesLocker: 3,
  secondCaptured: 1,
};

export function emptyBonuses() {
  const bonuses = {};
  for (const key of BONUS_KEYS) bonuses[key] = 0;
  return bonuses;
}

/**
 * Calcule le score d'un joueur pour une manche.
 * @param {number} roundNumber - numéro de la manche (1..N), = nb de plis joués ce tour
 * @param {number} bid - annonce du joueur (0..roundNumber)
 * @param {number} tricksWon - plis réellement remportés (0..roundNumber)
 * @param {object} bonuses - compteurs de bonus (voir emptyBonuses())
 * @param {object} rules - jeu de règles (voir DEFAULT_RULES)
 * @returns {number} score total de la manche pour ce joueur
 */
export function computeRoundScore(roundNumber, bid, tricksWon, bonuses, rules) {
  let base;
  if (bid === 0) {
    base = tricksWon === 0
      ? rules.bidZeroSuccess * roundNumber
      : -Math.abs(rules.bidZeroFail) * roundNumber;
  } else if (tricksWon === bid) {
    base = rules.bidSuccessPerTrick * bid;
  } else {
    const diff = Math.abs(tricksWon - bid);
    base = -Math.abs(rules.bidFailPerTrickDiff) * diff;
  }

  const bidSuccess = bid === 0 ? tricksWon === 0 : tricksWon === bid;
  const b = bonuses || emptyBonuses();
  const enabled = rules.enabled || {};
  let bonusTotal = 0;
  for (const key of BONUS_KEYS) {
    if (!enabled[key]) continue;
    if (BID_SUCCESS_ONLY_KEYS.has(key) && !bidSuccess) continue;
    bonusTotal += (b[key] || 0) * rules[key];
  }

  return base + bonusTotal;
}

/**
 * Calcule les totaux cumulés par joueur sur l'ensemble des manches jouées.
 * @param {Array} rounds - tableau de manches { entries: { [playerId]: { score } } }
 * @param {Array} players - tableau de joueurs { id }
 * @returns {Object} totaux { [playerId]: number }
 */
export function computeTotals(rounds, players) {
  const totals = {};
  for (const p of players) totals[p.id] = 0;
  for (const round of rounds) {
    for (const p of players) {
      const entry = round.entries && round.entries[p.id];
      if (entry && typeof entry.score === "number") {
        totals[p.id] += entry.score;
      }
    }
  }
  return totals;
}

/**
 * @param {number} voidedTricks - plis annulés ce tour (Kraken / Baleine blanche), personne ne les remporte
 */
export function validateRoundEntries(roundNumber, entries, players, voidedTricks = 0) {
  const errors = [];
  let sumTricks = 0;
  for (const p of players) {
    const e = entries[p.id];
    if (!e) {
      errors.push(`${p.name} : aucune saisie`);
      continue;
    }
    if (e.bid < 0 || e.bid > roundNumber) {
      errors.push(`${p.name} : annonce invalide (0 à ${roundNumber})`);
    }
    if (e.tricksWon < 0 || e.tricksWon > roundNumber) {
      errors.push(`${p.name} : plis invalides (0 à ${roundNumber})`);
    }
    sumTricks += e.tricksWon || 0;
  }
  if (voidedTricks < 0 || voidedTricks > roundNumber) {
    errors.push(`Plis annulés invalides (0 à ${roundNumber})`);
  }
  if (sumTricks + voidedTricks !== roundNumber) {
    errors.push(
      `Le total des plis remportés (${sumTricks}) + plis annulés (${voidedTricks}) doit être égal à ${roundNumber}`
    );
  }
  return errors;
}
