// Autoriza la subida directa de audios desde el navegador al almacenamiento privado (sin el límite de 4,5 MB de las funciones).
import { handleUpload } from "@vercel/blob/client";
import { verificarToken, json } from "./_lib/auth.js";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Datos no válidos." }, 400); }
  try {
    const r = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let token = "";
        try { token = JSON.parse(clientPayload || "{}").token || ""; } catch {}
        await verificarToken(token);
        if (!pathname.startsWith("audios/")) throw new Error("Ruta no permitida");
        return {
          allowedContentTypes: ["audio/*", "video/mp4", "video/webm", "video/quicktime", "application/octet-stream"],
          maximumSizeInBytes: 500 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    return json(r);
  } catch (e) {
    return json({ error: e && e.message ? e.message : "No se pudo autorizar la subida." }, 400);
  }
}
