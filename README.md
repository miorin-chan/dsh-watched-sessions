# Super pin

[简体中文](README.zh.md)

Keep frequently used sessions at the top of the DeepSeek Harness session sidebar.

## Install

**DeepSeek Harness 0.2.2-rc.5** is required on Desktop and Web.

1. Run `npm ci` in this directory to install dependencies and build the plugin.
2. In **Plugins** > **Add plugin**, select this directory.
   The plugin appears as **Super pin**.

## Use

1. Open the session sidebar and drag a session into the drop area at the top to super-pin it.
2. Drag sessions within the top section to reorder them.
3. Drag a session back into the regular list to remove its super pin.

Use the session's **…** menu or right-click menu to super-pin and unpin it, or to move it up or down in the top section.

When you remove a super pin, the session reappears in its original workspace according
to its regular pin status and the workspace's usual sort order.
This client saves the super pins and their order.
Archiving a session clears its super pin.

The plugin uses the single workspace browser slot.
While active, it hides decorations and buttons that other plugins add through the native session row slots.

[Project documentation](docs/README.md)
