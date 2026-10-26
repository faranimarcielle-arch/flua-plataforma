// Shared pieces for reading and practice: voice in and out, support levels and the guided attempt flow.
import { supabase, callChat, h } from "./lib.js";

/* ---------- voice out: Flo's female US voice, when the device has one ---------- */
const canSpeak = "speechSynthesis" in window;
const FEMALE = /jenny|aria|ava|emma|michelle|samantha|allison|susan|zira|google us english|female/i;
const MALE = /guy|christopher|eric|roger|steffan|andrew|brian|david|mark|alex\b|fred|daniel|tom\b|male/i;
let voice = null;
function pickVoice(){
  if (!canSpeak) return;
  const us = speechSynthesis.getVoices().filter(v => /^en[-_]US/i.test(v.lang));
  const female = us.filter(v => FEMALE.test(v.name) && !/\bmale/i.test(v.name.replace(/female/i, "")));
  voice = female.find(v => /natural|online|neural/i.test(v.name)) || female[0] || us.find(v => !MALE.test(v.name)) || null;
}
if (canSpeak){ pickVoice(); speechSynthesis.addEventListener("voiceschanged", pickVoice); }
export function speak(text, rate = 0.95, done){
  if (!canSpeak || !text){ done && done(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice){ u.voice = voice; u.lang = voice.lang; } else u.lang = "en-US";
  u.rate = rate; u.onend = u.onerror = () => done && done();
  speechSynthesis.speak(u);
}
export const stopSpeech = () => { if (canSpeak) speechSynthesis.cancel(); };
export const speakBtn = (text) => h("button", { type: "button", class: "icon-btn", onclick: () => speak(text) }, "🔊 Ouvir");

/* ---------- voice in: tap to talk, pauses never cut you off, tap again to stop ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const MIC_MSG = {
  "not-allowed": "O navegador bloqueou o microfone. Clique no cadeado ao lado do endereço e permita o microfone.",
  "service-not-allowed": "O navegador bloqueou o microfone. Clique no cadeado ao lado do endereço e permita o microfone.",
  "audio-capture": "Nenhum microfone encontrado. Confira se o fone está conectado.",
  "network": "Falha de rede no reconhecimento de voz. Confira a internet.",
};
let activeMic = null;
// A text box with a microphone: what the learner says is written in the box, so they can check it before sending.
export function composer(ta, sendBtn, status){
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); sendBtn.click(); } });
  const wrap = h("div", { class: "composer" }, ta);
  if (SR){
    const mic = h("button", { type: "button", class: "btn", "aria-label": "Falar em inglês" }, "🎤 Falar");
    let rec = null, on = false, base = "", heard = "";
    const stop = () => { on = false; if (rec) try{ rec.stop(); }catch(e){} mic.textContent = "🎤 Falar"; mic.classList.remove("primary"); if (activeMic === stop) activeMic = null; };
    const run = () => {
      rec = new SR(); rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true;
      let session = "";
      rec.onresult = e => { session = ""; for (let i = 0; i < e.results.length; i++) session += e.results[i][0].transcript + " "; ta.value = (base + " " + heard + " " + session).replace(/\s+/g, " ").trim(); };
      rec.onerror = e => { if (MIC_MSG[e.error]){ status && (status.textContent = MIC_MSG[e.error]); stop(); } };
      rec.onend = () => { heard = (heard + " " + session).trim(); rec = null; if (on) try{ run(); }catch(e){ stop(); } };
      rec.start();
    };
    mic.addEventListener("click", () => {
      if (on){ stop(); return; }
      if (activeMic) activeMic();
      stopSpeech(); base = ta.value.trim(); heard = ""; on = true; activeMic = stop;
      mic.textContent = "⏹ Parar"; mic.classList.add("primary");
      try{ run(); }catch(e){ stop(); }
    });
    sendBtn.addEventListener("click", stop, true);
    wrap.append(mic);
  }
  wrap.append(sendBtn);
  return wrap;
}

/* ---------- support levels ---------- */
export const LEVELS = { sozinho: ["Sozinho", "lv-s"], pista: ["Com pista", "lv-p"], modelo: ["Com modelo", "lv-m"] };
export const lvChip = (l, title) => h("span", { class: "lv " + LEVELS[l][1], title: title || null }, LEVELS[l][0]);
export const logPractice = (activity, focus, level) => supabase.rpc("log_practice", { p_activity: activity, p_focus: focus || "Outro", p_level: level });
export const queueReview = (task, goal, focus, level) => task ? supabase.rpc("queue_review", { p_task: task, p_goal: goal, p_focus: focus || "Outro", p_level: level }) : null;
export const errText = (e) => (e && e.msg) || "Não deu certo agora. Tente de novo.";

export function bubble(who, text, me){
  const el = h("div", { class: "msg " + (me ? "me" : "ai") }, who ? h("span", { class: "who" }, who) : null, text);
  if (!me && text && text !== "…") el.append(h("div", { style: "margin-top:6px" }, speakBtn(text)));
  return el;
}

export function challengeCard(host, text){
  if (!text) return;
  const c = h("div", { class: "challenge" }, h("p", { class: "eyebrow" }, "Desafio da vida real"), h("p", null, text));
  const b = h("button", { type: "button", class: "btn", style: "align-self:flex-start" }, "Aceitar desafio");
  b.addEventListener("click", async () => {
    b.disabled = true;
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase.from("challenges").insert({ student_id: session.user.id, body: String(text).slice(0, 400) });
    b.replaceWith(h("p", { class: "small muted" }, error ? "Não deu para salvar agora." : "Aceito! A professora vai perguntar como foi na próxima aula."));
  });
  c.append(b); host.append(c);
}

/* ---------- guided attempt: alone -> with a hint -> with a model and a new attempt ---------- */
export function attemptFlow(host, cfg){
  let stage = cfg.startStage || 0, hint = cfg.hint_pt || "", model = cfg.model || "", variation = "";
  const helpEl = h("div", { class: "stack" });
  const ta = h("textarea", { rows: "2", maxlength: "300", lang: "en", placeholder: "Write or speak in English…", "aria-label": "Sua resposta" });
  const btn = h("button", { type: "button", class: "btn primary" }, "Enviar");
  const status = h("p", { class: "status", role: "status" });
  const box = h("div", { class: "attempt" },
    cfg.lastLevel ? h("div", { class: "row small muted" }, "Da última vez:", lvChip(cfg.lastLevel)) : null,
    h("p", { class: "task" }, cfg.task_pt),
    cfg.original ? h("div", { class: "orig" }, h("span", { class: "small muted" }, "Você disse: "), h("span", { lang: "en" }, cfg.original)) : null,
    helpEl, composer(ta, btn, status), status);
  host.append(box);
  const renderHelp = () => {
    helpEl.replaceChildren();
    if (stage >= 1 && hint) helpEl.append(h("div", { class: "hint" }, h("b", null, "Pista: "), hint));
    if (stage >= 2 && model){
      helpEl.append(h("div", { class: "model" }, h("b", null, "Modelo: "), h("span", { lang: "en" }, model), " ", speakBtn(model)));
      helpEl.append(h("div", { class: "hint" }, h("b", null, "Nova tentativa: "), variation || "Agora diga algo parecido, mudando a informação (outro dia, outra pessoa, outro objeto)."));
    }
  };
  renderHelp();
  btn.addEventListener("click", async () => {
    const answer = ta.value.trim().slice(0, 300); if (!answer || btn.disabled) return;
    btn.disabled = true; status.textContent = "Analisando…";
    try{
      const r = await callChat({ action: "attempt", task_pt: cfg.task_pt, goal: cfg.goal, focus: cfg.focus, original: cfg.original || "", stage, variation, answer });
      if (r.ok){ finish(stage === 0 ? "sozinho" : stage === 1 ? "pista" : "modelo", r.praise_pt || "Isso!"); return; }
      model = r.model || model;
      if (stage === 0){
        stage = 1; hint = r.hint_pt || "Releia a situação e tente de novo.";
        status.textContent = r.understandable ? "Deu para entender! Agora ajuste um detalhe." : "Ainda não ficou claro. Use a pista.";
      } else if (stage === 1){
        stage = 2; variation = r.variation_pt || "";
        status.textContent = "Veja o modelo e tente de novo, com outra informação.";
      } else { finish("modelo", "Vamos retomar este ponto numa próxima vez."); return; }
      ta.value = ""; renderHelp(); btn.disabled = false; ta.focus();
    }catch(e){ status.textContent = errText(e); btn.disabled = false; }
  });
  async function finish(level, msg){
    ta.disabled = true; status.textContent = "";
    box.append(h("div", { class: "done-line" }, lvChip(level), " ", msg));
    await logPractice(cfg.activity, cfg.focus, level);
    if (cfg.reviewId) await supabase.rpc("review_done", { p_id: cfg.reviewId, p_level: level });
    else if (level !== "sozinho") await queueReview(cfg.reviewTask || variation || cfg.task_pt, cfg.goal, cfg.focus, level);
    cfg.onDone && cfg.onDone(level);
  }
}
