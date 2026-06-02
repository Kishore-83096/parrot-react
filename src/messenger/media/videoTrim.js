const STORY_VIDEO_TRIM_EPSILON_SECONDS = 0.05;
const STORY_VIDEO_TRIM_FRAME_RATE = 30;
const STORY_VIDEO_TRIM_MAX_WIDTH = 1280;
const STORY_VIDEO_OUTPUT_TYPES = [
  "video/mp4",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/webm;codecs=vp9,opus",
];

function waitForVideoEvent(video, eventName, errorMessage) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(eventName, handleEvent);
      video.removeEventListener("error", handleError);
    };
    const handleEvent = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error(errorMessage));
    };

    video.addEventListener(eventName, handleEvent, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

async function loadVideoMetadata(video) {
  if (video.readyState >= 1) {
    return;
  }

  await waitForVideoEvent(video, "loadedmetadata", "Unable to read this video.");
}

async function loadVideoData(video) {
  if (video.readyState >= 2) {
    return;
  }

  await waitForVideoEvent(video, "loadeddata", "Unable to play this video.");
}

async function seekVideo(video, time) {
  if (Math.abs(video.currentTime - time) <= STORY_VIDEO_TRIM_EPSILON_SECONDS) {
    return;
  }

  video.currentTime = time;
  await waitForVideoEvent(video, "seeked", "Unable to seek through this video.");
}

function getVideoOutputType() {
  if (typeof globalThis.MediaRecorder !== "function") {
    throw new Error("Video trimming is not supported by this browser.");
  }

  if (typeof globalThis.MediaRecorder.isTypeSupported !== "function") {
    return "";
  }

  const supportedOutputTypes = STORY_VIDEO_OUTPUT_TYPES.filter((mimeType) =>
    globalThis.MediaRecorder.isTypeSupported(mimeType),
  );
  const video = document.createElement("video");

  return (
    supportedOutputTypes.find((mimeType) => video.canPlayType(mimeType)) ||
    supportedOutputTypes[0] ||
    ""
  );
}

async function validateTrimmedVideoBlob(blob) {
  const sourceUrl = URL.createObjectURL(blob);
  const video = document.createElement("video");

  try {
    video.preload = "auto";
    video.playsInline = true;
    video.muted = true;
    video.src = sourceUrl;
    video.load();
    await loadVideoMetadata(video);
    await loadVideoData(video);

    if (!Number.isFinite(Number(video.duration)) || Number(video.duration) <= 0) {
      throw new Error("Unable to prepare the trimmed video for playback.");
    }
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
}

function createTrimmedVideoName(fileName, mimeType) {
  const extension = String(mimeType || "").startsWith("video/mp4")
    ? ".mp4"
    : ".webm";
  const nameWithoutExtension = String(fileName || "story-video").replace(
    /\.[^.]+$/,
    "",
  );

  return `${nameWithoutExtension}-trimmed${extension}`;
}

function createCanvasCaptureStream(video) {
  const canvas = document.createElement("canvas");
  const scale = Math.min(
    STORY_VIDEO_TRIM_MAX_WIDTH / Math.max(video.videoWidth, 1),
    1,
  );
  canvas.width = Math.max(Math.round(video.videoWidth * scale), 1);
  canvas.height = Math.max(Math.round(video.videoHeight * scale), 1);

  if (typeof canvas.captureStream !== "function") {
    throw new Error("Video trimming is not supported by this browser.");
  }

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to prepare the video trimmer.");
  }

  return {
    drawFrame: () => {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
    },
    stream: canvas.captureStream(STORY_VIDEO_TRIM_FRAME_RATE),
  };
}

async function addAudioTrackFallback(video, stream) {
  if (stream.getAudioTracks().length > 0) {
    return null;
  }

  const AudioContextConstructor =
    globalThis.AudioContext || globalThis.webkitAudioContext;
  if (typeof AudioContextConstructor !== "function") {
    return null;
  }

  const audioContext = new AudioContextConstructor();
  const source = audioContext.createMediaElementSource(video);
  const destination = audioContext.createMediaStreamDestination();
  source.connect(destination);
  destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  await audioContext.resume().catch(() => {});

  return audioContext;
}

function createRecordedBlob(recorder) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) {
        chunks.push(event.data);
      }
    });
    recorder.addEventListener("error", () => {
      reject(new Error("Unable to record the trimmed video."));
    });
    recorder.addEventListener("stop", () => {
      const blob = new Blob(chunks, {
        type: recorder.mimeType || "video/webm",
      });

      if (!blob.size) {
        reject(new Error("The trimmed video is empty."));
        return;
      }

      resolve(blob);
    });
  });
}

