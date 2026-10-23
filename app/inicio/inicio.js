import { supabase, requireLogin, renderNav, $, h, fmtSlot, dayKey, rpcError, TZ } from "../lib.js";
const login = await requireLogin();
if (!login) throw new Error("redirecting");
renderNav("inicio", login.profile);

const { data: me } = await supabase.rpc("my_profile");
const p = (me && me[0]) || {};
const name = p.name || (login.profile && login.profile.name) || "";
$("#hello").textContent = name ? `Olá, ${name}!` : "Olá!";
if (p.goal){ $("#goal").textContent = p.goal; $("#goal-card").hidden = false; }

const now = new Date();
const { data: rows } = await supabase.from("bookings").select("id, starts_at, status").eq("status", "marcada").order("starts_at");
const upcoming = (rows || []).filter(b => new Date(b.starts_at).getTime() + 30 * 60000 > now.getTime());
const box = $("#next");
if (!upcoming.length) box.append(h("p", { class: "muted" }, "Nenhuma aula marcada nos próximos dias."));
else {
  const b = upcoming[0], start = new Date(b.starts_at);
  const live = now >= start;
  const status = h("p", { class: "status", role: "status" });
  box.append(h("p", { class: "big-text", style: "color:var(--ink)" }, fmtSlot(b.starts_at)),
    live ? h("button", { type: "button", class: "btn primary", style: "align-self:flex-start", onclick: () => join(b.id, status) }, "Entrar na aula")
         : h("p", { class: "small muted" }, "O botão para entrar aparece no horário exato da aula."), status);
}
async function join(id, status){
  status.textContent = "Abrindo a aula…";
  const { data, error } = await supabase.rpc("join_class", { p_id: id });
  if (error){ status.textContent = rpcError(error); return; }
  status.textContent = "";
  const w = window.open(data, "_blank", "noopener");
  if (!w) status.replaceChildren(h("a", { href: data, target: "_blank", rel: "noopener", class: "btn primary" }, "Abrir a aula no Meet"));
}

// Month calendar with the days that have classes
const y = Number(now.toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 4)), m = Number(now.toLocaleDateString("en-CA", { timeZone: TZ }).slice(5, 7)) - 1;
$("#cal-month").textContent = new Date(y, m, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, c => c.toUpperCase());
const booked = new Set((rows || []).map(b => dayKey(b.starts_at)));
const today = dayKey(now), cal = $("#cal");
["D", "S", "T", "Q", "Q", "S", "S"].forEach(d => cal.append(h("span", { class: "wd" }, d)));
for (let i = 0; i < new Date(y, m, 1).getDay(); i++) cal.append(h("span"));
for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++){
  const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  cal.append(h("span", { class: "d" + (key === today ? " today" : "") + (booked.has(key) ? " booked" : "") }, d));
}

// "Install the app": Android/desktop Chrome offer a prompt; iPhone needs the Share menu.
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
if (!standalone){
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS){
    $("#install-text").textContent = "No iPhone: abra este site no Safari, toque em Compartilhar (o quadrado com a seta) e depois em \"Adicionar à Tela de Início\".";
    $("#install-card").hidden = false;
  }
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferred = e;
    $("#install-card").hidden = false; $("#install-btn").hidden = false;
  });
  $("#install-btn").addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt(); await deferred.userChoice; deferred = null;
    $("#install-card").hidden = true;
  });
}
