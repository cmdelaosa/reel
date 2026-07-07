import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

/* ⌘K command palette — empty shell for now; TMDB search wiring lands P2-C1.
   Markup/classes ported from prototype/src/marquee.tsx Palette. */

export function Palette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="mq-pal sheet" onKeyDown={onKey}>
        <div className="mq-pal-head">
          <Search size={17} className="mute" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search shows, genres, networks…"
          />
          <kbd className="mq-kbd">esc</kbd>
        </div>
        <div className="mq-pal-list no-scrollbar">
          <div className="mq-pal-empty">
            {q
              ? `Search is coming with your library — hang tight.`
              : "Type to search your shows and TMDB — landing in Phase 2."}
          </div>
        </div>
        <div className="mq-pal-foot">
          <span><kbd className="mq-kbd">↑↓</kbd> navigate</span>
          <span><kbd className="mq-kbd">↵</kbd> open</span>
          <span className="mute">⌘K from anywhere</span>
        </div>
      </div>
    </>
  );
}
