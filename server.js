/**
 * ZOCO FITTING — Backend Proxy Server
 * Actúa como intermediario entre el frontend y la API de Fal.ai
 * para mantener la API key segura en el servidor.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'env') });

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// Multer: imágenes en memoria (hasta 20MB por imagen)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// ─── Helper: convertir buffer a data URL ──────────────────────────────────────
function bufferToDataUrl(buffer, mimetype) {
  return `data:${mimetype};base64,${buffer.toString('base64')}`;
}

// ─── Helper: subir imagen a fal.storage y obtener URL pública ────────────────
async function uploadToFalStorage(buffer, mimetype, filename) {
  const FAL_KEY = process.env.FAL_KEY;
  
  // Fal Storage upload endpoint
  const uploadRes = await fetch('https://rest.alpha.fal.ai/storage/upload/initiate', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${FAL_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content_type: mimetype,
      file_name: filename
    })
  });

  if (!uploadRes.ok) {
    // Fallback: usar data URL directamente
    console.warn('Fal Storage upload initiation failed, using data URL');
    return bufferToDataUrl(buffer, mimetype);
  }

  const { upload_url, file_url } = await uploadRes.json();

  // Subir el archivo binario
  const putRes = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': mimetype },
    body: buffer
  });

  if (!putRes.ok) {
    console.warn('Fal Storage PUT failed, using data URL');
    return bufferToDataUrl(buffer, mimetype);
  }

  return file_url;
}

// ─── Helper: polling usando las URLs que Fal devuelve ────────────────────────
async function pollWithUrls(statusUrl, responseUrl, maxAttempts = 80) {
  const FAL_KEY = process.env.FAL_KEY;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 3000)); // 3s entre polls

    const statusRes = await fetch(statusUrl, {
      method: 'GET',
      headers: { 'Authorization': `Key ${FAL_KEY}` }
    });

    if (!statusRes.ok) {
      console.log(`Poll ${i + 1}: HTTP ${statusRes.status} — reintentando...`);
      continue;
    }

    const status = await statusRes.json();
    console.log(`Poll ${i + 1}: status = ${status.status}`);

    if (status.status === 'COMPLETED') {
      // Obtener el resultado final
      const resultRes = await fetch(responseUrl, {
        method: 'GET',
        headers: { 'Authorization': `Key ${FAL_KEY}` }
      });
      const result = await resultRes.json();
      return result;
    }

    if (status.status === 'FAILED') {
      throw new Error(`Fal job falló: ${JSON.stringify(status.error || status)}`);
    }
    // IN_QUEUE o IN_PROGRESS → seguir esperando
  }

  throw new Error('Timeout esperando resultado de Fal.ai (4 min). Inténtalo de nuevo.');
}

// ─── Endpoint principal: POST /api/tryon ─────────────────────────────────────
app.post('/api/tryon', upload.fields([
  { name: 'model', maxCount: 1 },
  { name: 'top', maxCount: 1 },
  { name: 'bottom', maxCount: 1 }
]), async (req, res) => {

  const FAL_KEY = process.env.FAL_KEY;
  
  if (!FAL_KEY) {
    return res.status(500).json({ error: 'FAL_KEY no configurada en el servidor' });
  }

  // Verificar que se subieron las 3 imágenes
  const files = req.files;
  if (!files?.model?.[0] || !files?.top?.[0] || !files?.bottom?.[0]) {
    return res.status(400).json({ error: 'Se requieren las 3 imágenes: modelo, prenda superior y prenda inferior' });
  }

  try {
    const modelFile = files.model[0];
    const topFile   = files.top[0];
    const bottomFile = files.bottom[0];

    console.log('📸 Subiendo imágenes a Fal Storage...');

    // Subir las 3 imágenes a Fal Storage para obtener URLs públicas
    const [modelUrl, topUrl, bottomUrl] = await Promise.all([
      uploadToFalStorage(modelFile.buffer, modelFile.mimetype, `model_${Date.now()}.jpg`),
      uploadToFalStorage(topFile.buffer,   topFile.mimetype,   `top_${Date.now()}.jpg`),
      uploadToFalStorage(bottomFile.buffer, bottomFile.mimetype, `bottom_${Date.now()}.jpg`)
    ]);

    console.log('✅ Imágenes subidas.');
    console.log('   model  :', modelUrl.substring(0, 80));
    console.log('   top    :', topUrl.substring(0, 80));
    console.log('   bottom :', bottomUrl.substring(0, 80));

    // Payload para el endpoint fal-ai/flux-2-klein/9b/edit/lora
    const falPayload = {
      image_urls: [modelUrl, topUrl, bottomUrl],
      prompt: "TRYON. Replace the outfit with the top tee and the bottom pant as shown in the reference images. The final image is a full body shot",
      num_inference_steps: 8,
      loras: [{
        path: "https://huggingface.co/fal/flux-klein-9b-virtual-tryon-lora/resolve/main/flux-klein-tryon.safetensors",
        scale: 1.0
      }]
    };

    console.log('🚀 Enviando a queue de Fal.ai...');
    const queueRes = await fetch('https://queue.fal.run/fal-ai/flux-2-klein/9b/edit/lora', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${FAL_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(falPayload)
    });

    if (!queueRes.ok) {
      const errText = await queueRes.text();
      console.error('Fal queue error:', errText);
      return res.status(502).json({ error: `Error de Fal.ai al encolar: ${errText}` });
    }

    const queueData = await queueRes.json();
    console.log('🔄 Queue response:', JSON.stringify(queueData));

    // Fal devuelve status_url y response_url exactas
    const statusUrl   = queueData.status_url;
    const responseUrl = queueData.response_url;

    if (!statusUrl || !responseUrl) {
      throw new Error('Fal no devolvió status_url/response_url. Respuesta: ' + JSON.stringify(queueData));
    }

    console.log('📡 Polling:', statusUrl);

    // Polling hasta obtener resultado
    const result = await pollWithUrls(statusUrl, responseUrl);
    console.log('✨ Resultado:', JSON.stringify(result).substring(0, 400));

    // Extraer URL de imagen del resultado
    let imageUrl = result?.images?.[0]?.url
      || result?.image?.url
      || result?.output?.images?.[0]?.url
      || null;

    // Fallback: buscar cualquier URL de imagen en el JSON
    if (!imageUrl) {
      const match = JSON.stringify(result).match(/"url"\s*:\s*"(https?:[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
      if (match) imageUrl = match[1];
    }

    if (!imageUrl) {
      console.error('Respuesta sin imagen:', JSON.stringify(result));
      return res.status(502).json({ error: 'No se encontró imagen en la respuesta de Fal.ai', raw: result });
    }

    return res.json({ success: true, imageUrl });

  } catch (err) {
    console.error('Error en /api/tryon:', err);
    return res.status(500).json({ error: err.message || 'Error interno del servidor' });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    hasApiKey: !!process.env.FAL_KEY,
    timestamp: new Date().toISOString()
  });
});

// ─── Proxy para descargar la imagen sin problemas de CORS ─────────────────────
app.get('/api/download', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('Falta URL');

    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) throw new Error('Error al obtener imagen');

    const buffer = await imageRes.buffer();
    
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', `attachment; filename="zoco-look-${Date.now()}.jpg"`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    res.send(buffer);
  } catch (err) {
    console.error('Error en /api/download:', err);
    res.status(500).send('Error descargando imagen');
  }
});

// ─── Iniciar servidor (o exportar para Vercel) ─────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`\n🚀 ZOCO FITTING Server corriendo en http://localhost:${PORT}`);
    console.log(`🔑 FAL_KEY: ${process.env.FAL_KEY ? '✅ Cargada' : '❌ NO encontrada'}`);
    console.log(`📂 Sirviendo archivos desde: ${__dirname}\n`);
  });
}

// Exportar la aplicación para que Vercel la trate como Serverless Function
module.exports = app;
