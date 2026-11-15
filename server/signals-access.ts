import { hasSignalsSubscription } from "./stripe";

export async function hasSignalsGrant(db: D1Database, userId: string) {
  return Boolean(await db.prepare("select 1 from signals_access_grants where user_id = ?").bind(userId).first<number>());
}

export async function hasSignalsAccess(db: D1Database, userId: string) {
  return await hasSignalsGrant(db, userId).catch(() => false) || await hasSignalsSubscription(db, userId);
}
