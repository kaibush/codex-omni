import { useEffect, useRef, useState } from "react";
import {
  BOUNDED_IMAGE_MAX_HEIGHT,
  BOUNDED_IMAGE_MAX_WIDTH,
  boundedImageSize,
  enqueueImageDecode
} from "./bounded-image";

type PreviewFrame = {
  src: string;
  width: number;
  height: number;
};

async function previewFrameFromBlob(
  blob: Blob,
  maxWidth: number,
  maxHeight: number
): Promise<PreviewFrame> {
  const bitmap = await createImageBitmap(blob);
  try {
    const size = boundedImageSize(bitmap.width, bitmap.height, maxWidth, maxHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return {
      src: canvas.toDataURL("image/jpeg", 0.82),
      width: size.width,
      height: size.height
    };
  } finally {
    bitmap.close();
  }
}

export function BoundedImage({
  src,
  alt,
  className,
  maxWidth = BOUNDED_IMAGE_MAX_WIDTH,
  maxHeight = BOUNDED_IMAGE_MAX_HEIGHT,
  onError
}: {
  src: string;
  alt: string;
  className?: string | undefined;
  maxWidth?: number | undefined;
  maxHeight?: number | undefined;
  onError?: (() => void) | undefined;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [visible, setVisible] = useState(false);
  const [frame, setFrame] = useState<PreviewFrame | null>(null);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(Boolean(entry?.isIntersecting));
      },
      { rootMargin: "96px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !src) {
      setFrame(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    void enqueueImageDecode(async () => {
      const response = await fetch(src, {
        signal: controller.signal,
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error(`image ${response.status}`);
      const blob = await response.blob();
      if (cancelled) return;
      const next = await previewFrameFromBlob(blob, maxWidth, maxHeight);
      if (!cancelled) setFrame(next);
    }, controller.signal).catch((error) => {
      if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
      setFrame(null);
      onErrorRef.current?.();
    });
    return () => {
      cancelled = true;
      controller.abort();
      setFrame(null);
    };
  }, [maxHeight, maxWidth, src, visible]);

  return (
    <div ref={hostRef} className="bounded-image-host" data-image-src={src}>
      {frame ? (
        <img
          src={frame.src}
          alt={alt}
          width={frame.width}
          height={frame.height}
          className={className}
          decoding="async"
        />
      ) : (
        <div className={className} aria-hidden />
      )}
    </div>
  );
}
