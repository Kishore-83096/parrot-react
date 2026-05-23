export const MESSAGE_REACTIONS = [
  { key: "thumbs_up", emoji: "\u{1F44D}", label: "Thumbs up" },
  { key: "heart", emoji: "\u2764\uFE0F", label: "Heart" },
  { key: "laugh", emoji: "\u{1F602}", label: "Laugh" },
  { key: "surprised", emoji: "\u{1F62E}", label: "Surprised" },
  { key: "sad", emoji: "\u{1F622}", label: "Sad" },
];

export const MESSAGE_REACTION_KEYS = MESSAGE_REACTIONS.map(
  (reaction) => reaction.key,
);

export function getReactionConfig(reactionKey) {
  return (
    MESSAGE_REACTIONS.find((reaction) => reaction.key === reactionKey) || null
  );
}
