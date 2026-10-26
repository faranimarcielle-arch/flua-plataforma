// Teacher panel: one student's progress, class logs, file (notes, plans, assessments) and monthly report.
import { supabase, callChat, $, h, fmtSlot, rpcError } from "../lib.js";

const LV = { sozinho: ["Sozinho", "lv-s"], pista: ["Com pista", "lv-p"], modelo: ["Com modelo", "lv-m"] };
const lvChip = (l, title) => h("span", { class: "lv " + LV[l][1], title }, LV[l][0]);
const SKILLS = ["Fala", "Compreensão oral", "Leitura", "Escrita"];
const SCALE = ["Não avaliado", "Precisa de apoio", "Em desenvolvimento", "Com autonomia"];
export const ACTIVITY_NAMES = { mission: "Missão Real", detective: "Detetive de Perguntas", choice: "Escolha e Defenda", voice: "Mensagem de Voz", review: "De Volta", warmup: "Aquecimento" };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const dayOf = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const br = (d) => d.split("-").reverse().join("/");
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000);
const store = { get(k, d){ try{ return JSON.parse(localStorage.getItem(k)) ?? d; }catch(e){ return d; } }, set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} } };
const del = (id, after) => h("button", { type: "button", class: "icon-btn", onclick: async () => { if (!confirm("Apagar este item?")) return; await supabase.from("teacher_notes").delete().eq("id", id); after(); } }, "Apagar");

let student = null;

