import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import provider from "./prices";

const DEFAULT_INITIAL_CASH = 1_000_000;
const POSITION_EPSILON = 1e-9;

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

const sanitizeNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
};

export interface WealthSnapshotPayload {
  cash: number;
  stocks: number;
  total: number;
  ts?: Date;
  source?: string | null;
}

export interface RecordWealthSnapshotOptions {
  source?: string;
}

export async function recordWealthSnapshot(
  uid: string | null | undefined,
  options?: RecordWealthSnapshotOptions,
): Promise<void> {
  if (!uid) return;

  const userRef = doc(db, "users", uid);
  const positionsRef = collection(db, "users", uid, "positions");

  const [userSnap, positionsSnap] = await Promise.all([
    getDoc(userRef),
    getDocs(positionsRef),
  ]);

  const userData = userSnap.exists()
    ? (userSnap.data() as Record<string, unknown>)
    : {};
  const baseCash =
    sanitizeNumber(userData?.cash) ??
    sanitizeNumber(userData?.initialCredits) ??
    DEFAULT_INITIAL_CASH;
  const cash = round6(baseCash);

  const positionDocs = positionsSnap.docs ?? [];
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

  const historyRef = doc(collection(db, "users", uid, "wealthHistory"));
  await setDoc(historyRef, {
    cash,
    stocks,
    total,
    source: options?.source ?? "trade",
    ts: serverTimestamp(),
  });
}
