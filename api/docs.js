// Almacén de documentos del equipo sobre Vercel Blob privado.
//   propuestas/<id>.json  → una propuesta completa
//   imagenes/<id>.json    → una imagen comprimida {data, w, h}
//   indice/propuestas.json → lista liviana para el selector {id, cliente, titulo, updatedAt, editadoPor}
import { put, get, del, BlobPreconditionFailedError } from "@vercel/blob";
import { usuario, json, manejar, HttpError } from "./_lib/auth.js";

const COLECCIONES = new Set(["propuestas", "imagenes"]);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const INDICE = "indice/propuestas.json";
const MAX_BYTES = 4 * 1024 * 1024;

function ruta(col, id) {
  if (!COLECCIONES.has(col)) throw new HttpError(400, "Colección no válida.", "parametros");
  if (!ID.test(id || "")) throw new HttpError(400, "Identificador no válido.", "parametros");
  return `${col}/${id}.json`;
}

async function leer(pathname) {
  const r = await get(pathname, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return { data: JSON.parse(await new Response(r.stream).text()), etag: r.blob.etag };
}

function escribir(pathname, data, extra = {}) {
  return put(pathname, JSON.stringify(data), {
    access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60, ...extra,
  });
}

// Cambia el índice con escritura condicional: si dos personas guardan a la vez, se reintenta sobre la versión nueva
async function actualizarIndice(cambio) {
  for (let intento = 0; intento < 6; intento++) {
    const actual = await leer(INDICE);
    const nuevo = cambio(actual ? actual.data : []);
    try {
      await escribir(INDICE, nuevo, actual ? { ifMatch: actual.etag } : {});
      return;
    } catch (e) {
      if (!(e instanceof BlobPreconditionFailedError) || intento === 5) throw e;
      await new Promise(r => setTimeout(r, 80 + Math.random() * 250));
    }
  }
}

export const GET = manejar(async request => {
  await usuario(request);
  const q = new URL(request.url).searchParams;
  const col = q.get("col"), id = q.get("id");
  if (col === "propuestas" && !id) {
    const indice = await leer(INDICE);
    const lista = (indice ? indice.data : []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return json({ lista });
  }
  const doc = await leer(ruta(col, id));
  if (!doc) return json({ error: "No existe.", code: "no_existe" }, 404);
  return json({ data: doc.data });
});

export const PUT = manejar(async request => {
  const u = await usuario(request);
  const texto = await request.text();
  if (texto.length > MAX_BYTES) throw new HttpError(413, "El documento es demasiado grande.", "muy_grande");
  let body;
  try { body = JSON.parse(texto); } catch { throw new HttpError(400, "Datos no válidos.", "parametros"); }
  const { col, id, data } = body || {};
  if (!data || typeof data !== "object") throw new HttpError(400, "Faltan los datos.", "parametros");
  const pathname = ruta(col, id);
  if (col === "propuestas") {
    data.id = id;
    data.updatedAt = Date.now();
    data.editadoPor = u.email;
    if (!data.creadoPor) data.creadoPor = u.email;
  }
  await escribir(pathname, data);
  if (col === "propuestas") {
    const entrada = { id, cliente: data.cliente || "", titulo: data.titulo || "", updatedAt: data.updatedAt, editadoPor: u.email, creadoPor: data.creadoPor };
    await actualizarIndice(lista => [entrada, ...lista.filter(x => x.id !== id)]);
  }
  return json({ ok: true, updatedAt: data.updatedAt || Date.now() });
});

export const DELETE = manejar(async request => {
  await usuario(request);
  const q = new URL(request.url).searchParams;
  const col = q.get("col"), id = q.get("id");
  const pathname = ruta(col, id);
  await del(pathname);
  if (col === "propuestas") await actualizarIndice(lista => lista.filter(x => x.id !== id));
  return json({ ok: true });
});
