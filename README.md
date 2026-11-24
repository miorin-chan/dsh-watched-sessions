# Watched sessions

[简体中文](README.zh.md)

Keep chosen sessions at the top of the DeepSeek Harness session sidebar, and fold them away
or show only those needing attention.

## Install

**DeepSeek Harness 0.2.2-rc.5** is required on Desktop and Web.

1. Run `npm ci` in this directory to install dependencies and build the plugin.
2. In **Plugins** > **Add plugin**, select this directory.
   The plugin appears as **Watched sessions**.

## Use

1. Open the session sidebar and drag a session to the drop row that appears at the top to watch it.
2. Drag sessions within the **Watched** section to reorder them.
3. Drag a session back into the regular list to stop watching it.

Use the session's **…** menu or right-click menu to watch it, stop watching it, or move it up or down.

Clicking the **Watched** heading cycles the section through three views, following the session list toggle:
all watched sessions, collapsed, and Needs attention.
Needs attention keeps the current, pinned, and drafted sessions, and those that are running,
waiting for you, or finished unread.
The count right after the title always shows how many sessions are watched.
Watching a new session reopens the full section, and reloading the page starts from the full section.

When you stop watching a session, it reappears in its original workspace according
to its regular pin status and the workspace's usual sort order.
This client saves the watched sessions and their order.
Archiving a session stops watching it.

The plugin uses the single workspace browser slot.
While active, it hides decorations and buttons that other plugins add through the native session row slots.

[Project documentation](docs/README.md)
