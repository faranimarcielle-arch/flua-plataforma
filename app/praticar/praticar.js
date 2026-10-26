import { supabase, requireLogin, callChat, renderNav, $, h } from "../lib.js";
import { speak, stopSpeech, speakBtn, composer, lvChip, logPractice, queueReview, bubble, challengeCard, attemptFlow, errText } from "../pratica.js";
const login = await requireLogin();
if (!login) throw new Error("redirecting");
renderNav("praticar", login.profile);
const me = login.session.user.id;
const { data: prof } = await supabase.rpc("my_profile");
const P = (prof && prof[0]) || { name: login.profile?.name || "", visible_activities: ["mission", "detective", "choice", "voice", "review", "warmup"] };
const firstName = (P.name || "").split(" ")[0] || "you";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const fmtDate = (d) => d.split("-").reverse().slice(0, 2).join("/");

const ACTIVITIES = [
  { id: "mission", name: "Missão Real", skill: "Usar o que você sabe numa situação nova", does: "Converse com um personagem até cumprir um objetivo." },
  { id: "detective", name: "Detetive de Perguntas", skill: "Fazer perguntas e continuar a conversa", does: "Descubra as informações só perguntando." },
  { id: "choice", name: "Escolha e Defenda", skill: "Comparar alternativas e justificar", does: "Escolha, explique por quê e responda a um contra-argumento." },
  { id: "voice", name: "Mensagem de Voz", skill: "Ouvir e responder ao significado", does: "Ouça a mensagem e responda como responderia de verdade." },
  { id: "review", name: "De Volta", skill: "Recuperar o que você já estudou", does: "Retome conteúdos anteriores com menos ajuda a cada vez." },
  { id: "warmup", name: "Aquecimento", skill: "Preparação (opcional)", does: "Exercícios rápidos de reconhecimento. Não contam como domínio.", prep: true },
];
const visible = ACTIVITIES.filter(a => (P.visible_activities || []).includes(a.id));

/* ---------- list ---------- */
let reviews = [];
async function renderList(){
  const [{ data: rv }, { data: ch }] = await Promise.all([
    supabase.from("review_items").select("id, task_pt, goal, focus, hist, due").eq("student_id", me).order("due"),
    supabase.from("challenges").select("body, status, created_at").eq("student_id", me).eq("status", "pendente").order("created_at", { ascending: false }),
  ]);
  reviews = rv || [];
  const due = reviews.filter(r => r.due <= today()).length;
  const tc = $("#today-card");
  tc.replaceChildren(h("h2", null, "Para hoje"),
    h("p", null, due ? `Você tem ${due} ${due === 1 ? "item" : "itens"} para retomar no De Volta.` : "Nada para retomar hoje no De Volta. Escolha uma atividade!"),
    (ch || []).length ? h("div", { class: "stack" }, h("p", { class: "small", style: "font-weight:800" }, "Seus desafios da vida real:"), (ch || []).slice(0, 3).map(c => h("p", { class: "small" }, "• " + c.body))) : null);
  $("#acts").replaceChildren(...visible.map(a => h("button", { type: "button", class: "act" + (a.prep ? " prep" : ""), onclick: () => { location.hash = a.id; } },
    h("span", { class: "eyebrow" }, a.skill), h("h3", null, a.name + (a.id === "review" && due ? ` · ${due} para hoje` : "")), h("span", { class: "small muted" }, a.does))));
  if (!visible.length) $("#acts").append(h("p", { class: "muted" }, "Nenhuma atividade liberada pela professora no momento."));
}

/* ---------- routing: #mission, #mission/<id>, ... ---------- */
async function route(){
  stopSpeech();
  const [id, sub] = location.hash.slice(1).split("/");
  const a = visible.find(x => x.id === id);
  if (!a){ $("#act-view").hidden = true; $("#list-view").hidden = false; renderList(); return; }
  $("#list-view").hidden = true;
  const view = $("#act-view"); view.hidden = false;
  const body = h("div", { class: "stack" });
  view.replaceChildren(h("a", { class: "btn", href: "#", style: "align-self:flex-start" }, "← Atividades"),
    h("div", null, h("p", { class: "eyebrow" }, a.skill), h("h1", null, a.name)), body);
  window.scrollTo({ top: 0 });
  if (id === "review") return runReview(body);
  if (id === "warmup") return runWarmup(body);
  if (sub){
    const { data: item } = await supabase.from("activity_items").select("id, content, runs").eq("id", sub).eq("student_id", me).single();
    if (item) return ({ mission: runMission, detective: runDetective, choice: runChoice, voice: runVoice })[id](item, body);
  }
  pickItem(a, body);
}
window.addEventListener("hashchange", route);

