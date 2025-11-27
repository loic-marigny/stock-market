import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";

const SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ACCOUNT_JSON) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT secret.");
  process.exit(1);
}

if (!SUPABASE_URL) {
  console.error("Missing SUPABASE_URL secret.");
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY secret.");
  process.exit(1);
}

const DEFAULT_INITIAL_CASH = 1_000_000;
const POSITION_EPSILON = 1e-9;
const SCHEDULED_INTERVAL_MS = 12 * 60 * 60 * 1000;
const ORDER_RETENTION_MS = 24 * 60 * 60 * 1000;

const serviceAccount = JSON.parse(SERVICE_ACCOUNT_JSON);
initializeApp({
  credential: cert(serviceAccount),
});

const firestore = getFirestore();
const priceCache = new Map();

const round6 = (value) => Math.round(value * 1e6) / 1e6;

const sanitizeNumber = (value, fallback) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
};

async function fetchLastPrice(symbol) {
  if (priceCache.has(symbol)) return priceCache.get(symbol);
  const query = new URL(
    `/rest/v1/stock_market_history`,
    SUPABASE_URL,
  );
  query.searchParams.set("select", "close_value,record_value");
  query.searchParams.set("symbol", `eq.${symbol}`);
  query.searchParams.set("order", "record_date.desc");
  query.searchParams.set("limit", "1");

  try {
    const res = await fetch(query.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase HTTP ${res.status}`);
    const payload = await res.json();
    const entry = payload[0];
    const raw =
      sanitizeNumber(entry?.close_value, undefined) ??
      sanitizeNumber(entry?.record_value, undefined);
    const px = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    priceCache.set(symbol, px);
    return px;
  } catch (error) {
    console.error(`Failed to fetch price for ${symbol}:`, error.message);
    priceCache.set(symbol, 0);
    return 0;
  }
}

async function cleanupOrderSnapshots(uid) {
  const cutoffTs = Timestamp.fromMillis(Date.now() - ORDER_RETENTION_MS);
  const colRef = firestore.collection("users").doc(uid).collection("wealthHistory");

  while (true) {
    const snapshot = await colRef
      .where("snapshotType", "==", "order")
      .where("ts", "<", cutoffTs)
      .limit(50)
      .get();

    if (snapshot.empty) break;
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
    if (snapshot.size < 50) break;
  }
}

async function shouldRecordScheduled(uid) {
  const colRef = firestore.collection("users").doc(uid).collection("wealthHistory");
  const latest = await colRef
    .where("snapshotType", "==", "scheduled")
    .orderBy("ts", "desc")
    .limit(1)
    .get();

  const doc = latest.docs.at(0);
  if (!doc) return true;
  const ts = doc.get("ts");
  if (!ts || typeof ts.toMillis !== "function") return true;
  return Date.now() - ts.toMillis() >= SCHEDULED_INTERVAL_MS;
}

async function computeSnapshot(uid, userData) {
  const baseCash =
    sanitizeNumber(userData?.cash, undefined) ??
    sanitizeNumber(userData?.initialCredits, undefined) ??
    DEFAULT_INITIAL_CASH;
  const cash = round6(baseCash);

  const positionsSnap = await firestore
    .collection("users")
    .doc(uid)
    .collection("positions")
    .get();

  const values = [];
  for (const doc of positionsSnap.docs) {
    const data = doc.data();
    const qty = sanitizeNumber(data?.qty, undefined);
    const symbol =
      typeof data?.symbol === "string" && data.symbol.trim()
        ? data.symbol.trim().toUpperCase()
        : doc.id;
    if (!symbol || typeof qty !== "number" || Math.abs(qty) <= POSITION_EPSILON) {
      continue;
    }
    const last = await fetchLastPrice(symbol);
    values.push(round6(qty * last));
  }

  const stocks = round6(values.reduce((acc, value) => acc + value, 0));
  const total = round6(cash + stocks);

  return { cash, stocks, total };
}

async function recordSnapshot(uid, payload) {
  const colRef = firestore.collection("users").doc(uid).collection("wealthHistory");
  await colRef.add({
    ...payload,
    snapshotType: "scheduled",
    source: "gha-scheduled",
    ts: FieldValue.serverTimestamp(),
  });
}

async function main() {
  const usersSnap = await firestore.collection("users").get();
  console.log(`Processing ${usersSnap.size} users...`);

  for (const doc of usersSnap.docs) {
    const uid = doc.id;
    try {
      const needsSnapshot = await shouldRecordScheduled(uid);
      if (!needsSnapshot) {
        await cleanupOrderSnapshots(uid);
        continue;
      }
      const payload = await computeSnapshot(uid, doc.data());
      await recordSnapshot(uid, payload);
      await cleanupOrderSnapshots(uid);
      console.log(`Recorded snapshot for ${uid}`);
    } catch (error) {
      console.error(`Failed snapshot for ${uid}:`, error);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
