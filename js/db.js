import * as local from "./localdb.js";

const TABLES = ["items", "kits", "kit_items", "sales"];

export async function loadLocalState() {
  const out = {};
  for (const t of TABLES) out[t] = await local.getAll(t);
  return out;
}

export async function replaceLocalState(state) {
  for (const t of TABLES) {
    await local.clear(t);
    for (const row of state[t] || []) await local.put(t, row);
  }
  await local.setMeta("lastSync", new Date().toISOString());
}

export async function upsertLocal(table, row) { return local.put(table, row); }
export async function deleteLocal(table, id) { return local.remove(table, id); }

export async function fetchRemote(supabase) {
  const out = {};
  for (const t of TABLES) {
    const { data, error } = await supabase.from(t).select("*");
    if (error) throw error;
    out[t] = data || [];
  }
  return out;
}

export async function insertRemote(supabase, table, row) {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function updateRemote(supabase, table, id, patch) {
  const { data, error } = await supabase.from(table).update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteRemote(supabase, table, id) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw error;
}

export async function fetchKitItemsForKit(supabase, kitId) {
  const { data, error } = await supabase.from("kit_items").select("*").eq("kit_id", kitId);
  if (error) throw error;
  return data || [];
}

export async function clearRemoteSales(supabase) {
  const { error } = await supabase.from("sales").delete().not("id", "is", null);
  if (error) throw error;
}
