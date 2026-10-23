// Autenticación con Google: solo entran cuentas verificadas del dominio autorizado.
import { OAuth2Client } from "google-auth-library";

const google = new OAuth2Client();

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function verificarToken(token) {
  if (!token) throw new HttpError(401, "Inicia sesión para continuar.", "sin_sesion");
  const audience = process.env.GOOGLE_CLIENT_ID;
  if (!audience) throw new HttpError(500, "Falta configurar GOOGLE_CLIENT_ID en Vercel.", "config");
  let p;
  try {
    p = (await google.verifyIdToken({ idToken: token, audience })).getPayload();
  } catch {
    throw new HttpError(401, "Tu sesión expiró. Vuelve a iniciar sesión.", "sesion_expirada");
  }
  const dominio = (process.env.ALLOWED_DOMAIN || "gmacro.com").toLowerCase();
  const email = String(p.email || "").toLowerCase();
  if (!p.email_verified || !email.endsWith("@" + dominio)) {
    throw new HttpError(403, "Solo pueden entrar cuentas @" + dominio + ".", "dominio");
  }
  return { email, nombre: p.name || email };
}

export function usuario(request) {
  const h = request.headers.get("authorization") || "";
  return verificarToken(h.startsWith("Bearer ") ? h.slice(7) : "");
}

// Envuelve un manejador: convierte los errores en respuestas JSON con un mensaje para el usuario
export function manejar(fn) {
  return async request => {
    try {
      return await fn(request);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
      console.error(e);
      return json({ error: "Error interno. Vuelve a intentar.", code: "interno" }, 500);
    }
  };
}
