import {
  FileText,
  Image as ImageIcon,
  Music,
  RefreshCw,
  RotateCcw,
  Trash2,
  Video,
  X,
} from "@/components/icons";
import { useEffect, useMemo, useState } from "react";

export const MESSAGE_ATTACHMENT_ACCEPT =
  "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.md,.json";

function getFileExtension(name) {
  const fileName = String(name || "");
  const extension = fileName.split(".").pop()?.toLowerCase() || "";

  return extension && extension !== fileName.toLowerCase() ? extension : "";
}

function getDisplayFileType(fileType) {
  return fileType === "document" ? "file" : fileType || "file";
}

function getFileTypeLabel(fileType, name = "") {
  const type = getDisplayFileType(fileType);
  const extension = getFileExtension(name);

  if (type === "image") {
    return "Image";
  }

  if (type === "video") {
    return "Video";
  }

  if (type === "audio") {
    return "Audio";
  }

  if (type === "pdf") {
    return "PDF";
  }

  return extension ? extension.toUpperCase() : "File";
}

function getPreviewIcon(fileType, size = 18) {
  const type = getDisplayFileType(fileType);

  if (type === "image") {
    return <ImageIcon size={size} aria-hidden="true" />;
  }

  if (type === "video") {
    return <Video size={size} aria-hidden="true" />;
  }

  if (type === "audio") {
    return <Music size={size} aria-hidden="true" />;
  }

  return <FileText size={size} aria-hidden="true" />;
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);

  if (!Number.isFinite(size) || size <= 0) {
    return "";
  }

  if (size < 1024 * 1024) {
    return `${Math.max(Math.round(size / 1024), 1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function useObjectUrl(file) {
  const [objectUrl, setObjectUrl] = useState("");

  useEffect(() => {
    if (!file) {
      setObjectUrl("");
      return undefined;
    }

    const nextObjectUrl = URL.createObjectURL(file);
    setObjectUrl(nextObjectUrl);

    return () => URL.revokeObjectURL(nextObjectUrl);
  }, [file]);

  return objectUrl;
}

function useAttachmentPreviewUrl(attachment, resolvePreviewUrl) {
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    const kind = getDisplayFileType(attachment?.file_type);
    const directUrl = attachment?.file_url || "";

    if (!attachment || !["image", "video"].includes(kind)) {
      setPreviewUrl("");
      return undefined;
    }

    if (directUrl && !attachment?.encrypted_file_url) {
      setPreviewUrl(directUrl);
      return undefined;
    }

    if (typeof resolvePreviewUrl !== "function") {
      setPreviewUrl("");
      return undefined;
    }

    let isMounted = true;
    let objectUrl = "";

    resolvePreviewUrl(attachment)
      .then((url) => {
        if (!isMounted || !url) {
          return;
        }

        objectUrl = url;
        setPreviewUrl(url);
      })
      .catch(() => {
        if (isMounted) {
          setPreviewUrl("");
        }
      });

    return () => {
      isMounted = false;
      if (objectUrl && objectUrl.startsWith("blob:")) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [attachment, resolvePreviewUrl]);

  return previewUrl;
}

function SelectedFilePreviewVisual({ selectedFile }) {
  const fileType = getDisplayFileType(selectedFile?.fileType);
  const objectUrl = useObjectUrl(selectedFile?.file);

  if (fileType === "image" && objectUrl) {
    return <img src={objectUrl} alt="" />;
  }

  if (fileType === "video" && objectUrl) {
    return <video src={objectUrl} muted playsInline preload="metadata" />;
  }

  return (
    <span className={`parent-layout-page__attachment-preview-icon is-${fileType}`}>
      {getPreviewIcon(fileType, 20)}
    </span>
  );
}

function AttachmentPreviewVisual({ attachment, resolvePreviewUrl }) {
  const fileType = getDisplayFileType(attachment?.file_type);
  const previewUrl = useAttachmentPreviewUrl(attachment, resolvePreviewUrl);

  if (fileType === "image" && previewUrl) {
    return <img src={previewUrl} alt="" />;
  }

  if (fileType === "video" && previewUrl) {
    return <video src={previewUrl} muted playsInline preload="metadata" />;
  }

  return (
    <span className={`parent-layout-page__attachment-preview-icon is-${fileType}`}>
      {getPreviewIcon(fileType, 20)}
    </span>
  );
}

export function getEditableAttachmentKey(attachment) {
  return String(
    attachment?.upload_intent_id ||
      attachment?.id ||
      attachment?.encrypted_file_url ||
      attachment?.file_url ||
      attachment?.file_name ||
      "",
  );
}

export function getAttachmentUploadIntentId(attachment) {
  return String(attachment?.upload_intent_id || "");
}

export function buildAttachmentEditPlan(currentAttachments, actionState) {
  const attachments = Array.isArray(currentAttachments) ? currentAttachments : [];
  const removedAttachmentKeys = new Set(actionState?.removedAttachmentKeys || []);
  const attachmentReplacements =
    actionState?.attachmentReplacements &&
    typeof actionState.attachmentReplacements === "object"
      ? actionState.attachmentReplacements
      : {};
  const additionalFiles = Array.isArray(actionState?.replacementFiles)
    ? actionState.replacementFiles
    : [];
  const finalSlots = [];
  const retainedAttachments = [];
  const uploadFiles = [];

  attachments.forEach((attachment) => {
    const attachmentKey = getEditableAttachmentKey(attachment);

    if (removedAttachmentKeys.has(attachmentKey)) {
      return;
    }

    const replacementFile = attachmentReplacements[attachmentKey];
    if (replacementFile) {
      uploadFiles.push(replacementFile);
      finalSlots.push({
        fileId: replacementFile.id,
        type: "new",
      });
      return;
    }

    retainedAttachments.push(attachment);
    finalSlots.push({
      attachment,
      type: "existing",
    });
  });

  additionalFiles.forEach((selectedFile) => {
    uploadFiles.push(selectedFile);
    finalSlots.push({
      fileId: selectedFile.id,
      type: "new",
    });
  });

  return {
    additionalFiles,
    attachmentReplacements,
    finalAttachmentCount: finalSlots.length,
    finalSlots,
    hasAttachmentChanges:
      removedAttachmentKeys.size > 0 ||
      Object.keys(attachmentReplacements).length > 0 ||
      additionalFiles.length > 0,
    retainedAttachments,
    retainedUploadIntentIds: retainedAttachments
      .map(getAttachmentUploadIntentId)
      .filter(Boolean),
    removedAttachmentKeys,
    uploadFiles,
  };
}

export function buildFinalEncryptedAttachments(editPlan, encryptedUploadAttachments) {
  const encryptedByFileId = new Map(
    (Array.isArray(encryptedUploadAttachments) ? encryptedUploadAttachments : [])
      .filter(Boolean)
      .map((attachment) => [attachment.id, attachment]),
  );

  return editPlan.finalSlots
    .map((slot) => {
      if (slot.type === "existing") {
        return slot.attachment;
      }

      return encryptedByFileId.get(slot.fileId) || null;
    })
    .filter(Boolean)
    .map((attachment, index) => ({
      ...attachment,
      sort_order: index,
    }));
}

export function SelectedAttachmentPreviewList({
  files,
  onRemove,
  variant = "composer",
}) {
  const safeFiles = Array.isArray(files) ? files : [];

  if (safeFiles.length === 0) {
    return null;
  }

  return (
    <div
      className={`parent-layout-page__attachment-preview-list is-${variant}`}
      aria-label="Selected attachments"
    >
      {safeFiles.map((selectedFile) => {
        const fileName = selectedFile.file?.name || "Attachment";
        const fileType = getDisplayFileType(selectedFile.fileType);

        return (
          <div
            className={`parent-layout-page__attachment-preview-card is-${fileType}`}
            key={selectedFile.id}
          >
            <div className="parent-layout-page__attachment-preview-visual">
              <SelectedFilePreviewVisual selectedFile={selectedFile} />
            </div>
            <div className="parent-layout-page__attachment-preview-meta">
              <strong>{fileName}</strong>
              <span>
                {getFileTypeLabel(fileType, fileName)}
                {formatFileSize(selectedFile.file?.size)
                  ? ` - ${formatFileSize(selectedFile.file?.size)}`
                  : ""}
              </span>
            </div>
            <button
              type="button"
              className="parent-layout-page__attachment-preview-remove"
              onClick={() => onRemove?.(selectedFile.id)}
              aria-label={`Remove ${fileName}`}
              title="Remove"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function EditableAttachmentGrid({
  attachments,
  disabled = false,
  onRemove,
  onReplace,
  onRestore,
  removedAttachmentKeys,
  replacements,
  resolvePreviewUrl,
}) {
  const safeAttachments = Array.isArray(attachments) ? attachments : [];
  const removedKeys = useMemo(
    () => new Set(removedAttachmentKeys || []),
    [removedAttachmentKeys],
  );
  const replacementMap =
    replacements && typeof replacements === "object" ? replacements : {};

  if (safeAttachments.length === 0) {
    return null;
  }

  return (
    <div
      className="parent-layout-page__edit-attachment-grid"
      aria-label="Current attachments"
    >
      {safeAttachments.map((attachment) => {
        const attachmentKey = getEditableAttachmentKey(attachment);
        const replacementFile = replacementMap[attachmentKey] || null;
        const isRemoved = removedKeys.has(attachmentKey);
        const fileName =
          replacementFile?.file?.name || attachment?.file_name || "Attachment";
        const fileType = getDisplayFileType(
          replacementFile?.fileType || attachment?.file_type,
        );

        return (
          <div
            className={`parent-layout-page__edit-attachment-card is-${fileType}${
              isRemoved ? " is-removed" : ""
            }${replacementFile ? " is-replaced" : ""}`}
            key={attachmentKey}
          >
            <div className="parent-layout-page__attachment-preview-visual">
              {replacementFile ? (
                <SelectedFilePreviewVisual selectedFile={replacementFile} />
              ) : (
                <AttachmentPreviewVisual
                  attachment={attachment}
                  resolvePreviewUrl={resolvePreviewUrl}
                />
              )}
            </div>
            <div className="parent-layout-page__attachment-preview-meta">
              <strong>{fileName}</strong>
              <span>
                {isRemoved
                  ? "Removed"
                  : replacementFile
                    ? "Replacing"
                    : getFileTypeLabel(fileType, fileName)}
              </span>
            </div>
            <div className="parent-layout-page__edit-attachment-actions">
              {isRemoved ? (
                <button
                  type="button"
                  onClick={() => onRestore?.(attachmentKey)}
                  disabled={disabled}
                  aria-label={`Restore ${fileName}`}
                  title="Restore"
                >
                  <RotateCcw size={14} aria-hidden="true" />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onRemove?.(attachmentKey)}
                    disabled={disabled}
                    aria-label={`Remove ${fileName}`}
                    title="Remove"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                  <label
                    aria-label={`Replace ${fileName}`}
                    title="Replace"
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    <input
                      type="file"
                      accept={MESSAGE_ATTACHMENT_ACCEPT}
                      onChange={(event) => onReplace?.(attachmentKey, event)}
                      disabled={disabled}
                    />
                  </label>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
