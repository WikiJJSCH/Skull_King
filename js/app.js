import { DEFAULT_RULES, BONUS_MAX, BONUS_KEYS, emptyBonuses, computeRoundScore, computeTotals, validateRoundEntries } from "./scoring.js";
import { createGame, updateGame, getGame, getInProgressGame, listFinishedGames } from "./db.js";

const BONUS_LABELS = {
  skullKingCapturesPirate: "Skull King capture un Pirate",
  pirateCapturesMermaid: "Pirate capture une Sirène",
  mermaidCapturesSkullKing: "Sirène capture le Skull King",
  bonus14Normal: "Carte 14 bonus (couleur)",
  bonus14Black: "Carte 14 bonus noire",
  butinAlliance: "Alliance Butin réussie (règle avancée)",
};

const SCREEN_NAV = {
  home: {},
  setup: { back: "home" },
  round: { home: true },
  scoreboard: { home: true },
  finished: {},
  history: { back: "home" },
  "history-detail": { back: "history" },
};

let currentGame = null;
let pendingResumeGame = null;
let lastPlayerNames = ["", ""];

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
  showScreen(name);
}

// ---------- Accueil ----------

async function renderHome() {
  const statusEl = document.getElementById("home-status");
  const resumeBtn = document.getElementById("btn-resume-game");
  statusEl.textContent = "";
  resumeBtn.classList.add("hidden");
  pendingResumeGame = null;
  try {
    pendingResumeGame = await getInProgressGame();
    if (pendingResumeGame) {
      resumeBtn.classList.remove("hidden");
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "Impossible de contacter la base de données. Vérifie la configuration Firebase (js/firebase-config.js) et ta connexion.";
  }
}

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

document.getElementById("btn-resume-game").addEventListener("click", () => {
  if (!pendingResumeGame) return;
  currentGame = pendingResumeGame;
  renderRoundScreen();
  showScreen("round");
});

document.getElementById("btn-new-game").addEventListener("click", () => {
  initSetupScreen();
  showScreen("setup");
});

document.getElementById("btn-history").addEventListener("click", () => navigateTo("history"));

// ---------- Saisie de manche ----------

function renderBonusField(key, playerId) {
  const max = BONUS_MAX[key];
  const label = BONUS_LABELS[key];
  const fieldId = `bonus-${key}-${playerId}`;
  if (max === 1) {
    return `
      <div class="rule-row">
        <label class="checkbox-label" for="${fieldId}">${label}</label>
        <input type="checkbox" id="${fieldId}" data-bonus-key="${key}" data-player="${playerId}" />
      </div>`;
  }
  return `
    <div class="rule-row">
      <label class="checkbox-label" for="${fieldId}">${label} (0-${max})</label>
      <input type="number" id="${fieldId}" class="rule-value" min="0" max="${max}" value="0"
        data-bonus-key="${key}" data-player="${playerId}" />
    </div>`;
}

function renderVoidedTricksField(roundNumber) {
  const container = document.getElementById("round-voided-tricks-container");
  if (!currentGame.rules.enableVoidedTricks) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `
    <div class="rule-row">
      <label class="checkbox-label" for="voided-tricks">Plis annulés (Kraken / Baleine blanche, 0-${roundNumber})</label>
      <input type="number" inputmode="numeric" id="voided-tricks" class="rule-value" min="0" max="${roundNumber}" value="0" />
    </div>`;
}

function renderRoundScreen() {
  const roundNumber = currentGame.rounds.length + 1;
  document.getElementById("round-title").textContent = `Manche ${roundNumber} / ${currentGame.numRounds}`;
  document.getElementById("round-errors").textContent = "";
  renderVoidedTricksField(roundNumber);

  const enabledBonusKeys = BONUS_KEYS.filter((k) => currentGame.rules.enabled[k]);

  const html = currentGame.players
    .map((p) => {
      const bonusHtml = enabledBonusKeys.map((k) => renderBonusField(k, p.id)).join("");
      return `
        <div class="player-round-card">
          <h3>${escapeHtml(p.name)}</h3>
          <div class="round-inputs-row">
            <div>
              <label for="bid-${p.id}">Annonce</label>
              <input type="number" inputmode="numeric" id="bid-${p.id}" min="0" max="${roundNumber}" value="0" />
            </div>
            <div>
              <label for="tricks-${p.id}">Plis remportés</label>
              <input type="number" inputmode="numeric" id="tricks-${p.id}" min="0" max="${roundNumber}" value="0" />
            </div>
          </div>
          ${bonusHtml ? `<div class="bonus-toggle-list">${bonusHtml}</div>` : ""}
        </div>`;
    })
    .join("");

  document.getElementById("round-entries").innerHTML = html;
}

document.getElementById("btn-validate-round").addEventListener("click", async () => {
  const errorsEl = document.getElementById("round-errors");
  errorsEl.textContent = "";
  const roundNumber = currentGame.rounds.length + 1;

  const entries = {};
  for (const p of currentGame.players) {
    const bid = parseInt(document.getElementById(`bid-${p.id}`).value, 10) || 0;
    const tricksWon = parseInt(document.getElementById(`tricks-${p.id}`).value, 10) || 0;
    const bonuses = emptyBonuses();
    for (const key of BONUS_KEYS) {
      if (!currentGame.rules.enabled[key]) continue;
      const el = document.getElementById(`bonus-${key}-${p.id}`);
      bonuses[key] = el.type === "checkbox" ? (el.checked ? 1 : 0) : parseInt(el.value, 10) || 0;
    }
    entries[p.id] = { bid, tricksWon, bonuses };
  }

  const voidedTricks = currentGame.rules.enableVoidedTricks
    ? parseInt(document.getElementById("voided-tricks").value, 10) || 0
    : 0;

  const errors = validateRoundEntries(roundNumber, entries, currentGame.players, voidedTricks);
  if (errors.length > 0) {
    errorsEl.textContent = errors.join("\n");
    return;
  }

  for (const p of currentGame.players) {
    const e = entries[p.id];
    e.score = computeRoundScore(roundNumber, e.bid, e.tricksWon, e.bonuses, currentGame.rules);
  }

  currentGame.rounds.push({ roundNumber, voidedTricks, entries });
  currentGame.totals = computeTotals(currentGame.rounds, currentGame.players);
  const finished = currentGame.rounds.length >= currentGame.numRounds;
  currentGame.status = finished ? "finished" : "in_progress";

  try {
    await updateGame(currentGame.id, {
      rounds: currentGame.rounds,
      totals: currentGame.totals,
      status: currentGame.status,
    });
  } catch (err) {
    console.error(err);
    errorsEl.textContent =
      "La manche est calculée mais n'a pas pu être sauvegardée en ligne. Vérifie ta connexion.";
    return;
  }

  if (finished) {
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

function buildScoreboardTable(game) {
  const players = game.players;
  let html = '<table class="scoreboard"><thead><tr><th>Manche</th>';
  html += players.map((p) => `<th>${escapeHtml(p.name)}</th>`).join("");
  html += "</tr></thead><tbody>";
  for (const round of game.rounds) {
    const voidedNote = round.voidedTricks ? ` (${round.voidedTricks} annulé${round.voidedTricks > 1 ? "s" : ""})` : "";
    html += `<tr><td class="round-label">${round.roundNumber}${voidedNote}</td>`;
    html += players
      .map((p) => {
        const e = round.entries[p.id];
        return `<td>${e ? e.score : ""}</td>`;
      })
      .join("");
    html += "</tr>";
  }
  html += '<tr class="total-row"><td class="round-label">Total</td>';
  html += players.map((p) => `<td>${game.totals[p.id] || 0}</td>`).join("");
  html += "</tr></tbody></table>";
  return html;
}

function renderScoreboard() {
  document.getElementById("scoreboard-title").textContent = "Scores";
  document.getElementById("scoreboard-table-container").innerHTML = buildScoreboardTable(currentGame);
  const nextRoundNumber = currentGame.rounds.length + 1;
  document.getElementById("btn-next-round").textContent = `Manche suivante (${nextRoundNumber}/${currentGame.numRounds})`;
}

document.getElementById("btn-next-round").addEventListener("click", () => {
  renderRoundScreen();
  showScreen("round");
});

// ---------- Fin de partie ----------

function renderFinished() {
  const ranked = rankedPlayers(currentGame);
  const html = ranked
    .map(
      (p, idx) => `
      <div class="ranking-item ${idx === 0 ? "rank-1" : ""}">
        <span><span class="rank-position">#${idx + 1}</span>${escapeHtml(p.name)}</span>
        <strong>${currentGame.totals[p.id] || 0} pts</strong>
      </div>`
    )
    .join("");
  document.getElementById("finished-ranking").innerHTML = html;
}

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
        const ranked = [...g.players].sort((a, b) => (g.totals[b.id] || 0) - (g.totals[a.id] || 0));
        const winner = ranked[0];
        const date = g.createdAt && g.createdAt.toDate ? g.createdAt.toDate().toLocaleDateString("fr-FR") : "";
        return `
          <div class="history-item" data-game-id="${g.id}">
            <div>${g.players.map((p) => escapeHtml(p.name)).join(", ")}</div>
            <div class="history-date">${date} — Gagnant : ${escapeHtml(winner.name)} (${g.totals[winner.id] || 0} pts)</div>
          </div>`;
      })
      .join("");
    container.querySelectorAll(".history-item").forEach((el) => {
      el.addEventListener("click", async () => {
        const game = await getGame(el.dataset.gameId);
        renderHistoryDetail(game);
        showScreen("history-detail");
      });
    });
  } catch (err) {
    console.error(err);
    container.textContent = "Impossible de charger l'historique. Vérifie ta connexion.";
  }
}

function renderHistoryDetail(game) {
  const ranked = [...game.players].sort((a, b) => (game.totals[b.id] || 0) - (game.totals[a.id] || 0));
  const rankingHtml = ranked
    .map(
      (p, idx) => `
      <div class="ranking-item ${idx === 0 ? "rank-1" : ""}">
        <span><span class="rank-position">#${idx + 1}</span>${escapeHtml(p.name)}</span>
        <strong>${game.totals[p.id] || 0} pts</strong>
      </div>`
    )
    .join("");
  document.getElementById("history-detail-content").innerHTML = rankingHtml + buildScoreboardTable(game);
}

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
