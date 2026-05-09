import { LogOut, UserRound, Menu, X } from "lucide-react";
import { useState } from "react";

import "../css/ContactsPageHeader.css";

function ContactsPageHeader({
  user,
  profile,
  onAccountClick,
  onProfileClick,
  onLogout,
}) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const handleDropdownToggle = () => {
    setIsDropdownOpen((prev) => !prev);
  };

  const handleAccountClick = () => {
    onAccountClick();
    setIsDropdownOpen(false);
  };

  const handleProfileClick = () => {
    onProfileClick();
    setIsDropdownOpen(false);
  };

  const handleLogoutClick = () => {
    onLogout();
    setIsDropdownOpen(false);
  };

  return (
    <div className="contacts-page__header-menu">
      <button
        className={`contacts-page__hamburger${
          isDropdownOpen ? " is-open" : ""
        }`}
        type="button"
        onClick={handleDropdownToggle}
        aria-label="Menu"
        title="Menu"
        aria-expanded={isDropdownOpen}
        aria-haspopup="true"
      >
        {isDropdownOpen ? (
          <X size={24} aria-hidden="true" />
        ) : (
          <Menu size={24} aria-hidden="true" />
        )}
      </button>

      {isDropdownOpen ? (
        <nav className="contacts-page__dropdown-menu" role="menu">
          <button
            className="contacts-page__dropdown-item"
            type="button"
            onClick={handleAccountClick}
            role="menuitem"
            aria-label="Account management"
          >
            <UserRound size={18} aria-hidden="true" />
            <span>Account Management</span>
          </button>
          <button
            className="contacts-page__dropdown-item"
            type="button"
            onClick={handleProfileClick}
            role="menuitem"
            aria-label="Profile management"
          >
            {profile?.profile_picture ? (
              <img
                src={profile.profile_picture}
                alt=""
                className="contacts-page__dropdown-avatar"
                aria-hidden="true"
              />
            ) : (
              <div className="contacts-page__dropdown-avatar-placeholder" />
            )}
            <span>Profile Management</span>
          </button>
          <hr className="contacts-page__dropdown-divider" />
          <button
            className="contacts-page__dropdown-item contacts-page__dropdown-item--logout"
            type="button"
            onClick={handleLogoutClick}
            role="menuitem"
            aria-label="Logout"
          >
            <LogOut size={18} aria-hidden="true" />
            <span>Logout</span>
          </button>
        </nav>
      ) : null}
    </div>
  );
}

export default ContactsPageHeader;
