import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import provider from "./prices";

const DEFAULT_INITIAL_CASH = 1_000_000;
const POSITION_EPSILON = 1e-9;
const STATS_EPSILON = 1e-6;
export const ORDER_SNAPSHOT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const SCHEDULED_SNAPSHOT_INTERVAL_MS = 12 * 60 * 60 * 1000;

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

const sanitizeNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
};

const timestampToMillis = (ts: unknown): number | null => {
  if (!ts) return null;
  if (typeof ts === "number" && Number.isFinite(ts)) return ts;
  if (ts instanceof Date) return ts.getTime();
  if (ts instanceof Timestamp) return ts.toMillis();
  if (typeof (ts as Timestamp)?.toMillis === "function") {
    try {
      return (ts as Timestamp).toMillis();
    } catch {
      return null;
    }
  }
  return null;
};

export type WealthSnapshotType = "order" | "scheduled";

export interface WealthSnapshotPayload {
  cash: number;
  stocks: number;
  total: number;
  ts?: Date;
  source?: string | null;
  snapshotType: WealthSnapshotType;
}

export interface RecordWealthSnapshotOptions {
  source?: string;
  snapshotType?: WealthSnapshotType;
  retentionMs?: number;
}

async function cleanupWealthSnapshots(
  uid: string,
  snapshotType: WealthSnapshotType,
  retentionMs: number,
): Promise<void> {
  const cutoffMs = Date.now() - retentionMs;
  if (cutoffMs <= 0) return;
  const cutoff = Timestamp.fromMillis(cutoffMs);
  const colRef = collection(db, "users", uid, "wealthHistory");

  while (true) {
    const staleQuery = query(
      colRef,
      where("snapshotType", "==", snapshotType),
      where("ts", "<", cutoff),
      limit(50),
    );
    const stale = await getDocs(staleQuery);
    if (stale.empty) break;
    await Promise.all(stale.docs.map((docSnap) => deleteDoc(docSnap.ref)));
    if (stale.size < 50) break;
  }
}

export async function recordWealthSnapshot(
  uid: string | null | undefined,
  options?: RecordWealthSnapshotOptions,
): Promise<void> {
  if (!uid) return;

  const userRef = doc(db, "users", uid);
  const positionsRef = collection(db, "users", uid, "positions");
  const ordersRef = collection(db, "users", uid, "orders");
  const ordersQuery = query(ordersRef, orderBy("ts", "asc"));
  const historyCol = collection(db, "users", uid, "wealthHistory");

  const [userSnap, positionsSnap] = await Promise.all([
    getDoc(userRef),
    getDocs(positionsRef),
  ]);

  const userData = userSnap.exists()
    ? (userSnap.data() as Record<string, unknown>)
    : {};
  const initialCredits =
    sanitizeNumber(userData?.initialCredits) ?? DEFAULT_INITIAL_CASH;
  const baseCash = sanitizeNumber(userData?.cash) ?? initialCredits;
  const cash = round6(baseCash);

  const [positionsList, ordersSnap] = await Promise.all([
    Promise.resolve(positionsSnap.docs ?? []),
    getDocs(ordersQuery),
  ]);

  const positionDocs = positionsList;
  const values = await Promise.all(
    positionDocs.map(async (docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      const qty = sanitizeNumber(data?.qty);
      const symbolRaw =
        typeof data?.symbol === "string" && data.symbol.trim()
          ? data.symbol
          : docSnap.id;
      if (!symbolRaw || typeof qty !== "number") return 0;
      if (Math.abs(qty) <= POSITION_EPSILON) return 0;

      try {
        const px = await provider.getLastPrice(symbolRaw);
        if (!Number.isFinite(px) || px <= 0) return 0;
        return round6(qty * px);
      } catch {
        return 0;
      }
    }),
  );

  const stocks = round6(values.reduce((acc, value) => acc + value, 0));
  const total = round6(cash + stocks);
  const snapshotType: WealthSnapshotType = options?.snapshotType ?? "order";

  const historyRef = doc(historyCol);
  await setDoc(historyRef, {
    cash,
    stocks,
    total,
    source: options?.source ?? "trade",
    snapshotType,
    ts: serverTimestamp(),
  });

  const normalizedOrders = normalizeOrders(ordersSnap.docs ?? []);
  const stats = computeUserStats(initialCredits, total, normalizedOrders);
  const statsRef = doc(db, "users", uid, "user_stats", "summary");
  await setDoc(
    statsRef,
    {
      totalValue: total,
      initialCredits,
      updatedAt: serverTimestamp(),
      ...stats,
    },
    { merge: true },
  );

  if (options?.retentionMs) {
    cleanupWealthSnapshots(uid, snapshotType, options.retentionMs).catch((error) => {
      console.error("Failed to cleanup wealth snapshots", error);
    });
  }
}

