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
  const historyCol = collection(db, "users", uid, "wealthHistory");

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
