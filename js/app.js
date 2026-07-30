import {
  DEFAULT_RULES,
  BONUS_MAX,
  BONUS_KEYS,
  BONUS_LABELS,
  emptyBonuses,
  computeRoundScore,
  computeTotals,
  validateRoundEntries,
  getBidOrder,
} from "./scoring.js";
import { createGame, updateGame, getGame, listInProgressGames, listFinishedGames, deleteGame } from "./db.js";

const SCREEN_NAV = {
  home: {},
  setup: { back: "home" },
  round: { home: true },
  scoreboard: { home: true },
  finished: {},
  history: { back: "home" },
  "history-detail": { back: "history" },
  stats: { back: "home" },
  rules: { back: "home" },
};

let currentGame = null;
let lastPlayerNames = ["", ""];
let editingRoundIndex = null;

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function clamp(n, min, max) {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// ---------- Navigation ----------

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById("screen-" + name).classList.add("active");
  const nav = SCREEN_NAV[name] || {};
  const backBtn = document.getElementById("btn-header-back");
  const homeBtn = document.getElementById("btn-header-home");
  backBtn.classList.toggle("hidden", !nav.back);
  homeBtn.classList.toggle("hidden", !nav.home);
  backBtn.dataset.target = nav.back || "";
  window.scrollTo(0, 0);
}

async function navigateTo(name) {
  if (name === "home") await renderHome();
  else if (name === "history") await renderHistoryList();
  else if (name === "stats") await renderStats();
  showScreen(name);
}

// ---------- Accueil ----------

function renderInProgressItem(g) {
  const roundNumber = Math.min(g.rounds.length + 1, g.numRounds);
  const names = g.players.map((p) => escapeHtml(p.name)).join(", ");
  return `
    <div class="history-item in-progress-item" data-game-id="${g.id}">
      <div class="history-item-main">
        <div>${names}</div>
        <div class="history-date">Manche ${roundNumber} / ${g.numRounds}</div>
      </div>
      <button type="button" class="btn-delete-history" aria-label="Abandonner la partie">🗑</button>
      <div class="history-confirm-delete hidden">
        <span>Abandonner définitivement cette partie ?</span>
        <button type="button" class="btn-small btn-cancel-delete">Annuler</button>
        <button type="button" class="btn-small btn-danger btn-confirm-delete">Abandonner</button>
      </div>
    </div>`;
}

