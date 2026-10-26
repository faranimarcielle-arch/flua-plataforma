import { supabase, requireLogin, renderNav, $, rpcError } from "../lib.js";
const login = await requireLogin();
if (!login) throw new Error("redirecting");
renderNav("feedback", login.profile);

$("#fb-send").addEventListener("click", async () => {
  const t = $("#fb-text").value.trim();
  if (t.length < 3){ $("#fb-status").textContent = "Escreva sua mensagem antes de enviar."; return; }
  $("#fb-send").disabled = true;
  const { error } = await supabase.rpc("send_feedback", { p_body: t });
  $("#fb-send").disabled = false;
  if (error){ $("#fb-status").textContent = rpcError(error); return; }
  $("#fb-text").value = "";
  $("#fb-status").textContent = "Enviado. Obrigado! A professora vai ler sem saber quem escreveu.";
});
