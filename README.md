# Simple chat (Gun.js version)

One global chat room with sign up / log in, text, pictures and small files.
No backend account or server needed: the page uses the free Gun.js network. Visitors never create anything except a username and password.

## Setup (about 5 minutes)

1. In `index.html`, change `ROOM` to any long random text (this keeps your chat separate from everyone else's).
2. Create a GitHub repo, upload `index.html`, then **Settings > Pages > Deploy from branch > main / root**.
3. Open your site and **sign up as `Gallifrey` first**.
4. A yellow box appears at the top with a long key. Copy it into `ADMIN_PUB` in `index.html` (between the quotes) and re-upload the file.
5. Reload the site and log in as Gallifrey. You now see **Delete** on messages and a **Members** button.

Do steps 3 and 4 before sharing the link with anyone.

## How admin works

Gallifrey signs each action (delete message, rename, delete account) with its private key. Every visitor's page checks the signature against `ADMIN_PUB` and obeys only valid ones. Messages are also signed by their authors, so nobody can post as someone else, and anyone using the name "gallifrey" without the real key is shown as "fake gallifrey".

## Limits you should know about

- **Moderation is enforced by the page, not a server.** Deleted messages and accounts are hidden, not erased from the network, and someone running a modified copy of the page could still see them.
- **Renaming** changes the name shown in chat. The person still logs in with their original username.
- **Delete account** hides all their messages and logs them out when they next open the site. A technical person could still make a new account.
- **Members** lists only people who have posted.
- **Files:** pictures are shrunk automatically. Other files must be under about 150 KB.
- **Relays:** the network depends on volunteer relay servers listed in `PEERS`. If chat stops syncing, replace the address with a current one from https://github.com/amark/gun/wiki/volunteer.dht and re-upload. Old messages can eventually disappear if relays clear their storage.
- Forgotten passwords cannot be recovered.
