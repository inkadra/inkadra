# Inkadra Clipper privacy policy

Last updated: 6 November 2026

Inkadra Clipper is a browser extension published by Matteo Maraffio. It saves images, text and
links to a board on an Inkadra server. This policy covers the extension only.

## The short version

- What you choose to save goes to the Inkadra server you connected the extension to, and to no one
  else.
- The publisher receives none of it, unless the publisher also runs the server you connect to.
- The extension has no analytics, no advertising and no third-party services.
- It does not sell your data.

## What the extension handles

**On your server, when you act:**

- the page address and title, when you save a page;
- the link's address and the address of the page it is on, when you save a link;
- the selected text and the address of its page, when you save a selection;
- the image and its file name, or its address if the image can't be read, with the address of its
  page, when you save an image;
- the note and tags you write, and the board and column you choose;
- what you type in the board search;
- a device name such as "Inkadra Clipper · Chrome · Linux", when you connect, which you see in your
  list of tokens.

**In your browser, in `chrome.storage.local`:**

- the server's address and its upload limit;
- the app token that lets the extension act for you, and its id;
- your name and email on that server, to show which account is connected;
- your recent boards: their ids, titles and project names, up to 20. Your server keeps this list too,
  so that it follows you across browsers.

The extension doesn't use Chrome's sync storage. Chrome removes this data when you remove the
extension. The extension does not encrypt it, so it is protected as your browser profile is. It is
closed to scripts running in web pages.

**Not handled:**

- your password: you sign in on your server's own page, and the extension receives only a code to
  exchange for the token;
- your browsing history: the extension reads a tab only when you click its button or a menu, or
  press its shortcut.

When you open the extension's button, it reads the text selected on the page to fill in the note.
That text stays in the window, and leaves your browser only if you then save.

## Where data goes

**Your server.** It is the one whose address you typed, for example your own or your team's. Chrome asks your
permission for that address when you connect. The extension asks for no other server's address, and
it removes the permission when you disconnect or switch server. What happens to data on the server is up to whoever runs it, and this policy doesn't cover
it. Ask its administrator.

**The site that hosts an image.** To save an image, your browser requests it from where it is
hosted, as the page did, using the page's cookies when it can so that pictures behind a login can be
saved. The extension adds no data of yours to that request.

There are no other recipients. The extension's data isn't shared with Matteo Maraffio, unless he
also runs the server you connect to, or with any analytics or advertising service.

## Your choices

- **Disconnect** in the extension's settings: this revokes the token on the server if it can be
  reached, removes the stored data above and drops the permission for the server's address.
- **Revoke the token** on the web, in Settings → Account → Apps and tokens. Do this if you removed
  the extension without disconnecting, or disconnected while offline: the token then stays valid on
  the server.
- **Delete saved content** on your server. To delete anything else held there, ask its administrator.

## Chrome Web Store limited use

The use of information received from Google APIs will adhere to the Chrome Web Store User Data
Policy, including the Limited Use requirements. The extension's use of data is limited to its single
purpose: saving what you choose to the server you chose. Data is not transferred to third parties,
used for advertising, or used to determine creditworthiness or for lending.

## Changes and contact

Changes to the extension's data handling will be reflected here, with a new date.

Questions: privacy@inkadra.com.
