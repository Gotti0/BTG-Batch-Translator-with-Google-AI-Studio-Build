import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getAiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function serializeError(error: any) {
  const status =
    typeof error?.status === 'number'
      ? error.status
      : typeof error?.code === 'number'
        ? error.code
        : 500;
  const details =
    error?.details ||
    error?.errorDetails ||
    error?.error?.details ||
    error?.response?.details;

  return {
    status: status >= 100 && status < 600 ? status : 500,
    body: {
      error: {
        message: error?.message || String(error),
        status,
        ...(details ? { details } : {}),
      },
    },
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  app.post('/api/gemini/generate-content', async (req, res) => {
    try {
      const { model, contents, config } = req.body;
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model,
        contents,
        config,
      });

      res.json({
        text: response.text,
        candidates: response.candidates,
        promptFeedback: response.promptFeedback,
      });
    } catch (error: any) {
      console.error('Error in /api/gemini/generate-content:', error);
      const { status, body } = serializeError(error);
      res.status(status).json(body);
    }
  });

  app.post('/api/gemini/generate-chat', async (req, res) => {
    try {
      const { model, history, message, config } = req.body;
      const ai = getAiClient();
      const chat = ai.chats.create({
        model,
        config,
        history,
      });

      const response = await chat.sendMessage({ message });
      res.json({
        text: response.text,
        candidates: response.candidates,
        promptFeedback: response.promptFeedback,
      });
    } catch (error: any) {
      console.error('Error in /api/gemini/generate-chat:', error);
      const { status, body } = serializeError(error);
      res.status(status).json(body);
    }
  });

  app.post('/api/gemini/generate-content-stream', async (req, res) => {
    try {
      const { model, contents, config } = req.body;
      const ai = getAiClient();
      const stream = await ai.models.generateContentStream({
        model,
        contents,
        config,
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      for await (const chunk of stream) {
        const text = chunk.text || '';
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error('Error in /api/gemini/generate-content-stream:', error);
      const { status, body } = serializeError(error);
      if (!res.headersSent) {
        res.status(status).json(body);
      } else {
        res.write(`data: ${JSON.stringify(body)}\n\n`);
        res.end();
      }
    }
  });

  app.get('/api/gemini/models', async (_req, res) => {
    try {
      const ai = getAiClient();
      const response = await ai.models.list();
      const models: string[] = [];
      let modelList: any[] = [];

      if (response && typeof response === 'object') {
        if (Array.isArray(response)) {
          modelList = response;
        } else if ('models' in response && Array.isArray((response as any).models)) {
          modelList = (response as any).models;
        } else if (Symbol.asyncIterator in response) {
          for await (const model of response as any) {
            modelList.push(model);
          }
        }
      }

      for (const model of modelList) {
        const name = typeof model?.name === 'string' ? model.name.replace(/^models\//, '') : '';
        if (name) {
          models.push(name);
        }
      }

      res.json({ models });
    } catch (error: any) {
      console.error('Error in /api/gemini/models:', error);
      const { status, body } = serializeError(error);
      res.status(status).json(body);
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
