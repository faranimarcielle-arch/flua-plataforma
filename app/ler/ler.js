import { supabase, requireLogin, callChat, renderNav, $, h } from "../lib.js";
import { speak, stopSpeech, attemptFlow, errText } from "../pratica.js";
const login = await requireLogin();
if (!login) throw new Error("redirecting");
renderNav("ler", login.profile);

const TENSE = { past: "Simple Past", present: "Simple Present", cont: "Present Continuous", future: "Future (will)" };
let reading = null, rate = 0.9, playing = false;

// {verb phrase|tense|tradução} and [expression|tradução] become buttons; everything else stays plain text.
function parseBody(body){
  const re = /\{([^|{}]+)\|([^|{}]+)\|([^{}]+)\}|\[([^|\[\]]+)\|([^\[\]]+)\]/g;
  return String(body).split(/\n\s*\n/).map(par => {
    const p = h("p"); let last = 0, m; re.lastIndex = 0;
    while ((m = re.exec(par))){
      if (m.index > last) p.append(par.slice(last, m.index));
      if (m[1]){ const t = m[2].trim().toLowerCase(); p.append(h("button", { type: "button", class: "w v " + (TENSE[t] ? t : "other"), "data-tr": m[3].trim(), "data-tense": t }, m[1].trim())); }
      else p.append(h("button", { type: "button", class: "w", "data-tr": m[5].trim() }, m[4].trim()));
      last = re.lastIndex;
    }
    if (last < par.length) p.append(par.slice(last));
    return p;
  });
}
const plain = (body) => String(body).replace(/\{([^|{}]+)\|[^{}]*\}/g, "$1").replace(/\[([^|\[\]]+)\|[^\[\]]*\]/g, "$1");

function render(){
  const c = reading.content;
  $("#read-card").hidden = $("#quiz-card").hidden = $("#turn-card").hidden = false;
  $("#read-title").textContent = c.title;
  $("#read-tags").replaceChildren(...(c.tags || []).map(t => h("span", { class: "chip" }, t)));
  $("#read-body").replaceChildren(...parseBody(c.body));
  renderQuiz();
  const yt = $("#your-turn"); yt.replaceChildren();
  attemptFlow(yt, { activity: "Leitura: Sua vez", task_pt: c.your_turn_pt || "Conte algo da sua vida usando o que você leu.",
    goal: c.your_turn_goal || "talk about their own life using the language of the text", focus: c.your_turn_focus || "Leitura" });
}
function renderQuiz(){
  const qs = reading.content.questions || [], ans = reading.answers || {};
  $("#quiz").replaceChildren(...qs.map((q, i) => h("div", { class: "q" }, h("p", { lang: "en", style: "font-weight:700" }, `${i + 1}. ${q.q}`),
    q.options.map((o, j) => {
      const b = h("button", { type: "button", class: "opt", lang: "en", disabled: ans[i] != null }, o);
      if (ans[i] != null){ if (j === q.answer) b.classList.add("right"); else if (j === ans[i]) b.classList.add("wrong"); }
      b.addEventListener("click", () => answer(i, j));
      return b;
    }))));
  const n = Object.keys(ans).length, ok = qs.filter((q, i) => ans[i] === q.answer).length;
  $("#quiz-status").textContent = n === qs.length ? `Você acertou ${ok} de ${qs.length}. Agora, a sua vez de falar.` : "";
}
async function answer(i, j){
  if (reading.answers[i] != null) return;
  reading.answers = { ...reading.answers, [i]: j };
  renderQuiz();
  await supabase.rpc("answer_reading", { p_id: reading.id, p_question: i, p_choice: j });
}

$("#listen").addEventListener("click", () => {
  if (playing){ stopSpeech(); playing = false; $("#listen").textContent = "▶ Ouvir o texto"; return; }
  playing = true; $("#listen").textContent = "⏹ Parar áudio";
  speak(reading.content.title + ". " + plain(reading.content.body), rate, () => { playing = false; $("#listen").textContent = "▶ Ouvir o texto"; });
});
$("#speed").addEventListener("click", e => { rate = rate === 0.9 ? 0.7 : rate === 0.7 ? 1 : 0.9; e.currentTarget.textContent = `Velocidade ${rate}x`; });
$("#hl").addEventListener("change", e => { $("#read-body").classList.toggle("hl", e.target.checked); $("#legend").hidden = !e.target.checked; });
let word = "";
$("#read-body").addEventListener("click", e => {
  const w = e.target.closest(".w"); if (!w) return;
  word = w.textContent; $("#sh-word").textContent = word; $("#sh-tr").textContent = w.dataset.tr;
  const t = w.dataset.tense, tp = $("#sh-tense");
  if (t && TENSE[t]){ tp.hidden = false; tp.className = "tense " + t; tp.textContent = TENSE[t]; } else tp.hidden = true;
  $("#sheet").hidden = false; speak(word, 0.85);
});
$("#sh-speak").addEventListener("click", () => speak(word, 0.85));
$("#sh-close").addEventListener("click", () => { $("#sheet").hidden = true; });

$("#gen").addEventListener("click", async () => {
  $("#gen").disabled = true; $("#gen-status").textContent = "Escrevendo um texto só para você… isso pode levar até um minuto.";
  try{
    reading = await callChat({ action: "reading_new" });
    render(); window.scrollTo({ top: 0, behavior: "smooth" });
    $("#gen-status").textContent = "Texto novo pronto!"; loadHistory();
  }catch(e){ $("#gen-status").textContent = errText(e); }
  finally{ $("#gen").disabled = false; }
});

let all = [];
async function loadHistory(){
  const { data } = await supabase.from("readings").select("id, content, answers, created_at").eq("student_id", login.session.user.id).order("created_at", { ascending: false }).limit(20);
  all = data || [];
  $("#older").hidden = all.length < 2;
  return all;
}
$("#older").addEventListener("click", e => {
  e.preventDefault();
  const box = $("#history"); box.hidden = !box.hidden;
  box.replaceChildren(...all.map(r => h("div", { class: "line" }, h("span", null, r.content.title),
    h("button", { type: "button", class: "icon-btn", onclick: () => { reading = r; render(); window.scrollTo({ top: 0, behavior: "smooth" }); } }, "Abrir"))));
});

await loadHistory();
if (all.length){ reading = all[0]; render(); }
else{ $("#new-title").textContent = "Seu primeiro texto"; $("#gen").textContent = "Criar meu texto"; $("#gen").classList.add("primary"); }
