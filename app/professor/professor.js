import { supabase, requireLogin, logout, $, h } from "../lib.js";
const login = await requireLogin();
if (!login) throw new Error("redirecting");
$("#logout").addEventListener("click", logout);
if (!login.profile || login.profile.role !== "teacher"){ $("#denied").hidden = false; throw new Error("not teacher"); }
$("#students-card").hidden = false;

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
  if (st){ $("#st-level").value = st.level; $("#st-limit").value = st.daily_ai_limit_usd; $("#st-interests").value = st.interests; $("#st-goal").value = st.goal; }
  const today = new Date().toLocaleDateString("en-CA", { timeZone:"America/Sao_Paulo" });
  const { data: usage } = await supabase.from("ai_usage").select("cost_usd, day").eq("student_id", s.id);
  const total = (usage || []).reduce((a, r) => a + Number(r.cost_usd), 0), day = (usage || []).filter(r => r.day === today).reduce((a, r) => a + Number(r.cost_usd), 0);
  $("#st-cost").textContent = `Gasto com IA: hoje US$ ${day.toFixed(4)} · total US$ ${total.toFixed(4)}`;
  await loadConversations(s.id);
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
    supabase.from("student_settings").update({ level:$("#st-level").value, daily_ai_limit_usd:limit, interests:$("#st-interests").value.trim(), goal:$("#st-goal").value.trim(), updated_at:new Date().toISOString() }).eq("student_id", current.id),
    supabase.from("profiles").update({ name:$("#st-display").value.trim() }).eq("id", current.id)
  ]);
  $("#st-status").textContent = a.error || b.error ? "Não deu para salvar." : "Salvo. A conversa já usa o perfil novo.";
  if (!b.error){ current.name = $("#st-display").value.trim(); $("#st-name").textContent = current.name || current.email; loadStudents(); }
});
loadStudents();
