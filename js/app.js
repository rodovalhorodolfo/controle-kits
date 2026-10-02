import { createSupabaseClient } from "./supabase.js";
import { createAuth } from "./auth.js";
import * as db from "./db.js";
import * as local from "./localdb.js";
import { syncFromServer } from "./sync.js";

let supabase;
let auth;
let user = null;
let state = { kits: [], kit_items: [], sales: [] };

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
  e._timer = setTimeout(() => e.className = "msg", 3500);
}

function setOnlineStatus() {
  $("offlineBanner").classList.toggle("hidden", navigator.onLine);
}

function renderLogin(authorized = false, checking = false) {
  const logged = !!user;
  const canUseApp = logged && authorized && !checking;

  // A sessão Google, sozinha, não libera a interface operacional.
  $("loginPanel").classList.toggle("hidden", canUseApp);
  $("app").classList.toggle("hidden", !canUseApp);
  $("loginBtn").classList.toggle("hidden", logged || checking);
  $("loginBtn2").classList.toggle("hidden", logged || checking);
  $("logoutBtn").classList.toggle("hidden", !logged);
  $("userEmail").textContent = logged ? user.email : "";

  if (checking) {
    showMsg("msgGlobal", "Verificando autorização...", true);
  }
}

function kitRows() {
  return state.kit_items.filter(x => x.kit_id && state.kits.some(k => k.id === x.kit_id));
}