async function pickItem(a, body){
  const list = h("div", { class: "stack" }), status = h("p", { class: "status", role: "status" });
  const more = h("button", { type: "button", class: "btn" }, "Criar situações novas");
  body.append(h("p", { class: "small muted" }, a.does + " Escolha uma situação:"), list, h("div", { class: "row" }, more), status);
  const title = (c) => c.title || c.q_pt || ("Mensagem de " + c.from);
  const draw = (items) => list.replaceChildren(...items.map(it => h("button", { type: "button", class: "act", onclick: () => { location.hash = a.id + "/" + it.id; } },
    h("h3", null, title(it.content)), h("span", { class: "small muted" }, it.runs ? `Feita ${it.runs}x` : "Nova"))));
  const load = async () => (await supabase.from("activity_items").select("id, content, runs").eq("student_id", me).eq("activity", a.id).order("created_at", { ascending: false }).limit(12)).data || [];
  const create = async () => {
    more.disabled = true; status.textContent = "Criando situações pensadas para você… pode levar até um minuto.";
    try{ await callChat({ action: "items_new", activity: a.id }); draw(await load()); status.textContent = ""; }
    catch(e){ status.textContent = errText(e); }
    finally{ more.disabled = false; }
  };
  more.addEventListener("click", create);
  const items = await load();
  if (items.length) draw(items); else create();
}
const bump = (id) => supabase.rpc("bump_activity_run", { p_id: id });
// Errors noticed during free practice come back at the end, to fix with a hint.
function reviewIssues(host, issues, activity, done){
  const seen = new Set(), list = issues.filter(i => i && i.original && !seen.has(i.focus) && seen.add(i.focus)).slice(0, 3);
  if (!list.length){ host.append(h("p", { class: "done-line" }, lvChip("sozinho"), " Nenhum ponto para retomar. Você se comunicou bem!")); done && done(); return; }
  host.append(h("div", null, h("h3", null, `Pontos para retomar (${list.length})`), h("p", { class: "small muted" }, "Use a pista para corrigir a sua própria frase.")));
  let i = 0;
  const next = () => {
    if (i >= list.length){ done && done(); return; }
    const iss = list[i++];
    attemptFlow(host, { activity, focus: iss.focus || "Outro", task_pt: "Reescreva a frase usando a pista.", original: iss.original, hint_pt: iss.hint_pt, model: iss.model,
      startStage: 1, reviewTask: iss.situation_pt || null, goal: "Express the same idea as the learner's original sentence, correctly. Original: " + iss.original, onDone: next });
  };
  next();
}

