import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle
} from "@/components/ui/dialog";
import {
  IMAGE_PREVIEW_MAX_SCALE,
  IMAGE_PREVIEW_MIN_SCALE,
  IMAGE_PREVIEW_ZOOM_STEP,
  type ImagePreviewPoint,
  type ImagePreviewTransform,
  clampImagePreviewOffset,
  clientPointInView,
  imagePointFromView,
  imagePreviewTransformForScale,
  panImagePreview,
  pinchImagePreviewScale,
  pointerDistance,
  pointerMidpoint,
  wheelImagePreviewFactor,
  zoomImagePreview
} from "./image-preview";

const FIT_TRANSFORM: ImagePreviewTransform = { scale: 1, x: 0, y: 0 };

export function ImagePreviewDialog({
  open,
  onOpenChange,
  src,
  alt
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-black/75" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 outline-none"
          style={{ touchAction: "none" }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DialogTitle className="sr-only">{alt || "图片预览"}</DialogTitle>
          <DialogDescription className="sr-only">
            可以放大、缩小，手机上支持双指缩放。
          </DialogDescription>
          <ImagePreviewStage src={src} alt={alt} onClose={() => onOpenChange(false)} />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function ImagePreviewStage({
  src,
  alt,
  onClose
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ImagePreviewTransform>(FIT_TRANSFORM);
  const pointers = useRef(new Map<number, ImagePreviewPoint>());
  const pinchRef = useRef<{
    distance: number;
    scale: number;
    imagePoint: ImagePreviewPoint;
  } | null>(null);
  const panRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    origin: ImagePreviewTransform;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [transform, setTransform] = useState<ImagePreviewTransform>(FIT_TRANSFORM);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  function commit(next: ImagePreviewTransform) {
    const rect = viewRef.current?.getBoundingClientRect();
    const clamped =
      rect && rect.width > 0 && rect.height > 0
        ? clampImagePreviewOffset(next, rect)
        : next.scale <= 1
          ? FIT_TRANSFORM
          : next;
    transformRef.current = clamped;
    setTransform(clamped);
  }

  function viewPoint(clientX: number, clientY: number) {
    const rect = viewRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return clientPointInView(rect, clientX, clientY);
  }

  function zoomBy(factor: number) {
    const current = transformRef.current;
    commit(zoomImagePreview(current, { x: 0, y: 0 }, current.scale * factor));
  }

  useEffect(() => {
    const node = viewRef.current;
    if (!node) return;
    const preventGesture = (event: Event) => event.preventDefault();
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = wheelImagePreviewFactor(event.deltaY);
      if (factor === 1) return;
      const anchor = clientPointInView(node.getBoundingClientRect(), event.clientX, event.clientY);
      const current = transformRef.current;
      commit(zoomImagePreview(current, anchor, current.scale * factor));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("gesturestart", preventGesture, { passive: false });
    node.addEventListener("gesturechange", preventGesture, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("gesturestart", preventGesture);
      node.removeEventListener("gesturechange", preventGesture);
    };
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (event.pointerType !== "mouse") event.preventDefault();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is optional; events still update the gesture while they hit the stage.
    }
    if (pointers.current.size >= 2) {
      const [first, second] = [...pointers.current.values()];
      if (!first || !second) return;
      const midpoint = pointerMidpoint(first, second);
      pinchRef.current = {
        distance: Math.max(1, pointerDistance(first, second)),
        scale: transformRef.current.scale,
        imagePoint: imagePointFromView(transformRef.current, viewPoint(midpoint.x, midpoint.y))
      };
      panRef.current = null;
      suppressClickRef.current = true;
      return;
    }
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      origin: transformRef.current
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinchRef.current) {
      const [first, second] = [...pointers.current.values()];
      if (!first || !second) return;
      const midpoint = pointerMidpoint(first, second);
      const scale = pinchImagePreviewScale(
        pinchRef.current.scale,
        pinchRef.current.distance,
        pointerDistance(first, second)
      );
      suppressClickRef.current = true;
      commit(
        imagePreviewTransformForScale(
          viewPoint(midpoint.x, midpoint.y),
          pinchRef.current.imagePoint,
          scale
        )
      );
      return;
    }
    const drag = panRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.origin.scale <= 1) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) suppressClickRef.current = true;
    commit(panImagePreview(drag.origin, dx, dy));
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 1) {
      const entry = [...pointers.current.entries()][0];
      if (entry) {
        panRef.current = {
          pointerId: entry[0],
          x: entry[1].x,
          y: entry[1].y,
          origin: transformRef.current
        };
      }
    } else if (pointers.current.size === 0) {
      panRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (event.target === event.currentTarget) onClose();
  }

  function onDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const current = transformRef.current;
    const nextScale = current.scale > 1.01 ? 1 : 2.5;
    commit(
      nextScale === 1
        ? FIT_TRANSFORM
        : zoomImagePreview(current, viewPoint(event.clientX, event.clientY), nextScale)
    );
  }

  const zoomOutDisabled = transform.scale <= IMAGE_PREVIEW_MIN_SCALE;
  const zoomInDisabled = transform.scale >= IMAGE_PREVIEW_MAX_SCALE;
  const resetDisabled = transform.scale === 1 && transform.x === 0 && transform.y === 0;

  return (
    <div className="relative h-full w-full text-white">
      <div className="pointer-events-none absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex items-start justify-between gap-3 px-3">
        <p className="min-w-0 truncate pt-1 text-sm text-white/80">{alt}</p>
        <DialogPrimitive.Close
          type="button"
          className="pointer-events-auto inline-flex size-8 items-center justify-center rounded-lg border border-white/15 bg-black/55 text-white hover:bg-black/75"
          aria-label="关闭"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </div>
      <div
        ref={viewRef}
        className="flex h-full w-full items-center justify-center"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        {status === "loading" ? <p className="text-sm text-white/75">正在加载图片…</p> : null}
        {status === "error" ? <p className="text-sm text-white/75">图片无法显示</p> : null}
        <img
          src={src}
          alt={alt}
          draggable={false}
          decoding="async"
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
          onDragStart={(event) => event.preventDefault()}
          className={`max-h-[calc(100dvh-7rem)] max-w-[calc(100vw-2rem)] object-contain select-none ${
            transform.scale > 1 ? "cursor-grab" : "cursor-zoom-in"
          } ${status === "ready" ? "" : "hidden"}`}
          style={{
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
            transformOrigin: "center center"
          }}
        />
      </div>
      <div className="absolute inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 flex justify-center px-3">
        <div
          data-preview-controls
          className="flex items-center gap-1 rounded-lg border border-white/15 bg-black/60 p-1"
        >
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-lg text-white hover:bg-white/15 disabled:opacity-40"
            aria-label="缩小"
            disabled={zoomOutDisabled}
            onClick={() => zoomBy(1 / IMAGE_PREVIEW_ZOOM_STEP)}
          >
            <Minus className="size-4" />
          </button>
          <span className="min-w-12 text-center text-xs tabular-nums text-white/85">
            {Math.round(transform.scale * 100)}%
          </span>
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-lg text-white hover:bg-white/15 disabled:opacity-40"
            aria-label="放大"
            disabled={zoomInDisabled}
            onClick={() => zoomBy(IMAGE_PREVIEW_ZOOM_STEP)}
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center gap-1 rounded-lg px-2 text-xs text-white hover:bg-white/15 disabled:opacity-40"
            aria-label="还原"
            disabled={resetDisabled}
            onClick={() => commit(FIT_TRANSFORM)}
          >
            <RotateCcw className="size-3.5" />
            还原
          </button>
        </div>
      </div>
    </div>
  );
}
