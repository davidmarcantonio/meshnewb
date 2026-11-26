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

## 0.16.1: the direct-message prerequisite

David, after trying the live tab: "I think we need prerequisite for that. The guide assumes you already have direct message capability." He is right: the lesson opened on a contact list that already had people in it.

- New card in 02, "Before you can message one person": same mesh settings, both radios on in the same place, look in Nodes, then start the message (Direct Messages, or touch and hold in Nodes and choose Message). A hint covers "in Nodes but not in Direct Messages": Exchange User Info.
- The lesson's contact-list step and its last line now point at that card.
- From the app's source: the contact list leaves out nodes it holds no public key for (UserList), the node screen says "This node has not shared a public key, so direct messages to it cannot be sent. Exchange User Info asks for one." (NodeDetail), and the node list's hold menu has Message (NodeList).
- My call: "give it a few minutes" for how long two radios take to hear each other. Not measured.

## 0.16.1, second pass: layout review against other guides

David asked whether the layout works for explaining channel and direct messages, and to see how other guides explain it and how contacts are added.

What other guides do: the official app docs state the two modes first (channel broadcast, direct message) and say a direct message needs the other radio's public key, which "usually arrives on its own" inside node info; both apps have Share Contact (a QR code) and an Add Contact / import step, and Exchange User Info (iPhone) or Request User Info (Android) for a node with no key. Meshtastic's "finding your local mesh" post recommends a direct message as the test, because only the recipient's acknowledgment proves arrival. The MeshCore app guide orders it contact first, message second. The beginner guides read (Hexaspot, Meshtastic for Non-coders) stop at the public channel and never explain direct messages.

Changes:
- Organised by task, not by medium: "Two kinds of message" (the model, before any steps), 01 practice, 02 message your group, 03 message one person, 04 did it go through.
- In 03 the prerequisite comes before the steps that depend on it, and has two routes side by side: scan their code (Share Contact, Add Contact), or let the radios find each other.
- Real-phone steps are set at body size with accent numerals (`ol.taps`; `ol.steps` is already the progress pills).
- Android moved into one closed "Using an Android phone?" block.
- On a phone, on this tab only, the five choices become a compact two-column grid without subtitles, so the guide starts about 470px sooner.

Not verified on a real phone: the iPhone path for showing your own code (Nodes, your radio, Actions, Share Contact) and that the camera opens the link. Both come from the docs. David has two T1000-Es to try it with.

## 0.16.2: what a real iPhone showed

David: "It looks wrong on my iPhone." Checked in the iOS Simulator on codey-box (iPhone 17, iOS 27, Safari) with `xcrun simctl openurl` and `simctl io screenshot`, using #anchors to reach each part of the page.

- The sticky step slid over the top of the pretend phone and hid its title and back button. The step is no longer sticky; the drawing's height follows the screen (`100svh`) so step and phone fit together, and practice.js scrolls the step to the top after a tap when either end is off screen.
- Section headings and their asides wrapped into two ragged columns. They stack on a phone now.
- Tab labels wrapped under their emoji. They wrap beside it now.
- A card title's aside ("when you are together") broke mid-phrase. It is on its own line now.

tests/use.py runs in Chrome, which never showed the first problem at its 360x740 size until the page was scrolled; the test now scrolls and checks that the step does not cover the phone.

## 0.16.3: the pretend phone ran off the right edge

David's iPhone 17 Pro screenshot of the live 0.16.2: on the Channels screen the lesson buttons, the step and the drawing all ran past the right edge. Cause: on a narrow screen `.practice` was a `1fr` grid track, which grows to its widest child, and the one-line message preview ("Who ate the last of the ice cream? ...") is `white-space: nowrap`. The first screen has no long text, which is why the load-time "fits a phone" test and the simulator pass (which cannot tap) both missed it. Fix: `minmax(0, 1fr)` and `min-width: 0` down the chain. The test now walks every screen of the pretend phone at phone width.