/* ---------- 1. Missão Real ---------- */
function runMission(item, host){
  const m = item.content, goals = m.goals || [];
  const run = { turns: [{ role: "assistant", content: m.opener || "Hi!" }], met: goals.map(() => false), issues: [], usedKw: false, usedStarter: false, busy: false, ended: false };
  const first = !item.runs;
  const goalsEl = h("ul", { class: "goals" }), chat = h("div", { class: "chat", lang: "en" });
  const kw = h("div", { class: "row", hidden: !first }, (m.keywords || []).map(k => h("span", { class: "chip", lang: "en" }, k)));
  if (first) run.usedKw = true;
  const kwBtn = h("button", { type: "button", class: "icon-btn" }, first ? "Esconder palavras-chave" : "Mostrar palavras-chave");
  kwBtn.addEventListener("click", () => { kw.hidden = !kw.hidden; if (!kw.hidden) run.usedKw = true; kwBtn.textContent = kw.hidden ? "Mostrar palavras-chave" : "Esconder palavras-chave"; });
  const idea = h("p", { class: "hint", hidden: true, lang: "en" });
  const ideaBtn = h("button", { type: "button", class: "icon-btn" }, "Ideia de frase");
  ideaBtn.addEventListener("click", () => { const i = run.met.findIndex(g => !g); idea.textContent = (m.starters || [])[i < 0 ? 0 : i] || ""; idea.hidden = !idea.textContent; run.usedStarter = true; });
  const support = h("div", { class: "stack" }, h("div", { class: "row" }, kwBtn, ideaBtn), kw, idea);
  const ta = h("textarea", { rows: "1", maxlength: "400", lang: "en", placeholder: "Write or speak in English…", "aria-label": "Sua mensagem" });
  const send = h("button", { type: "button", class: "btn primary" }, "Enviar");
  const status = h("p", { class: "status", role: "status" });
  const comp = composer(ta, send, status);
  const endBtn = h("button", { type: "button", class: "btn", style: "align-self:flex-start" }, "Encerrar missão");
  const after = h("div", { class: "stack" });
  host.append(h("div", { class: "brief" }, h("p", { class: "eyebrow" }, "Sua missão"), h("p", null, m.brief_pt)), goalsEl,
    h("div", { class: "card" }, chat, support, comp, status), endBtn, after);
  const drawGoals = () => goalsEl.replaceChildren(...goals.map((g, i) => h("li", { class: run.met[i] ? "done" : "" }, h("span", { class: "check" }, run.met[i] ? "✓" : ""), g.pt)));
  const drawChat = () => { chat.replaceChildren(...run.turns.map(t => bubble(t.role === "user" ? null : m.char, t.content, t.role === "user"))); chat.lastChild && chat.lastChild.scrollIntoView({ block: "nearest" }); };
  drawGoals(); drawChat(); speak(run.turns[0].content);
  async function doSend(){
    const msg = ta.value.trim().slice(0, 400); if (!msg || run.busy || run.ended) return;
    run.busy = true; send.disabled = true; ta.value = ""; status.textContent = "";
    run.turns.push({ role: "user", content: msg }); drawChat(); chat.append(bubble(m.char, "…"));
    try{
      const r = await callChat({ action: "mission_turn", item_id: item.id, turns: run.turns });
      run.turns.push({ role: "assistant", content: r.reply || "…" });
      r.goals_met.forEach((v, i) => { if (v && i < run.met.length) run.met[i] = true; });
      run.issues.push(...(r.issues || []));
      drawGoals(); drawChat(); speak(r.reply);
      if (run.met.length && run.met.every(Boolean)) end(true);
    }catch(e){ run.turns.pop(); ta.value = msg; drawChat(); status.textContent = errText(e); }
    finally{ run.busy = false; send.disabled = false; }
  }
  send.addEventListener("click", doSend);
  endBtn.addEventListener("click", () => { if (!run.busy && !run.ended) end(false); });
  function end(complete){
    run.ended = true; comp.hidden = support.hidden = endBtn.hidden = true;
    bump(item.id);
    const lvl = run.usedStarter ? "modelo" : run.usedKw ? "pista" : "sozinho", met = run.met.filter(Boolean).length;
    if (complete) logPractice("Missão Real", "Missão: " + (m.title || ""), lvl);
    after.append(h("div", { class: "card" }, h("h2", null, complete ? "Missão cumprida!" : "Missão encerrada"), h("p", null, `Objetivos cumpridos: ${met} de ${goals.length}.`),
      complete ? h("div", { class: "done-line" }, "Apoio usado na missão: ", lvChip(lvl)) : null));
    reviewIssues(after, run.issues, "Missão Real", () => challengeCard(after, m.challenge));
  }
}

