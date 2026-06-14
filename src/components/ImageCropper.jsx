import { Check, RotateCcw, X } from "@/components/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import "./ImageCropper.css";

const MAX_ZOOM = 5;
const OUTPUT_SIZE = 720;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getOutputType(file) {
  if (["image/jpeg", "image/png", "image/webp"].includes(file?.type)) {
    return file.type;
  }

  return "image/jpeg";
}

function getOutputExtension(type) {
  if (type === "image/png") {
    return "png";
  }

  if (type === "image/webp") {
    return "webp";
  }

  return "jpg";
}

function getCroppedName(file, type) {
  const extension = getOutputExtension(type);
  const baseName = String(file?.name || "image")
    .replace(/\.[^/.]+$/, "")
    .trim();

  return `${baseName || "image"}-cropped.${extension}`;
}

function getDistance(firstPointer, secondPointer) {
  return Math.hypot(
    secondPointer.x - firstPointer.x,
    secondPointer.y - firstPointer.y,
  );
}

function getPointersCenter(firstPointer, secondPointer, rect, stageSize) {
  return {
    x: (firstPointer.x + secondPointer.x) / 2 - rect.left - stageSize.width / 2,
    y: (firstPointer.y + secondPointer.y) / 2 - rect.top - stageSize.height / 2,
  };
}

