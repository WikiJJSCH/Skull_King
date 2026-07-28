// Wrapper Firestore - centralise tous les accès à la base de données.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

let db = null;

export function initDb() {
  if (!db) {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  }
  return db;
}

const GAMES_COLLECTION = "games";

export async function createGame(gameData) {
  const database = initDb();
  const docRef = await addDoc(collection(database, GAMES_COLLECTION), {
    ...gameData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function updateGame(gameId, partialData) {
  const database = initDb();
  const ref = doc(database, GAMES_COLLECTION, gameId);
  await updateDoc(ref, {
    ...partialData,
    updatedAt: serverTimestamp(),
  });
}

export async function getGame(gameId) {
  const database = initDb();
  const ref = doc(database, GAMES_COLLECTION, gameId);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function deleteGame(gameId) {
  const database = initDb();
  const ref = doc(database, GAMES_COLLECTION, gameId);
  await deleteDoc(ref);
}

// Tri effectué côté client (et non via orderBy Firestore) pour éviter d'exiger
// un index composite manuel sur (status, updatedAt/createdAt) côté Firebase.
function toMillis(ts) {
  return ts && typeof ts.toMillis === "function" ? ts.toMillis() : 0;
}

export async function getInProgressGame() {
  const database = initDb();
  const q = query(collection(database, GAMES_COLLECTION), where("status", "==", "in_progress"));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const games = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  games.sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
  return games[0];
}

export async function listFinishedGames() {
  const database = initDb();
  const q = query(collection(database, GAMES_COLLECTION), where("status", "==", "finished"));
  const snap = await getDocs(q);
  const games = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  games.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  return games;
}