/* ---------- 2. Detetive de Perguntas ---------- */
function runDetective(item, host){
  const c = item.content, facts = c.facts || [];
  const run = { found: {}, stage: 0, hint: "", model: "", variation: "", prevQ: "", busy: false, levels: [] };
  const factsEl = h("ul", { class: "goals" }), chat = h("div", { class: "chat", lang: "en" }), help = h("div", { class: "stack" });
  const words = h("div", { class: "row", hidden: !!item.runs }, (c.words || []).map(w => h("span", { class: "chip", lang: "en" }, w)));
  const wordsBtn = h("button", { type: "button", class: "icon-btn", hidden: !item.runs }, "Mostrar palavras de pergunta");
  wordsBtn.addEventListener("click", () => { words.hidden = false; wordsBtn.hidden = true; });
  const ta = h("textarea", { rows: "1", maxlength: "200", lang: "en", placeholder: "Ask a question…", "aria-label": "Sua pergunta" });
  const send = h("button", { type: "button", class: "btn primary" }, "Perguntar");
  const status = h("p", { class: "status", role: "status" });
  const qCard = h("div", { class: "card" }, chat, help, wordsBtn, words, composer(ta, send, status), status);
  const after = h("div", { class: "stack" });
  host.append(h("div", { class: "brief" }, h("p", { class: "eyebrow" }, "Seu caso"), h("p", null, c.brief_pt)), factsEl, qCard, after);
  const drawFacts = () => factsEl.replaceChildren(...facts.map(f => h("li", { class: run.found[f.id] ? "done" : "" }, h("span", { class: "check" }, run.found[f.id] ? "✓" : ""), f.pt)));
  const drawHelp = () => {
    help.replaceChildren();
    if (run.stage >= 1 && run.hint) help.append(h("div", { class: "hint" }, h("b", null, "Pista: "), run.hint, " Reformule a pergunta."));
    if (run.stage >= 2 && run.model){
      help.append(h("div", { class: "model" }, h("b", null, "Modelo: "), h("span", { lang: "en" }, run.model), " ", speakBtn(run.model)));
      help.append(h("div", { class: "hint" }, h("b", null, "Agora pergunte: "), run.variation || "outra coisa, usando o mesmo formato de pergunta."));
    }
  };
  drawFacts(); chat.append(bubble(c.char, "Ask me anything!"));
  async function ask(){
    const q = ta.value.trim().slice(0, 200); if (!q || run.busy) return;
    run.busy = true; send.disabled = true; ta.value = ""; status.textContent = "";
    const mine = bubble(null, q, true); chat.append(mine);
    try{
      const r = await callChat({ action: "detective_ask", item_id: item.id, question: q, stage: run.stage, prev_q: run.prevQ });
      const focus = r.focus || c.focus || "Perguntas";
      const show = () => {
        if (r.understandable && r.answer){ chat.append(bubble(c.char, r.answer)); speak(r.answer); }
        r.revealed.forEach(id => { if (facts.some(f => f.id === id)) run.found[id] = true; });
      };
      if (run.stage === 0){
        show();
        if (r.well_formed) settle("sozinho", focus);
        else{
          if (!r.understandable) chat.append(bubble(c.char, "Sorry, I don't understand the question."));
          Object.assign(run, { stage: 1, prevQ: q, hint: r.hint_pt || "Confira a ordem das palavras e o auxiliar.", model: r.model, variation: r.variation_pt });
        }
      } else if (run.stage === 1){
        if (r.well_formed){ show(); settle("pista", focus); }
        else Object.assign(run, { stage: 2, prevQ: q, model: r.model || run.model, variation: r.variation_pt || run.variation });
      } else { show(); settle("modelo", focus, !r.well_formed); }
      drawHelp(); drawFacts();
      if (facts.length && facts.every(f => run.found[f.id])) finish();
    }catch(e){ status.textContent = errText(e); ta.value = q; mine.remove(); }
    finally{ run.busy = false; send.disabled = false; }
  }
  function settle(level, focus, failed){
    logPractice("Detetive de Perguntas", focus, level); run.levels.push(level);
    if (level !== "sozinho") queueReview(run.variation || "Pergunte a alguém o que essa pessoa fez no fim de semana.", "ask a correctly formed question", focus, level);
    status.textContent = level === "sozinho" ? "Pergunta perfeita!" : failed ? "Vamos retomar esse formato de pergunta depois." : "Boa correção!";
    Object.assign(run, { stage: 0, hint: "", model: "", variation: "" });
  }
  function finish(){
    qCard.hidden = true; bump(item.id);
    after.append(h("div", { class: "card" }, h("h2", null, "Caso resolvido!"),
      h("p", null, `Você fez ${run.levels.length} pergunta${run.levels.length === 1 ? "" : "s"} bem formada${run.levels.length === 1 ? "" : "s"}, com este apoio:`),
      h("div", { class: "row" }, run.levels.map(l => lvChip(l)))));
    challengeCard(after, c.challenge);
  }
  send.addEventListener("click", ask);
}

