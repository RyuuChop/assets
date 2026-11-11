import { AI_LEVEL_DESCRIPTIONS } from '../ai/chessAI';
import { useState } from 'react';
import { Chess } from 'chess.js';
import { Crown, Swords, Bot, Shuffle, Play, X } from 'lucide-react';
import { AppMode, AIDifficulty, PlayerColorChoice } from '../types/chess';

/* =========================================================================
   10. MODE SELECTION & START MATCH MODAL
   ========================================================================= */

export interface ModeModalProps {
  initialMode: AppMode;
  initialDifficulty: AIDifficulty;
  initialColor: PlayerColorChoice;
  isGameStarted: boolean;
  onClose: () => void;
  onStart: (mode: AppMode, diff: AIDifficulty, color: PlayerColorChoice) => void;
}

export function ModeModal({
  initialMode,
  initialDifficulty,
  initialColor,
  isGameStarted,
  onClose,
  onStart,
}: ModeModalProps) {
  const [mode, setMode] = useState<AppMode>(initialMode);
  const [diff, setDiff] = useState<AIDifficulty>(initialDifficulty);
  const [color, setColor] = useState<PlayerColorChoice>(initialColor);

  return (
    <div className="w-full max-w-lg bg-neutral-900 border border-neutral-700/80 rounded-3xl p-6 shadow-2xl relative text-neutral-100">
      {isGameStarted && (
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl bg-neutral-800/80 hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 transition"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      <div className="flex items-center space-x-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-neutral-950 shadow-lg shadow-amber-500/20">
          <Crown className="w-5 h-5 text-neutral-950" />
        </div>
        <div>
          <h2 className="text-lg font-bold font-serif-title leading-tight">
            {isGameStarted ? 'Start New Match' : 'Grandmaster 3D Chess'}
          </h2>
          <p className="text-xs text-neutral-400">
            {isGameStarted ? 'Choose your game rules and opponent' : 'Select mode and difficulty to begin'}
          </p>
        </div>
      </div>

      <div className="space-y-3 mb-5">
        <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
          Game Mode
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setMode('ai')}
            className={`p-3.5 rounded-2xl border text-left transition flex flex-col space-y-1.5 ${
              mode === 'ai'
                ? 'bg-amber-500/15 border-amber-500 text-neutral-100 ring-1 ring-amber-500'
                : 'bg-neutral-800/60 border-neutral-700 text-neutral-400 hover:bg-neutral-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-neutral-100">Player vs AI</span>
              <Bot className={`w-4 h-4 ${mode === 'ai' ? 'text-amber-400' : 'text-neutral-500'}`} />
            </div>
            <span className="text-[11px] text-neutral-400 leading-tight">
              Challenge our tactical engine with 3 difficulty levels
            </span>
          </button>

          <button
            onClick={() => setMode('pvp')}
            className={`p-3.5 rounded-2xl border text-left transition flex flex-col space-y-1.5 ${
              mode === 'pvp'
                ? 'bg-blue-500/15 border-blue-500 text-neutral-100 ring-1 ring-blue-500'
                : 'bg-neutral-800/60 border-neutral-700 text-neutral-400 hover:bg-neutral-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-neutral-100">Player vs Player</span>
              <Swords className={`w-4 h-4 ${mode === 'pvp' ? 'text-blue-400' : 'text-neutral-500'}`} />
            </div>
            <span className="text-[11px] text-neutral-400 leading-tight">
              Local pass-and-play match with optional board flipping
            </span>
          </button>
        </div>
      </div>

      {mode === 'ai' && (
        <div className="space-y-4 mb-6 pt-3 border-t border-neutral-800">
          <div>
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider block mb-2">
              AI Difficulty
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(['easy', 'medium', 'hard', 'extreme'] as AIDifficulty[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDiff(d)}
                  className={`py-2 px-3 rounded-xl border text-xs font-semibold capitalize transition ${
                    diff === d
                      ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-md shadow-amber-500/20'
                      : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-neutral-400 mt-1.5 block">
              {AI_LEVEL_DESCRIPTIONS[diff]}
            </span>
          </div>

          <div>
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider block mb-2">
              Your Color
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setColor('white')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-1.5 transition ${
                  color === 'white'
                    ? 'bg-neutral-100 text-neutral-950 border-white shadow-md'
                    : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-white border border-neutral-300" />
                <span>White</span>
              </button>
              <button
                onClick={() => setColor('black')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-1.5 transition ${
                  color === 'black'
                    ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-md'
                    : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-neutral-900 border border-neutral-500" />
                <span>Black</span>
              </button>
              <button
                onClick={() => setColor('random')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-1.5 transition ${
                  color === 'random'
                    ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-md'
                    : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <Shuffle className="w-3 h-3" />
                <span>Random</span>
              </button>
            </div>
            <span className="text-[11px] text-neutral-400 mt-1.5 block">
              {color === 'black'
                ? 'You play as Black. The AI will make the opening move as White.'
                : color === 'white'
                ? 'You play as White and make the first move.'
                : 'Randomly assigned White or Black.'}
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center space-x-3 pt-4 border-t border-neutral-800">
        {isGameStarted && (
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-semibold text-xs tracking-wider uppercase transition border border-neutral-700"
          >
            Cancel
          </button>
        )}
        <button
          onClick={() => onStart(mode, diff, color)}
          className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 font-bold text-xs tracking-wider uppercase transition shadow-lg shadow-amber-500/20 flex items-center justify-center space-x-1.5"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Start Game</span>
        </button>
      </div>
    </div>
  );
}
