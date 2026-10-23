import { supabase, APP, $ } from "../lib.js";
const { data: { session } } = await supabase.auth.getSession();
if (session) location.replace(APP + "conversa/");
$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#email").value.trim().toLowerCase(), password = $("#password").value;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ $("#status").textContent = "Digite um e-mail válido."; return; }
  if (!password){ $("#status").textContent = "Digite a sua senha."; return; }
  $("#send").disabled = true; $("#status").textContent = "Entrando…";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  $("#send").disabled = false;
  if (!error){ location.replace(APP + "conversa/"); return; }
  // One message for wrong e-mail or wrong password, so the page does not reveal who is a student.
  $("#status").textContent = /rate|limit|too many/i.test(error.message)
    ? "Muitas tentativas seguidas. Espere alguns minutos e tente de novo."
    : "E-mail ou senha incorretos. Se esqueceu a senha, fale com a FLUA.";
});
