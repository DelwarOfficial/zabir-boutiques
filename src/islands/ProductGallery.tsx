import { useState, useEffect, useRef } from 'react';

type Props = {
  imageUrls: string[];
  title: string;
};

export function ProductGallery({ imageUrls, title }: Props) {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  function prev() {
    setIndex((prevIndex) => (prevIndex === 0 ? imageUrls.length - 1 : prevIndex - 1));
  }

  function next() {
    setIndex((prevIndex) => (prevIndex === imageUrls.length - 1 ? 0 : prevIndex + 1));
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.changedTouches[0].screenX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    touchEndX.current = e.changedTouches[0].screenX;
    handleSwipe();
  }

  function handleSwipe() {
    const diff = touchStartX.current - touchEndX.current;
    if (diff > 50) {
      next();
    } else if (diff < -50) {
      prev();
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') {
        prev();
      } else if (e.key === 'ArrowRight') {
        next();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imageUrls]);

  if (!imageUrls || imageUrls.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Main Image viewer */}
      <div 
        className="relative aspect-[4/5] overflow-hidden rounded-3xl bg-[var(--surface-soft)] shadow-md group shine-card"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <img
          src={imageUrls[index]}
          alt={`${title} - view ${index + 1}`}
          className="h-full w-full object-cover transition-all duration-300 select-none pointer-events-none"
        />

        {/* Carousel buttons */}
        {imageUrls.length > 1 && (
          <>
            <button
              type="button"
              onClick={prev}
              className="absolute left-3 top-1/2 -translate-y-1/2 tap-44 p-2 rounded-full bg-white/80 dark:bg-black/80 shadow-md text-[var(--ink-storefront)] hover:scale-105 transition cursor-pointer"
              aria-label="Previous image"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M15 19l-7-7 7-7"/></svg>
            </button>
            <button
              type="button"
              onClick={next}
              className="absolute right-3 top-1/2 -translate-y-1/2 tap-44 p-2 rounded-full bg-white/80 dark:bg-black/80 shadow-md text-[var(--ink-storefront)] hover:scale-105 transition cursor-pointer"
              aria-label="Next image"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M9 5l7 7-7 7"/></svg>
            </button>
          </>
        )}
      </div>

      {/* Thumbnails list */}
      {imageUrls.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1" role="tablist">
          {imageUrls.map((url, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={index === i}
              onClick={() => setIndex(i)}
              className={`tap-44 h-16 w-16 shrink-0 rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${
                index === i 
                  ? 'border-[var(--brand-storefront)] scale-95 shadow-sm' 
                  : 'border-[var(--border-storefront)] opacity-75 hover:opacity-100'
              }`}
              aria-label={`Show view ${i + 1}`}
            >
              <img src={url} alt="" className="h-full w-full object-cover select-none pointer-events-none" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
