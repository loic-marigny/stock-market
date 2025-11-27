import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
  type DocumentSnapshot,
} from "firebase/firestore";
import { db } from "../firebase";
import { recordWealthSnapshot } from "./wealthHistory";

export type SpotSide = "buy" | "sell";

export interface SpotOrderParams {
  uid: string;
  symbol: string;
  side: SpotSide;
  qty: number;
  fillPrice: number;
  type?: string;
  lotTimestamp?: number;
  extra?: Record<string, unknown>;
}

const FIFO_EPSILON = 1e-9;
const DEFAULT_INITIAL_CASH = 1_000_000;

type FifoLotDoc = {
  qty: number;
  price: number;
  ts: number;
};

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

const sanitizeNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
};

const normalizeFifoLots = (raw: unknown): FifoLotDoc[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return undefined;
      const qty = sanitizeNumber((entry as any).qty);
      const price = sanitizeNumber((entry as any).price);
      const tsCandidate = (entry as any).ts;
      const ts =
        typeof tsCandidate === "number" && Number.isFinite(tsCandidate) ? tsCandidate : 0;
      if (typeof qty !== "number" || typeof price !== "number") return undefined;
      if (qty <= FIFO_EPSILON) return undefined;
      return { qty, price, ts };
    })
    .filter((lot): lot is FifoLotDoc => Boolean(lot))
    .sort((a, b) => a.ts - b.ts);
};

const computeCashAfterDelta = (
  snapshot: DocumentSnapshot | null,
  delta: number,
  fallbackInitial = DEFAULT_INITIAL_CASH,
): number => {
  const data = snapshot?.exists() ? (snapshot.data() as Record<string, unknown>) : {};
  const base =
    sanitizeNumber(data?.cash) ??
    sanitizeNumber(data?.initialCredits) ??
    fallbackInitial;
  return round6(base + delta);
};

const computeFifoPositionPayload = (
  snapshot: DocumentSnapshot | null,
  symbol: string,
  side: SpotSide,
  qty: number,
  price: number,
  ts: number,
) => {
  const data = snapshot?.exists() ? (snapshot.data() as Record<string, unknown>) : {};
  const currentLots = normalizeFifoLots((data as any).lots);
  let nextLots: FifoLotDoc[];

  if (side === "buy") {
    nextLots = [...currentLots, { qty: round6(qty), price, ts }];
  } else {
    let remaining = qty;
    const updated: FifoLotDoc[] = [];
    for (const lot of currentLots) {
      if (remaining <= FIFO_EPSILON) {
        updated.push(lot);
        continue;
      }
      const consume = Math.min(lot.qty, remaining);
      const leftover = lot.qty - consume;
      remaining -= consume;
      if (leftover > FIFO_EPSILON) {
        updated.push({ ...lot, qty: round6(leftover) });
      }
    }
    if (remaining > FIFO_EPSILON) {
      throw new Error("Insufficient FIFO lots to settle sell order.");
    }
    nextLots = updated;
  }

  nextLots = nextLots
    .filter((lot) => lot.qty > FIFO_EPSILON)
    .map((lot) => ({ ...lot, qty: round6(lot.qty), price: round6(lot.price) }))
    .sort((a, b) => a.ts - b.ts);

  const totalQty = nextLots.reduce((acc, lot) => acc + lot.qty, 0);
  const totalCost = nextLots.reduce((acc, lot) => acc + lot.qty * lot.price, 0);
  const avgPrice = totalQty > FIFO_EPSILON ? round6(totalCost / totalQty) : 0;

  return {
    symbol,
    qty: round6(totalQty),
    avgPrice,
    lots: nextLots,
    updatedAt: ts,
  };
};

export async function submitSpotOrder(params: SpotOrderParams): Promise<void> {
  const {
    uid,
    symbol,
    side,
    qty,
    fillPrice,
    type = "MARKET",
    lotTimestamp = Date.now(),
    extra,
  } = params;

  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Quantity must be positive.");
  }
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
    throw new Error("Price must be positive.");
  }

  const ordRef = doc(collection(db, "users", uid, "orders"));
  const userRef: DocumentReference = doc(db, "users", uid);
  const positionRef: DocumentReference = doc(db, "users", uid, "positions", symbol);
  const cashDelta = (side === "buy" ? -1 : 1) * qty * fillPrice;

  await runTransaction(db, async (tx) => {
    const [userSnap, positionSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(positionRef),
    ]);

    const nextCash = computeCashAfterDelta(userSnap, cashDelta);
    const positionPayload = computeFifoPositionPayload(positionSnap, symbol, side, qty, fillPrice, lotTimestamp);

    tx.set(userRef, { cash: nextCash }, { merge: true });
    tx.set(positionRef, positionPayload, { merge: true });
    tx.set(ordRef, {
      symbol,
      side,
      qty,
      type,
      status: "filled",
      fillPrice,
      ts: serverTimestamp(),
      ...(extra ?? {}),
    });
  });

  const sourceLabel = typeof extra?.source === "string" ? extra.source : undefined;
  recordWealthSnapshot(uid, { source: sourceLabel }).catch((error) => {
    console.error("Failed to record wealth snapshot", error);
  });
}
