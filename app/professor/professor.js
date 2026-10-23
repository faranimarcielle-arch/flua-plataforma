import { supabase, callChat, requireLogin, renderNav, $, h, fmtSlot, rpcError } from "../lib.js";
const login = await requireLogin();
if (!login) throw new Error("redirecting");
renderNav("professor", login.profile);
if (!login.profile || login.profile.role !== "teacher"){ $("#denied").hidden = false; throw new Error("not teacher"); }
$("#students-card").hidden = false;
$("#agenda-card").hidden = false;
// Google Calendar + e-mails. Google sends the teacher back here with ?code=... after she allows access.
const back = location.origin + location.pathname;
const gq = new URLSearchParams(location.search);
async function googleStatus(){
  // Also sends any pending class notice and shows whether Google is connected.
  try{
    const r = await callChat({ action: "agenda" });
    $("#gcal-status").textContent = r && r.google
      ? "Google Agenda e e-mails: conectados." + (r.sent ? ` ${r.sent} aviso(s) enviado(s) agora.` : "")
      : "Google Agenda e e-mails: ainda não conectados.";
    $("#gcal-connect").textContent = r && r.google ? "Conectar de novo" : "Conectar Google Agenda";
  }catch(e){ $("#gcal-status").textContent = "Google Agenda: " + (e.msg || "erro ao conectar."); }
}
$("#gcal-connect").addEventListener("click", async () => {
  $("#gcal-status").textContent = "Abrindo o Google…";
  try{ const r = await callChat({ action: "google_auth_url", redirect_uri: back }); location.assign(r.url); }
  catch(e){ $("#gcal-status").textContent = e.msg; }
});
async function googleReturn(){
  history.replaceState(null, "", back);
  if (gq.has("error")){ $("#gcal-status").textContent = "A conexão com o Google foi cancelada."; return; }
  $("#gcal-status").textContent = "Conectando…";
  try{ await callChat({ action: "google_connect", code: gq.get("code"), state: gq.get("state"), redirect_uri: back }); await googleStatus(); }
  catch(e){ $("#gcal-status").textContent = e.msg; }
}
if (gq.has("code") || gq.has("error")) googleReturn(); else googleStatus();

const fmt = iso => new Date(iso).toLocaleString("pt-BR", { dateStyle:"short", timeStyle:"short" });
let current = null;