/* ---------- 3. Escolha e Defenda ---------- */
const BANK = ["I'd rather… because…", "I prefer… because…", "It's cheaper / faster / easier than…", "That's true, but…", "On the other hand,…", "For me, the most important thing is…"];
function runChoice(item, host){
  const d = item.content;
  const run = { choice: null, turns: [], step: 0, busy: false, usedBank: !item.runs };
  const intro = h("div", { class: "brief" }, h("p", { class: "eyebrow" }, "A escolha"), h("p", { style: "font-weight:700" }, d.q_pt));
  const opts = h("div", { class: "row" }, [d.a, d.b].map(o => h("button", { type: "button", class: "btn", onclick: () => choose(o) }, o)));
  const chat = h("div", { class: "chat", lang: "en" });
  const bank = h("div", { class: "row", hidden: !!item.runs }, BANK.map(b => h("span", { class: "chip", lang: "en" }, b)));
  const bankBtn = h("button", { type: "button", class: "icon-btn", hidden: !item.runs }, "Mostrar expressões úteis");
  bankBtn.addEventListener("click", () => { bank.hidden = false; bankBtn.hidden = true; run.usedBank = true; });
  const ta = h("textarea", { rows: "2", maxlength: "400", lang: "en", placeholder: "I'd rather… because…", "aria-label": "Sua resposta" });
  const send = h("button", { type: "button", class: "btn primary" }, "Enviar");
  const status = h("p", { class: "status", role: "status" });
  const comp = composer(ta, send, status), sup = h("div", { class: "stack" }, bankBtn, bank);
  const work = h("div", { class: "card", hidden: true }, chat, sup, comp, status), after = h("div", { class: "stack" });
  host.append(intro, opts, work, after);
  function choose(o){ run.choice = o; opts.remove(); work.hidden = false; intro.append(h("p", { class: "small" }, "Sua escolha: ", h("b", null, o))); chat.append(bubble("Flo", "Interesting choice! Why?")); ta.focus(); }
  async function doSend(){
    const msg = ta.value.trim().slice(0, 400); if (!msg || run.busy) return;
    run.busy = true; send.disabled = true; ta.value = ""; status.textContent = "";
    run.turns.push({ role: "user", content: msg });
    const mine = bubble(null, msg, true); chat.append(mine);
    try{
      if (run.step === 0){
        const r = await callChat({ action: "choice_turn", item_id: item.id, choice: run.choice, text: msg });
        const reply = r.reply || "Why do you think so?";
        run.turns.push({ role: "assistant", content: reply }); chat.append(bubble("Flo", reply)); speak(reply);
        if (r.understandable) run.step = 1;
      } else {
        comp.hidden = sup.hidden = true; status.textContent = "Flo está pensando no que você disse…";
        const r = await callChat({ action: "choice_turn", item_id: item.id, choice: run.choice, turns: run.turns, final: true });
        status.textContent = ""; chat.append(bubble("Flo", r.closing || "Fair enough!")); bump(item.id);
        const lvl = run.usedBank ? "pista" : "sozinho";
        logPractice("Escolha e Defenda", "Comparar e justificar", lvl);
        const fb = h("div", { class: "card" }, h("h2", null, "Seus pontos"));
        if (r.points.length) r.points.forEach(p => fb.append(h("div", { class: "point" }, h("span", { lang: "en" }, h("s", null, p.original), " → ", h("b", null, p.better)), h("span", { class: "small muted" }, p.why_pt))));
        else fb.append(h("p", null, "Seus argumentos ficaram claros e naturais!"));
        if (r.reformulation) fb.append(h("div", { class: "model" }, h("b", null, "Seu argumento, mais natural: "), h("span", { lang: "en" }, r.reformulation), " ", speakBtn(r.reformulation)));
        fb.append(h("div", { class: "done-line" }, "Apoio usado: ", lvChip(lvl)));
        const tr = h("div", { class: "card" }, h("h3", null, "Agora, outra escolha"));
        after.append(fb, tr);
        attemptFlow(tr, { activity: "Escolha e Defenda", task_pt: r.transfer_pt || "Prefere trabalhar em casa ou no escritório? Escolha e explique por quê.",
          goal: r.transfer_goal || "choose one option and justify it with a reason", focus: r.transfer_focus || "Comparar e justificar",
          onDone: () => challengeCard(after, "Esta semana, dê sua opinião em inglês sobre alguma escolha (um filme, um jogo, uma ferramenta) e explique o porquê.") });
      }
    }catch(e){ status.textContent = errText(e); comp.hidden = sup.hidden = false; run.turns.pop(); mine.remove(); ta.value = msg; }
    finally{ run.busy = false; send.disabled = false; }
  }
  send.addEventListener("click", doSend);
}

