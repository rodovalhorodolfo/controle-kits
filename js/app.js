import { createSupabaseClient } from "./supabase.js";
import { createAuth } from "./auth.js";
import * as db from "./db.js";
import * as local from "./localdb.js";
import { syncFromServer } from "./sync.js";

let supabase;
let auth;
let user = null;
let state = { items: [], kits: [], kit_items: [], sales: [] };

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[m]));

function todayLocal() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0,10);
}

function showMsg(id, text, ok=true) {
  const e = $(id);
  if (!e) return;
  e.textContent = text;
  e.className = "msg " + (ok ? "ok" : "err");
  clearTimeout(e._timer);
  e._timer = setTimeout(() => e.className = "msg", 4000);
}

function setOnlineStatus() {
  const banner = $("offlineBanner");
  if (banner) banner.classList.toggle("hidden", navigator.onLine);
}

function renderLogin(authorized = false, checking = false) {
  const logged = !!user;
  const canUseApp = logged && authorized && !checking;
  $("loginPanel").classList.toggle("hidden", canUseApp);
  $("app").classList.toggle("hidden", !canUseApp);
  $("loginBtn").classList.toggle("hidden", logged || checking);
  $("loginBtn2").classList.toggle("hidden", logged || checking);
  $("logoutBtn").classList.toggle("hidden", !logged);
  $("userEmail").textContent = logged ? user.email : "";
  if (checking) showMsg("msgGlobal", "Verificando autorização...", true);
}