async function loadStudents(){
  const { data, error } = await supabase.from("profiles").select("id, name, email").eq("role", "student").order("name");
  const box = $("#students"); box.replaceChildren();
  if (error){ box.append(h("p", {class:"err"}, "Não deu para carregar os alunos.")); return; }
  if (!data.length) box.append(h("p", {class:"muted"}, "Nenhum aluno cadastrado ainda."));
  data.forEach(s => box.append(h("div", {class:"line"}, h("div", null, h("b", null, s.name || s.email), h("p", {class:"small muted"}, s.email)),
    h("button", {type:"button", class:"btn", onclick:() => openStudent(s)}, "Abrir"))));
}
async function openStudent(s){
  current = s; $("#student-card").hidden = false; $("#st-name").textContent = s.name || s.email; $("#st-display").value = s.name || "";
  const { data: st } = await supabase.from("student_settings").select("*").eq("student_id", s.id).single();
  if (st){ $("#st-level").value = st.level; $("#st-week").value = st.classes_per_week; $("#st-day").value = st.classes_per_day; $("#st-limit").value = st.daily_ai_limit_usd; $("#st-interests").value = st.interests; $("#st-goal").value = st.goal; }
  const today = new Date().toLocaleDateString("en-CA", { timeZone:"America/Sao_Paulo" });
  const { data: usage } = await supabase.from("ai_usage").select("cost_usd, day").eq("student_id", s.id);
  const total = (usage || []).reduce((a, r) => a + Number(r.cost_usd), 0), day = (usage || []).filter(r => r.day === today).reduce((a, r) => a + Number(r.cost_usd), 0);
  $("#st-cost").textContent = `Gasto com IA: hoje US$ ${day.toFixed(4)} · total US$ ${total.toFixed(4)}`;
  await Promise.all([loadConversations(s.id), loadStudentClasses(s.id)]);
  $("#student-card").scrollIntoView({ behavior:"smooth" });
}
async function loadConversations(id){
  const box = $("#convs"); box.replaceChildren(h("p", {class:"status"}, "Carregando…"));
  const { data: convs } = await supabase.from("conversations").select("id, started_at, ended_at").eq("student_id", id).order("started_at", { ascending:false }).limit(20);
  box.replaceChildren();
  if (!convs || !convs.length){ box.append(h("p", {class:"muted"}, "Nenhuma conversa ainda.")); return; }
  for (const c of convs){
    const det = h("details", {class:"line", style:"display:block"}, h("summary", null, `Conversa de ${fmt(c.started_at)}${c.ended_at ? "" : " · em andamento"}`));
    det.addEventListener("toggle", async () => {
      if (!det.open || det.dataset.loaded) return; det.dataset.loaded = "1";
      const { data: msgs } = await supabase.from("messages").select("role, text, audio_path, created_at").eq("conversation_id", c.id).order("id");
      const chat = h("div", {class:"chat", style:"margin-top:10px"});
      for (const m of msgs || []){
        const b = h("div", {class:"msg " + (m.role === "user" ? "me" : "ai")}, h("span", {class:"who"}, m.role === "user" ? "Aluno" : "Max"), m.text);
        if (m.audio_path){
          const { data: signed } = await supabase.storage.from("audios").createSignedUrl(m.audio_path, 600);
          if (signed) b.append(h("audio", {controls:true, preload:"none", src:signed.signedUrl}));
        }
        chat.append(b);
      }
      det.append(chat);
    });
    box.append(det);
  }
}
$("#st-save").addEventListener("click", async () => {
  if (!current) return;
  const limit = Math.max(0, Math.min(5, Number($("#st-limit").value) || 0));
  const [a, b] = await Promise.all([
    supabase.from("student_settings").update({ level:$("#st-level").value, daily_ai_limit_usd:limit, classes_per_week:Math.max(1, Math.min(7, Math.round(Number($("#st-week").value) || 1))), classes_per_day:Math.max(1, Math.min(4, Math.round(Number($("#st-day").value) || 1))), interests:$("#st-interests").value.trim(), goal:$("#st-goal").value.trim(), updated_at:new Date().toISOString() }).eq("student_id", current.id),
    supabase.from("profiles").update({ name:$("#st-display").value.trim() }).eq("id", current.id)
  ]);
  $("#st-status").textContent = a.error || b.error ? "Não deu para salvar." : "Salvo. A conversa já usa o perfil novo.";
  if (!b.error){ current.name = $("#st-display").value.trim(); $("#st-name").textContent = current.name || current.email; loadStudents(); }
});
loadStudents();

/* ---------- agenda: Meet link, weekly slots, upcoming classes ---------- */
const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const ATT = { presente:"Presente", atraso:"Presente com atraso", falta:"Faltou", justificada:"Falta justificada", "sem-registro":"Sem entrada registrada" };
async function loadAgenda(){
  const [{ data: st }, { data: av }, { data: up }] = await Promise.all([
    supabase.from("school_settings").select("meet_link").eq("id", 1).single(),
    supabase.from("availability").select("id, weekday, start_time").order("weekday").order("start_time"),
    supabase.rpc("teacher_bookings", { p_student: null, p_from: new Date().toISOString() })
  ]);
  if (st) $("#meet").value = st.meet_link;
  const box = $("#avail"); box.replaceChildren();
  [1, 2, 3, 4, 5, 6, 0].forEach(d => {
    const list = (av || []).filter(a => a.weekday === d);
    box.append(h("div", { class: "line" }, h("b", { style: "min-width:80px;color:var(--ink)" }, DAYS[d]),
      h("div", { class: "row", style: "flex:1" }, list.length ? list.map(a => h("span", { class: "pill", style: "display:inline-flex;gap:6px;align-items:center" }, a.start_time.slice(0, 5),
        h("button", { type: "button", class: "icon-btn", style: "padding:0 6px", "aria-label": `Remover ${a.start_time.slice(0, 5)} de ${DAYS[d]}`, onclick: () => removeSlot(a.id) }, "×"))) : h("span", { class: "small muted" }, "sem aulas"))));
  });
  const ub = $("#all-upcoming"); ub.replaceChildren();
  const next = (up || []).filter(b => b.status === "marcada" && new Date(b.starts_at).getTime() + 30 * 60000 > Date.now()).sort((a, b) => a.starts_at < b.starts_at ? -1 : 1);
  if (!next.length) ub.append(h("p", { class: "muted small" }, "Nenhuma aula marcada."));
  next.forEach(b => ub.append(h("div", { class: "line" }, h("span", null, h("b", null, fmtSlot(b.starts_at)), " · ", b.student_name || "Aluno"))));
}
async function removeSlot(id){
  const { error } = await supabase.from("availability").delete().eq("id", id);
  $("#av-status").textContent = error ? "Não deu para remover." : "Horário removido. Aulas já marcadas nele continuam valendo.";
  loadAgenda();
}
$("#av-add").addEventListener("click", async () => {
  const t = $("#av-time").value;
  if (!/^\d{2}:(00|30)$/.test(t)){ $("#av-status").textContent = "Escolha um horário em hora cheia ou meia hora (ex.: 19:00 ou 19:30)."; return; }
  const { error } = await supabase.from("availability").insert({ weekday: Number($("#av-day").value), start_time: t });
  $("#av-status").textContent = error ? (/duplicate|unique/i.test(error.message) ? "Esse horário já existe." : "Não deu para adicionar.") : "Horário adicionado. Os alunos já podem marcar.";
  loadAgenda();
});
$("#meet-save").addEventListener("click", async () => {
  const link = $("#meet").value.trim();
  if (link && !/^https:\/\/\S+$/i.test(link)){ $("#meet-status").textContent = "O link precisa começar com https://"; return; }
  const { error } = await supabase.from("school_settings").update({ meet_link: link, updated_at: new Date().toISOString() }).eq("id", 1);
  $("#meet-status").textContent = error ? "Não deu para salvar." : "Link salvo.";
});

