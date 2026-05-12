import "./Layout.css";

function Layout({
  contactHeader,
  contacts,
  contactFooter,
  room,
  roomHeader,
  contactsLabel = "Contacts",
  roomLabel = "Room",
}) {
  return (
    <main className="parrot-layout" aria-label="Parrot browser layout">
      <section
        className="parrot-layout__contacts"
        aria-label={contactsLabel}
      >
        <header className="parrot-layout__contacts-header">
          {contactHeader}
        </header>

        <div className="parrot-layout__contacts-body">{contacts}</div>

        {contactFooter ? (
          <footer className="parrot-layout__contacts-footer">
            {contactFooter}
          </footer>
        ) : null}
      </section>

      <section
        className="parrot-layout__room"
        aria-labelledby="parrot-layout-room-title"
      >
        <header className="parrot-layout__room-header">
          {roomHeader || <h2 id="parrot-layout-room-title">{roomLabel}</h2>}
        </header>

        <div className="parrot-layout__room-body">{room}</div>
      </section>
    </main>
  );
}

export default Layout;
