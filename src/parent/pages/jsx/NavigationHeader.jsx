import { LogOut, Menu, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import ParrotIcon from "../../components/ParrotIcon.jsx";
import "../css/NavigationHeader.css";

function NavigationHeader({
  user,
  profile,
  onAccountClick,
  onProfileClick,
  onLogout,
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isMenuOpen || typeof document === "undefined") {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (menuRef.current?.contains(event.target)) {
        return;
      }

      setIsMenuOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  const handleMenuAction = (action) => {
    action?.();
    setIsMenuOpen(false);
  };

  return (
    <header className="parent-navigation__header">
      <div className="parent-navigation__brand">
        <ParrotIcon className="parent-navigation__brand-icon" />
        Parrot
      </div>

      <div className="parent-navigation__account-menu" ref={menuRef}>
        <button
          className={`parent-navigation__menu-button${
            isMenuOpen ? " is-open" : ""
          }`}
          type="button"
          onClick={() => setIsMenuOpen((currentValue) => !currentValue)}
          aria-expanded={isMenuOpen}
          aria-haspopup="menu"
          aria-label="Account menu"
          title="Account menu"
        >
          {isMenuOpen ? (
            <X size={20} aria-hidden="true" />
          ) : (
            <Menu size={20} aria-hidden="true" />
          )}
        </button>

        {isMenuOpen ? (
          <nav
            className="parent-navigation__menu-dropdown"
            role="menu"
            aria-label="Account menu"
          >
            <div className="parent-navigation__menu-user">
              <span>{user.username}</span>
              {user.email ? <small>{user.email}</small> : null}
            </div>
            <button
              className="parent-navigation__menu-item"
              type="button"
              onClick={() => handleMenuAction(onAccountClick)}
              role="menuitem"
            >
              <UserRound size={18} aria-hidden="true" />
              <span>Account</span>
            </button>
            <button
              className="parent-navigation__menu-item"
              type="button"
              onClick={() => handleMenuAction(onProfileClick)}
              role="menuitem"
            >
              {profile?.profile_picture ? (
                <img
                  className="parent-navigation__menu-avatar"
                  src={profile.profile_picture}
                  alt=""
                  aria-hidden="true"
                />
              ) : (
                <ParrotIcon className="parent-navigation__menu-avatar-mark" />
              )}
              <span>Profile</span>
            </button>
            <button
              className="parent-navigation__menu-item parent-navigation__menu-item--logout"
              type="button"
              onClick={() => handleMenuAction(onLogout)}
              role="menuitem"
            >
              <LogOut size={18} aria-hidden="true" />
              <span>Logout</span>
            </button>
          </nav>
        ) : null}
      </div>
    </header>
  );
}

export default NavigationHeader;
