import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";
import type {
  ConditionalOrder,
  ConditionalOrderStatus,
  TriggerType,
} from "./conditionalOrders";

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") {
    return new Date(value);
  }
  if (typeof value.toDate === "function") {
    return value.toDate();
  }
  return null;
};

const normalizeTriggerType = (value: any): TriggerType =>
  value === "lte" ? "lte" : "gte";

const normalizeStatus = (value: any): ConditionalOrderStatus => {
  switch (value) {
    case "executing":
    case "triggered":
    case "cancelled":
    case "error":
      return value;
    default:
      return "pending";
  }
};

export function useConditionalOrders(
  uid: string | null | undefined,
): ConditionalOrder[] {
  const [orders, setOrders] = useState<ConditionalOrder[]>([]);

  useEffect(() => {
    if (!uid) {
      setOrders([]);
      return;
    }
    const q = query(
      collection(db, "users", uid, "conditionalOrders"),
      orderBy("createdAt", "asc"),
    );
    return onSnapshot(q, (snapshot) => {
      const mapped: ConditionalOrder[] = snapshot.docs.map((doc) => {
        const data = doc.data() as Record<string, any>;
        return {
          id: doc.id,
          symbol: data.symbol ?? "",
          side: data.side === "sell" ? "sell" : "buy",
          qty: typeof data.qty === "number" ? data.qty : 0,
          triggerPrice:
            typeof data.triggerPrice === "number" ? data.triggerPrice : 0,
          triggerType: normalizeTriggerType(data.triggerType),
          status: normalizeStatus(data.status),
          createdAt: toDate(data.createdAt),
          updatedAt: toDate(data.updatedAt),
          triggeredAt: toDate(data.triggeredAt),
          triggeredPrice:
            typeof data.triggeredPrice === "number"
              ? data.triggeredPrice
              : undefined,
          cancelledAt: toDate(data.cancelledAt),
          executingAt: toDate(data.executingAt),
          lastError: data.lastError ?? null,
        };
      });
      setOrders(mapped);
    });
  }, [uid]);

  return orders;
}