/* ---------- tabs ---------- */
export function showTab(name){
  document.querySelectorAll("#st-tabs [data-tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === name ? "true" : "false"));
  document.querySelectorAll("#student-card section[data-tab]").forEach(s => { s.hidden = s.dataset.tab !== name; });
}
$("#st-tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) showTab(b.dataset.tab); });

export async function openFicha(s){
  student = s;
  $("#plan-date").value = $("#ev-date").value = today();
  if (!$("#rep-month").value) $("#rep-month").value = today().slice(0, 7);
  $("#rep-text").value = ""; $("#rep-status").textContent = ""; $("#log-status").textContent = "";
  $("#ev-skills").replaceChildren(...SKILLS.map((name, i) => h("label", { class: "f", for: "ev-sk-" + i }, name, h("select", { id: "ev-sk-" + i }, SCALE.map(o => h("option", null, o))))));
  await Promise.all([loadProgress(), loadLogs(), loadFile(), loadReports()]);
}

/* ---------- Progresso ---------- */
async function loadProgress(){
  const id = student.id;
  const [{ data: logs }, { data: issues }, { data: decided }, { data: rv }, { data: ch }, { data: bk }, { count: nRead }, { count: nConv }] = await Promise.all([
    supabase.from("practice_log").select("activity, focus, level, created_at").eq("student_id", id).order("created_at").limit(1000),
    supabase.from("practice_issues").select("activity, focus, original, situation_pt, created_at").eq("student_id", id).order("created_at").limit(300),
    supabase.from("teacher_notes").select("body, data").eq("student_id", id).eq("kind", "dificuldade"),
    supabase.from("review_items").select("task_pt, focus, hist, due, source").eq("student_id", id).order("due").limit(50),
    supabase.from("challenges").select("id, body, status, created_at").eq("student_id", id).order("created_at", { ascending: false }).limit(30),
    supabase.rpc("teacher_bookings", { p_student: id, p_from: new Date(Date.now() - 60 * 86400000).toISOString() }),
    supabase.from("readings").select("id", { count: "exact", head: true }).eq("student_id", id),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("student_id", id),
  ]);
  const L = logs || [];

  // alerts
  const alertDays = Number(store.get("flua.alertDays", 4));
  $("#st-alert-days").value = String(alertDays);
  const seen = store.get("flua.seenAlerts", {});
  const out = [], last = L.length ? dayOf(L[L.length - 1].created_at) : null, idle = last ? daysBetween(last, today()) : null;
  if (idle === null || idle >= alertDays) out.push({ key: `${id}:idle:${last}`, title: idle === null ? "Ainda não praticou na plataforma" : `${idle} dias sem praticar`, detail: last ? `Última prática em ${br(last)}.` : "" });
  const now = Date.now();
  const past = (bk || []).filter(b => b.status === "marcada" && new Date(b.starts_at).getTime() + 30 * 60000 <= now).sort((a, b) => a.starts_at < b.starts_at ? 1 : -1);
  let miss = 0; for (const b of past){ const k = b.attendance || b.auto_attendance; if (k === "falta" || k === "sem-registro") miss++; else break; }
  if (miss >= 2) out.push({ key: `${id}:miss:${past[0].id}`, title: `${miss} aulas seguidas sem presença`, detail: "Inclui aulas sem entrada registrada: confirme na aba Aulas." });
  if (!(bk || []).some(b => b.status === "marcada" && new Date(b.starts_at).getTime() > now)) out.push({ key: `${id}:nobook:${today().slice(0, 8)}`, title: "Nenhuma aula marcada", detail: "" });
  const oldCh = (ch || []).filter(c => c.status === "pendente" && daysBetween(dayOf(c.created_at), today()) >= 7).length;
  if (oldCh) out.push({ key: `${id}:ch:${oldCh}:${today()}`, title: `${oldCh} desafio(s) aceito(s) há mais de uma semana`, detail: "Pergunte como foi na próxima aula." });
  const alerts = out.filter(a => !seen[a.key]);
  $("#st-alerts").replaceChildren(...(alerts.length ? alerts.map(a => h("div", { class: "alert" }, h("div", null, h("b", null, a.title), a.detail ? h("p", { class: "small muted" }, a.detail) : null),
    h("button", { type: "button", class: "icon-btn", onclick: () => { seen[a.key] = today(); store.set("flua.seenAlerts", seen); loadProgress(); } }, "Visto")))
    : [h("p", { class: "muted small" }, "Nada que precise de atenção agora.")]));

  // support per structure
  const groups = {};
  L.filter(e => !e.focus.startsWith("Missão:")).forEach(e => (groups[e.focus] ||= []).push(e));
  const keys = Object.keys(groups).sort((a, b) => groups[a].at(-1).created_at < groups[b].at(-1).created_at ? 1 : -1);
  const sb = $("#st-structs"); sb.replaceChildren();
  if (!keys.length) sb.append(h("p", { class: "muted small" }, "Ainda não há tentativas registradas."));
  keys.forEach(k => { const es = groups[k];
    sb.append(h("div", { class: "struct" }, h("div", { class: "row", style: "justify-content:space-between" }, h("b", null, k), h("span", { class: "small muted" }, "última: " + br(dayOf(es.at(-1).created_at)))),
      h("div", { class: "row" }, es.slice(-10).map(e => lvChip(e.level, `${br(dayOf(e.created_at))} · ${e.activity}`))))); });
  const ms = L.filter(e => e.focus.startsWith("Missão:"));
  if (ms.length) sb.append(h("div", { class: "struct" }, h("b", null, "Missões cumpridas"), h("div", { class: "row" }, ms.slice(-10).map(e => lvChip(e.level, `${br(dayOf(e.created_at))} · ${e.focus}`)))));

  // recurring difficulties
  const done = new Set((decided || []).map(d => (d.data && d.data.key) || d.body.toLowerCase()));
  const by = {};
  (issues || []).forEach(i => { const k = i.focus.trim().toLowerCase(); (by[k] ||= { label: i.focus.trim(), list: [] }).list.push(i); });
  const pending = Object.entries(by).filter(([k, g]) => g.list.length >= 2 && !done.has(k));
  const sg = $("#st-sugg"); sg.replaceChildren();
  if (!pending.length) sg.append(h("p", { class: "muted small" }, "Nenhuma sugestão nova."));
  pending.forEach(([k, g]) => sg.append(h("div", { class: "sugg" },
    h("p", { class: "eyebrow" }, "Sugestão da IA · não confirmada"), h("p", null, h("b", null, g.label), ` apareceu ${g.list.length} vezes.`),
    h("div", { class: "stack" }, g.list.slice(-3).map(i => h("p", { class: "small" }, h("span", { lang: "en" }, `“${i.original}”`), h("span", { class: "muted" }, ` · ${i.activity}, ${br(dayOf(i.created_at))}`)))),
    h("div", { class: "row" },
      h("button", { type: "button", class: "btn primary", onclick: async () => {
        const sit = g.list.filter(i => i.situation_pt).at(-1);
        await supabase.from("teacher_notes").insert({ student_id: student.id, kind: "dificuldade", body: g.label, data: { key: k, decision: "ok" } });
        await supabase.from("review_items").insert({ student_id: student.id, source: "professor", focus: g.label.slice(0, 80),
          task_pt: (sit ? sit.situation_pt : `Use ${g.label} para contar algo que aconteceu com você esta semana.`).slice(0, 400), goal: ("communicate the situation correctly using " + g.label).slice(0, 400) });
        loadProgress();
      } }, "Confirmar e mandar para o De Volta"),
      h("button", { type: "button", class: "btn", onclick: async () => { await supabase.from("teacher_notes").insert({ student_id: student.id, kind: "dificuldade", body: g.label, data: { key: k, decision: "no" } }); loadProgress(); } }, "Descartar")))));

  // De Volta
  const rb = $("#st-review"); rb.replaceChildren();
  if (!(rv || []).length) rb.append(h("p", { class: "muted small" }, "Nenhum item no De Volta."));
  (rv || []).slice(0, 12).forEach(r => rb.append(h("div", { class: "line" }, h("div", { style: "flex:1;min-width:200px" }, h("b", null, r.focus), h("p", { class: "small muted" }, r.task_pt)),
    h("span", { class: "small muted" }, (r.due <= today() ? "para hoje" : br(r.due)) + (r.source === "aula" ? " · da aula" : r.source === "professor" ? " · seu" : "")), r.hist.length ? lvChip(r.hist.at(-1), "última tentativa") : null)));

  // challenges
  const cb = $("#st-challenges"); cb.replaceChildren();
  if (!(ch || []).length) cb.append(h("p", { class: "muted small" }, "O aluno ainda não aceitou nenhum desafio."));
  (ch || []).forEach(c => cb.append(h("div", { class: "line" }, h("div", { style: "flex:1;min-width:200px" }, h("p", null, c.body),
    h("p", { class: "small muted" }, `Aceito em ${br(dayOf(c.created_at))} · ${c.status === "feito" ? "Fez" : c.status === "nao" ? "Não fez" : "Pendente"}`)),
    h("div", { class: "row" }, ["feito", "nao"].map(st => h("button", { type: "button", class: "icon-btn" + (c.status === st ? " primary" : ""), onclick: async () => { await supabase.from("challenges").update({ status: st }).eq("id", c.id); loadProgress(); } }, st === "feito" ? "Fez" : "Não fez"))))));

  // summary
  const month = L.filter(e => Date.now() - new Date(e.created_at) < 30 * 86400000);
  const cnt = (l) => month.filter(e => e.level === l).length;
  $("#st-summary").replaceChildren(h("p", null, `Últimos 30 dias: ${month.length} tentativas (${cnt("sozinho")} sozinho, ${cnt("pista")} com pista, ${cnt("modelo")} com modelo).`),
    h("p", null, `Textos de leitura: ${nRead ?? 0} · Conversas com a Flo: ${nConv ?? 0}.`));
}
$("#st-alert-days").addEventListener("change", e => { store.set("flua.alertDays", Number(e.target.value)); if (student) loadProgress(); });

/* ---------- Registro da aula ---------- */
async function loadLogs(){
  const { data: bk } = await supabase.rpc("teacher_bookings", { p_student: student.id, p_from: new Date(Date.now() - 60 * 86400000).toISOString() });
  const [{ data: logs }, { data: items }] = await Promise.all([
    supabase.from("teacher_notes").select("id, note_date, body, data").eq("student_id", student.id).eq("kind", "registro").order("note_date", { ascending: false }).limit(30),
    supabase.from("review_items").select("note_id, task_pt, focus").eq("student_id", student.id).eq("source", "aula"),
  ]);
  const logged = new Set((logs || []).map(l => l.data && l.data.booking_id).filter(Boolean));
  const past = (bk || []).filter(b => b.status === "marcada" && new Date(b.starts_at) <= new Date()).sort((a, b) => a.starts_at < b.starts_at ? 1 : -1).slice(0, 10);
  $("#log-class").replaceChildren(...past.map(b => h("option", { value: b.id, "data-day": dayOf(b.starts_at) }, fmtSlot(b.starts_at) + (logged.has(b.id) ? " · já registrada" : ""))),
    h("option", { value: "", "data-day": today() }, "Aula fora da agenda (hoje)"));
  const box = $("#log-list"); box.replaceChildren();
  (logs || []).forEach(l => { const its = (items || []).filter(i => i.note_id === l.id);
    box.append(h("div", { class: "struct" }, h("div", { class: "row", style: "justify-content:space-between" }, h("b", null, "Aula de " + br(l.note_date)), del(l.id, loadLogs)),
      h("p", { style: "white-space:pre-wrap" }, l.body),
      its.length ? h("div", { class: "stack" }, h("span", { class: "small", style: "font-weight:800" }, "Prática criada no De Volta:"), its.map(i => h("p", { class: "small" }, "• " + i.task_pt + " ", h("span", { class: "chip" }, i.focus)))) : null)); });
}
$("#log-save").addEventListener("click", async () => {
  const text = $("#log-text").value.trim(); if (!text){ $("#log-status").textContent = "Escreva o que foi trabalhado."; return; }
  const opt = $("#log-class").selectedOptions[0];
  $("#log-save").disabled = true; $("#log-status").textContent = "Criando a prática da semana…";
  try{
    const r = await callChat({ action: "class_log", student_id: student.id, text, date: opt ? opt.dataset.day : today(), booking_id: opt && opt.value ? opt.value : null });
    $("#log-text").value = ""; $("#log-status").textContent = `Registro salvo. ${r.items.length} ${r.items.length === 1 ? "exercício entrou" : "exercícios entraram"} no De Volta do aluno.`;
    loadLogs(); loadProgress();
  }catch(e){ $("#log-status").textContent = e.msg || "Não deu para salvar."; }
  finally{ $("#log-save").disabled = false; }
});

/* ---------- Ficha: observações, planejamento, avaliações ---------- */
async function loadFile(){
  const { data } = await supabase.from("teacher_notes").select("id, kind, note_date, body, data").eq("student_id", student.id).in("kind", ["observacao", "planejamento", "avaliacao"]).order("note_date", { ascending: false }).limit(200);
  const of = (k) => (data || []).filter(n => n.kind === k);
  $("#obs-list").replaceChildren(...of("observacao").map(n => h("div", { class: "line" }, h("div", { style: "flex:1" }, h("p", { class: "small muted" }, br(n.note_date)), h("p", { style: "white-space:pre-wrap" }, n.body)), del(n.id, loadFile))));
  $("#plan-list").replaceChildren(...of("planejamento").map(n => h("div", { class: "line" }, h("div", { style: "flex:1" }, h("p", { class: "small muted" }, "Aula de " + br(n.note_date)), h("p", { style: "white-space:pre-wrap" }, n.body)), del(n.id, loadFile))));
  $("#ev-list").replaceChildren(...of("avaliacao").map(n => h("div", { class: "struct" },
    h("div", { class: "row", style: "justify-content:space-between" }, h("b", null, (n.data && n.data.title) || "Avaliação"), h("span", { class: "small muted" }, br(n.note_date))),
    h("div", { class: "row" }, Object.entries((n.data && n.data.skills) || {}).filter(([, v]) => v !== SCALE[0]).map(([k, v]) => h("span", { class: "chip" }, `${k}: ${v}`))),
    n.body ? h("p", { class: "small", style: "white-space:pre-wrap" }, n.body) : null, h("div", null, del(n.id, loadFile)))));
}
async function addNote(kind, body, date, data){
  const { error } = await supabase.from("teacher_notes").insert({ student_id: student.id, kind, body, note_date: date || today(), data: data || {} });
  $("#ficha-status").textContent = error ? "Não deu para salvar." : "";
  if (!error) loadFile();
  return !error;
}
$("#obs-add").addEventListener("click", async () => { const t = $("#obs-text").value.trim(); if (t && await addNote("observacao", t)) $("#obs-text").value = ""; });
$("#plan-add").addEventListener("click", async () => { const t = $("#plan-text").value.trim(); if (t && await addNote("planejamento", t, $("#plan-date").value)) $("#plan-text").value = ""; });
$("#ev-add").addEventListener("click", async () => {
  const title = $("#ev-title").value.trim(); if (!title){ $("#ficha-status").textContent = "Dê um nome para a avaliação."; return; }
  const skills = {}; SKILLS.forEach((name, i) => { skills[name] = $("#ev-sk-" + i).value; });
  if (await addNote("avaliacao", $("#ev-note").value.trim(), $("#ev-date").value, { title, skills })){ $("#ev-title").value = ""; $("#ev-note").value = ""; $("#ficha-status").textContent = "Avaliação salva."; }
});

/* ---------- Relatório mensal ---------- */
async function loadReports(){
  const { data } = await supabase.from("teacher_notes").select("id, note_date, body, data").eq("student_id", student.id).eq("kind", "relatorio").order("created_at", { ascending: false }).limit(24);
  $("#rep-list").replaceChildren(...(data || []).map(n => h("details", { class: "line", style: "display:block" },
    h("summary", null, `Relatório de ${n.data && n.data.month ? n.data.month.split("-").reverse().join("/") : br(n.note_date)} · para ${n.data && n.data.to === "empresa" ? "a empresa" : "o aluno"}`),
    h("p", { style: "white-space:pre-wrap;margin-top:8px" }, n.body), del(n.id, loadReports))));
}
$("#rep-gen").addEventListener("click", async () => {
  $("#rep-gen").disabled = true; $("#rep-status").textContent = "Escrevendo o rascunho… pode levar até um minuto.";
  try{
    const r = await callChat({ action: "report", student_id: student.id, month: $("#rep-month").value, audience: $("#rep-to").value, with_notes: $("#rep-notes").checked });
    $("#rep-text").value = r.report; $("#rep-status").textContent = "Rascunho pronto. Revise e edite antes de enviar.";
  }catch(e){ $("#rep-status").textContent = e.msg || "Não deu certo agora."; }
  finally{ $("#rep-gen").disabled = false; }
});
$("#rep-copy").addEventListener("click", () => {
  const ta = $("#rep-text");
  try{ navigator.clipboard.writeText(ta.value).then(() => { $("#rep-status").textContent = "Relatório copiado."; }, () => { ta.select(); }); }catch(e){ ta.select(); }
});
$("#rep-save").addEventListener("click", async () => {
  const t = $("#rep-text").value.trim(); if (!t) return;
  const { error } = await supabase.from("teacher_notes").insert({ student_id: student.id, kind: "relatorio", body: t, data: { month: $("#rep-month").value, to: $("#rep-to").value } });
  $("#rep-status").textContent = error ? "Não deu para guardar." : "Guardado na ficha.";
  if (!error) loadReports();
});

/* ---------- anonymous feedback (all students) ---------- */
export async function loadFeedback(){
  $("#feedback-card").hidden = false;
  const { data, error } = await supabase.from("feedback_anon").select("week, body").order("week", { ascending: false }).limit(100);
  const box = $("#feedbacks"); box.replaceChildren();
  if (error){ box.append(h("p", { class: "err" }, rpcError(error))); return; }
  if (!data.length) box.append(h("p", { class: "muted small" }, "Nenhum feedback recebido ainda."));
  data.forEach(f => box.append(h("div", { class: "struct" }, h("p", { class: "small muted" }, "Semana de " + br(f.week)), h("p", { style: "white-space:pre-wrap" }, f.body))));
}
