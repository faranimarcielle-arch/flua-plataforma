// Shared helpers for the FLUA app. The publishable key is meant to be public: access is enforced by row level security.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

export const SUPABASE_URL = "https://spwcyhjqdxasgloujbyz.supabase.co";
export const SUPABASE_KEY = "sb_publishable_GVxTpJOWXYXEyeOsMOSMLg_7ZJX8FmA";
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
export const APP = new URL("./", import.meta.url).href;   // .../app/

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
  const { data, error } = await supabase.functions.invoke("chat", { body });
  if (error){
    let msg = "Não deu certo agora. Tente de novo em instantes.";
    try{ const j = await error.context.json(); if (j && j.error) msg = j.error; }catch(e){}
    if (error.name === "FunctionsFetchError") msg = "Sem conexão com o servidor. Confira a internet.";
    throw { msg };
  }
  return data;
}

export async function logout(){ await supabase.auth.signOut(); location.replace(APP + "entrar/"); }
