# FLUA · Plataforma de inglês

Plataforma da FLUA para alunos adultos: prática comunicativa, conversa por voz com IA, agendamento de aulas e painel do professor.

## O que já existe

- `conversa/`: página de teste da **conversa por voz** com o Max. Funciona no modo "aperta para falar, aperta de novo para enviar": o aluno pode pausar e pensar sem ser interrompido.
  - O aluno toca no microfone, fala em inglês e vê o texto do que falou.
  - O Max responde em texto e em voz e volta a ouvir sozinho.
  - Durante a conversa não há correção. No fim, até 3 pontos, cada um com pista, nova tentativa falada e modelo.

## Como testar

1. Abra a página no **Google Chrome** ou no **Microsoft Edge**. O reconhecimento de voz depende do navegador.
2. Em **Configurações**, cole a chave da API da Anthropic (console.anthropic.com → API Keys).
3. Para usar fone de ouvido, escolha o fone como microfone e saída de som do computador.
4. Quando o navegador perguntar, permita o uso do microfone.

## Segurança: esta é uma versão de teste

Na página de teste, a chave da API fica **só no navegador de quem a colou**. Por padrão ela é guardada apenas na aba aberta; marcando "Lembrar a chave", fica neste computador. A chave **nunca** vai para o repositório.

**Não use esta versão com alunos.** Na versão para alunos, a página vai falar com um servidor (Cloudflare Worker ou Supabase Edge Function) que guarda a chave como segredo, exige login e limita o uso de cada aluno.

## Próximos passos

- Login de aluno e de professor (Supabase).
- Servidor para a IA, com a chave escondida e um limite de uso.
- Atividades, agenda, frequência e painel do professor do protótipo.
- Integração com a Google Agenda e o Meet (Google Workspace, app interno).
