import {
  addDoc,
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import type { SpotSide } from "./trading";
import { submitSpotOrder } from "./trading";

export type TriggerType = "gte" | "lte";
export type ConditionalOrderStatus =
  | "pending"
  | "executing"
  | "triggered"
  | "cancelled"
  | "error";

export interface ConditionalOrder {
  id: string;
  symbol: string;
  side: SpotSide;
  qty: number;
  triggerPrice: number;
  triggerType: TriggerType;
  status: ConditionalOrderStatus;
  createdAt: Date | null;
  updatedAt: Date | null;
  triggeredAt?: Date | null;
  triggeredPrice?: number;
  cancelledAt?: Date | null;
  executingAt?: Date | null;
  lastError?: string | null;
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

const normalizeNumber = (value: unknown): number => {
  if (typeof value !== "number") return 0;
  if (!Number.isFinite(value)) return 0;
  return value;
};

const normalizeSymbol = (value: string): string => {
  return value?.trim().toUpperCase() || "";
};

const conditionalOrdersCollection = (uid: string) =>
  collection(db, "users", uid, "conditionalOrders");

const conditionalOrderDoc = (uid: string, orderId: string) =>
  doc(db, "users", uid, "conditionalOrders", orderId);

export interface ScheduleConditionalOrderParams {
  uid: string;
  symbol: string;
  side: SpotSide;
  qty: number;
  triggerPrice: number;
  triggerType: TriggerType;
  note?: string;
}

export async function scheduleConditionalOrder(
  params: ScheduleConditionalOrderParams,
): Promise<void> {
  const symbol = normalizeSymbol(params.symbol);
  const qty = round6(params.qty);
  const triggerPrice = normalizeNumber(params.triggerPrice);
  if (!symbol) throw new Error("Symbol is required.");
  if (qty <= 0) throw new Error("Quantity must be positive.");
  if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) {
    throw new Error("Trigger price must be positive.");
  }

  await addDoc(conditionalOrdersCollection(params.uid), {
    symbol,
    side: params.side,
    qty,
    triggerPrice,
    triggerType: params.triggerType,
    status: "pending" satisfies ConditionalOrderStatus,
    note: params.note ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function cancelConditionalOrder(
  uid: string,
  orderId: string,
): Promise<void> {
  await updateDoc(conditionalOrderDoc(uid, orderId), {
    status: "cancelled" satisfies ConditionalOrderStatus,
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function executeConditionalOrder(params: {
  uid: string;
  order: ConditionalOrder;
  fillPrice: number;
}): Promise<boolean> {
  const { uid, order, fillPrice } = params;
  if (!order?.id) return false;
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) return false;

  const docRef = conditionalOrderDoc(uid, order.id);
  const locked = await runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists()) return false;
    const data = snap.data() as Partial<ConditionalOrder>;
    if (data.status && data.status !== "pending") {
      return false;
    }
    tx.update(docRef, {
      status: "executing",
      executingAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastSeenPrice: fillPrice,
    });
    return true;
  });

  if (!locked) return false;

  try {
    await submitSpotOrder({
      uid,
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      fillPrice,
      type: "CONDITIONAL",
      extra: {
        triggerPrice: order.triggerPrice,
        triggerType: order.triggerType,
        conditionalOrderId: order.id,
      },
    });

    await updateDoc(docRef, {
      status: "triggered",
      triggeredAt: serverTimestamp(),
      triggeredPrice: fillPrice,
      updatedAt: serverTimestamp(),
      lastError: null,
    });
    return true;
  } catch (error) {
    await updateDoc(docRef, {
      status: "error",
      updatedAt: serverTimestamp(),
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