function getKits() {
  return [...state.kits].filter(k => k.ativo !== false).sort((a,b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function getItems() {
  return [...new Set(kitRows().map(x => x.item.trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, "pt-BR"));
}

function compositionForKit(kitId) {
  return kitRows().filter(x => x.kit_id === kitId);
}

function renderProductSelect() {
  const tipo = $("tipoVenda").value;
  const arr = tipo === "kit" ? getKits().map(k => ({id:k.id, name:k.nome})) :
    getItems().map(x => ({id:x, name:x}));
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
      const item = row.item;
      inside[item] = (inside[item] || 0) + q * Number(row.quantidade || 0);
    }
  }
  const items = [...new Set([...getItems(), ...Object.keys(direct), ...Object.keys(inside)])]
    .sort((a,b) => a.localeCompare(b, "pt-BR"));
  return items.map(item => ({
    item,
    direct: direct[item] || 0,
    inside: inside[item] || 0,
    total: (direct[item] || 0) + (inside[item] || 0)
  }));
}

function render() {
  renderProductSelect();

  $("listaKits").innerHTML = getKits().map(k => {
    const comp = compositionForKit(k.id);
    return comp.length
      ? comp.map((x,i) => `
        <tr>
          <td>${esc(k.nome)}</td>
          <td>${esc(x.item)}</td>
          <td class="num">${x.quantidade}</td>
          <td><button class="danger" data-delete-item="${esc(x.id)}">Excluir</button></td>
        </tr>`).join("")
      : `<tr><td>${esc(k.nome)}</td><td colspan="3" class="muted">Kit sem composição</td></tr>`;
  }).join("") || `<tr><td colspan="4">Nenhum kit cadastrado.</td></tr>`;

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

  const c = consolidation();
  $("resultadoItens").innerHTML = c.map(x => `
    <tr><td>${esc(x.item)}</td><td class="num">${x.direct}</td>
    <td class="num">${x.inside}</td><td class="num"><b>${x.total}</b></td></tr>
  `).join("") || `<tr><td colspan="4">Nenhum item vendido.</td></tr>`;

  $("totalVendas").textContent = sales.length;
  $("totalKits").textContent = state.sales.filter(x => x.tipo === "kit")
    .reduce((s,x) => s + Number(x.quantidade || 0), 0);
  $("totalItens").textContent = c.reduce((s,x) => s + x.total, 0);

  local.getMeta("lastSync").then(x => {
    $("syncInfo").textContent = x ? `Última sincronização: ${new Date(x).toLocaleString("pt-BR")}` : "Ainda não sincronizado.";
  });
}

async function ensureAuthorized() {
  if (!user) return false;

  // Vincula o primeiro login ao pré-cadastro pelo e-mail.
  // A função do banco usa auth.uid() e o e-mail de auth.users.
  const { data: claimed, error: claimError } =
    await supabase.rpc("claim_allowed_user");

  if (claimError) throw claimError;

  if (!claimed) {
    await supabase.auth.signOut();
    throw new Error(
      "Sua conta Google foi autenticada, mas não está autorizada no sistema."
    );
  }

  // Confirma a autorização efetiva pelo UUID autenticado.
  const { data, error } = await supabase
    .from("allowed_users")
    .select("user_id,email,ativo")
    .eq("user_id", user.id)
    .eq("ativo", true)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    await supabase.auth.signOut();
    throw new Error(
      "Sua conta Google foi autenticada, mas não está autorizada no sistema."
    );
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
}

async function registerKit() {
  const nome = $("kitNome").value.trim();
  const item = $("itemNome").value.trim();
  const quantidade = Number($("qtdNoKit").value);
  if (!nome || !item || !Number.isFinite(quantidade) || quantidade <= 0)
    return showMsg("msgKit", "Informe kit, item e quantidade válida.", false);

  let kit = getKits().find(k => k.nome.toLocaleLowerCase() === nome.toLocaleLowerCase());
  try {
    if (!kit) {
      kit = await db.insertRemote(supabase, "kits", {
        nome, ativo:true, created_by:user.id
      });
      state.kits.push(kit);
    }
    const row = await db.insertRemote(supabase, "kit_items", {
      kit_id:kit.id, item, quantidade, created_by:user.id
    });
    state.kit_items.push(row);
    await local.put("kits", kit);
    await local.put("kit_items", row);
    $("kitNome").value = "";
    $("itemNome").value = "";
    $("qtdNoKit").value = "1";
    render();
    showMsg("msgKit", "Composição adicionada.");
  } catch (e) {
    showMsg("msgKit", e.message || "Erro ao salvar composição.", false);
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
    let produto = productValue;
    let composicao = null;

    if (tipo === "kit") {
      const kit = state.kits.find(k => k.id === productValue);
      if (!kit) throw new Error("Kit não encontrado.");
      produto = kit.nome;
      composicao = compositionForKit(kit.id).map(x => ({
        item: x.item,
        quantidade: Number(x.quantidade)
      }));
      if (!composicao.length) throw new Error("Este kit não possui composição cadastrada.");
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

async function deleteKitItem(id) {
  const row = state.kit_items.find(x => x.id === id);
  if (!row) return;

  const kit = state.kits.find(k => k.id === row.kit_id);
  if (!kit) {
    showMsg("msgKit", "Kit associado não encontrado.", false);
    return;
  }

  const remainingItems = state.kit_items.filter(
    x => x.kit_id === row.kit_id && x.id !== id
  );

  // Regra de negócio: um kit não pode existir sem composição.
  // Se este for o último item, a exclusão remove também o kit.
  if (remainingItems.length === 0) {
    const ok = confirm(
      `Este é o último item do kit "${kit.nome}".\\n\\n` +
      `Ao excluí-lo, o kit também será excluído.\\n` +
      `As vendas já registradas serão preservadas.\\n\\n` +
      `Continuar?`
    );

    if (!ok) return;

    try {
      // Excluir o kit diretamente. O banco remove seus kit_items
      // automaticamente por ON DELETE CASCADE.
      const kitItemsToRemove = state.kit_items.filter(
        x => x.kit_id === kit.id
      );

      await db.deleteRemote(supabase, "kits", kit.id);

      state.kits = state.kits.filter(k => k.id !== kit.id);
      state.kit_items = state.kit_items.filter(
        x => x.kit_id !== kit.id
      );

      await local.remove("kits", kit.id);

      for (const item of kitItemsToRemove) {
        await local.remove("kit_items", item.id);
      }

      render();
      showMsg("msgKit", `Kit "${kit.nome}" excluído.`);
    } catch (e) {
      showMsg("msgKit", e.message || "Erro ao excluir kit.", false);
    }

    return;
  }

  // Ainda existem outros itens: exclui somente este componente.
  if (!confirm("Excluir esta composição do kit?")) return;

  try {
    await db.deleteRemote(supabase, "kit_items", id);
    state.kit_items = state.kit_items.filter(x => x.id !== id);
    await local.remove("kit_items", id);
    render();
  } catch (e) {
    showMsg("msgKit", e.message || "Erro ao excluir composição.", false);
  }
}

async function clearSales() {
  if (!confirm("Apagar TODAS as vendas compartilhadas? Os kits serão mantidos.")) return;
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
    version: 4,
    exported_at: new Date().toISOString(),
    user: user?.email || null,
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
    if (!Array.isArray(x.kits) || !Array.isArray(x.kit_items) || !Array.isArray(x.sales))
      throw new Error("Formato de backup inválido.");

    const ok = confirm(
      "O backup será importado para o navegador como cache local. " +
      "Ele NÃO será enviado automaticamente ao Supabase. Continuar?"
    );
    if (!ok) return;

    await db.replaceLocalState({
      kits:x.kits, kit_items:x.kit_items, sales:x.sales
    });
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
  const valid = ["vendas","kits","resultado","dados"];
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

        // Enquanto a autorização não for confirmada, a interface
        // operacional permanece escondida.
        renderLogin(false, true);

        try {
          await ensureAuthorized();
          renderLogin(true, false);
          await loadData();
        } catch (e) {
          user = null;
          renderLogin(false, false);
          showMsg(
            "msgGlobal",
            e.message || "Acesso não autorizado.",
            false
          );
        }
      }
    });

    $("dataVenda").value = todayLocal();
    setOnlineStatus();

    $("loginBtn").onclick = () => auth.login().catch(e => showMsg("msgGlobal", e.message, false));
    $("loginBtn2").onclick = () => auth.login().catch(e => showMsg("msgGlobal", e.message, false));
    $("logoutBtn").onclick = () => auth.logout().catch(e => showMsg("msgGlobal", e.message, false));
    $("tipoVenda").onchange = renderProductSelect;
    $("addKit").onclick = registerKit;
    $("addVenda").onclick = registerSale;
    $("limparVendas").onclick = clearSales;
    $("sincronizar").onclick = syncNow;
    $("exportar").onclick = exportBackup;
    $("importar").onchange = e => importBackup(e.target.files[0]);

    document.querySelectorAll(".tab").forEach(b => b.onclick = () => showTab(b.dataset.tab));
    document.querySelectorAll("#listaVendas").forEach(() => {});
    $("listaVendas").addEventListener("click", e => {
      const id = e.target.dataset.deleteSale;
      if (id) deleteSale(id);
    });
    $("listaKits").addEventListener("click", e => {
      const id = e.target.dataset.deleteItem;
      if (id) deleteKitItem(id);
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
        showMsg(
          "msgGlobal",
          e.message || "Acesso não autorizado.",
          false
        );
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
