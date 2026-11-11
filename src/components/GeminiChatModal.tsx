import React, { useState, useRef, useEffect } from 'react';
import { Bot, Sparkles, Send, X, RotateCcw, User, MessageSquareText, ShieldAlert } from 'lucide-react';
import { AIDifficulty } from '../types/chess';

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
}

interface GeminiChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentFen: string;
  moveHistory: string[];
  difficulty: AIDifficulty;
}

export function GeminiChatModal({
  isOpen,
  onClose,
  currentFen,
  moveHistory,
  difficulty,
}: GeminiChatModalProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init-1',
      role: 'model',
      text: "Greetings, challenger! I am Grandmaster Garry, powered by Gemini. Whether you're playing against my Extreme AI or studying your game, ask me about tactics, move recommendations, or position evaluations!",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputValue).trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInputValue('');
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newHistory.map((m) => ({ role: m.role, text: m.text })),
          fen: currentFen,
          moveHistory,
          difficulty,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server returned ${response.status}`);
      }

      const data = await response.json();
      const modelMsg: ChatMessage = {
        id: `model-${Date.now()}`,
        role: 'model',
        text: data.reply || "A sharp move! Let's see how the board develops.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, modelMsg]);
    } catch (err: any) {
      console.error('Chat error:', err);
      setErrorMessage(
        err.message || 'Unable to connect to Grandmaster AI. Please check server status.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const clearChat = () => {
    setMessages([
      {
        id: `init-${Date.now()}`,
        role: 'model',
        text: 'Board cleared! What chess concepts or moves would you like to explore?',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setErrorMessage(null);
  };

  const quickPrompts = [
    'Evaluate the current board position',
    'What is the best tactical plan right now?',
    'Explain the key ideas in the current pawn structure',
    'Give me a famous Grandmaster quote',
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in pointer-events-auto">
      <div className="relative w-full max-w-lg h-[640px] max-h-[92vh] flex flex-col rounded-3xl bg-neutral-900/95 border border-neutral-700/80 shadow-2xl overflow-hidden text-neutral-100">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-800 bg-neutral-950/40">
          <div className="flex items-center space-x-3">
            <div className="relative p-2 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <Bot className="w-5 h-5" />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-neutral-900" />
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <h3 className="font-bold text-sm text-neutral-100">Grandmaster Garry</h3>
                <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded-full bg-amber-400/10 text-amber-300 text-[10px] font-semibold border border-amber-500/20">
                  <Sparkles className="w-2.5 h-2.5" />
                  <span>Gemini AI</span>
                </span>
              </div>
              <p className="text-[11px] text-neutral-400">
                Live Grandmaster commentary & tactical analysis
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1">
            <button
              onClick={clearChat}
              title="Reset conversation"
              className="p-1.5 rounded-xl hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              title="Close chat"
              className="p-1.5 rounded-xl hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Quick prompt chips */}
        <div className="px-4 py-2 border-b border-neutral-800/80 bg-neutral-900/50 flex items-center space-x-2 overflow-x-auto no-scrollbar text-xs">
          {quickPrompts.map((prompt, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(prompt)}
              disabled={isLoading}
              className="shrink-0 px-2.5 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700/80 border border-neutral-700/60 text-neutral-300 hover:text-amber-300 transition text-[11px] font-medium"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Message Thread */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 space-y-3.5 scrollbar-thin scrollbar-thumb-neutral-700"
        >
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex items-start space-x-2.5 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}
              >
                <div
                  className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold ${
                    isUser
                      ? 'bg-amber-500 text-neutral-950 shadow-md'
                      : 'bg-neutral-800 text-amber-400 border border-neutral-700'
                  }`}
                >
                  {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>

                <div
                  className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
                    isUser
                      ? 'bg-amber-500 text-neutral-950 font-medium rounded-tr-sm shadow-md'
                      : 'bg-neutral-800/90 text-neutral-200 border border-neutral-700/60 rounded-tl-sm shadow-sm'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                  <span
                    className={`block mt-1 text-[9px] ${
                      isUser ? 'text-neutral-900/70 text-right' : 'text-neutral-500'
                    }`}
                  >
                    {msg.timestamp}
                  </span>
                </div>
              </div>
            );
          })}

          {isLoading && (
            <div className="flex items-start space-x-2.5">
              <div className="w-7 h-7 rounded-xl bg-neutral-800 text-amber-400 border border-neutral-700 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 animate-pulse" />
              </div>
              <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-neutral-800/90 border border-neutral-700/60 flex items-center space-x-1.5 text-xs text-neutral-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                <span>Grandmaster Garry is analyzing...</span>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-center space-x-2 p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="p-3 border-t border-neutral-800 bg-neutral-950/60">
          <div className="flex items-center space-x-2 px-3 py-1.5 rounded-2xl bg-neutral-900 border border-neutral-700 focus-within:border-amber-500 transition">
            <MessageSquareText className="w-4 h-4 text-neutral-400" />
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about a move, plan, or evaluation..."
              disabled={isLoading}
              className="flex-1 bg-transparent text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none"
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={!inputValue.trim() || isLoading}
              className="p-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-30 disabled:hover:bg-amber-500 text-neutral-950 font-bold transition shadow-md"
              title="Send message"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center justify-between mt-2 px-1 text-[10px] text-neutral-500">
            <span>Powered by Gemini 3.8 Flash</span>
            <span>Moves in game: {moveHistory.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
