import { useRef } from "react";
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  imagePlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  CreateLink,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  InsertCodeBlock,
  ListsToggle,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";

interface Props {
  body: string;
  onChange: (body: string) => void;
}

export function RichBodyEditor({ body, onChange }: Props) {
  const ref = useRef<MDXEditorMethods>(null);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="flex h-8 shrink-0 items-center border-b border-zinc-800 px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Rich
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <MDXEditor
          ref={ref}
          markdown={body}
          onChange={onChange}
          className="tve-mdx dark-theme dark-editor"
          contentEditableClassName="tve-mdx-content"
          plugins={[
            headingsPlugin(),
            listsPlugin(),
            quotePlugin(),
            thematicBreakPlugin(),
            linkPlugin(),
            linkDialogPlugin(),
            imagePlugin(),
            tablePlugin(),
            codeBlockPlugin({ defaultCodeBlockLanguage: "ts" }),
            codeMirrorPlugin({
              codeBlockLanguages: {
                ts: "TypeScript",
                tsx: "TSX",
                js: "JavaScript",
                jsx: "JSX",
                astro: "Astro",
                html: "HTML",
                css: "CSS",
                json: "JSON",
                md: "Markdown",
                bash: "Bash",
                "": "Plain text",
              },
            }),
            markdownShortcutPlugin(),
            toolbarPlugin({
              toolbarContents: () => (
                <>
                  <UndoRedo />
                  <BoldItalicUnderlineToggles />
                  <BlockTypeSelect />
                  <ListsToggle />
                  <CreateLink />
                  <InsertImage />
                  <InsertTable />
                  <InsertThematicBreak />
                  <InsertCodeBlock />
                </>
              ),
            }),
          ]}
        />
      </div>
    </div>
  );
}
