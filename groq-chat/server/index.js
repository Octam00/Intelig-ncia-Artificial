/**
 * Backend (Node.js + Express) para conversar com a API da Groq.
 *
 * O servidor expõe:
 *  - GET  /            -> entrega arquivos estáticos (pasta /public)
 *  - POST /api/chat    -> recebe { messages: [{role, content}, ...] } do frontend
 *                        faz requisição para a Groq Chat Completion endpoint
 *                        e retorna o texto da IA.
 *
 * Requisitos:
 *  - configurar .env com GROQ_API_KEY e opcionalmente GROQ_MODEL
 *  - instalar dependências (npm install)
 *
 * Segurança/Boas práticas implementadas:
 *  - helmet para headers de segurança
 *  - cors permitindo apenas origens seguras (aqui liberamos '*' para demo; em produção especifique)
 *  - tratamento de erros com respostas padronizadas
 *
 * Observação:
 *  - Endpoint da Groq usado: https://api.groq.com/openai/v1/chat/completions
 *  - Consulte a documentação oficial da Groq para parâmetros avançados (streaming, tools, etc).
 *    Fonte: Groq API Reference (Chat completions).
 */

import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama3-7b"; // ajuste se desejar

if (!GROQ_API_KEY) {
  console.error("ERRO: Defina GROQ_API_KEY no seu .env");
  process.exit(1);
}

// Middlewares
app.use(helmet());
app.use(cors()); // Em produção, substitua por: cors({ origin: 'https://seusite.com' })
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

// Servir frontend estático (pasta public)
app.use(express.static(path.join(__dirname, "..", "public")));

// Rota de health check
app.get("/healthz", (req, res) => {
  res.json({ status: "ok", time: Date.now() });
});

/**
 * POST /api/chat
 * Recebe:
 *  { messages: [{ role: "user"|"system"|"assistant", content: "..." }, ...] }
 *
 * Retorna:
 *  { success: true, reply: "texto gerado pela IA" }
 *
 * Observação: a Groq aceita um array messages compatível com OpenAI-style.
 */
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, max_output_tokens, temperature } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, error: "messages (array) é obrigatório" });
    }

    // Monta o corpo da requisição para a Groq
    const body = {
      model: GROQ_MODEL,
      messages,
      // parametros opcionais:
      max_output_tokens: max_output_tokens ?? 512,
      temperature: temperature ?? 0.2
    };

    // Faz a chamada para a API Groq (endpoint compatível com OpenAI-style)
    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify(body),
      // timeout handling pode ser adicionado com AbortController, se desejar
    });

    if (!groqResp.ok) {
      const text = await groqResp.text();
      console.error("Groq API error:", groqResp.status, text);
      return res.status(502).json({ success: false, error: "Erro na Groq API", detail: text });
    }

    const data = await groqResp.json();

    // A resposta pode vir com formato compatível OpenAI — extraímos o texto principal
    // Estrutura esperada: data.choices[0].message.content  (OpenAI-style)
    // Mas Groq docs mostram um objeto 'choices' ou 'output' dependendo do endpoint. Adaptamos:
    let replyText = "";

    // Tentativa: OpenAI-style
    if (data?.choices && Array.isArray(data.choices) && data.choices.length > 0) {
      const first = data.choices[0];
      if (first.message?.content) replyText = first.message.content;
      else if (typeof first.text === "string") replyText = first.text;
    }

    // Fallback: Groq 'response' style
    if (!replyText && data?.output) {
      if (Array.isArray(data.output) && data.output.length > 0) {
        // junta partes textuais
        replyText = data.output.map(o => (typeof o === "string" ? o : o.text ?? "")).join("\n");
      } else if (typeof data.output === "string") {
        replyText = data.output;
      }
    }

    // Se ainda vazio, stringify para debug
    if (!replyText) replyText = JSON.stringify(data, null, 2);

    return res.json({ success: true, reply: replyText });
  } catch (err) {
    console.error("Erro no servidor:", err);
    return res.status(500).json({ success: false, error: "Erro interno do servidor" });
  }
});

// Em produção, deixar o servidor servir index.html para rotas desconhecidas (single page)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}  (NODE_ENV=${process.env.NODE_ENV || "production"})`);
});
