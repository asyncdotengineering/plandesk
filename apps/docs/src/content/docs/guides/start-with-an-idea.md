---
title: Start with just an idea
description: A gentle, no-experience-needed walkthrough — talk your idea into shape with Claude Code, give it a home in Plan Desk, and watch it get built.
---

You have an idea. You're not a developer, and that's completely fine. The only tool you really need to be comfortable with is **Claude Code** — the assistant you chat with, the same way you'd message a capable friend who happens to be able to build things. You describe what you want; it does the work.

This guide takes you from "I have a vague idea" to "there's a real plan, and I'm watching it get built" — slowly, one conversation at a time. Nothing here assumes you've coded before. When something technical needs to happen, you'll hand it to Claude and it'll handle it.

Two things you'll touch:

- **Claude Code** — your home base. You talk, it acts. This is where you live.
- **Plan Desk** — a board where your idea turns into a visible plan. Think of it as a wall of sticky notes that updates itself as work gets done — so you can _see_ your idea taking shape instead of just imagining it.

Let's go.

## 1. Don't plan yet — just talk about the idea

Open Claude Code. Resist the urge to be organized. The first job is just to get the idea out of your head and make it _clear_, and the easiest way to do that is to talk it through.

Paste this, with your idea in your own words:

```text
I have an idea: <describe it however it comes out — messy is fine>.
I'm not technical. Ask me questions one at a time to help me make this
idea clear and concrete. Don't write any code or plans yet — just help
me think it through.
```

Claude will ask you things — who it's for, what it should do first, what "done" looks like. Answer like you're chatting. You'll notice the idea getting sharper as you go. This back-and-forth is the whole point; a fuzzy idea becomes a clear one without you having to know any of the technical words.

Have a couple of these rounds. When it feels solid, pin it down:

```text
Good. Now summarize what we've figured out as a short, plain description:
what we're building, who it's for, and the main pieces it needs. Keep it
simple enough that I could read it to a friend.
```

Now you have something concrete — in plain English. That's your finalized idea.

## 2. Give your idea a home — set up Plan Desk

So far it's all been talk. Plan Desk is where the idea gets a body: a plan you and Claude can both see and update as things move.

You don't have to install anything by hand. Paste this and let Claude do the setup:

```text
Run this in bash: curl -fsSL https://plandesk.asyncdot.com/start.md | cat
Then follow the instructions to set up Plan Desk for this project.
```

Claude installs Plan Desk, starts it up, and connects itself to it — scoped to the folder you're working in (if you don't have one yet, ask it to make one). If it ever needs you to run a command, it'll hand you the exact thing to paste. When it's done, it'll give you a link (it looks like `http://127.0.0.1:3847`) — that's your board, running on your own computer.

:::note
"On your own computer" is the point: your idea and plan live locally with you, not on someone else's server. Nothing gets shared until you decide to share it.
:::

## 3. Turn the idea into a plan you can see

Now ask Claude to turn the idea you finalized in Step 1 into an actual plan on the board:

```text
Use Plan Desk. Take the idea we finalized and turn it into a plan: break it
into clear steps, mark which steps depend on which, and write a short brief
for the first step. Keep it simple and explain the plan back to me in plain
language.
```

Open the link from Step 2. You'll see your idea as a set of cards — each card is one piece of work. Lines between them mean "this has to happen before that." You didn't draw a single one of them.

Take a minute to actually look at it. This is the first time your idea is something you can _point at_. If a step is missing or wrong, just say so in Claude Code ("add a step for X", "we don't need Y") and watch the board update.

## 4. Build it — and watch it happen

Here's the part that feels like magic. Tell Claude to start working through the plan:

```text
Use Plan Desk. Work through the plan one step at a time: pick the next step
that's ready, do it, mark it done, and move on. Explain what you're doing in
plain language as you go, and stop to check with me on anything important.
```

Keep the board open in your browser. As Claude works, cards move and statuses change — live, no refreshing. You're literally watching your idea get built, in the right order (Claude won't start a step until the steps it depends on are done).

You don't need to understand the code it writes. You need to understand the _plan_, and you already do — you helped make it.

## 5. Change your mind by leaving a note

You'll have second thoughts. That's normal, and you don't need technical words to act on them. Open any step's brief on the board and leave a **comment** in plain language — for example:

> Make the sign-up as simple as possible — no passwords if we can avoid it.

Next time Claude checks the plan, it reads your note, adjusts, and marks the comment handled. You steer the whole thing by just... saying what you want.

## That's the whole loop

- You **talked** a rough idea into a clear one.
- You gave it a **home** in Plan Desk with one pasted prompt.
- You watched it become a **plan** you can see and point at.
- Claude **built** it from that plan while you watched.
- You **steered** with plain-language notes.

No jargon required — just a clear idea and a willingness to describe what you want.

## Where to go next

- Ready for the hands-on version with more detail? [From idea to development with Claude Code](/guides/idea-to-development/).
- Want to show this to a client or teammate and let them follow along (and send you feedback)? [Plan → share → build with your team](/guides/plan-share-build/).
- Curious how the whole thing fits together? [Research, plan, build, and share](/guides/research-plan-build-share/).
