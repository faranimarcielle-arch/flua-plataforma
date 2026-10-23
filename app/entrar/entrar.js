import { supabase, APP, $ } from "../lib.js";
const { data: { session } } = await supabase.auth.getSession();
if (session) location.replace(APP + "conversa/");
$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#email").value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ $("#status").textContent = "Digite um e-mail válido."; return; }
  $("#send").disabled = true; $("#status").textContent = "Enviando…";
  // shouldCreateUser:false: only students the teacher registered can log in.
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: APP + "conversa/" } });
  $("#send").disabled = false;
  // Same message whether or not the e-mail exists, so the page does not reveal who is a student.
  $("#status").textContent = error && /rate|limit/i.test(error.message)
    ? "Muitos pedidos seguidos. Espere alguns minutos e tente de novo."
    : "Se este e-mail estiver cadastrado, o link de acesso chega em instantes. Confira também o spam.";
});
