import { supabase, requireLogin, $ } from "../lib.js";
const login = await requireLogin();
if (!login) throw new Error("redirecting");
$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const a = $("#password").value, b = $("#password2").value;
  if (a.length < 8){ $("#status").textContent = "A senha precisa ter pelo menos 8 caracteres."; return; }
  if (a !== b){ $("#status").textContent = "As duas senhas não são iguais."; return; }
  $("#send").disabled = true; $("#status").textContent = "Salvando…";
  const { error } = await supabase.auth.updateUser({ password: a });
  $("#send").disabled = false;
  if (error){ $("#status").textContent = /same|different/i.test(error.message) ? "A nova senha precisa ser diferente da atual." : "Não deu para trocar a senha agora. Tente de novo."; return; }
  $("#form").reset(); $("#status").textContent = "Senha trocada. Use a nova senha da próxima vez que entrar.";
});