/* ---------- one student's classes and attendance ---------- */
async function loadStudentClasses(id){
  const box = $("#st-classes"); box.replaceChildren(h("p", { class: "status" }, "Carregando…"));
  const { data, error } = await supabase.rpc("teacher_bookings", { p_student: id, p_from: new Date(Date.now() - 120 * 86400000).toISOString() });
  box.replaceChildren();
  if (error){ box.append(h("p", { class: "err" }, rpcError(error))); return; }
  const now = Date.now();
  const past = data.filter(b => b.status === "marcada" && new Date(b.starts_at).getTime() + 30 * 60000 <= now);
  const counted = past.filter(b => (b.attendance || b.auto_attendance) !== "justificada");
  const present = counted.filter(b => ["presente", "atraso"].includes(b.attendance || b.auto_attendance)).length;
  $("#st-rate").textContent = counted.length ? `Frequência: ${Math.round(present / counted.length * 100)}% · ${present} de ${counted.length}` : "Sem aulas realizadas";
  if (!data.length) box.append(h("p", { class: "muted small" }, "Nenhuma aula ainda."));
  data.forEach(b => {
    const isPast = new Date(b.starts_at).getTime() + 30 * 60000 <= now;
    const row = h("div", { class: "line" }, h("div", { style: "flex:1;min-width:180px" }, h("b", { style: "color:var(--ink)" }, fmtSlot(b.starts_at)),
      h("p", { class: "small muted" }, b.status === "desmarcada" ? "Desmarcada pelo aluno (não conta como falta)" : b.joined_at ? `Entrou às ${new Date(b.joined_at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}` : isPast ? "Não tocou em Entrar na aula · confirme" : "Aula futura")));
    if (b.status === "marcada" && isPast){
      const k = b.attendance || b.auto_attendance;
      const sel = h("select", { "aria-label": "Presença em " + fmtSlot(b.starts_at), style: "padding:6px 8px" },
        h("option", { value: "" }, "Automático"), ...["presente", "atraso", "falta", "justificada"].map(v => h("option", { value: v }, ATT[v])));
      sel.value = b.attendance || "";
      sel.addEventListener("change", async () => { const { error } = await supabase.rpc("set_attendance", { p_id: b.id, p_value: sel.value || null }); if (error) alertRow(row, rpcError(error)); else loadStudentClasses(id); });
      row.append(k ? h("span", { class: "att att-" + k }, ATT[k]) : null, sel);
    }
    if (b.status === "marcada" && !isPast){
      const inp = h("input", { type: "text", maxlength: "200", placeholder: "Link só desta aula (opcional)", value: b.meet_link || "", "aria-label": "Link do Meet desta aula", style: "min-width:200px" });
      row.append(inp, h("button", { type: "button", class: "icon-btn", onclick: async () => {
        const v = inp.value.trim();
        if (v && !/^https:\/\/\S+$/i.test(v)){ alertRow(row, "O link precisa começar com https://"); return; }
        const { error } = await supabase.rpc("set_class_link", { p_id: b.id, p_link: v });
        alertRow(row, error ? rpcError(error) : (v ? "Link desta aula salvo." : "Esta aula volta a usar o link padrão."));
      } }, "Salvar link"));
    }
    box.append(row);
  });
}
function alertRow(row, text){ const old = row.querySelector(".row-msg"); if (old) old.remove(); row.append(h("span", { class: "small muted row-msg" }, text)); }
loadAgenda();
