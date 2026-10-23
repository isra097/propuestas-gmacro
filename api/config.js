// Datos públicos que la página necesita para mostrar el botón de Google.
import { json } from "./_lib/auth.js";

export function GET() {
  return json({
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    dominio: process.env.ALLOWED_DOMAIN || "gmacro.com",
  });
}
