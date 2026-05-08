import { SendHorizontal } from "lucide-react";
import { useState } from "react";

import {
  createMessengerClientMessageId,
  getMessengerErrorMessage,
  sendMessengerMessage,
} from "../../api.js";
import "../css/SendMessagePage.css";
import "../tab/SendMessagePage.css";
import "../mobile/SendMessagePage.css";

function getParticipants(room, roomDetail) {
  if (Array.isArray(roomDetail?.participants)) {
    return roomDetail.participants;
  }

  if (Array.isArray(room?.participants)) {
    return room.participants;
  }

  return [];
}

function getOtherParticipants(room, roomDetail, currentUser) {
  if (Array.isArray(room?.other_participants) && room.other_participants.length > 0) {
    return room.other_participants;
  }

  const currentUserId = Number(currentUser?.user_id);

  if (!currentUserId) {
    return [];
  }

  return getParticipants(room, roomDetail).filter(
    (participant) => Number(participant.user_id) !== currentUserId,
  );
}

function getRecipientAccountNumber(room, roomDetail, currentUser) {
  if (roomDetail?.is_group || room?.is_group) {
    return "";
  }

  const recipient = getOtherParticipants(room, roomDetail, currentUser)[0];

  return recipient?.account_number || "";
}

function SendMessagePage({
  currentUser,
  disabled = false,
  onMessageSent,
  recipientAccountNumber = "",
  room,
  roomDetail,
}) {
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  const resolvedRecipientAccountNumber =
    recipientAccountNumber ||
    getRecipientAccountNumber(room, roomDetail, currentUser);
  const trimmedText = text.trim();
  const isComposerDisabled =
    disabled || isSending || !resolvedRecipientAccountNumber;

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!resolvedRecipientAccountNumber) {
      setMessage("Unable to find the recipient for this room.");
      return;
    }

    if (!trimmedText) {
      setMessage("Message is required.");
      return;
    }

    setIsSending(true);
    setMessage("");

    try {
      const response = await sendMessengerMessage({
        recipient_account_number: resolvedRecipientAccountNumber,
        text: trimmedText,
        client_message_id: createMessengerClientMessageId(),
      });

      setText("");
      await onMessageSent?.(response.data);
    } catch (error) {
      setMessage(getMessengerErrorMessage(error, "Unable to send message."));
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit(event);
    }
  };

  return (
    <form className="messenger-send-message" onSubmit={handleSubmit}>
      {message ? (
        <p className="messenger-send-message__message" role="alert">
          {message}
        </p>
      ) : null}

      <div className="messenger-send-message__bar">
        <textarea
          aria-label="Message"
          disabled={disabled || isSending}
          maxLength={5000}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message"
          rows={1}
          value={text}
        />
        <button
          type="submit"
          disabled={isComposerDisabled || !trimmedText}
          aria-label="Send message"
          title={isSending ? "Sending..." : "Send message"}
        >
          <SendHorizontal size={18} aria-hidden="true" />
          <span>Send</span>
        </button>
      </div>
    </form>
  );
}

export default SendMessagePage;
