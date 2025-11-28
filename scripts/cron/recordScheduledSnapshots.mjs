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
const STATS_EPSILON = 1e-6;
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
  const initialCredits =
    sanitizeNumber(userData?.initialCredits, undefined) ?? DEFAULT_INITIAL_CASH;
  const baseCash =
    sanitizeNumber(userData?.cash, undefined) ?? initialCredits;
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

  return { cash, stocks, total, initialCredits };
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

async function fetchOrders(uid) {
  const snap = await firestore
    .collection("users")
    .doc(uid)
    .collection("orders")
    .orderBy("ts", "asc")
    .get();
  return snap.docs
    .map((docSnap) => {
      const data = docSnap.data();
      const symbol =
        typeof data?.symbol === "string" ? data.symbol.trim().toUpperCase() : "";
      const side = data?.side === "buy" || data?.side === "sell" ? data.side : null;
      const qty = sanitizeNumber(data?.qty, undefined);
      const fillPrice = sanitizeNumber(data?.fillPrice, undefined);
      const tsValue = data?.ts;
      let ts = Date.now();
      if (typeof tsValue === "number" && Number.isFinite(tsValue)) {
        ts = tsValue;
      } else if (tsValue instanceof Timestamp) {
        ts = tsValue.toMillis();
      } else if (tsValue instanceof Date) {
        ts = tsValue.getTime();
      }
      if (!symbol || !side) return null;
      if (typeof qty !== "number" || typeof fillPrice !== "number") return null;
      if (qty <= STATS_EPSILON || fillPrice <= STATS_EPSILON) return null;
      return { symbol, side, qty, fillPrice, ts };
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);
}

function computeUserStats(initialCredits, totalValue, orders) {
  const tradesCount = orders.length;
  const pnl = round6(totalValue - initialCredits);
  const roi =
    initialCredits > STATS_EPSILON
      ? round6((totalValue - initialCredits) / initialCredits)
      : 0;

  const books = new Map();
  let realizedPnl = 0;
  let wins = 0;
  let losses = 0;
  let closedTrades = 0;

  for (const order of orders) {
    if (!books.has(order.symbol)) {
      books.set(order.symbol, []);
    }
    const book = books.get(order.symbol);
    if (order.side === "buy") {
      book.push({ qty: order.qty, price: order.fillPrice });
      continue;
    }

    let remaining = order.qty;
    let orderPnl = 0;
    while (remaining > STATS_EPSILON && book.length) {
      const lot = book[0];
      const consume = Math.min(lot.qty, remaining);
      orderPnl += (order.fillPrice - lot.price) * consume;
      lot.qty -= consume;
      remaining -= consume;
      if (lot.qty <= STATS_EPSILON) {
        book.shift();
      }
    }

    if (remaining <= STATS_EPSILON) {
      realizedPnl += orderPnl;
      closedTrades += 1;
      if (orderPnl > STATS_EPSILON) {
        wins += 1;
      } else if (orderPnl < -STATS_EPSILON) {
        losses += 1;
      }
    }
  }

  const winRate = closedTrades > 0 ? wins / closedTrades : 0;

  return {
    tradesCount,
    pnl,
    roi,
    realizedPnl: round6(realizedPnl),
    wins,
    losses,
    winRate,
    closedTrades,
  };
}

async function updateUserStats(uid, initialCredits, totalValue, stats) {
  const docRef = firestore.collection("users").doc(uid).collection("user_stats").doc("summary");
  await docRef.set(
    {
      ...stats,
      totalValue,
      initialCredits,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
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
      const orders = await fetchOrders(uid);
      await recordSnapshot(uid, payload);
      const stats = computeUserStats(payload.initialCredits, payload.total, orders);
      await updateUserStats(uid, payload.initialCredits, payload.total, stats);
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