export async function ensureScheduledWealthSnapshot(
  uid: string | null | undefined,
): Promise<void> {
  if (!uid) return;
  cleanupWealthSnapshots(uid, "order", ORDER_SNAPSHOT_RETENTION_MS).catch((error) => {
    console.error("Failed to cleanup stale order snapshots", error);
  });
  const colRef = collection(db, "users", uid, "wealthHistory");
  const scheduledQuery = query(
    colRef,
    where("snapshotType", "==", "scheduled"),
    orderBy("ts", "desc"),
    limit(1),
  );
  const snap = await getDocs(scheduledQuery);
  const lastDoc = snap.docs.at(0);
  const lastMillis = timestampToMillis(lastDoc?.data()?.ts);

  if (
    !lastMillis ||
    Date.now() - lastMillis >= SCHEDULED_SNAPSHOT_INTERVAL_MS
  ) {
    await recordWealthSnapshot(uid, {
      source: "scheduled",
      snapshotType: "scheduled",
    });
  }
}

type NormalizedOrder = {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  fillPrice: number;
  ts: number;
};

function normalizeOrders(
  docs: Array<{ data(): Record<string, unknown> }>,
): NormalizedOrder[] {
  return docs
    .map((docSnap) => {
      const data = docSnap.data();
      const symbolRaw = typeof data?.symbol === "string" ? data.symbol.trim().toUpperCase() : "";
      const sideRaw = data?.side === "sell" ? "sell" : data?.side === "buy" ? "buy" : undefined;
      const qty = sanitizeNumber((data as any)?.qty);
      const fillPrice = sanitizeNumber((data as any)?.fillPrice);
      const tsValue = data?.ts;
      let ts = Date.now();
      if (typeof tsValue === "number" && Number.isFinite(tsValue)) {
        ts = tsValue;
      } else if (tsValue instanceof Timestamp) {
        ts = tsValue.toMillis();
      } else if (tsValue instanceof Date) {
        ts = tsValue.getTime();
      }
      if (!symbolRaw || !sideRaw) return null;
      if (typeof qty !== "number" || typeof fillPrice !== "number") return null;
      if (qty <= STATS_EPSILON || fillPrice <= STATS_EPSILON) return null;
      return { symbol: symbolRaw, side: sideRaw, qty, fillPrice, ts };
    })
    .filter((entry): entry is NormalizedOrder => Boolean(entry))
    .sort((a, b) => a.ts - b.ts);
}

type UserStats = {
  tradesCount: number;
  pnl: number;
  roi: number;
  realizedPnl: number;
  wins: number;
  losses: number;
  winRate: number;
  closedTrades: number;
};

function computeUserStats(
  initialCredits: number,
  totalValue: number,
  orders: NormalizedOrder[],
): UserStats {
  const tradesCount = orders.length;
  const pnl = round6(totalValue - initialCredits);
  const roi =
    initialCredits > STATS_EPSILON ? round6((totalValue - initialCredits) / initialCredits) : 0;

  const fifoBooks = new Map<string, Array<{ qty: number; price: number }>>();
  let realizedPnl = 0;
  let wins = 0;
  let losses = 0;
  let closedTrades = 0;

  for (const order of orders) {
    if (!fifoBooks.has(order.symbol)) {
      fifoBooks.set(order.symbol, []);
    }
    const book = fifoBooks.get(order.symbol)!;
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
