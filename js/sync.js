import * as local from "./localdb.js";
import { fetchRemote, replaceLocalState } from "./db.js";

export async function syncFromServer(supabase) {
  const state = await fetchRemote(supabase);
  await replaceLocalState(state);
  return state;
}

export async function queueOperation(operation) {
  const id = crypto.randomUUID();
  await local.put("pending_ops", { id, ...operation, created_at: new Date().toISOString() });
  return id;
}

export async function pendingOperations() {
  return local.getAll("pending_ops");
}

export async function removeOperation(id) {
  return local.remove("pending_ops", id);
}
