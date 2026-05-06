import { LogOut, UserRound } from "lucide-react";

import ParrotIcon from "../../components/ParrotIcon.jsx";
import "../css/NavigationHeader.css";

function NavigationHeader({
  user,
  profile,
  onAccountClick,
  onProfileClick,
  onLogout,
}) {
  return (
    <header className="parent-navigation__header">
      <div className="parent-navigation__brand">
        <ParrotIcon className="parent-navigation__brand-icon" />
        Parrot
      </div>

      <div className="parent-navigation__account">
        <p>{user.username}</p>
        <button
          type="button"
          onClick={onAccountClick}
          aria-label="Account details"
          title="Account details"
        >
          <UserRound size={18} aria-hidden="true" />
        </button>
        <button
          className="parent-navigation__profile-action"
          type="button"
          onClick={onProfileClick}
          aria-label="Profile"
          title="Profile"
        >
          {profile?.profile_picture ? (
            <img src={profile.profile_picture} alt="" aria-hidden="true" />
          ) : (
            <ParrotIcon className="parent-navigation__profile-mark" />
          )}
        </button>
        <button
          className="parent-navigation__logout"
          type="button"
          onClick={onLogout}
          aria-label="Logout"
          title="Logout"
        >
          <LogOut size={20} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

export default NavigationHeader;
