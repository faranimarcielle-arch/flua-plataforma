import { supabase, requireLogin, callChat, renderNav, $, h } from "../lib.js";
import { speak as say, stopSpeech } from "../pratica.js";
const speak = (text, done) => say(text, 0.95, done);

const login = await requireLogin();
if (!login) throw new Error("redirecting");
const userId = login.session.user.id;
renderNav("conversa", login.profile);

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const canRecord = !!(navigator.mediaDevices && window.MediaRecorder);
$("#support").textContent = (SR ? "" : "Este navegador não reconhece voz: use o Google Chrome ou o Microsoft Edge. ") +
  "Para usar fone de ouvido, escolha-o como microfone e saída de som antes de começar. Sua voz fica gravada para o professor poder ouvir.";

/* ---------- conversation ---------- */
let conversationId = null, turns = 0, busy = false;
// Flo's messages get a replay button: if the phone blocked the speech, one tap plays it.
const bubble = (who, text, cls) => h("div", {class:"msg " + cls}, h("span", {class:"who"}, who), text,
  cls === "ai" ? h("div", {style:"margin-top:6px"}, h("button", {type:"button", class:"icon-btn", onclick:() => speak(text)}, "🔊 Ouvir")) : null);
function addBubble(who, text, cls){ const b = bubble(who, text, cls); $("#chat").append(b); b.scrollIntoView({block:"nearest", behavior:"smooth"}); return b; }
function setState(kind, text){
  $("#mic").classList.toggle("listening", kind === "listening");
  $("#mic").classList.toggle("busy", kind === "thinking");
  $("#mic").setAttribute("aria-label", kind === "listening" ? "Enviar" : "Falar");
  $("#state").textContent = text;
}
const IDLE = "Toque no microfone e fale";
async function start(){
  conversationId = null; turns = 0; $("#chat").replaceChildren(); $("#review").hidden = true; $("#finish").disabled = true;
  try{ const r = await callChat({ action:"start" }); addBubble("Flo", r.opener, "ai"); speak(r.opener); setState("idle", IDLE); }
  catch(e){ setState("idle", IDLE); $("#status").replaceChildren(h("span", {class:"err"}, e.msg)); }
}
$("#restart").addEventListener("click", () => { stopAll(); start(); });