export async function trimStoryVideoFile(
  file,
  { endSeconds, onProgress, startSeconds = 0 } = {},
) {
  if (!String(file?.type || "").startsWith("video/")) {
    throw new Error("Choose a video before trimming.");
  }

  if (typeof document === "undefined") {
    throw new Error("Video trimming is only available in the browser.");
  }

  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  let audioContext = null;
  let capturedStream = null;
  let sourceCaptureStream = null;
  let frameRequest = null;
  let recorder = null;
  let timeoutId = null;

  try {
    video.preload = "auto";
    video.playsInline = true;
    video.muted = true;
    video.src = sourceUrl;
    video.load();
    await loadVideoMetadata(video);

    const duration = Number(video.duration);
    const trimStart = Math.max(Number(startSeconds) || 0, 0);
    const trimEnd = Math.min(Number(endSeconds) || duration, duration);
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      trimEnd - trimStart <= STORY_VIDEO_TRIM_EPSILON_SECONDS
    ) {
      throw new Error("Choose a valid video trim range.");
    }

    if (
      trimStart <= STORY_VIDEO_TRIM_EPSILON_SECONDS &&
      trimEnd >= duration - STORY_VIDEO_TRIM_EPSILON_SECONDS
    ) {
      onProgress?.(100);
      return file;
    }

    await seekVideo(video, trimStart);

    try {
      sourceCaptureStream =
        video.captureStream?.() || video.mozCaptureStream?.() || null;
    } catch {
      sourceCaptureStream = null;
    }

    const canvasCapture = createCanvasCaptureStream(video);
    capturedStream = canvasCapture.stream;
    sourceCaptureStream
      ?.getAudioTracks()
      .forEach((track) => capturedStream.addTrack(track));
    canvasCapture.drawFrame();
    audioContext = await addAudioTrackFallback(video, capturedStream);

    const outputType = getVideoOutputType();
    recorder = outputType
      ? new globalThis.MediaRecorder(capturedStream, { mimeType: outputType })
      : new globalThis.MediaRecorder(capturedStream);
    const recordedBlob = createRecordedBlob(recorder);
    const trimDuration = trimEnd - trimStart;
    let previousPercent = -1;

    const emitProgress = () => {
      const percent = Math.min(
        Math.max(Math.round(((video.currentTime - trimStart) / trimDuration) * 100), 0),
        100,
      );
      if (percent !== previousPercent) {
        previousPercent = percent;
        onProgress?.(percent);
      }
    };

    const waitForTrimEnd = new Promise((resolve, reject) => {
      const drawNextFrame = () => {
        try {
          canvasCapture.drawFrame();
        } catch {
          // Some browsers need one playback frame before canvas drawing succeeds.
        }
        emitProgress();

        if (
          video.currentTime >= trimEnd - STORY_VIDEO_TRIM_EPSILON_SECONDS ||
          video.ended
        ) {
          resolve();
          return;
        }

        frameRequest = globalThis.requestAnimationFrame(drawNextFrame);
      };

      timeoutId = globalThis.setTimeout(
        () => reject(new Error("Video trimming took too long. Try a shorter clip.")),
        Math.max((trimDuration + 8) * 1000, 15000),
      );
      drawNextFrame();
    });

    recorder.start(250);
    await video.play();
    await waitForTrimEnd;
    video.pause();
    recorder.stop();

    const blob = await recordedBlob;
    await validateTrimmedVideoBlob(blob);
    onProgress?.(100);
    return new File([blob], createTrimmedVideoName(file.name, blob.type), {
      lastModified: Date.now(),
      type: blob.type || outputType || "video/webm",
    });
  } finally {
    if (frameRequest !== null) {
      globalThis.cancelAnimationFrame(frameRequest);
    }
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
    if (recorder?.state && recorder.state !== "inactive") {
      recorder.stop();
    }
    video.pause();
    video.removeAttribute("src");
    video.load();
    capturedStream?.getTracks().forEach((track) => track.stop());
    if (sourceCaptureStream !== capturedStream) {
      sourceCaptureStream?.getTracks().forEach((track) => track.stop());
    }
    audioContext?.close().catch(() => {});
    URL.revokeObjectURL(sourceUrl);
  }
}