function ImageCropper({
  aspectRatio = 1,
  file,
  onCancel,
  onCrop,
  title = "Crop Image",
}) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [imageSize, setImageSize] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isCropping, setIsCropping] = useState(false);
  const imageRef = useRef(null);
  const stageRef = useRef(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const zoomRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    if (!file || typeof URL === "undefined") {
      setSourceUrl("");
      return undefined;
    }

    const nextSourceUrl = URL.createObjectURL(file);
    setSourceUrl(nextSourceUrl);
    setImageSize(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });

    return () => URL.revokeObjectURL(nextSourceUrl);
  }, [file]);

  useEffect(() => {
    const stage = stageRef.current;

    if (!stage) {
      return undefined;
    }

    const updateStageSize = () => {
      const rect = stage.getBoundingClientRect();

      setStageSize({
        width: rect.width,
        height: rect.height,
      });
    };

    updateStageSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateStageSize);
      return () => window.removeEventListener("resize", updateStageSize);
    }

    const observer = new ResizeObserver(updateStageSize);
    observer.observe(stage);

    return () => observer.disconnect();
  }, [sourceUrl]);

  useEffect(() => {
    if (imageSize && stageSize.width && stageSize.height) {
      zoomRef.current = 1;
      offsetRef.current = { x: 0, y: 0 };
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    }
  }, [imageSize, stageSize.height, stageSize.width]);

  const renderMetrics = useMemo(() => {
    if (!imageSize || !stageSize.width || !stageSize.height) {
      return null;
    }

    const baseScale = Math.max(
      stageSize.width / imageSize.width,
      stageSize.height / imageSize.height,
    );
    const width = imageSize.width * baseScale * zoom;
    const height = imageSize.height * baseScale * zoom;

    return {
      height,
      left: (stageSize.width - width) / 2 + offset.x,
      top: (stageSize.height - height) / 2 + offset.y,
      width,
    };
  }, [imageSize, offset.x, offset.y, stageSize.height, stageSize.width, zoom]);

  const getClampedOffset = useCallback(
    (nextOffset, nextZoom) => {
      if (!imageSize || !stageSize.width || !stageSize.height) {
        return { x: 0, y: 0 };
      }

      const baseScale = Math.max(
        stageSize.width / imageSize.width,
        stageSize.height / imageSize.height,
      );
      const renderedWidth = imageSize.width * baseScale * nextZoom;
      const renderedHeight = imageSize.height * baseScale * nextZoom;
      const maxX = Math.max(0, (renderedWidth - stageSize.width) / 2);
      const maxY = Math.max(0, (renderedHeight - stageSize.height) / 2);

      return {
        x: clamp(nextOffset.x, -maxX, maxX),
        y: clamp(nextOffset.y, -maxY, maxY),
      };
    },
    [imageSize, stageSize.height, stageSize.width],
  );

  const commitTransform = useCallback(
    (nextZoom, nextOffset) => {
      const boundedZoom = clamp(nextZoom, 1, MAX_ZOOM);
      const boundedOffset = getClampedOffset(nextOffset, boundedZoom);

      zoomRef.current = boundedZoom;
      offsetRef.current = boundedOffset;
      setZoom(boundedZoom);
      setOffset(boundedOffset);
    },
    [getClampedOffset],
  );

  const zoomAtPoint = useCallback(
    (nextZoom, point) => {
      const currentZoom = zoomRef.current;
      const currentOffset = offsetRef.current;
      const boundedZoom = clamp(nextZoom, 1, MAX_ZOOM);
      const zoomRatio = boundedZoom / currentZoom;

      commitTransform(boundedZoom, {
        x: point.x - (point.x - currentOffset.x) * zoomRatio,
        y: point.y - (point.y - currentOffset.y) * zoomRatio,
      });
    },
    [commitTransform],
  );

  const resetCrop = () => {
    commitTransform(1, { x: 0, y: 0 });
  };

  const handleWheel = (event) => {
    event.preventDefault();

    if (!stageRef.current || !imageSize) {
      return;
    }

    const rect = stageRef.current.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left - stageSize.width / 2,
      y: event.clientY - rect.top - stageSize.height / 2,
    };
    const nextZoom = zoomRef.current * Math.exp(-event.deltaY * 0.001);

    zoomAtPoint(nextZoom, point);
  };

  const handlePointerDown = (event) => {
    if (!imageSize) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    const pointers = Array.from(pointersRef.current.values());

    if (pointers.length === 1) {
      gestureRef.current = {
        startOffset: offsetRef.current,
        startPointer: pointers[0],
        type: "pan",
      };
      return;
    }

    if (pointers.length >= 2 && stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect();
      gestureRef.current = {
        startCenter: getPointersCenter(pointers[0], pointers[1], rect, stageSize),
        startDistance: Math.max(1, getDistance(pointers[0], pointers[1])),
        startOffset: offsetRef.current,
        startZoom: zoomRef.current,
        type: "pinch",
      };
    }
  };

  const handlePointerMove = (event) => {
    if (!pointersRef.current.has(event.pointerId) || !gestureRef.current) {
      return;
    }

    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    const pointers = Array.from(pointersRef.current.values());
    const gesture = gestureRef.current;

    if (pointers.length >= 2 && gesture.type === "pinch" && stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect();
      const distance = getDistance(pointers[0], pointers[1]);
      const currentCenter = getPointersCenter(pointers[0], pointers[1], rect, stageSize);
      const nextZoom = gesture.startZoom * (distance / gesture.startDistance);
      const boundedZoom = clamp(nextZoom, 1, MAX_ZOOM);
      const zoomRatio = boundedZoom / gesture.startZoom;

      commitTransform(boundedZoom, {
        x:
          currentCenter.x -
          (gesture.startCenter.x - gesture.startOffset.x) * zoomRatio,
        y:
          currentCenter.y -
          (gesture.startCenter.y - gesture.startOffset.y) * zoomRatio,
      });
      return;
    }

    if (pointers.length === 1 && gesture.type === "pan") {
      const pointer = pointers[0];

      commitTransform(zoomRef.current, {
        x: gesture.startOffset.x + pointer.x - gesture.startPointer.x,
        y: gesture.startOffset.y + pointer.y - gesture.startPointer.y,
      });
    }
  };

  const handlePointerEnd = (event) => {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }

    pointersRef.current.delete(event.pointerId);
    const pointers = Array.from(pointersRef.current.values());

    if (pointers.length === 1) {
      gestureRef.current = {
        startOffset: offsetRef.current,
        startPointer: pointers[0],
        type: "pan",
      };
      return;
    }

    gestureRef.current = null;
  };

  const handleZoomChange = (event) => {
    zoomAtPoint(Number(event.target.value), { x: 0, y: 0 });
  };

  const handleApplyCrop = async () => {
    const image = imageRef.current;

    if (!image || !renderMetrics || !imageSize || !stageSize.width || !stageSize.height) {
      return;
    }

    setIsCropping(true);

    try {
      const outputType = getOutputType(file);
      const outputWidth = OUTPUT_SIZE;
      const outputHeight = Math.round(OUTPUT_SIZE / aspectRatio);
      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;

      const scaleX = renderMetrics.width / imageSize.width;
      const scaleY = renderMetrics.height / imageSize.height;
      const sourceX = clamp((0 - renderMetrics.left) / scaleX, 0, imageSize.width - 1);
      const sourceY = clamp((0 - renderMetrics.top) / scaleY, 0, imageSize.height - 1);
      const sourceWidth = clamp(
        stageSize.width / scaleX,
        1,
        Math.max(1, imageSize.width - sourceX),
      );
      const sourceHeight = clamp(
        stageSize.height / scaleY,
        1,
        Math.max(1, imageSize.height - sourceY),
      );
      const context = canvas.getContext("2d");

      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        outputWidth,
        outputHeight,
      );

      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, outputType, 0.92);
      });

      if (!blob) {
        throw new Error("Unable to crop image.");
      }

      const croppedFile = new File([blob], getCroppedName(file, outputType), {
        lastModified: Date.now(),
        type: outputType,
      });

      await Promise.resolve(onCrop?.(croppedFile));
    } finally {
      setIsCropping(false);
    }
  };

  if (!file || !sourceUrl) {
    return null;
  }

  return createPortal(
    <div className="image-cropper" role="presentation">
      <section
        className="image-cropper__modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-cropper-title"
      >
        <button
          className="image-cropper__close"
          type="button"
          onClick={onCancel}
          aria-label="Close cropper"
          disabled={isCropping}
        >
          <X size={19} aria-hidden="true" />
        </button>

        <div className="image-cropper__header">
          <h2 id="image-cropper-title">{title}</h2>
        </div>

        <div
          className="image-cropper__stage"
          ref={stageRef}
          style={{ aspectRatio }}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          <img
            ref={imageRef}
            className="image-cropper__image"
            src={sourceUrl}
            alt=""
            draggable="false"
            onLoad={(event) => {
              setImageSize({
                height: event.currentTarget.naturalHeight,
                width: event.currentTarget.naturalWidth,
              });
            }}
            style={
              renderMetrics
                ? {
                    height: `${renderMetrics.height}px`,
                    left: `${renderMetrics.left}px`,
                    top: `${renderMetrics.top}px`,
                    width: `${renderMetrics.width}px`,
                  }
                : undefined
            }
          />
          <span className="image-cropper__frame" aria-hidden="true" />
        </div>

        <label className="image-cropper__zoom">
          <span>Zoom</span>
          <input
            type="range"
            min="1"
            max={MAX_ZOOM}
            step="0.01"
            value={zoom}
            onChange={handleZoomChange}
            disabled={!imageSize || isCropping}
          />
        </label>

        <div className="image-cropper__actions">
          <button type="button" onClick={resetCrop} disabled={isCropping}>
            <RotateCcw size={17} aria-hidden="true" />
            <span>Reset</span>
          </button>
          <button type="button" onClick={onCancel} disabled={isCropping}>
            <X size={17} aria-hidden="true" />
            <span>Cancel</span>
          </button>
          <button
            className="image-cropper__apply"
            type="button"
            onClick={handleApplyCrop}
            disabled={!imageSize || isCropping}
          >
            <Check size={17} aria-hidden="true" />
            <span>{isCropping ? "Cropping" : "Apply"}</span>
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default ImageCropper;