async function renderHome() {
  const statusEl = document.getElementById("home-status");
  const listEl = document.getElementById("in-progress-list");
  statusEl.textContent = "";
  listEl.innerHTML = "";
  try {
    const games = await listInProgressGames();
    if (games.length > 0) {
      listEl.innerHTML =
        '<p class="table-hint">Parties en cours (touche pour reprendre) :</p>' +
        games.map(renderInProgressItem).join("");
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "Impossible de contacter la base de données. Vérifie la configuration Firebase (js/firebase-config.js) et ta connexion.";
  }
}

document.getElementById("in-progress-list").addEventListener("click", async (e) => {
  const item = e.target.closest(".in-progress-item");
  if (!item) return;
  const gameId = item.dataset.gameId;

  if (e.target.closest(".btn-delete-history")) {
    item.querySelector(".history-confirm-delete").classList.remove("hidden");
    e.target.closest(".btn-delete-history").classList.add("hidden");
    return;
  }
  if (e.target.closest(".btn-cancel-delete")) {
    item.querySelector(".history-confirm-delete").classList.add("hidden");
    item.querySelector(".btn-delete-history").classList.remove("hidden");
    return;
  }
  if (e.target.closest(".btn-confirm-delete")) {
    try {
      await deleteGame(gameId);
      item.remove();
    } catch (err) {
      console.error(err);
      item.querySelector(".history-confirm-delete").classList.add("hidden");
      item.querySelector(".btn-delete-history").classList.remove("hidden");
    }
    return;
  }
  if (e.target.closest("button")) return;

  try {
    currentGame = await getGame(gameId);
    renderRoundScreen();
    showScreen("round");
  } catch (err) {
    console.error(err);
  }
});

// ---------- Configuration (setup) ----------

function renderPlayerRows() {
  const list = document.getElementById("players-list");
  list.innerHTML = "";
  lastPlayerNames.forEach((name, idx) => addPlayerRow(name));
  updateAddPlayerButtonState();
}

function addPlayerRow(name = "") {
  const list = document.getElementById("players-list");
  const row = document.createElement("div");
  row.className = "player-row";
  row.innerHTML = `
    <input type="text" class="player-name-input" placeholder="Nom du joueur" value="${escapeHtml(name)}" />
    <button type="button" class="btn-remove-player" aria-label="Supprimer">✕</button>
  `;
  row.querySelector(".btn-remove-player").addEventListener("click", () => {
    if (list.querySelectorAll(".player-row").length > 2) {
      row.remove();
      updateAddPlayerButtonState();
    }
  });
  list.appendChild(row);
  updateAddPlayerButtonState();
}

function updateAddPlayerButtonState() {
  const count = document.querySelectorAll("#players-list .player-row").length;
  document.getElementById("btn-add-player").disabled = count >= 8;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function fillRuleInputs(rules) {
  document.getElementById("rule-bidZeroSuccess").value = rules.bidZeroSuccess;
  document.getElementById("rule-bidZeroFail").value = rules.bidZeroFail;
  document.getElementById("rule-bidSuccessPerTrick").value = rules.bidSuccessPerTrick;
  document.getElementById("rule-bidFailPerTrickDiff").value = rules.bidFailPerTrickDiff;
  document.getElementById("enable-voided-tricks").checked = !!rules.enableVoidedTricks;
  document.getElementById("enable-simplified-bonus-mode").checked = !!rules.simplifiedBonusMode;
  for (const key of BONUS_KEYS) {
    document.getElementById("enable-" + key).checked = !!rules.enabled[key];
    document.getElementById("value-" + key).value = rules[key];
  }
}

function readRuleInputsFromForm() {
  const rules = {
    bidZeroSuccess: parseInt(document.getElementById("rule-bidZeroSuccess").value, 10) || 0,
    bidZeroFail: parseInt(document.getElementById("rule-bidZeroFail").value, 10) || 0,
    bidSuccessPerTrick: parseInt(document.getElementById("rule-bidSuccessPerTrick").value, 10) || 0,
    bidFailPerTrickDiff: parseInt(document.getElementById("rule-bidFailPerTrickDiff").value, 10) || 0,
    enableVoidedTricks: document.getElementById("enable-voided-tricks").checked,
    simplifiedBonusMode: document.getElementById("enable-simplified-bonus-mode").checked,
    enabled: {},
  };
  for (const key of BONUS_KEYS) {
    rules[key] = parseInt(document.getElementById("value-" + key).value, 10) || 0;
    rules.enabled[key] = document.getElementById("enable-" + key).checked;
  }
  return rules;
}

function initSetupScreen() {
  renderPlayerRows();
  document.getElementById("input-num-rounds").value = 10;
  fillRuleInputs(DEFAULT_RULES);
  document.getElementById("setup-errors").textContent = "";
}

document.getElementById("btn-add-player").addEventListener("click", () => addPlayerRow(""));

document.getElementById("btn-reset-rules").addEventListener("click", () => fillRuleInputs(DEFAULT_RULES));

document.getElementById("btn-start-game").addEventListener("click", async () => {
  const errorsEl = document.getElementById("setup-errors");
  errorsEl.textContent = "";

  const nameInputs = [...document.querySelectorAll("#players-list .player-name-input")];
  const names = nameInputs.map((i) => i.value.trim()).filter((n) => n.length > 0);

  if (names.length < 2) {
    errorsEl.textContent = "Il faut au moins 2 joueurs.";
    return;
  }
  const hasDuplicates = new Set(names).size !== names.length;
  if (hasDuplicates) {
    errorsEl.textContent = "Les noms des joueurs doivent être différents.";
    return;
  }

  const numRounds = clamp(parseInt(document.getElementById("input-num-rounds").value, 10), 1, 10);
  const rules = readRuleInputsFromForm();
  const players = names.map((name) => ({ id: uid(), name }));

  const gameData = {
    status: "in_progress",
    players,
    numRounds,
    rules,
    rounds: [],
    totals: computeTotals([], players),
  };

  try {
    const id = await createGame(gameData);
    currentGame = { id, ...gameData };
    lastPlayerNames = names;
    renderRoundScreen();
    showScreen("round");
  } catch (err) {
    console.error(err);
    errorsEl.textContent =
      "Impossible de créer la partie. Vérifie la configuration Firebase (js/firebase-config.js) et ta connexion.";
  }
});

document.getElementById("btn-new-game").addEventListener("click", () => {
  initSetupScreen();
  showScreen("setup");
});

document.getElementById("btn-history").addEventListener("click", () => navigateTo("history"));
document.getElementById("btn-rules").addEventListener("click", () => showScreen("rules"));

// ---------- Saisie de manche ----------

function renderStepper(fieldId, max, extraAttrs = "", initialValue = 0, { min = 0, step = 1 } = {}) {
  const minAttr = min != null ? `min="${min}"` : "";
  const maxAttr = max != null ? `max="${max}"` : "";
  return `
    <div class="stepper" data-max="${max ?? ""}" data-min="${min ?? ""}" data-step="${step}">
      <button type="button" class="stepper-btn stepper-minus" aria-label="Diminuer">−</button>
      <input type="number" id="${fieldId}" class="stepper-value" readonly inputmode="none" ${minAttr} ${maxAttr}
        value="${initialValue}" ${extraAttrs} />
      <button type="button" class="stepper-btn stepper-plus" aria-label="Augmenter">+</button>
    </div>`;
}

function handleStepperClick(e) {
  const btn = e.target.closest(".stepper-btn");
  if (!btn) return;
  const stepper = btn.closest(".stepper");
  const input = stepper.querySelector(".stepper-value");
  const max = stepper.dataset.max !== "" ? parseInt(stepper.dataset.max, 10) : null;
  const min = stepper.dataset.min !== "" ? parseInt(stepper.dataset.min, 10) : null;
  const step = parseInt(stepper.dataset.step, 10) || 1;
  const value = parseInt(input.value, 10) || 0;
  let next = btn.classList.contains("stepper-plus") ? value + step : value - step;
  if (max != null) next = Math.min(max, next);
  if (min != null) next = Math.max(min, next);
  input.value = next;
}

function updateTricksCounter() {
  const counterEl = document.getElementById("round-tricks-counter");
  const isEdit = editingRoundIndex !== null;
  const roundNumber = isEdit ? currentGame.rounds[editingRoundIndex].roundNumber : currentGame.rounds.length + 1;

  const voidedEl = document.getElementById("voided-tricks");
  let sum = voidedEl ? parseInt(voidedEl.value, 10) || 0 : 0;
  currentGame.players.forEach((p) => {
    const el = document.getElementById(`tricks-${p.id}`);
    sum += parseInt(el.value, 10) || 0;
  });

  counterEl.textContent = `Plis saisis : ${sum} / ${roundNumber}`;
  counterEl.classList.toggle("counter-mismatch", sum !== roundNumber);
}

function handleStepperClickAndUpdateCounter(e) {
  handleStepperClick(e);
  updateTricksCounter();
}

document.getElementById("round-entries").addEventListener("click", handleStepperClickAndUpdateCounter);
document.getElementById("round-voided-tricks-container").addEventListener("click", handleStepperClickAndUpdateCounter);

function renderBonusField(key, playerId, initialValue = 0) {
  const max = BONUS_MAX[key];
  const label = BONUS_LABELS[key];
  const fieldId = `bonus-${key}-${playerId}`;
  if (max === 1) {
    return `
      <div class="rule-row">
        <label class="checkbox-label" for="${fieldId}">${label}</label>
        <input type="checkbox" id="${fieldId}" data-bonus-key="${key}" data-player="${playerId}"
          ${initialValue ? "checked" : ""} />
      </div>`;
  }
  return `
    <div class="rule-row">
      <label class="checkbox-label" for="${fieldId}">${label} (0-${max})</label>
      ${renderStepper(fieldId, max, `data-bonus-key="${key}" data-player="${playerId}"`, initialValue)}
    </div>`;
}

function renderSimpleBonusField(playerId, initialValue = 0) {
  const fieldId = `simple-bonus-${playerId}`;
  return `
    <div>
      <label for="${fieldId}">Bonus</label>
      ${renderStepper(fieldId, null, `data-player="${playerId}"`, initialValue, { min: null, step: 5 })}
    </div>`;
}

function renderVoidedTricksField(roundNumber, initialValue = 0) {
  const container = document.getElementById("round-voided-tricks-container");
  if (!currentGame.rules.enableVoidedTricks) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `
    <div class="rule-row">
      <label class="checkbox-label" for="voided-tricks">Plis annulés (Kraken / Baleine blanche, 0-${roundNumber})</label>
      ${renderStepper("voided-tricks", roundNumber, "", initialValue)}
    </div>`;
}

/**
 * @param {number|null} editIndex - index dans currentGame.rounds à modifier, ou null pour saisir la
 *   prochaine manche
 */
function renderRoundScreen(editIndex = null) {
  editingRoundIndex = editIndex;
  const isEdit = editIndex !== null;
  const existing = isEdit ? currentGame.rounds[editIndex] : null;
  const roundNumber = isEdit ? existing.roundNumber : currentGame.rounds.length + 1;

  document.getElementById("round-title").textContent = isEdit
    ? `Modifier la manche ${roundNumber} / ${currentGame.numRounds}`
    : `Manche ${roundNumber} / ${currentGame.numRounds}`;
  document.getElementById("round-errors").textContent = "";
  renderVoidedTricksField(roundNumber, existing ? existing.voidedTricks || 0 : 0);

  const { dealerIndex, order: bidOrder } = getBidOrder(roundNumber, currentGame.players);
  const bidPositionByPlayerId = {};
  bidOrder.forEach((p, i) => {
    bidPositionByPlayerId[p.id] = i + 1;
  });
  document.getElementById("round-dealer-info").textContent =
    `Donneur : ${currentGame.players[dealerIndex].name}`;

  const simplifiedBonus = !!currentGame.rules.simplifiedBonusMode;
  const enabledBonusKeys = BONUS_KEYS.filter((k) => currentGame.rules.enabled[k]);

  const html = currentGame.players
    .map((p, idx) => {
      const entry = existing ? existing.entries[p.id] : null;
      let detailedBonusHtml = "";
      let simpleBonusColumnHtml = "";
      if (simplifiedBonus) {
        simpleBonusColumnHtml = renderSimpleBonusField(p.id, entry ? entry.simpleBonus || 0 : 0);
      } else {
        const bonusHtml = enabledBonusKeys
          .map((k) => renderBonusField(k, p.id, entry && entry.bonuses ? entry.bonuses[k] || 0 : 0))
          .join("");
        detailedBonusHtml = bonusHtml
          ? `<details class="bonus-accordion"><summary>Bonus</summary><div class="bonus-toggle-list">${bonusHtml}</div></details>`
          : "";
      }
      const dealerBadge = idx === dealerIndex ? '<span class="dealer-badge" title="Donneur">🎲</span>' : "";
      return `
        <div class="player-round-card">
          <h3>
            <span class="bid-order-badge" title="Ordre d'annonce">${bidPositionByPlayerId[p.id]}</span>
            ${escapeHtml(p.name)}
            ${dealerBadge}
          </h3>
          <div class="round-inputs-row">
            <div>
              <label for="bid-${p.id}">Annonce</label>
              ${renderStepper(`bid-${p.id}`, roundNumber, "", entry ? entry.bid || 0 : 0)}
            </div>
            <div>
              <label for="tricks-${p.id}">Plis remportés</label>
              ${renderStepper(`tricks-${p.id}`, roundNumber, "", entry ? entry.tricksWon || 0 : 0)}
            </div>
            ${simpleBonusColumnHtml}
          </div>
          ${detailedBonusHtml}
        </div>`;
    })
    .join("");

  document.getElementById("round-entries").innerHTML = html;
  document.getElementById("btn-validate-round").textContent = isEdit
    ? "Enregistrer les modifications"
    : "Valider la manche";
  updateTricksCounter();
}

document.getElementById("btn-validate-round").addEventListener("click", async () => {
  const errorsEl = document.getElementById("round-errors");
  errorsEl.textContent = "";
  const isEdit = editingRoundIndex !== null;
  const roundNumber = isEdit ? currentGame.rounds[editingRoundIndex].roundNumber : currentGame.rounds.length + 1;

  const entries = {};
  for (const p of currentGame.players) {
    const bid = parseInt(document.getElementById(`bid-${p.id}`).value, 10) || 0;
    const tricksWon = parseInt(document.getElementById(`tricks-${p.id}`).value, 10) || 0;
    const bonuses = emptyBonuses();
    let simpleBonus = 0;
    if (currentGame.rules.simplifiedBonusMode) {
      simpleBonus = parseInt(document.getElementById(`simple-bonus-${p.id}`).value, 10) || 0;
    } else {
      for (const key of BONUS_KEYS) {
        if (!currentGame.rules.enabled[key]) continue;
        const el = document.getElementById(`bonus-${key}-${p.id}`);
        bonuses[key] = el.type === "checkbox" ? (el.checked ? 1 : 0) : parseInt(el.value, 10) || 0;
      }
    }
    entries[p.id] = { bid, tricksWon, bonuses, simpleBonus };
  }

  const voidedTricks = currentGame.rules.enableVoidedTricks
    ? parseInt(document.getElementById("voided-tricks").value, 10) || 0
    : 0;

  const errors = validateRoundEntries(roundNumber, entries, currentGame.players, currentGame.rules, voidedTricks);
  if (errors.length > 0) {
    errorsEl.textContent = errors.join("\n");
    if (errors.some((e) => e.includes("dépasse le maximum possible"))) {
      document.querySelectorAll("#round-entries .bonus-accordion").forEach((details) => {
        details.open = true;
      });
    }
    return;
  }

  for (const p of currentGame.players) {
    const e = entries[p.id];
    e.score = computeRoundScore(roundNumber, e.bid, e.tricksWon, e.bonuses, currentGame.rules, e.simpleBonus);
  }

  const newRounds = isEdit
    ? currentGame.rounds.map((r, i) => (i === editingRoundIndex ? { roundNumber, voidedTricks, entries } : r))
    : [...currentGame.rounds, { roundNumber, voidedTricks, entries }];
  const newStatus = isEdit
    ? currentGame.status
    : newRounds.length >= currentGame.numRounds
    ? "finished"
    : "in_progress";
  const newTotals = computeTotals(newRounds, currentGame.players);

  try {
    await updateGame(currentGame.id, {
      rounds: newRounds,
      totals: newTotals,
      status: newStatus,
    });
  } catch (err) {
    console.error(err);
    errorsEl.textContent =
      "La manche est calculée mais n'a pas pu être sauvegardée en ligne. Vérifie ta connexion.";
    return;
  }

  currentGame.rounds = newRounds;
  currentGame.status = newStatus;
  currentGame.totals = newTotals;
  editingRoundIndex = null;

  if (currentGame.status === "finished") {
    renderFinished();
    showScreen("finished");
  } else {
    renderScoreboard();
    showScreen("scoreboard");
  }
});

// ---------- Tableau des scores ----------

function rankedPlayers(game) {
  return [...game.players].sort((a, b) => (game.totals[b.id] || 0) - (game.totals[a.id] || 0));
}

function getWinners(game) {
  const ranked = rankedPlayers(game);
  if (ranked.length === 0) return [];
  const bestTotal = game.totals[ranked[0].id] || 0;
  return ranked.filter((p) => (game.totals[p.id] || 0) === bestTotal);
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

function buildRankingHtml(game) {
  const ranked = rankedPlayers(game);
  return ranked
    .map((p) => {
      const total = game.totals[p.id] || 0;
      const rank = 1 + ranked.filter((o) => (game.totals[o.id] || 0) > total).length;
      return `
      <div class="ranking-item ${rank === 1 ? "rank-1" : ""}">
        <span><span class="rank-position">#${rank}</span>${escapeHtml(p.name)}</span>
        <strong>${total} pts</strong>
      </div>`;
    })
    .join("");
}

function buildScoreboardTable(game, { editable = false } = {}) {
  const players = game.players;
  let html = "";
  if (editable) {
    html += '<p class="table-hint">Touchez une manche pour la corriger.</p>';
  }
  html += '<table class="scoreboard"><thead><tr><th>Manche</th>';
  html += players.map((p) => `<th>${escapeHtml(p.name)}</th>`).join("");
  html += "</tr></thead><tbody>";
  game.rounds.forEach((round, index) => {
    const voidedNote = round.voidedTricks ? ` (${round.voidedTricks} annulé${round.voidedTricks > 1 ? "s" : ""})` : "";
    const rowAttrs = editable ? ` class="round-row-editable" data-round-index="${index}"` : "";
    html += `<tr${rowAttrs}><td class="round-label">${round.roundNumber}${voidedNote}</td>`;
    html += players
      .map((p) => {
        const e = round.entries[p.id];
        return `<td>${e ? e.score : ""}</td>`;
      })
      .join("");
    html += "</tr>";
  });
  html += '<tr class="total-row"><td class="round-label">Total</td>';
  html += players.map((p) => `<td>${game.totals[p.id] || 0}</td>`).join("");
  html += "</tr></tbody></table>";
  return html;
}

function handleScoreboardRowClick(e) {
  const row = e.target.closest("tr.round-row-editable");
  if (!row) return;
  renderRoundScreen(parseInt(row.dataset.roundIndex, 10));
  showScreen("round");
}

document.getElementById("scoreboard-table-container").addEventListener("click", handleScoreboardRowClick);
document.getElementById("finished-ranking").addEventListener("click", handleScoreboardRowClick);

function renderScoreboard() {
  document.getElementById("scoreboard-title").textContent = "Scores";
  document.getElementById("scoreboard-table-container").innerHTML = buildScoreboardTable(currentGame, {
    editable: true,
  });
  const nextRoundNumber = currentGame.rounds.length + 1;
  document.getElementById("btn-next-round").textContent = `Manche suivante (${nextRoundNumber}/${currentGame.numRounds})`;
}

document.getElementById("btn-next-round").addEventListener("click", () => {
  renderRoundScreen();
  showScreen("round");
});

// ---------- Fin de partie ----------

function renderFinished() {
  document.getElementById("finished-ranking").innerHTML =
    buildRankingHtml(currentGame) + buildScoreboardTable(currentGame, { editable: true });
  document.getElementById("finished-share-status").textContent = "";
}

const MEDALS = ["🥇", "🥈", "🥉"];

function buildResultShareText(game) {
  const ranked = rankedPlayers(game);
  const lines = ranked.map((p, idx) => {
    const marker = MEDALS[idx] || `#${idx + 1}`;
    return `${marker} ${p.name} — ${game.totals[p.id] || 0} pts`;
  });
  const roundsLabel = `${game.numRounds} manche${game.numRounds > 1 ? "s" : ""}`;
  return `🏴‍☠️ Skull King — Résultat de la partie (${roundsLabel})\n\n${lines.join("\n")}`;
}

document.getElementById("btn-share-result").addEventListener("click", async () => {
  const statusEl = document.getElementById("finished-share-status");
  const text = buildResultShareText(currentGame);

  if (navigator.share) {
    try {
      await navigator.share({ text });
    } catch (err) {
      if (err.name !== "AbortError") console.error(err);
    }
    return;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      statusEl.textContent = "Copié dans le presse-papiers !";
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Impossible de copier le résultat.";
    }
  }
});

document.getElementById("btn-finished-new-game").addEventListener("click", () => {
  initSetupScreen();
  showScreen("setup");
});
document.getElementById("btn-finished-home").addEventListener("click", () => navigateTo("home"));

// ---------- Historique ----------

async function renderHistoryList() {
  const container = document.getElementById("history-list");
  container.textContent = "Chargement...";
  try {
    const games = await listFinishedGames();
    if (games.length === 0) {
      container.textContent = "Aucune partie terminée pour le moment.";
      return;
    }
    container.innerHTML = games
      .map((g) => {
        const winners = getWinners(g);
        const winnerNames = winners.map((w) => escapeHtml(w.name));
        const winnerPoints = g.totals[winners[0].id] || 0;
        const winnerLabel =
          winners.length > 1
            ? `Égalité entre ${joinNames(winnerNames)} (${winnerPoints} pts)`
            : `Gagnant : ${winnerNames[0]} (${winnerPoints} pts)`;
        const date = g.createdAt && g.createdAt.toDate ? g.createdAt.toDate().toLocaleDateString("fr-FR") : "";
        return `
          <div class="history-item" data-game-id="${g.id}">
            <div class="history-item-main">
              <div>${g.players.map((p) => escapeHtml(p.name)).join(", ")}</div>
              <div class="history-date">${date} — ${winnerLabel}</div>
            </div>
            <button type="button" class="btn-delete-history" aria-label="Supprimer la partie">🗑</button>
            <div class="history-confirm-delete hidden">
              <span>Supprimer définitivement cette partie ?</span>
              <button type="button" class="btn-small btn-cancel-delete">Annuler</button>
              <button type="button" class="btn-small btn-danger btn-confirm-delete">Supprimer</button>
            </div>
          </div>`;
      })
      .join("");
  } catch (err) {
    console.error(err);
    container.textContent = "Impossible de charger l'historique. Vérifie ta connexion.";
  }
}

document.getElementById("history-list").addEventListener("click", async (e) => {
  const item = e.target.closest(".history-item");
  if (!item) return;
  const gameId = item.dataset.gameId;

  if (e.target.closest(".btn-delete-history")) {
    item.querySelector(".history-confirm-delete").classList.remove("hidden");
    e.target.closest(".btn-delete-history").classList.add("hidden");
    return;
  }
  if (e.target.closest(".btn-cancel-delete")) {
    item.querySelector(".history-confirm-delete").classList.add("hidden");
    item.querySelector(".btn-delete-history").classList.remove("hidden");
    return;
  }
  if (e.target.closest(".btn-confirm-delete")) {
    try {
      await deleteGame(gameId);
      item.remove();
    } catch (err) {
      console.error(err);
      item.querySelector(".history-confirm-delete").classList.add("hidden");
      item.querySelector(".btn-delete-history").classList.remove("hidden");
    }
    return;
  }
  if (e.target.closest("button")) return;

  const game = await getGame(gameId);
  renderHistoryDetail(game);
  showScreen("history-detail");
});

function renderHistoryDetail(game) {
  document.getElementById("history-detail-content").innerHTML =
    buildRankingHtml(game) + buildScoreboardTable(game);
}

// ---------- Statistiques par joueur ----------

/**
 * Agrège les statistiques par joueur à partir des parties terminées. Les joueurs sont
 * regroupés par nom exact (aucune identité persistante entre parties, chaque partie
 * génère de nouveaux id joueur).
 */
function computePlayerStats(games) {
  const statsByName = {};

  for (const game of games) {
    const ranked = rankedPlayers(game);
    const bestTotal = ranked.length > 0 ? game.totals[ranked[0].id] || 0 : 0;

    for (const p of game.players) {
      const stats =
        statsByName[p.name] ||
        (statsByName[p.name] = {
          name: p.name,
          gamesPlayed: 0,
          wins: 0,
          totalScoreSum: 0,
          bestRound: null,
          worstRound: null,
        });

      stats.gamesPlayed += 1;
      stats.totalScoreSum += game.totals[p.id] || 0;
      if ((game.totals[p.id] || 0) === bestTotal) stats.wins += 1;

      for (const round of game.rounds) {
        const entry = round.entries && round.entries[p.id];
        if (!entry || typeof entry.score !== "number") continue;
        if (stats.bestRound === null || entry.score > stats.bestRound) stats.bestRound = entry.score;
        if (stats.worstRound === null || entry.score < stats.worstRound) stats.worstRound = entry.score;
      }
    }
  }

  return Object.values(statsByName).sort((a, b) => b.wins - a.wins);
}

async function renderStats() {
  const container = document.getElementById("stats-content");
  container.textContent = "Chargement...";
  try {
    const games = await listFinishedGames();
    if (games.length === 0) {
      container.textContent = "Aucune partie terminée pour le moment.";
      return;
    }
    const stats = computePlayerStats(games);
    container.innerHTML = stats
      .map((s) => {
        const winRate = Math.round((s.wins / s.gamesPlayed) * 100);
        const avgScore = Math.round(s.totalScoreSum / s.gamesPlayed);
        return `
          <div class="stats-card">
            <h3>${escapeHtml(s.name)}</h3>
            <div class="stats-grid">
              <div><span class="stats-value">${s.gamesPlayed}</span><span class="stats-label">Parties jouées</span></div>
              <div><span class="stats-value">${s.wins} (${winRate}%)</span><span class="stats-label">Victoires</span></div>
              <div><span class="stats-value">${avgScore}</span><span class="stats-label">Score moyen</span></div>
              <div><span class="stats-value">${s.bestRound ?? "-"}</span><span class="stats-label">Meilleure manche</span></div>
              <div><span class="stats-value">${s.worstRound ?? "-"}</span><span class="stats-label">Pire manche</span></div>
            </div>
          </div>`;
      })
      .join("");
  } catch (err) {
    console.error(err);
    container.textContent = "Impossible de charger les statistiques. Vérifie ta connexion.";
  }
}

document.getElementById("btn-stats").addEventListener("click", () => navigateTo("stats"));

// ---------- Header (back/home) ----------

document.getElementById("btn-header-back").addEventListener("click", (e) => {
  const target = e.currentTarget.dataset.target;
  if (target) navigateTo(target);
});
document.getElementById("btn-header-home").addEventListener("click", () => navigateTo("home"));

// ---------- Service worker ----------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.error("SW registration failed", err));
  });
}

// ---------- Démarrage ----------

renderHome().then(() => showScreen("home"));