/* ---------- 4. Mensagem de Voz ---------- */
function runVoice(item, host){
  const v = item.content, text = String(v.text || "").replaceAll("{name}", firstName), sender = String(v.from || "").split(",")[0] || "Friend";
  const run = { plays: 0, slow: false, transcript: false, attempts: 0, busy: false, done: false };
  const counts = h("p", { class: "small muted" }), tr = h("p", { lang: "en", hidden: true, style: "font-weight:700" }, text);
  const upd = () => { counts.textContent = `Ouviu ${run.plays}x` + (run.slow ? " · usou velocidade lenta" : "") + (run.transcript ? " · viu o texto" : ""); };
  const trBtn = h("button", { type: "button", class: "icon-btn" }, "Ver o texto");
  const showTr = () => { run.transcript = true; tr.hidden = false; trBtn.hidden = true; upd(); };
  trBtn.addEventListener("click", showTr);
  const play = h("button", { type: "button", class: "btn primary" }, "▶ Ouvir");
  play.addEventListener("click", () => { run.plays++; upd(); speak(text, 0.95); });
  const slow = h("button", { type: "button", class: "icon-btn" }, "Ouvir devagar");
  slow.addEventListener("click", () => { run.plays++; run.slow = true; upd(); speak(text, 0.65); });
  const chat = h("div", { class: "chat", lang: "en" });
  const ta = h("textarea", { rows: "2", maxlength: "300", lang: "en", placeholder: "Reply in English…", "aria-label": "Sua resposta" });
  const send = h("button", { type: "button", class: "btn primary" }, "Responder");
  const status = h("p", { class: "status", role: "status" }), comp = composer(ta, send, status), after = h("div", { class: "stack" });
  host.append(h("div", { class: "voice" }, h("p", { class: "eyebrow" }, "Mensagem de voz de " + v.from), h("div", { class: "row" }, play, slow, trBtn), counts, tr),
    h("p", { class: "small muted" }, "Responda como você responderia de verdade. O que conta é responder ao que a pessoa disse."),
    h("div", { class: "card" }, chat, comp, status), after);
  upd();
  send.addEventListener("click", async () => {
    const ans = ta.value.trim().slice(0, 300); if (!ans || run.busy || run.done) return;
    if (!run.plays){ status.textContent = "Ouça a mensagem primeiro."; return; }
    run.busy = true; send.disabled = true; ta.value = ""; status.textContent = ""; run.attempts++;
    const mine = bubble(null, ans, true); chat.append(mine);
    try{
      const r = await callChat({ action: "voice_reply", item_id: item.id, answer: ans });
      if (r.character_reply){ chat.append(bubble(sender, r.character_reply)); speak(r.character_reply); }
      if (r.appropriate){
        run.done = true; comp.hidden = true; bump(item.id);
        const level = run.transcript ? "modelo" : (run.slow || run.attempts > 1) ? "pista" : "sozinho";
        logPractice("Mensagem de Voz", v.focus || "Responder ao significado", level);
        after.append(h("div", { class: "card" }, h("h2", null, "Mensagem entendida!"), r.note_pt ? h("p", null, r.note_pt) : null, h("div", { class: "done-line" }, "Apoio usado: ", lvChip(level))));
        challengeCard(after, v.challenge);
      } else {
        status.textContent = (r.note_pt || "Parece que faltou entender uma parte.") + (run.attempts >= 2 && !run.transcript ? " Tente ouvir devagar." : " Ouça de novo e responda outra vez.");
        if (run.attempts >= 3 && !run.transcript) showTr();
      }
    }catch(e){ status.textContent = errText(e); run.attempts--; mine.remove(); ta.value = ans; }
    finally{ run.busy = false; send.disabled = false; }
  });
}

