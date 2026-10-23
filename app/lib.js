// Shared helpers for the FLUA app. The publishable key is meant to be public: access is enforced by row level security.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

export const SUPABASE_URL = "https://spwcyhjqdxasgloujbyz.supabase.co";
export const SUPABASE_KEY = "sb_publishable_GVxTpJOWXYXEyeOsMOSMLg_7ZJX8FmA";
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
export const APP = new URL("./", import.meta.url).href;   // .../app/
// Name of the server function in Supabase (the dashboard editor named it automatically).
export const CHAT_FUNCTION = "bright-function";

// Installable app (PWA): register the service worker for every page under app/.
if ("serviceWorker" in navigator) navigator.serviceWorker.register(APP + "sw.js").catch(() => {});

export const $ = (s) => document.querySelector(s);
export function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)){
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

// Sends the visitor to the login page when there is no session. Returns { session, profile }.
export async function requireLogin(){
  const { data: { session } } = await supabase.auth.getSession();
  if (!session){ location.replace(APP + "entrar/"); return null; }
  const { data: profile } = await supabase.from("profiles").select("id, role, name, email").eq("id", session.user.id).single();
  return { session, profile };
}

// Calls the server function that talks to the AI. Throws { msg } with a message for the student.
export async function callChat(body){
  const { data, error } = await supabase.functions.invoke(CHAT_FUNCTION, { body });
  if (error){
    let msg = "Não deu certo agora. Tente de novo em instantes.";
    try{ const j = await error.context.json(); if (j && j.error) msg = j.error; }catch(e){}
    if (error.name === "FunctionsFetchError") msg = "Sem conexão com o servidor. Confira a internet.";
    throw { msg };
  }
  return data;
}

export async function logout(){ await supabase.auth.signOut(); location.replace(APP + "entrar/"); }

// Times are always shown in the school's time zone.
export const TZ = "America/Sao_Paulo";
export const fmtDay = (d) => new Date(d).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit" });
export const fmtTime = (d) => new Date(d).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
export const fmtSlot = (d, minutes = 30) => {
  const s = new Date(d), e = new Date(s.getTime() + minutes * 60000);
  const day = s.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
  return `${day} · ${fmtTime(s)}–${fmtTime(e)}`;
};
export const dayKey = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ });

// Readable message from a database function error (our functions raise messages in Portuguese).
export const rpcError = (error) => (error && error.message && !/JWT|permission|violates/i.test(error.message)) ? error.message : "Não deu certo agora. Tente de novo.";

// Shared header: logo, menu and account links. `active` is the current page.
export function renderNav(active, profile){
  const header = document.querySelector("#nav");
  if (!header) return;
  const ROOT = new URL("../", APP).href;
  const items = [["inicio", "Início"], ["conversa", "Conversar"], ["agenda", "Agenda"]];
  if (profile && profile.role === "teacher") items.push(["professor", "Professor"]);
  header.className = "top";
  header.replaceChildren(
    h("a", { href: APP + "inicio/", "aria-label": "FLUA, início" },
      h("picture", { class: "brand" }, h("source", { srcset: ROOT + "img/flua-logo-branco.webp", media: "(prefers-color-scheme: dark)" }),
        h("img", { src: ROOT + "img/flua-logo.webp", alt: "FLUA", style: "height:36px;width:auto;display:block" }))),
    h("nav", { class: "menu", "aria-label": "Menu" },
      items.map(([k, label]) => h("a", { href: APP + k + "/", class: "menu-item", "aria-current": k === active ? "page" : null }, label)),
      h("a", { href: APP + "senha/", class: "menu-item small" }, "Trocar senha"),
      h("button", { type: "button", class: "menu-item small", onclick: logout }, "Sair")));
}
