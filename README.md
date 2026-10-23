# Generador de Propuestas · Grupo Macro

Webapp interna para crear propuestas comerciales de Grupo Macro y descargarlas en PowerPoint. El equipo entra con su cuenta Google @gmacro.com.

- **Crear con IA desde la reunión**: sube el audio (Gemini lo transcribe) o pega las notas; Gemini analiza qué falta y arma la propuesta siguiendo la skill `propuesta-gmacro`.
- **Imágenes con Gemini**: cada espacio de imagen tiene su prompt y el botón "Generar con Gemini". También se puede arrastrar o pegar una imagen.
- **Edición en tiempo real** con vista previa de las láminas y descarga en `.pptx`.

## Cómo está armado

| Parte | Dónde | Qué hace |
|---|---|---|
| `public/index.html` | Navegador | Editor, vista previa y exportación a PowerPoint (PptxGenJS) |
| `public/assets.js` | Navegador | Recursos gráficos de Grupo Macro (íconos, pinceladas, mapa, logos) |
| `public/skill.js` | Navegador | Referencias de la skill `propuesta-gmacro` que se envían a Gemini |
| `api/docs.js` | Vercel | Guarda propuestas e imágenes en Vercel Blob **privado** |
| `api/ia.js` | Vercel | Llama a Gemini: textos, JSON, imágenes y transcripción de audio |
| `api/subir-audio.js` | Vercel | Autoriza la subida directa de audios grandes al Blob privado |
| `api/_lib/auth.js` | Vercel | Verifica el inicio de sesión de Google y el dominio @gmacro.com |

La API key de Gemini solo vive en las variables de entorno de Vercel. El navegador nunca la ve.

## Configuración (una sola vez)

1. **Gemini**: en [Google AI Studio](https://aistudio.google.com/apikey) crea una API key en un proyecto con facturación (la generación de imágenes cobra por imagen).
2. **Inicio de sesión con Google**: en [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
   - Pantalla de consentimiento OAuth → tipo **Interno** (solo cuentas de Grupo Macro).
   - Credenciales → Crear credenciales → **ID de cliente de OAuth** → tipo **Aplicación web**.
   - Orígenes autorizados de JavaScript: la URL de Vercel (por ejemplo `https://propuestas-gmacro.vercel.app`).
3. **Vercel** (proyecto importado desde este repositorio):
   - Storage → crear un **Blob store** con acceso **privado** y conectarlo al proyecto (crea `BLOB_READ_WRITE_TOKEN`).
   - Settings → Environment Variables: `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID`, `ALLOWED_DOMAIN=gmacro.com` (ver `.env.example`).
   - Volver a desplegar después de agregar las variables.

## Modelos de Gemini

Por defecto: `gemini-2.5-flash` (texto y audio) y `gemini-2.5-flash-image` (imágenes). Se cambian con `GEMINI_TEXT_MODEL` y `GEMINI_IMAGE_MODEL`. Para ver qué modelos tiene disponibles la API key, una persona con sesión iniciada puede llamar a `POST /api/ia` con `{"modo":"modelos"}`.

## Límites conocidos

- Audios de hasta 500 MB; el audio se borra después de transcribirlo.
- Las funciones de Vercel tienen un máximo de 300 segundos: una reunión muy larga puede no alcanzar a transcribirse.
- El plan Hobby de Vercel es solo para uso no comercial: antes de que el equipo lo use en serio hay que pasar a Pro.
