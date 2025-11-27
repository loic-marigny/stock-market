import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import type { QueryDocumentSnapshot, Timestamp } from "firebase/firestore";
import { db } from "../firebase";
import { ensureScheduledWealthSnapshot, type WealthSnapshotType } from "./wealthHistory";

export interface WealthHistoryPoint {
  id: string;
  cash: number;
  stocks: number;
  total: number;
  ts: Date | null;
  source?: string | null;
  snapshotType?: WealthSnapshotType | null;
}

const sanitizeNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return 0;
};

const tsToDate = (ts: unknown): Date | null => {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof (ts as Timestamp)?.toDate === "function") {
    return (ts as Timestamp).toDate();
  }
  return null;
};

const docToPoint = (docSnap: QueryDocumentSnapshot): WealthHistoryPoint => {
  const data = docSnap.data() as Record<string, unknown>;
  return {
    id: docSnap.id,
    cash: sanitizeNumber(data?.cash),
    stocks: sanitizeNumber(data?.stocks),
    total: sanitizeNumber(data?.total),
    ts: tsToDate(data?.ts),
    source: typeof data?.source === "string" ? data.source : null,
    snapshotType: typeof data?.snapshotType === "string" ? (data.snapshotType as WealthSnapshotType) : null,
  };
};

export function useWealthHistory(uid: string | null | undefined): {
  history: WealthHistoryPoint[];
  loading: boolean;
} {
  const [history, setHistory] = useState<WealthHistoryPoint[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!uid) return;
    ensureScheduledWealthSnapshot(uid).catch((error) => {
      console.error("Failed to ensure scheduled wealth snapshot", error);
    });
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setHistory([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(
      collection(db, "users", uid, "wealthHistory"),
      orderBy("ts", "asc"),
    );
    return onSnapshot(
      q,
      (snapshot) => {
        const entries = snapshot.docs.map(docToPoint);
        setHistory(entries);
        setLoading(false);
      },
      (error) => {
        console.error("Failed to load wealth history", error);
        setHistory([]);
        setLoading(false);
      },
    );
  }, [uid]);

  return { history, loading };
}