function getItems() {
  return [...state.items].filter(x => x.ativo !== false)
    .sort((a,b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function getAllItems() {
  return [...state.items].sort((a,b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function getKits() {
  return [...state.kits].filter(k => k.ativo !== false)
    .sort((a,b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function compositionForKit(kitId) {
  return state.kit_items
    .filter(x => x.kit_id === kitId)
    .map(x => ({
      ...x,
      itemObj: state.items.find(i => i.id === x.item_id)
    }))
    .filter(x => x.itemObj);
}

function renderItemSelects() {
  const active = getItems();
  const options = active.length
    ? active.map(i => `<option value="${esc(i.id)}">${esc(i.nome)}</option>`).join("")
    : `<option value="">Nenhum item cadastrado</option>`;

  for (const id of ["primeiroItemKit", "composicaoItem"]) {
    const el = $(id);
    if (!el) continue;
    const old = el.value;
    el.innerHTML = options;
    if (active.some(i => i.id === old)) el.value = old;
  }
}

function renderKitSelect() {
  const kits = getKits();
  const el = $("composicaoKit");
  if (!el) return;
  const old = el.value;
  el.innerHTML = kits.length
    ? kits.map(k => `<option value="${esc(k.id)}">${esc(k.nome)}</option>`).join("")
    : `<option value="">Nenhum kit cadastrado</option>`;
  if (kits.some(k => k.id === old)) el.value = old;
}

function renderProductSelect() {
  const tipo = $("tipoVenda").value;
  const arr = tipo === "kit"
    ? getKits().map(k => ({id:k.id, name:k.nome}))
    : getItems().map(i => ({id:i.id, name:i.nome}));
  $("produtoVenda").innerHTML = arr.length
    ? arr.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")
    : `<option value="">Nenhum cadastrado</option>`;
}

function consolidation() {
  const direct = {};
  const inside = {};
  for (const v of state.sales) {
    const q = Number(v.quantidade) || 0;
    if (v.tipo === "item") {
      direct[v.produto] = (direct[v.produto] || 0) + q;
      continue;
    }
    const comp = Array.isArray(v.composicao) ? v.composicao : [];
    for (const row of comp) {
      const item = String(row.item || "").trim();
      if (!item) continue;
      inside[item] = (inside[item] || 0) + q * Number(row.quantidade || 0);
    }
  }
  const names = [...new Set([
    ...getAllItems().map(i => i.nome),
    ...Object.keys(direct),
    ...Object.keys(inside)
  ])].sort((a,b) => a.localeCompare(b, "pt-BR"));

  return names.map(item => ({
    item,
    direct: direct[item] || 0,
    inside: inside[item] || 0,
    total: (direct[item] || 0) + (inside[item] || 0)
  }));
}

function renderItems() {
  const rows = getAllItems().map(i => `
    <tr>
      <td>${esc(i.nome)}</td>
      <td>${i.ativo ? "Ativo" : "Inativo"}</td>
      <td>
        <button class="secondary" data-toggle-item="${esc(i.id)}">${i.ativo ? "Inativar" : "Reativar"}</button>
        <button class="danger" data-delete-item-master="${esc(i.id)}">Excluir</button>
      </td>
    </tr>`).join("");
  $("listaItens").innerHTML = rows || `<tr><td colspan="3">Nenhum item cadastrado.</td></tr>`;
}

function renderKits() {
  const html = getKits().map(k => {
    const comp = compositionForKit(k.id);
    const rows = comp.map(x => `
      <div class="kit-item-row">
        <span>${esc(x.itemObj.nome)}</span>
        <span class="num">${x.quantidade}</span>
        <button class="danger" data-delete-kit-item="${esc(x.id)}">Excluir</button>
      </div>`).join("");
    return `
      <details class="kit-group">
        <summary><strong>${esc(k.nome)}</strong><span class="muted">${comp.length} ${comp.length === 1 ? "item" : "itens"}</span></summary>
        <div class="kit-group-body">
          ${rows}
          <div class="kit-group-actions">
            <button class="danger" data-delete-kit="${esc(k.id)}">Excluir kit</button>
          </div>
        </div>
      </details>`;
  }).join("");
  $("listaKits").innerHTML = html || `<div class="muted">Nenhum kit cadastrado.</div>`;
}

function renderSales() {
  const sales = [...state.sales].sort((a,b) => {
    const d = String(b.data).localeCompare(String(a.data));
    return d || String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });
  $("listaVendas").innerHTML = sales.map(x => `
    <tr>
      <td>${esc(x.data)}</td>
      <td>${esc(x.produto)}</td>
      <td>${x.tipo === "kit" ? "Kit" : "Item"}</td>
      <td class="num">${x.quantidade}</td>
      <td><button class="danger" data-delete-sale="${esc(x.id)}">Excluir</button></td>
    </tr>`).join("") || `<tr><td colspan="5">Nenhuma venda registrada.</td></tr>`;
}

function renderResult() {
  const c = consolidation();
  $("resultadoItens").innerHTML = c.map(x => `
    <tr><td>${esc(x.item)}</td><td class="num">${x.direct}</td><td class="num">${x.inside}</td><td class="num"><b>${x.total}</b></td></tr>
  `).join("") || `<tr><td colspan="4">Nenhum item vendido.</td></tr>`;
  $("totalVendas").textContent = state.sales.length;
  $("totalKits").textContent = state.sales.filter(x => x.tipo === "kit")
    .reduce((s,x) => s + Number(x.quantidade || 0), 0);
  $("totalItens").textContent = c.reduce((s,x) => s + x.total, 0);
}

function render() {
  renderItemSelects();
  renderKitSelect();
  renderProductSelect();
  renderItems();
  renderKits();
  renderSales();
  renderResult();
  local.getMeta("lastSync").then(x => {
    $("syncInfo").textContent = x
      ? `Última sincronização: ${new Date(x).toLocaleString("pt-BR")}`
      : "Ainda não sincronizado.";
  });
}

async function ensureAuthorized() {
  if (!user) return false;
  const { data: claimed, error: claimError } = await supabase.rpc("claim_allowed_user");
  if (claimError) throw claimError;
  if (!claimed) {
    await supabase.auth.signOut();
    throw new Error("Sua conta Google foi autenticada, mas não está autorizada no sistema.");
  }
  const { data, error } = await supabase.from("allowed_users")
    .select("user_id,email,ativo")
    .eq("user_id", user.id).eq("ativo", true).maybeSingle();
  if (error) throw error;
  if (!data) {
    await supabase.auth.signOut();
    throw new Error("Sua conta Google foi autenticada, mas não está autorizada no sistema.");
  }
  return true;
}

async function loadData() {
  try {
    state = await syncFromServer(supabase);
  } catch (e) {
    state = await db.loadLocalState();
    showMsg("msgGlobal", "Não foi possível sincronizar. Usando o cache local.", false);
  }
  render();
  setKitMode(novoKitMode);
}

async function registerItem() {
  const nome = $("novoItemNome").value.trim();
  if (!nome) return showMsg("msgItem", "Informe o nome do item.", false);
  try {
    const exists = state.items.some(i => i.nome.trim().toLocaleLowerCase() === nome.toLocaleLowerCase());
    if (exists) return showMsg("msgItem", "Já existe um item com esse nome.", false);
    const row = await db.insertRemote(supabase, "items", { nome, ativo:true, created_by:user.id });
    state.items.push(row);
    await local.put("items", row);
    $("novoItemNome").value = "";
    render();
    showMsg("msgItem", "Item cadastrado.");
  } catch (e) {
    showMsg("msgItem", e.message || "Erro ao cadastrar item.", false);
  }
}

async function toggleItem(id) {
  const item = state.items.find(x => x.id === id);
  if (!item) return;
  try {
    const row = await db.updateRemote(supabase, "items", id, { ativo: !item.ativo, updated_at: new Date().toISOString() });
    state.items = state.items.map(x => x.id === id ? row : x);
    await local.put("items", row);
    render();
  } catch (e) {
    showMsg("msgItem", e.message || "Erro ao alterar item.", false);
  }
}

async function deleteMasterItem(id) {
  const item = state.items.find(x => x.id === id);
  if (!item) return;
  const used = state.kit_items.some(x => x.item_id === id);
  if (used) return showMsg("msgItem", "Este item está em um ou mais kits. Inative-o em vez de excluí-lo.", false);
  if (!confirm(`Excluir o item "${item.nome}"?`)) return;
  try {
    await db.deleteRemote(supabase, "items", id);
    state.items = state.items.filter(x => x.id !== id);
    await local.remove("items", id);
    render();
    showMsg("msgItem", "Item excluído.");
  } catch (e) {
    showMsg("msgItem", e.message || "Erro ao excluir item.", false);
  }
}

let novoKitMode = false;

function setKitMode(novo) {
  novoKitMode = Boolean(novo);

  const existingWrap = $("kitExistenteWrap");
  const newWrap = $("novoKitNomeWrap");
  const toggle = $("novoKitToggle");
  const action = $("kitAction");
  const help = $("kitModeHelp");
  const kitSelect = $("composicaoKit");
  const itemSelect = $("composicaoItem");
  const hasItems = getItems().length > 0;
  const hasKits = getKits().length > 0;

  if (novoKitMode && !hasItems) {
    novoKitMode = false;
    showMsg("msgKit", "Nenhum item cadastrado. Cadastre pelo menos um item antes de criar um kit.", false);
  }

  existingWrap.classList.toggle("hidden", novoKitMode);
  newWrap.classList.toggle("hidden", !novoKitMode);

  toggle.className = novoKitMode ? "primary" : "secondary";
  toggle.textContent = novoKitMode ? "✓ Novo kit" : "＋ Novo kit";

  action.textContent = novoKitMode ? "Cadastrar kit" : "Adicionar item";

  if (novoKitMode) {
    help.textContent = "Digite o nome do novo kit, selecione o primeiro item e informe a quantidade.";
    kitSelect.disabled = true;
    itemSelect.disabled = !hasItems;
  } else {
    help.textContent = hasKits
      ? "Selecione um kit existente para adicionar um item à composição."
      : "Nenhum kit cadastrado. Clique em “＋ Novo kit” para criar o primeiro.";
    kitSelect.disabled = !hasKits;
    itemSelect.disabled = !hasItems;
  }
}

async function createKitWithFirstItem() {
  const nome = $("novoKitNome").value.trim();
  const itemId = $("composicaoItem").value;
  const quantidade = Number($("composicaoQtd").value);

  if (!getItems().length)
    return showMsg("msgKit", "Nenhum item cadastrado. Cadastre pelo menos um item antes de criar um kit.", false);

  if (!nome || !itemId || !Number.isFinite(quantidade) || quantidade <= 0)
    return showMsg("msgKit", "Informe o nome do novo kit, selecione o primeiro item e informe uma quantidade válida.", false);

  try {
    const { data, error } = await supabase.rpc("create_kit_with_item", {
      p_nome: nome,
      p_item_id: itemId,
      p_quantidade: quantidade
    });
    if (error) throw error;

    const kit = data;
    state.kits.push(kit);

    const remote = await db.fetchKitItemsForKit(supabase, kit.id);
    state.kit_items.push(...remote);

    await local.put("kits", kit);
    for (const row of remote) await local.put("kit_items", row);

    $("novoKitNome").value = "";
    $("composicaoQtd").value = "1";
    setKitMode(false);
    render();
    $("composicaoKit").value = kit.id;
    showMsg("msgKit", "Kit cadastrado com o primeiro item.");
  } catch (e) {
    showMsg("msgKit", e.message || "Erro ao cadastrar kit.", false);
  }
}

async function addItemToKit() {
  const kitId = $("composicaoKit").value;
  const itemId = $("composicaoItem").value;
  const quantidade = Number($("composicaoQtd").value);

  if (!kitId || !itemId || !Number.isFinite(quantidade) || quantidade <= 0)
    return showMsg("msgKit", "Selecione um kit, um item e uma quantidade válida.", false);

  if (state.kit_items.some(x => x.kit_id === kitId && x.item_id === itemId))
    return showMsg("msgKit", "Esse item já está na composição do kit. Exclua o registro atual antes de cadastrar novamente.", false);

  try {
    const row = await db.insertRemote(supabase, "kit_items", {
      kit_id: kitId, item_id: itemId, quantidade, created_by:user.id
    });
    state.kit_items.push(row);
    await local.put("kit_items", row);
    $("composicaoQtd").value = "1";
    render();
    $("composicaoKit").value = kitId;
    showMsg("msgKit", "Item adicionado ao kit.");
  } catch (e) {
    showMsg("msgKit", e.message || "Erro ao adicionar item ao kit.", false);
  }
}

async function deleteKitItem(id) {
  const row = state.kit_items.find(x => x.id === id);
  if (!row) return;
  const kit = state.kits.find(k => k.id === row.kit_id);
  const item = state.items.find(i => i.id === row.item_id);
  if (!kit) return;
  const remaining = state.kit_items.filter(x => x.kit_id === row.kit_id && x.id !== id);

  if (remaining.length === 0) {
    const ok = confirm(
      `Este é o último item do kit "${kit.nome}".\n\n` +
      `Ao excluí-lo, o kit também será excluído.\n` +
      `As vendas já registradas serão preservadas.\n\n` +
      `Continuar?`
    );
    if (!ok) return;
    return deleteKit(kit.id);
  }

  if (!confirm(`Excluir "${item?.nome || "este item"}" da composição de "${kit.nome}"?`)) return;
  try {
    await db.deleteRemote(supabase, "kit_items", id);
    state.kit_items = state.kit_items.filter(x => x.id !== id);
    await local.remove("kit_items", id);
    render();
    showMsg("msgKit", "Item removido do kit.");
  } catch (e) {
    showMsg("msgKit", e.message || "Erro ao excluir composição.", false);
  }
}

async function deleteKit(id) {
  const kit = state.kits.find(k => k.id === id);
  if (!kit) return;
  if (!confirm(`Excluir o kit "${kit.nome}"?\n\nAs vendas já registradas serão preservadas.`)) return;
  try {
    const rows = state.kit_items.filter(x => x.kit_id === id);
    await db.deleteRemote(supabase, "kits", id);
    state.kits = state.kits.filter(k => k.id !== id);
    state.kit_items = state.kit_items.filter(x => x.kit_id !== id);
    await local.remove("kits", id);
    for (const row of rows) await local.remove("kit_items", row.id);
    render();
    showMsg("msgKit", `Kit "${kit.nome}" excluído.`);
  } catch (e) {
    showMsg("msgKit", e.message || "Erro ao excluir kit.", false);
  }
}

async function registerSale() {
  const data = $("dataVenda").value || todayLocal();
  const tipo = $("tipoVenda").value;
  const productValue = $("produtoVenda").value;
  const quantidade = Number($("qtdVenda").value);
  if (!productValue || !Number.isFinite(quantidade) || quantidade <= 0)
    return showMsg("msgVenda", "Selecione o produto e informe uma quantidade válida.", false);

  try {
    let produto;
    let composicao = null;
    if (tipo === "kit") {
      const kit = state.kits.find(k => k.id === productValue);
      if (!kit) throw new Error("Kit não encontrado.");
      const comp = compositionForKit(kit.id);
      if (!comp.length) throw new Error("Este kit não possui composição.");
      produto = kit.nome;
      composicao = comp.map(x => ({ item:x.itemObj.nome, quantidade:Number(x.quantidade) }));
    } else {
      const item = state.items.find(i => i.id === productValue && i.ativo !== false);
      if (!item) throw new Error("Item não encontrado.");
      produto = item.nome;
    }

    const row = await db.insertRemote(supabase, "sales", {
      data, produto, tipo, quantidade, composicao, created_by:user.id
    });
    state.sales.push(row);
    await local.put("sales", row);
    $("qtdVenda").value = "1";
    render();
    showMsg("msgVenda", "Venda registrada.");
  } catch (e) {
    showMsg("msgVenda", e.message || "Erro ao registrar venda.", false);
  }
}

async function deleteSale(id) {
  if (!confirm("Excluir esta venda?")) return;
  try {
    await db.deleteRemote(supabase, "sales", id);
    state.sales = state.sales.filter(x => x.id !== id);
    await local.remove("sales", id);
    render();
  } catch (e) {
    showMsg("msgVenda", e.message || "Erro ao excluir venda.", false);
  }
}

async function clearSales() {
  if (!confirm("Apagar TODAS as vendas compartilhadas? Os kits e itens serão mantidos.")) return;
  try {
    await db.clearRemoteSales(supabase);
    state.sales = [];
    await local.clear("sales");
    render();
    showMsg("msgVenda", "Todas as vendas foram apagadas.");
  } catch (e) {
    showMsg("msgVenda", e.message || "Erro ao apagar vendas.", false);
  }
}

function exportBackup() {
  const payload = {
    version: 6,
    exported_at: new Date().toISOString(),
    user: user?.email || null,
    items: state.items,
    kits: state.kits,
    kit_items: state.kit_items,
    sales: state.sales
  };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `backup_controle_kits_${todayLocal()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showMsg("msgDados", "Backup exportado.");
}

async function importBackup(file) {
  if (!file) return;
  try {
    const x = JSON.parse(await file.text());
    if (!Array.isArray(x.items) || !Array.isArray(x.kits) || !Array.isArray(x.kit_items) || !Array.isArray(x.sales))
      throw new Error("Formato de backup inválido para a versão atual.");
    const ok = confirm("O backup será importado somente para o cache local. Ele NÃO será enviado automaticamente ao Supabase. Continuar?");
    if (!ok) return;
    await db.replaceLocalState({ items:x.items, kits:x.kits, kit_items:x.kit_items, sales:x.sales });
    state = await db.loadLocalState();
    render();
    showMsg("msgDados", "Backup importado para o cache local.");
  } catch (e) {
    showMsg("msgDados", e.message || "Arquivo inválido.", false);
  } finally {
    $("importar").value = "";
  }
}

async function syncNow() {
  if (!navigator.onLine) return showMsg("msgDados", "Sem conexão com a internet.", false);
  try {
    state = await syncFromServer(supabase);
    render();
    showMsg("msgDados", "Sincronização concluída.");
  } catch (e) {
    showMsg("msgDados", e.message || "Erro de sincronização.", false);
  }
}

function showTab(id) {
  const valid = ["vendas","itens","kits","resultado","dados"];
  if (!valid.includes(id)) id = "vendas";
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === id));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === id));
}

async function init() {
  try {
    supabase = createSupabaseClient();
    auth = createAuth(supabase, {
      onChange: async (u) => {
        user = u;
        if (!u) {
          renderLogin(false, false);
          return;
        }
        renderLogin(false, true);
        try {
          await ensureAuthorized();
          renderLogin(true, false);
          await loadData();
        } catch (e) {
          user = null;
          renderLogin(false, false);
          showMsg("msgGlobal", e.message || "Acesso não autorizado.", false);
        }
      }
    });

    $("dataVenda").value = todayLocal();
    setOnlineStatus();

    $("loginBtn").onclick = () => auth.login().catch(e => showMsg("msgGlobal", e.message, false));
    $("loginBtn2").onclick = () => auth.login().catch(e => showMsg("msgGlobal", e.message, false));
    $("logoutBtn").onclick = () => auth.logout().catch(e => showMsg("msgGlobal", e.message, false));
    $("tipoVenda").onchange = renderProductSelect;
    $("addItem").onclick = registerItem;
    $("novoKitToggle").onclick = () => setKitMode(!novoKitMode);
    $("kitAction").onclick = () => novoKitMode ? createKitWithFirstItem() : addItemToKit;
    $("addVenda").onclick = registerSale;
    $("limparVendas").onclick = clearSales;
    $("sincronizar").onclick = syncNow;
    $("exportar").onclick = exportBackup;
    $("importar").onchange = e => importBackup(e.target.files[0]);
    setKitMode(false);

    document.querySelectorAll(".tab").forEach(b => b.onclick = () => showTab(b.dataset.tab));
    $("listaItens").addEventListener("click", e => {
      const toggle = e.target.dataset.toggleItem;
      const del = e.target.dataset.deleteItemMaster;
      if (toggle) toggleItem(toggle);
      if (del) deleteMasterItem(del);
    });
    $("listaKits").addEventListener("click", e => {
      const itemId = e.target.dataset.deleteKitItem;
      const kitId = e.target.dataset.deleteKit;
      if (itemId) deleteKitItem(itemId);
      if (kitId) deleteKit(kitId);
    });
    $("listaVendas").addEventListener("click", e => {
      const id = e.target.dataset.deleteSale;
      if (id) deleteSale(id);
    });

    window.addEventListener("online", async () => {
      setOnlineStatus();
      if (user) await syncNow();
    });
    window.addEventListener("offline", setOnlineStatus);

    renderLogin(false, false);
    const existing = await auth.getUser();
    if (existing) {
      user = existing;
      renderLogin(false, true);
      try {
        await ensureAuthorized();
        renderLogin(true, false);
        await loadData();
      } catch(e) {
        user = null;
        renderLogin(false, false);
        showMsg("msgGlobal", e.message || "Acesso não autorizado.", false);
      }
    }
  } catch (e) {
    showMsg("msgGlobal", e.message || "Falha ao inicializar o aplicativo.", false);
  }
}

init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
