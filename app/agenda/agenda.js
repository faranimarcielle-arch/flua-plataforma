import { supabase, requireLogin, renderNav, $, h, fmtSlot, fmtDay, dayKey, rpcError } from "../lib.js";
const login = await requireLogin();
if (!login) throw new Error("redirecting");
renderNav("agenda", login.profile);

let mine = [], slots = [], movingId = null, pending = null;
const { data: me } = await supabase.rpc("my_profile");
const perWeek = me && me[0] ? me[0].classes_per_week : null, perDay = me && me[0] ? me[0].classes_per_day : null;
if (perWeek) $("#plan").textContent = `Plano: ${perWeek} ${perWeek === 1 ? "aula" : "aulas"} por semana` + (perDay ? ` · ${perDay} por dia` : "");

async function load(){
  const [b, s] = await Promise.all([
    supabase.from("bookings").select("id, starts_at, status").eq("status", "marcada").order("starts_at"),
    supabase.rpc("available_slots")
  ]);
  const now = Date.now();
  mine = (b.data || []).filter(x => new Date(x.starts_at).getTime() + 30 * 60000 > now);
  slots = s.data || [];
  if (s.error) $("#status").textContent = rpcError(s.error);
  render();
}
function render(){
  const now = new Date();
  const box = $("#mine"); box.replaceChildren();
  if (!mine.length) box.append(h("p", { class: "muted" }, "Nenhuma aula marcada. Escolha um horário abaixo."));
  mine.forEach(b => {
    const st = new Date(b.starts_at), started = now >= st;
    const actions = h("div", { class: "row" }), msg = h("p", { class: "status", role: "status" });
    const draw = () => {
      actions.replaceChildren();
      if (started) actions.append(h("button", { type: "button", class: "btn primary", onclick: () => join(b.id, msg) }, "Entrar na aula"));
      else {
        actions.append(h("button", { type: "button", class: "btn", onclick: () => { movingId = b.id; pending = null; render(); $("#slots-card").scrollIntoView({ behavior: "smooth" }); } }, "Remarcar"));
        actions.append(h("button", { type: "button", class: "btn", onclick: () => {
          actions.replaceChildren(h("span", { class: "small" }, "Desmarcar esta aula? Ela volta para você marcar outra."),
            h("button", { type: "button", class: "btn primary", onclick: async () => {
              const { error } = await supabase.rpc("cancel_class", { p_id: b.id });
              if (error){ msg.textContent = rpcError(error); draw(); return; }
              if (movingId === b.id) movingId = null;
              $("#status").textContent = "Aula desmarcada. Você pode marcar outra."; load();
            } }, "Sim, desmarcar"),
            h("button", { type: "button", class: "btn", onclick: draw }, "Voltar"));
        } }, "Desmarcar"));
      }
    };
    draw();
    box.append(h("div", { class: "cls" }, h("div", { class: "when" }, h("b", null, fmtSlot(b.starts_at)),
      h("span", { class: "small muted" }, started ? "Acontecendo agora" : "Dá para desmarcar ou remarcar até o horário da aula")), actions, msg));
  });

  const rb = $("#resched"); rb.replaceChildren();
  const moving = movingId && mine.find(x => x.id === movingId);
  if (moving) rb.append(h("div", { class: "confirm" }, h("span", null, "Escolha o novo horário para a aula de ", h("b", null, fmtSlot(moving.starts_at)), "."),
    h("button", { type: "button", class: "btn", onclick: () => { movingId = null; pending = null; render(); } }, "Desistir")));

  const sb = $("#slots"); sb.replaceChildren();
  if (!slots.length) sb.append(h("p", { class: "muted" }, "Nenhum horário aberto nos próximos 7 dias."));
  const byDay = new Map();
  slots.forEach(s => { const k = dayKey(s.starts_at); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(s); });
  for (const [k, list] of byDay){
    const times = h("div", { class: "times" });
    list.forEach(s => {
      // While rescheduling, the class being moved does not count toward the daily or weekly limit.
      let state = s.state;
      if (moving && state === "day" && dayKey(s.starts_at) === dayKey(moving.starts_at)) state = "free";
      if (moving && state === "limit" && sameWeek(s.starts_at, moving.starts_at)) state = "free";
      const label = new Date(s.starts_at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
      times.append(h("button", { type: "button", class: `slot ${state === "free" ? "" : state}${pending === s.starts_at ? " sel" : ""}`, disabled: state !== "free",
        "aria-label": fmtSlot(s.starts_at) + (state === "free" ? "" : " · " + ({ mine: "sua aula", taken: "ocupado", day: "já tem aula nesse dia", limit: "limite da semana" })[state]),
        onclick: () => { pending = s.starts_at; $("#status").textContent = ""; render(); } }, label));
    });
    const day = h("div", { class: "day" }, h("h3", null, fmtDay(list[0].starts_at)), times);
    if (pending && list.some(s => s.starts_at === pending)){
      day.append(h("div", { class: "confirm" }, h("span", null, moving ? "Mover a aula para " : "Marcar aula em ", h("b", null, fmtSlot(pending)), "?"),
        h("button", { type: "button", class: "btn primary", onclick: confirm }, moving ? "Confirmar remarcação" : "Confirmar"),
        h("button", { type: "button", class: "btn", onclick: () => { pending = null; render(); } }, "Voltar")));
    }
    sb.append(day);
  }
}
const weekOf = (d) => { const x = new Date(new Date(d).toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x.getTime(); };
const sameWeek = (a, b) => weekOf(a) === weekOf(b);
async function confirm(){
  const t = pending; if (!t) return;
  const { error } = movingId
    ? await supabase.rpc("reschedule_class", { p_id: movingId, p_new_starts_at: t })
    : await supabase.rpc("book_class", { p_starts_at: t });
  pending = null;
  if (error){ $("#status").textContent = rpcError(error); load(); return; }
  $("#status").textContent = (movingId ? "Aula remarcada: " : "Aula marcada: ") + fmtSlot(t);
  movingId = null; load();
}
async function join(id, msg){
  msg.textContent = "Abrindo a aula…";
  const { data, error } = await supabase.rpc("join_class", { p_id: id });
  if (error){ msg.textContent = rpcError(error); return; }
  msg.textContent = "";
  const w = window.open(data, "_blank", "noopener");
  if (!w) msg.replaceChildren(h("a", { href: data, target: "_blank", rel: "noopener", class: "btn primary" }, "Abrir a aula no Meet"));
}
load();
