import { useCallback, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { codeLanguages } from "./languageSupport";
import { keymap } from "@codemirror/view";
import { neonEditorTheme } from "./editorTheme";

interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
}

export function CodeMirrorEditor({
  value,
  onChange,
  onSave,
}: CodeMirrorEditorProps) {
  const handleChange = useCallback(
    (val: string) => {
      onChange(val);
    },
    [onChange],
  );

  const extensions = useMemo(() => {
    const ext = [
      markdown({ codeLanguages }),
      neonEditorTheme,
    ];

    if (onSave) {
      ext.push(
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              onSave();
              return true;
            },
          },
        ]),
      );
    }

    return ext;
  }, [onSave]);

  return (
    <div className="h-full w-full overflow-hidden">
      <CodeMirror
        value={value}
        onChange={handleChange}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
        }}
        className="h-full"
      />
    </div>
  );
}
