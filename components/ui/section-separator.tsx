'use client';

export function SectionSeparator({ className = '' }: { className?: string }) {
  return (
    <div className={`relative w-full overflow-hidden ${className}`}>
      <div className="absolute inset-0">
        <svg
          className="w-full h-full"
          viewBox="0 0 1200 80"
          preserveAspectRatio="none"
          fill="none"
        >
          <path
            d="M0 40 L600 0 L1200 40 L600 80 Z"
            stroke="#e5e7eb"
            strokeWidth="1"
            fill="none"
          />
          <path
            d="M0 40 L600 0 L1200 40"
            stroke="#d1d5db"
            strokeWidth="0.5"
            strokeDasharray="4 4"
          />
          <path
            d="M600 80 L1200 40"
            stroke="#d1d5db"
            strokeWidth="0.5"
            strokeDasharray="4 4"
          />
          <path
            d="M0 40 L600 80"
            stroke="#d1d5db"
            strokeWidth="0.5"
            strokeDasharray="4 4"
          />
        </svg>
      </div>
      <div className="h-px bg-gradient-to-r from-transparent via-neutral-200 to-transparent" />
    </div>
  );
}

export function DarkSectionSeparator({ className = '' }: { className?: string }) {
  return (
    <div className={`relative w-full overflow-hidden ${className}`}>
      <div className="absolute inset-0">
        <svg
          className="w-full h-full"
          viewBox="0 0 1200 80"
          preserveAspectRatio="none"
          fill="none"
        >
          <path
            d="M0 40 L600 0 L1200 40 L600 80 Z"
            stroke="#374151"
            strokeWidth="1"
            fill="none"
          />
          <path
            d="M0 40 L600 0 L1200 40"
            stroke="#4b5563"
            strokeWidth="0.5"
            strokeDasharray="4 4"
          />
          <path
            d="M600 80 L1200 40"
            stroke="#4b5563"
            strokeWidth="0.5"
            strokeDasharray="4 4"
          />
          <path
            d="M0 40 L600 80"
            stroke="#4b5563"
            strokeWidth="0.5"
            strokeDasharray="4 4"
          />
        </svg>
      </div>
      <div className="h-px bg-gradient-to-r from-transparent via-neutral-700 to-transparent" />
    </div>
  );
}

export function DiagonalSeparator({ className = '' }: { className?: string }) {
  return (
    <div className={`relative w-full h-16 overflow-hidden ${className}`}>
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 1200 64"
        preserveAspectRatio="none"
        fill="none"
      >
        {/* Main diagonal lines */}
        <line x1="0" y1="64" x2="1200" y2="0" stroke="#e5e7eb" strokeWidth="1" />
        <line x1="0" y1="48" x2="1200" y2="-16" stroke="#d1d5db" strokeWidth="0.5" />
        <line x1="0" y1="32" x2="1200" y2="-32" stroke="#e5e7eb" strokeWidth="0.5" />
        <line x1="0" y1="16" x2="1200" y2="-48" stroke="#d1d5db" strokeWidth="0.5" />
        <line x1="0" y1="0" x2="1200" y2="-64" stroke="#e5e7eb" strokeWidth="0.5" />
        
        {/* Cross lines for diamond pattern */}
        <line x1="0" y1="0" x2="1200" y2="64" stroke="#d1d5db" strokeWidth="0.5" />
        <line x1="0" y1="16" x2="1200" y2="80" stroke="#e5e7eb" strokeWidth="0.5" />
        <line x1="0" y1="32" x2="1200" y2="96" stroke="#d1d5db" strokeWidth="0.5" />
        <line x1="0" y1="48" x2="1200" y2="112" stroke="#e5e7eb" strokeWidth="0.5" />
        <line x1="0" y1="64" x2="1200" y2="128" stroke="#d1d5db" strokeWidth="0.5" />
      </svg>
    </div>
  );
}

export function VerticalHatching({ className = '' }: { className?: string }) {
  return (
    <div className={`relative w-full ${className}`}>
      {/* Top border line */}
      <div className="h-px bg-neutral-200" />
      
      {/* Diagonal pattern strip */}
      <div 
        className="w-full h-full bg-neutral-100"
        style={{
          backgroundImage: `repeating-linear-gradient(
            135deg,
            transparent 0px,
            transparent 3px,
            rgba(0, 0, 0, 0.04) 3px,
            rgba(0, 0, 0, 0.04) 4px
          )`
        }}
      />
      
      {/* Bottom border line */}
      <div className="h-px bg-neutral-200" />
    </div>
  );
}

export function GlowSeparator({ className = '' }: { className?: string }) {
  return (
    <div className={`relative w-full py-8 ${className}`}>
      <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-violet-500/50 to-transparent" />
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-8 bg-gradient-to-r from-transparent via-violet-500/10 to-transparent blur-xl" />
    </div>
  );
}
