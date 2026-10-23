// Puente con Gemini. La API key vive solo aquí, en las variables de entorno de Vercel.
// Modos: "texto" y "json" (redacción), "imagen" (genera una foto), "transcribir" (audio de una reunión), "modelos" (diagnóstico).
import { get, del } from "@vercel/blob";
import { usuario, json, manejar, HttpError } from "./_lib/auth.js";

const BASE = "https://generativelanguage.googleapis.com";
const TEXTO = () => process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const IMAGEN = () => process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const FORMATOS = new Set(["1:1", "16:9", "4:3", "3:4", "9:16"]);

function key() {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new HttpError(500, "Falta configurar GEMINI_API_KEY en Vercel.", "config");
  return k;
}

async function gemini(model, body) {
  const r = await fetch(`${BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key() },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && j.error.message) || r.statusText;
    console.error("Gemini", model, r.status, msg);
    if (r.status === 429) throw new HttpError(429, "Se alcanzó el límite de uso de Gemini. Intenta en unos minutos.", "rate_limited");
    if (r.status === 404) throw new HttpError(502, "El modelo " + model + " no está disponible para esta API key. Revisa GEMINI_TEXT_MODEL o GEMINI_IMAGE_MODEL.", "modelo");
    if (r.status === 400 && /API key/i.test(msg)) throw new HttpError(500, "La API key de Gemini no es válida.", "config");
    throw new HttpError(502, "Gemini respondió con un error: " + String(msg).slice(0, 240), "upstream_error");
  }
  const c = (j.candidates || [])[0];
  if (!c) {
    const motivo = j.promptFeedback && j.promptFeedback.blockReason;
    throw new HttpError(422, motivo ? "Gemini no quiso procesar este pedido (" + motivo + "). Cambia el texto e intenta de nuevo." : "Gemini no devolvió respuesta.", "refused");
  }
  return c;
}

const textoDe = c => ((c.content && c.content.parts) || []).map(p => p.text || "").join("").trim();

function parteImagen(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new HttpError(400, "La imagen no es válida.", "parametros");
  return { inline_data: { mime_type: m[1], data: m[2] } };
}

async function texto({ prompt, imagen, comoJson }) {
  if (!prompt) throw new HttpError(400, "Falta el pedido.", "parametros");
  const parts = [{ text: String(prompt) }];
  if (imagen) parts.push(parteImagen(imagen));
  const c = await gemini(TEXTO(), {
    contents: [{ role: "user", parts }],
    generationConfig: comoJson ? { responseMimeType: "application/json", maxOutputTokens: 32768 } : { maxOutputTokens: 8192 },
  });
  const t = textoDe(c);
  if (c.finishReason === "SAFETY") throw new HttpError(422, "Gemini no quiso responder a este pedido. Cambia el texto e intenta de nuevo.", "refused");
  if (!t) throw new HttpError(502, "Gemini no devolvió texto. Intenta otra vez.", "empty_completion");
  if (!comoJson) return { text: t };
  try {
    return { json: JSON.parse(t.replace(/^```(?:json)?\s*|\s*```$/g, "")) };
  } catch {
    throw new HttpError(502, c.finishReason === "MAX_TOKENS" ? "La respuesta fue demasiado larga y llegó incompleta." : "La respuesta de Gemini llegó incompleta.", "invalid_json");
  }
}

async function imagen({ prompt, ar }) {
  if (!prompt) throw new HttpError(400, "Falta el prompt de la imagen.", "parametros");
  const c = await gemini(IMAGEN(), {
    contents: [{ role: "user", parts: [{ text: String(prompt) }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: FORMATOS.has(ar) ? ar : "1:1" } },
  });
  const p = ((c.content && c.content.parts) || []).find(x => x.inlineData || x.inline_data);
  if (!p) {
    const t = textoDe(c);
    throw new HttpError(422, "Gemini no generó la imagen" + (t ? ": " + t.slice(0, 200) : ". Ajusta el prompt e intenta de nuevo."), "refused");
  }
  const d = p.inlineData || p.inline_data;
  return { data: `data:${d.mimeType || d.mime_type || "image/png"};base64,${d.data}` };
}

const PEDIDO_TRANSCRIPCION = "Transcribe este audio de una reunión comercial en español. Señala quién habla cuando se distinga (por ejemplo, Grupo Macro y Cliente). Al final, agrega un resumen en viñetas con: cliente, necesidad o problema, público y número de participantes, fecha, lugar y duración, actividades o módulos mencionados, presupuesto o valores conversados y próximos pasos. No inventes datos que no se dicen en el audio.";

async function transcribir({ pathname }) {
  if (!/^audios\//.test(pathname || "")) throw new HttpError(400, "Audio no válido.", "parametros");
  const r = await get(pathname, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) throw new HttpError(404, "No se encontró el audio subido.", "no_existe");
  const mime = r.blob.contentType && r.blob.contentType !== "application/octet-stream" ? r.blob.contentType : "audio/mpeg";
  const bytes = new Uint8Array(await new Response(r.stream).arrayBuffer());
  let archivo = null;
  try {
    // 1. Subir el audio a Gemini (carga reanudable)
    const inicio = await fetch(`${BASE}/upload/v1beta/files`, {
      method: "POST",
      headers: {
        "x-goog-api-key": key(), "Content-Type": "application/json",
        "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.length), "X-Goog-Upload-Header-Content-Type": mime,
      },
      body: JSON.stringify({ file: { display_name: "reunion" } }),
    });
    const urlCarga = inicio.headers.get("x-goog-upload-url");
    if (!inicio.ok || !urlCarga) throw new HttpError(502, "Gemini no aceptó el audio.", "upstream_error");
    const carga = await fetch(urlCarga, {
      method: "POST",
      headers: { "Content-Length": String(bytes.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
      body: bytes,
    });
    archivo = (await carga.json()).file;
    if (!archivo) throw new HttpError(502, "Gemini no pudo recibir el audio.", "upstream_error");
    // 2. Esperar a que Gemini lo procese
    for (let i = 0; archivo.state === "PROCESSING" && i < 60; i++) {
      await new Promise(res => setTimeout(res, 2000));
      archivo = await (await fetch(`${BASE}/v1beta/${archivo.name}`, { headers: { "x-goog-api-key": key() } })).json();
    }
    if (archivo.state !== "ACTIVE") throw new HttpError(502, "Gemini no pudo procesar el audio. Prueba con MP3, M4A o WAV.", "upstream_error");
    // 3. Transcribir
    const c = await gemini(TEXTO(), {
      contents: [{ role: "user", parts: [{ file_data: { mime_type: archivo.mimeType || mime, file_uri: archivo.uri } }, { text: PEDIDO_TRANSCRIPCION }] }],
      generationConfig: { maxOutputTokens: 65536 },
    });
    const t = textoDe(c);
    if (!t) throw new HttpError(502, "Gemini no devolvió la transcripción.", "empty_completion");
    return { text: t };
  } finally {
    // El audio no se guarda: se borra de Vercel y de Gemini
    await del(pathname).catch(() => {});
    if (archivo && archivo.name) await fetch(`${BASE}/v1beta/${archivo.name}`, { method: "DELETE", headers: { "x-goog-api-key": key() } }).catch(() => {});
  }
}

async function modelos() {
  const r = await fetch(`${BASE}/v1beta/models?pageSize=1000`, { headers: { "x-goog-api-key": key() } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, "No se pudo consultar Gemini: " + ((j.error && j.error.message) || r.status), "upstream_error");
  return { texto: TEXTO(), imagen: IMAGEN(), disponibles: (j.models || []).map(m => m.name.replace(/^models\//, "")) };
}

export const POST = manejar(async request => {
  await usuario(request);
  let body;
  try { body = await request.json(); } catch { throw new HttpError(400, "Datos no válidos.", "parametros"); }
  const modo = body && body.modo;
  if (modo === "texto") return json(await texto({ prompt: body.prompt, imagen: body.imagen }));
  if (modo === "json") return json(await texto({ prompt: body.prompt, imagen: body.imagen, comoJson: true }));
  if (modo === "imagen") return json(await imagen({ prompt: body.prompt, ar: body.ar }));
  if (modo === "transcribir") return json(await transcribir({ pathname: body.pathname }));
  if (modo === "modelos") return json(await modelos());
  throw new HttpError(400, "Modo no válido.", "parametros");
});
