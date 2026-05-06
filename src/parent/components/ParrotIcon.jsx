const PARROT_ICON_SRC = "/favicon.svg?v=8";

function ParrotIcon({ className = "" }) {
  return (
    <img
      className={className}
      src={PARROT_ICON_SRC}
      alt=""
      aria-hidden="true"
      draggable="false"
    />
  );
}

export default ParrotIcon;
