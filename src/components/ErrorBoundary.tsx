import { Component, ErrorInfo, ReactNode } from 'react';
import { Chess } from 'chess.js';
import { RefreshCw, AlertTriangle } from 'lucide-react';

/* =========================================================================
   11. APPLICATION ERROR BOUNDARY
   ========================================================================= */

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[3D Chess Application Error Caught]:', error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) this.props.onReset();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full min-h-[500px] flex flex-col items-center justify-center bg-[#181d28] p-8 text-neutral-200 text-center select-none">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-xl font-bold font-serif-title text-neutral-100 mb-2">
            {this.props.fallbackTitle || 'Grandmaster 3D Chess Studio'}
          </h2>
          <p className="text-sm text-neutral-400 max-w-md mb-6 font-mono text-xs bg-neutral-900 p-3 rounded-lg border border-neutral-800 break-words">
            {this.state.error?.message || 'A runtime rendering exception occurred.'}
          </p>
          <button
            onClick={this.handleRetry}
            className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-semibold text-xs tracking-wider uppercase transition shadow-lg shadow-amber-500/20"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Reload 3D Board</span>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