async function uploadAudio(blob){
  if (!blob || !blob.size) return null;
  const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "mp4" : "webm";
  const path = `${userId}/${new Date().toISOString().slice(0, 10)}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("audios").upload(path, blob, { contentType: blob.type.split(";")[0] || "audio/webm" });
  return error ? null : path;
}
async function sendLearner(text, blob){
  text = text.trim().slice(0, 600); if (!text || busy) return;
  busy = true;
  const mine = addBubble("Você", text, "me");
  if (blob && blob.size) mine.append(h("audio", {controls:true, src:URL.createObjectURL(blob), preload:"none"}));
  setState("thinking", "Flo está pensando…"); $("#status").textContent = "";
  try{
    const audio_path = await uploadAudio(blob);
    const r = await callChat({ action:"reply", conversation_id:conversationId, text, audio_path });
    conversationId = r.conversation_id; turns++;
    $("#finish").disabled = turns < 2;
    addBubble("Flo", r.reply, "ai");
    setState("speaking", "Flo está falando…");
    speak(r.reply, () => setState("idle", IDLE));
  }catch(e){
    mine.remove();
    $("#status").replaceChildren(h("span", {class:"err"}, e.msg || "Algo deu errado."));
    setState("idle", IDLE);
  }finally{ busy = false; }
}

/* ---------- push-to-talk: tap to start, pauses never end the turn, tap again to send ---------- */
let rec = null, recording = false, kept = "", partial = "", live = null, onHeard = null, ptt = null, restarts = 0;
let media = null, recorder = null, chunks = [];
const MIC_MSG = {
  "not-allowed":"O navegador bloqueou o microfone. Clique no cadeado ao lado do endereço e permita o microfone.",
  "service-not-allowed":"O navegador bloqueou o microfone. Clique no cadeado ao lado do endereço e permita o microfone.",
  "audio-capture":"Nenhum microfone encontrado. Confira se o fone está conectado e escolhido como microfone.",
  "network":"Falha de rede no reconhecimento de voz. Confira a internet."
};
const heardSoFar = () => (kept + " " + partial).replace(/\s+/g, " ").trim();
function showHeard(){ const t = heardSoFar(); if (live) live.lastChild.textContent = t || "…"; if (ptt && ptt.liveEl) ptt.liveEl.textContent = t || "…"; }
function runSession(){
  rec = new SR(); rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
  partial = "";
  rec.onresult = e => {
    let fin = "", tmp = "";
    for (let i = 0; i < e.results.length; i++){ const r = e.results[i]; if (r.isFinal) fin += r[0].transcript + " "; else tmp += r[0].transcript + " "; }
    partial = (fin + tmp).trim(); restarts = 0; showHeard();
  };
  rec.onerror = e => { if (MIC_MSG[e.error]){ recording = false; $("#status").textContent = MIC_MSG[e.error]; } };
  rec.onend = () => {
    kept = heardSoFar(); partial = ""; rec = null;
    if (recording && restarts++ < 100){ try{ runSession(); return; }catch(e){} }
    finishRecording();
  };
  rec.start();
}
async function startAudio(){
  if (!canRecord) return;
  try{
    media = await navigator.mediaDevices.getUserMedia({ audio:true });
    chunks = []; recorder = new MediaRecorder(media);
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.start();
  }catch(e){ media = null; recorder = null; }
}
function stopAudio(){
  return new Promise(resolve => {
    if (!recorder || recorder.state === "inactive"){ resolve(null); return; }
    recorder.onstop = () => { const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" }); media && media.getTracks().forEach(t => t.stop()); media = null; recorder = null; resolve(blob); };
    recorder.stop();
  });
}
async function startRecording(target){
  if (!SR){ $("#status").textContent = "Reconhecimento de voz indisponível: use o Chrome ou o Edge, ou escreva a mensagem."; return; }
  if (rec || recording || busy) return;
  stopSpeech();
  ptt = target || null; onHeard = target ? target.done : sendLearner;
  kept = ""; partial = ""; restarts = 0; recording = true; $("#status").textContent = "";
  if (!target) live = addBubble("Você", "…", "me live");
  setState("listening", "Gravando… fale no seu ritmo. Toque de novo para enviar.");
  $("#cancel-rec").hidden = false;
  if (ptt && ptt.button) ptt.button.textContent = "Enviar minha resposta";
  if (!target) await startAudio();
  try{ runSession(); }catch(e){ recording = false; finishRecording(); }
}
function sendRecording(){ if (!recording) return; recording = false; try{ rec ? rec.stop() : finishRecording(); }catch(e){ finishRecording(); } }
function cancelRecording(){ onHeard = null; recording = false; try{ rec && rec.abort(); }catch(e){} if (!rec) finishRecording(); }
// The recogniser reports its end more than once; only the first call (while something is recording) counts.
let finishing = false;
async function finishRecording(){
  if (finishing || (!onHeard && !live && !ptt && !recorder)) return;
  finishing = true;
  try{ await finishRecordingNow(); }finally{ finishing = false; }
}
async function finishRecordingNow(){
  const text = heardSoFar(), cb = onHeard, target = ptt;
  kept = ""; partial = ""; onHeard = null; ptt = null;
  if (live){ live.remove(); live = null; }
  $("#cancel-rec").hidden = true;
  if (target && target.button) target.button.textContent = target.label;
  const blob = await stopAudio();
  setState("idle", IDLE);
  if (cb && text) cb(text, blob);
  else if (cb && !text) $("#status").textContent = "Não ouvi nada. Toque no microfone e tente de novo.";
}
function stopAll(){ cancelRecording(); stopSpeech(); setState("idle", IDLE); }
$("#mic").addEventListener("click", () => {
  if (recording){ if (!ptt) sendRecording(); return; }
  if ($("#mic").classList.contains("busy")) return;
  startRecording();
});
$("#cancel-rec").addEventListener("click", cancelRecording);
$("#send-typed").addEventListener("click", () => { const t = $("#typed").value; $("#typed").value = ""; stopAll(); sendLearner(t, null); });
$("#typed").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); $("#send-typed").click(); } });

/* ---------- review: hint first, then a new spoken try, then the model ---------- */
$("#finish").addEventListener("click", async () => {
  stopAll();
  const box = $("#review"); box.hidden = false;
  box.replaceChildren(h("h2", null, "Seus pontos"), h("p", {class:"status"}, "Separando os pontos mais importantes…"));
  try{
    const r = await callChat({ action:"review", conversation_id:conversationId });
    box.replaceChildren(h("h2", null, "Seus pontos"), h("p", null, r.well_pt || "Você manteve a conversa em inglês. Muito bom!"));
    if (!r.issues.length) box.append(h("p", {class:"ok-line"}, "Nenhum ponto para retomar. Você se comunicou bem!"));
    r.issues.forEach((x, i) => box.append(issueBlock(x, i)));
    $("#finish").disabled = true; conversationId = null;
    box.append(h("button", {type:"button", class:"btn primary", style:"align-self:flex-start", onclick:() => { $("#restart").click(); window.scrollTo({top:0, behavior:"smooth"}); }}, "Nova conversa"));
  }catch(e){ box.replaceChildren(h("h2", null, "Seus pontos"), h("p", {class:"err"}, e.msg)); }
});
function issueBlock(x, i){
  const out = h("div", {class:"status", role:"status"});
  const retry = h("button", {type:"button", class:"btn primary"}, "Tentar de novo falando");
  const modelBox = h("div", {class:"model", hidden:true}, h("b", null, "Modelo: "), h("span", {lang:"en"}, String(x.model || "")), " ",
    h("button", {type:"button", class:"icon-btn", onclick:() => speak(String(x.model || ""))}, "Ouvir"));
  const showModel = () => { modelBox.hidden = false; };
  retry.addEventListener("click", () => {
    if (recording){ if (ptt && ptt.button === retry) sendRecording(); return; }
    const liveEl = h("span", {lang:"en"}, "…");
    out.replaceChildren(h("span", null, "Gravando: "), liveEl);
    startRecording({ button:retry, label:retry.textContent, liveEl, done: async said => {
      out.replaceChildren(h("span", null, "Você disse: "), h("b", {lang:"en"}, said), h("span", null, " · conferindo…"));
      try{
        const r = await callChat({ action:"retry", original:String(x.original), hint:String(x.hint_pt || ""), said });
        out.replaceChildren(h("span", {class: r.ok ? "ok-line" : ""}, (r.ok ? "Isso! " : "Quase. ") + (r.feedback_pt || "")));
        if (!r.ok) showModel();
      }catch(e){ out.replaceChildren(h("span", {class:"err"}, e.msg)); }
    } });
  });
  return h("div", {class:"point"}, h("p", {class:"small muted"}, `Ponto ${i + 1}`),
    h("div", {class:"orig"}, h("span", {class:"small muted"}, "Você disse: "), h("span", {lang:"en"}, String(x.original))),
    h("div", {class:"hint"}, h("b", null, "Pista: "), String(x.hint_pt || "")),
    modelBox, h("div", {class:"row"}, retry, h("button", {type:"button", class:"icon-btn", onclick:showModel}, "Ver modelo")), out);
}

start();
