import parrotIcon from "./ParrotIcon.svg";

function ParrotIcon({ className = "" }) {
  return (
    <img
      className={className}
      src={parrotIcon}
      alt=""
      aria-hidden="true"
      draggable="false"
    />
  );
}

export default ParrotIcon;
