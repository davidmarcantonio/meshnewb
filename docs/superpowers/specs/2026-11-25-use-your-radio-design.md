# Use your radio tab (0.16.0)

**Why:** MeshNewb ends when the radio is set up. David wants the next step covered for a non-technical reader (he named a 60-year-old): now that the radio works, how to send a message on the private channel made in the Family tab, and how to message one person. He asked first for a simple how-to with mock screenshots, then for a mock-up "somebody can click through and simulate what it's like to send a message".

**What it does**
- Fifth choice and address `/use/`: "💬 Use your radio", a full-width button under the 2x2 grid, because it is what comes after the other four.
- 01 Practice on a pretend phone: a drawn iPhone running the Meshtastic app. Two lessons, "Message your family channel" and "Message one person", five steps each. A coach line names the next tap and the thing to tap is outlined in orange. A wrong turn gets "tap the blue word at the top left to go back". The message shows "Sending...", then "Delivered to mesh" (channel) or "Delivered to recipient" (direct), and a made-up reply arrives.
- 02 Now on your real phone: the same taps as two four-step numbered lists, a warning that Primary Channel is public, one paragraph for Android.
- 03 Did it go through?: the five status lines a newcomer will meet, in plain words, and four things to know (200 bytes, why a person can be missing from Direct Messages, test first, not 911).
- "Your radio is ready" (Set up a radio) and the Family tab's test-message callout link here.
- The tab hides "Before you start" and the USB privacy line: nothing is plugged in. It is the one tab that is useful on a phone.

**Not in it:** no radio access, no requests, no storage. The pretend phone sends nothing anywhere.

**Approaches considered**
1. A fifth tab (chosen by David, after turning down a blog post): one site, one build, one link, same theme.
2. A blog post linked from the page: his first idea was mine, not his; he wants it as a supplement to the mesh page.
3. A standalone page: easier to print, a second thing to theme and maintain.
4. A section at the bottom of every tab: nobody scrolls that far.

**Where the screens come from:** the app's source, meshtastic/Meshtastic-Apple at d7441b9 (2026-11-25): tab order Messages, Nodes, Map, Settings, Connect (ContentView); Messages has two rows, Channels and Direct Messages (Messages); an unnamed primary channel is titled "Primary Channel", channel rows are a circle with the slot number, a lock, the name (ChannelList, ChannelLock); a message row is a circle with the sender's short name and "Long name (!id)" above the bubble (ChannelMessageRow); the direct-message list is "Contacts (n)" with "Find a contact" (UserList); the box says "Message", sends with an up arrow, and stops at 200 bytes (TextMessageField). Status wording is from the app's bundled "Message Status" screenshot. That is main, which can be ahead of the App Store release. Icons are simple drawings of our own, not Apple's symbols, and the caption says it is a drawing.

**How it is built**
- `src/practice.js` exports `initPractice(root)`. State is the lesson, the screen and the chats; the coach derives the step from the screen each time, so there is no step counter to get out of step.
- No inline styles: the page's CSP is `style-src 'self'`. Colours are classes in app.css; the byte bar's width is set through the CSSOM, which the policy allows.
- Styles are scoped under `.practice` and buttons there start from `all: unset`, so the page's button and input rules do not leak into the phone.
- On a narrow screen `.pr-side` is `display: contents` so the coach can stick to the top for the whole height of the pretend phone.
- `showPage` accepts `use`; `build.mjs` writes `use/index.html`; the attestation list in pages.yml names it.

**My calls, not David's:** the made-up names (Otter 42, Bison 08, Maple 17, in the style of "Suggest a name") and messages; iPhone as the phone drawn, Android in one paragraph; the wording of every step; which five statuses to list.

**Tests:** tests/use.py (both lessons, wrong turn, empty send, 200-byte cap, typing survives a reply, links in, keyboard, no outside request, no CSP report, phone width and sticky step). Not covered: a real phone side by side with the drawing. David should compare the tab bar and lock icons with his iPhone once.
