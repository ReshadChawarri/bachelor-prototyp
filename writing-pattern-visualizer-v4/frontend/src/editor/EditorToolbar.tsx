import type { Editor } from "@tiptap/react";

interface EditorToolbarProps {
  editor: Editor | null;
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  if (!editor) {
    return <div className="format-toolbar" aria-label="Formatting toolbar" />;
  }

  return (
    <div className="format-toolbar" aria-label="Formatting toolbar">
      <button type="button" title="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
        Undo
      </button>
      <button type="button" title="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
        Redo
      </button>
      <span className="toolbar-divider" />
      <select
        aria-label="Text style"
        value={currentBlockStyle(editor)}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "paragraph") {
            editor.chain().focus().setParagraph().run();
          } else {
            editor
              .chain()
              .focus()
              .toggleHeading({ level: Number(value.replace("heading-", "")) as 1 | 2 | 3 })
              .run();
          }
        }}
      >
        <option value="paragraph">Normal text</option>
        <option value="heading-1">Heading 1</option>
        <option value="heading-2">Heading 2</option>
        <option value="heading-3">Heading 3</option>
      </select>
      <span className="toolbar-divider" />
      <button
        type="button"
        title="Bold"
        className={editor.isActive("bold") ? "active" : ""}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        B
      </button>
      <button
        type="button"
        title="Italic"
        className={editor.isActive("italic") ? "active" : ""}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        I
      </button>
      <button
        type="button"
        title="Underline"
        className={editor.isActive("underline") ? "active" : ""}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        U
      </button>
      <span className="toolbar-divider" />
      <button
        type="button"
        title="Bullet list"
        className={editor.isActive("bulletList") ? "active" : ""}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        List
      </button>
      <button
        type="button"
        title="Numbered list"
        className={editor.isActive("orderedList") ? "active" : ""}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.
      </button>
    </div>
  );
}

function currentBlockStyle(editor: Editor): string {
  if (editor.isActive("heading", { level: 1 })) {
    return "heading-1";
  }
  if (editor.isActive("heading", { level: 2 })) {
    return "heading-2";
  }
  if (editor.isActive("heading", { level: 3 })) {
    return "heading-3";
  }
  return "paragraph";
}

