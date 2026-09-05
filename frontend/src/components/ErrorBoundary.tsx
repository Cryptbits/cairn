import React from 'react';

interface Props {
  children: React.ReactNode;
}
interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {

    console.error('Cairn crashed:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-bg p-[24px]">
          <div className="max-w-[360px] text-center flex flex-col items-center gap-[16px]">
            <svg className="w-[28px] h-[24px]" viewBox="0 0 26 22" fill="none">
              <rect x="2" y="16" width="22" height="5" rx="2.2" fill="#5C5646" />
              <rect x="5.5" y="9" width="15" height="5" rx="2.2" fill="#8B6A45" />
              <rect x="9" y="2" width="8" height="5" rx="2.2" fill="#E9A165" />
            </svg>
            <div>
              <div className="font-d text-[18px] font-[560] text-white mb-[6px]">Something went wrong</div>
              <div className="text-[13.5px] text-text-2 leading-relaxed">
                Cairn hit an unexpected error. Nothing was lost, a refresh usually clears it.
              </div>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="px-[20px] py-[10px] rounded-[12px] bg-surface-2 border border-bdr-strong text-text-1 font-semibold text-[13.5px] hover:bg-surface-hover transition-all"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