/* ---------- 5. De Volta ---------- */
function runReview(host){
  const t = today(), due = reviews.filter(r => r.due <= t), later = reviews.filter(r => r.due > t);
  const items = (due.length ? due : later).slice(0, 5);
  const intro = h("div", { class: "card" },
    h("p", null, due.length ? `Você tem ${due.length} ${due.length === 1 ? "item" : "itens"} para retomar hoje.` : reviews.length ? "Nada para retomar hoje." : "Ainda não há nada para retomar. Os itens aparecem quando você pratica ou depois das aulas."),
    h("p", { class: "small muted" }, "Os itens voltam em intervalos maiores quando você faz sozinho, e mais cedo quando precisa de pista ou modelo."));
  if (items.length) intro.append(h("button", { type: "button", class: "btn primary", style: "align-self:flex-start", onclick: start }, due.length ? "Começar" : "Praticar mesmo assim"));
  if (later.length) intro.append(h("div", null, h("p", { class: "eyebrow" }, "Próximos"), later.slice(0, 5).map(r => h("div", { class: "line" }, h("span", { class: "small" }, r.focus), h("span", { class: "small muted" }, fmtDate(r.due))))));
  const area = h("div", { class: "card", hidden: true });
  host.append(intro, area);
  function start(){
    intro.hidden = true; area.hidden = false; let i = 0;
    const next = () => {
      if (i >= items.length){ area.append(h("div", { class: "stack" }, h("h2", null, "Retomada feita!"), h("p", { class: "small muted" }, "Os próximos itens voltam no dia certo."))); return; }
      const it = items[i++];
      area.append(h("p", { class: "eyebrow" }, `${i} de ${items.length} · ${it.focus}`));
      attemptFlow(area, { activity: "De Volta", task_pt: it.task_pt, goal: it.goal, focus: it.focus, reviewId: it.id, lastLevel: it.hist[it.hist.length - 1], onDone: next });
    };
    next();
  }
}

/* ---------- Aquecimento (recognition only, not counted as mastery) ---------- */
const TENSE_GAME = [
  ["I am cooking dinner right now.", "cont", "Estou fazendo o jantar agora."], ["Yesterday I watched a great movie.", "past", "Ontem eu assisti um filme ótimo."],
  ["She works from home on Fridays.", "present", "Ela trabalha de casa às sextas."], ["Tomorrow I will call the bank.", "future", "Amanhã vou ligar para o banco."],
  ["They are travelling to Chile this week.", "cont", "Eles estão viajando para o Chile esta semana."], ["Last night we ordered a pizza.", "past", "Ontem à noite pedimos uma pizza."],
  ["My manager drinks coffee every morning.", "present", "Meu gerente toma café toda manhã."], ["I think it will rain later.", "future", "Acho que vai chover mais tarde."],
  ["He found his keys in the car.", "past", "Ele achou as chaves no carro."], ["We will finish the project next month.", "future", "Vamos terminar o projeto mês que vem."],
  ["The kids are playing in the garden.", "cont", "As crianças estão brincando no jardim."], ["I usually go to the gym after work.", "present", "Eu geralmente vou à academia depois do trabalho."],
];
const TB = [["past", "Simple Past"], ["present", "Simple Present"], ["cont", "Present Continuous"], ["future", "Future (will)"]];
function runWarmup(host){
  host.append(h("p", { class: "small muted" }, "Aquecimento rápido: reconhecer o tempo verbal. Serve de preparação e não entra no painel como domínio."));
  const area = h("div", { class: "stack" }); host.append(area);
  const items = TENSE_GAME.slice().sort(() => Math.random() - 0.5).slice(0, 6); let i = 0, ok = 0;
  const step = () => {
    if (i >= items.length){
      area.replaceChildren(h("div", { class: "card", style: "align-items:center;text-align:center" }, h("p", { class: "big-text" }, `${ok}/${items.length}`),
        h("p", null, "Aquecido! Agora use isso de verdade numa Missão Real."),
        h("div", { class: "row", style: "justify-content:center" }, visible.some(a => a.id === "mission") ? h("a", { class: "btn primary", href: "#mission" }, "Ir para a Missão Real") : null,
          h("button", { type: "button", class: "btn", onclick: () => { i = 0; ok = 0; step(); } }, "De novo"))));
      return;
    }
    const [sent, tense, pt] = items[i], fb = h("div");
    const answers = h("div", { class: "answers" }, TB.map(([k, l]) => h("button", { type: "button", class: "opt", lang: "en", onclick: (e) => {
      if (fb.childNodes.length) return;
      if (k === tense) ok++;
      [...answers.children].forEach((b, j) => { b.disabled = true; if (TB[j][0] === tense) b.classList.add("right"); else if (b === e.currentTarget) b.classList.add("wrong"); });
      fb.append(h("p", { class: "small muted" }, pt), h("button", { type: "button", class: "btn primary", style: "margin-top:8px", onclick: () => { i++; step(); } }, "Próxima"));
    } }, l)));
    area.replaceChildren(h("div", { class: "card" }, h("p", { class: "small muted" }, `${i + 1} de ${items.length} · Qual é o tempo verbal?`), h("p", { class: "big-text", lang: "en" }, sent), answers, fb));
  };
  step();
}

await renderList();
route();
