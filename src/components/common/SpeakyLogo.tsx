import React from 'react';

interface SpeakyLogoProps {
  className?: string;
  size?: number;
  /** render on light surface (dark glyph) instead of the default dark tile */
  onLight?: boolean;
}

/**
 * Speaky mark: a rounded tile with a stylized voice-line waveform.
 */
export const SpeakyLogo: React.FC<SpeakyLogoProps> = ({ className = 'w-6 h-6', size, onLight }) => {
  const style = size ? { width: size, height: size } : undefined;

  return (
    <div
      style={style}
      className={`relative flex items-center justify-center rounded-[8px] shrink-0 overflow-hidden select-none shadow-xs ${
        onLight ? 'bg-neutral-100' : 'bg-gradient-to-br from-indigo-500 to-violet-600'
      } ${className}`}
    >
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-4/5 h-4/5">
        {/* soft inner glow */}
        <circle cx="16" cy="16" r="11" fill="white" fillOpacity="0.1" />
        {/* voice equalizer line — the Speaky signature */}
        <path
          d="M5 16h3l2.2-6.4a1 1 0 0 1 1.9.05L14 22l2.3-9.2a1 1 0 0 1 1.94-.1L19.6 18l1.8-3.4a1 1 0 0 1 1.8.05L24 19l3-3"
          stroke="white"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};

export default SpeakyLogo;
