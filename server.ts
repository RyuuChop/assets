import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// Initialize Gemini SDK with telemetry header
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

/* =========================================================================
   1. GEMINI EXTREME DIFFICULTY CHESS MOVE ENDPOINT
   ========================================================================= */

app.post('/api/ai/move', async (req, res) => {
  const { fen, moveHistory, legalMoves, sideToMove } = req.body;

  if (!fen || !legalMoves || !Array.isArray(legalMoves) || legalMoves.length === 0) {
    return res.status(400).json({ error: 'Valid fen and legalMoves array are required' });
  }

  // Quick fallback if only 1 legal move
  if (legalMoves.length === 1) {
    return res.json({ move: legalMoves[0], thought: 'Only one legal move available.' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({
      error: 'GEMINI_API_KEY is not configured on server.',
      fallbackNeeded: true,
    });
  }

  try {
    const prompt = `You are a World Champion Grandmaster Chess Engine playing at EXTREME difficulty.
Current board FEN: ${fen}
Side to move: ${sideToMove || 'Black'}
Recent moves in match: ${moveHistory && moveHistory.length > 0 ? moveHistory.slice(-10).join(', ') : 'Game start'}

LEGAL MOVES available in this position (Standard Algebraic Notation or UCI from-to):
${legalMoves.join(', ')}

Your task:
Analyze pawn structure, king safety, piece activity, tactical threats, and positional advantages.
Select the absolute strongest, most lethal grandmaster move from the LEGAL MOVES list provided above.
You MUST choose a move that strictly exists in the legal moves list.

Respond ONLY in strict JSON format:
{
  "move": "<chosen move exactly matching one from the legal moves list>",
  "thought": "<one or two concise sentences explaining your tactical/positional reasoning as a Grandmaster>"
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction: 'You are an invincible Chess Grandmaster and calculation engine. Always return valid JSON containing your chosen legal move and high-level grandmaster evaluation.',
        responseMimeType: 'application/json',
      },
    });

    const text = response.text?.trim() || '{}';
    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      // JSON extraction fallback
      const match = text.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    }

    // Verify chosen move is legal
    const chosen = parsed.move?.trim();
    const isLegal = legalMoves.some(
      (m: string) => m.toLowerCase() === chosen?.toLowerCase()
    );

    if (isLegal) {
      const canonicalMove = legalMoves.find(
        (m: string) => m.toLowerCase() === chosen.toLowerCase()
      );
      return res.json({
        move: canonicalMove,
        thought: parsed.thought || 'Calculated the most active, initiative-seizing continuation.',
      });
    }

    // If model didn't pick an exact match, try matching from-to coordinates (e.g. e7e5 or e7-e5)
    const normalizedChosen = chosen?.replace(/[^a-h1-8]/gi, '');
    const coordMatch = legalMoves.find((m: string) => {
      const norm = m.replace(/[^a-h1-8]/gi, '');
      return norm === normalizedChosen || m.includes(chosen);
    });

    if (coordMatch) {
      return res.json({
        move: coordMatch,
        thought: parsed.thought || 'Strong positional pressure.',
      });
    }

    // Otherwise signal fallback so chessAI minimax takes over
    return res.status(200).json({
      fallbackNeeded: true,
      reason: 'Model selected move outside legal set',
    });
  } catch (err: any) {
    console.error('[Gemini AI Move Error]:', err?.message || err);
    return res.status(500).json({
      error: err?.message || 'Failed to generate Gemini move',
      fallbackNeeded: true,
    });
  }
});

/* =========================================================================
   2. GEMINI GRANDMASTER CHATBOT ENDPOINT (MULTI-TURN)
   ========================================================================= */

app.post('/api/ai/chat', async (req, res) => {
  const { messages, fen, moveHistory, difficulty } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({
      error: 'Gemini API key is not configured on the server.',
    });
  }

  try {
    const systemInstruction = `You are "Grandmaster Garry", an elite, witty, and insightful Chess Grandmaster opponent and commentator inside Grandmaster 3D Chess Studio.
Current Game Context:
- Active Board FEN: ${fen || 'Initial standard position'}
- Current Move Count / History: ${moveHistory && moveHistory.length > 0 ? moveHistory.join(' ') : 'Match just started'}
- AI Opponent Difficulty: ${difficulty || 'Extreme'}

Your Personality:
- Deeply knowledgeable about chess openings, tactical motifs, endgames, and historical games (Kasparov, Fischer, Tal, Carlsen).
- Passionate, encouraging yet competitive with playful grandmaster banter.
- Answer player questions about what moves are good, explain your tactical ideas, analyze the current board state, or discuss chess strategy and culture.
- Keep responses engaging, conversational, and concise (typically 2-4 sentences unless the player specifically asks for an in-depth breakdown).
- Use chess notation (like e4, Nf3, Bb5) when discussing moves.`;

    // Format multi-turn conversation contents for Gemini SDK
    // Convert incoming { role: 'user' | 'model', text: string } to Gemini format
    const contents = messages.map((m: any) => ({
      role: m.role === 'model' || m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text || '' }],
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction,
      },
    });

    const reply = response.text || 'An intriguing position! What move are you considering next?';
    return res.json({ reply });
  } catch (err: any) {
    console.error('[Gemini Chat Error]:', err?.message || err);
    return res.status(500).json({
      error: err?.message || 'Failed to communicate with Grandmaster Gemini',
    });
  }
});

/* =========================================================================
   3. VITE DEV MIDDLEWARE & STATIC ASSET SERVING
   ========================================================================= */

const isProd = process.env.NODE_ENV === 'production';

if (!isProd) {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Grandmaster 3D Server] Running on http://0.0.0.0:${PORT}`);
});
