import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, orderBy, query, type DocumentReference } from "firebase/firestore";
import { db } from "../firebase";
import provider from "./prices";
import { computeCash, computePositions, type Order, type Position } from "./portfolio";

export interface PortfolioSnapshot {
  orders: Order[];
  positions: Record<string, Position>;
  prices: Record<string, number>;
  cash: number;
  marketValue: number;
  totalValue: number;
  initialCredits: number;
  loadingPrices: boolean;
  loadingInitial: boolean;
}

const DEFAULT_INITIAL = 1_000_000;
const EPSILON = 1e-9;

function normalizePrice(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
}

export function usePortfolioSnapshot(uid: string | null | undefined): PortfolioSnapshot {
  const [orders, setOrders] = useState<Order[]>([]);
  const [initialCredits, setInitialCredits] = useState<number>(DEFAULT_INITIAL);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [loadingPrices, setLoadingPrices] = useState<boolean>(false);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);

  useEffect(() => {
    if (!uid) {
      setOrders([]);
      return;
    }
    const qRef = query(collection(db, "users", uid, "orders"), orderBy("ts", "asc"));
    return onSnapshot(qRef, snap => {
      const arr: Order[] = snap.docs.map(d => d.data() as Order);
      setOrders(arr);
    });
  }, [uid]);

  useEffect(() => {
    let cancelled = false;
    if (!uid) {
      setInitialCredits(DEFAULT_INITIAL);
      setLoadingInitial(false);
      return;
    }
    setLoadingInitial(true);
    (async () => {
      try {
        const ref: DocumentReference = doc(db, "users", uid);
        const snap = await getDoc(ref);
        if (cancelled) return;
        const raw = snap.exists() ? (snap.data() as any)?.initialCredits : undefined;
        const next = typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_INITIAL;
        setInitialCredits(next);
      } catch {
        if (!cancelled) setInitialCredits(DEFAULT_INITIAL);
      } finally {
        if (!cancelled) setLoadingInitial(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const positions = useMemo(() => computePositions(orders), [orders]);
  const cash = useMemo(() => computeCash(initialCredits, orders), [initialCredits, orders]);

  const heldSymbols = useMemo(() => {
    return Object.entries(positions)
      .filter(([, p]) => Math.abs(p.qty) > EPSILON)
      .map(([sym]) => sym)
      .sort();
  }, [positions]);
  const heldKey = heldSymbols.join("|");

  useEffect(() => {
    let cancelled = false;
    if (!heldSymbols.length) {
      setPrices({});
      setLoadingPrices(false);
      return () => { cancelled = true; };
    }
    setLoadingPrices(true);
    (async () => {
      const fetched: Record<string, number> = {};
      for (const sym of heldSymbols) {
        try {
          const px = await provider.getLastPrice(sym);
          const valid = normalizePrice(px);
          if (typeof valid === "number") fetched[sym] = valid;
        } catch {
          // ignore individual failures; we will fallback to previous value if any
        }
        if (cancelled) return;
      }
      if (cancelled) return;
      setPrices(prev => {
        const next: Record<string, number> = {};
        for (const sym of heldSymbols) {
          if (sym in fetched) {
            next[sym] = fetched[sym];
          } else if (sym in prev) {
            next[sym] = prev[sym];
          } else {
            next[sym] = 0;
          }
        }
        return next;
      });
      setLoadingPrices(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [heldKey]);

  const marketValue = useMemo(() => {
    let total = 0;
    for (const [sym, pos] of Object.entries(positions)) {
      const qty = pos.qty;
      if (Math.abs(qty) <= EPSILON) continue;
      const px = prices[sym];
      if (typeof px === "number" && Number.isFinite(px)) {
        total += qty * px;
      }
    }
    return total;
  }, [positions, prices]);

  const totalValue = cash + marketValue;

  return {
    orders,
    positions,
    prices,
    cash,
    marketValue,
    totalValue,
    initialCredits,
    loadingPrices,
    loadingInitial,
  };
}
