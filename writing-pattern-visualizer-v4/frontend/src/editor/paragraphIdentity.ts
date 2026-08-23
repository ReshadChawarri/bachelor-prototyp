import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { nanoid } from "nanoid";

const PARAGRAPH_NODE_TYPES = new Set(["paragraph", "heading"]);

export const ParagraphIdentity = Extension.create({
  name: "paragraphIdentity",

  onCreate() {
    const transaction = createParagraphIdentityTransaction(this.editor.state);
    if (transaction) {
      this.editor.view.dispatch(transaction);
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("paragraphIdentity"),
        view: (view) => {
          const transaction = createParagraphIdentityTransaction(view.state);
          if (transaction) {
            view.dispatch(transaction);
          }
          return {};
        },
        appendTransaction: (_transactions, _oldState, newState) => createParagraphIdentityTransaction(newState),
      }),
    ];
  },
});

export function createParagraphId(): string {
  return `p_${nanoid(10)}`;
}

export function createParagraphIdentityTransaction(state: EditorState): Transaction | null {
  const seen = new Set<string>();
  const transaction = state.tr;
  let changed = false;

  state.doc.descendants((node, position) => {
    if (!PARAGRAPH_NODE_TYPES.has(node.type.name)) {
      return true;
    }

    const existingId = node.attrs.paragraphId;
    const needsNewId = typeof existingId !== "string" || existingId.length === 0 || seen.has(existingId);
    const paragraphId = needsNewId ? createParagraphId() : existingId;
    seen.add(paragraphId);

    if (needsNewId) {
      transaction.setNodeMarkup(position, undefined, { ...node.attrs, paragraphId }, node.marks);
      changed = true;
    }

    return true;
  });

  if (!changed || !transaction.docChanged) {
    return null;
  }

  transaction.setMeta("addToHistory", false);
  return transaction;
}
