<script lang="ts">
  import { onMount, tick, onDestroy } from "svelte";
  import { Parser, Language } from 'web-tree-sitter';
  import { Node as SyntaxNode} from "web-tree-sitter";
  import type { Point } from "web-tree-sitter";
  import { escapeHtml, formatTree, type FormatTree } from "./utils";
  // Optionally, import a mode for syntax highlighting:
  // import 'codemirror/mode/javascript/javascript.js';
  import { EditorState } from "@codemirror/state";
  import { javascript } from "@codemirror/lang-javascript";
  import { EditorView, lineNumbers, keymap } from "@codemirror/view";
  import {
    history,
    defaultKeymap,
    historyKeymap,
    indentWithTab,
  } from "@codemirror/commands";

  import { StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
  import type { DecorationSet } from "@codemirror/view";
  import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";


  // State field that tracks highlighted ranges
  const highlightEffect =
    StateEffect.define<{ start: number; end: number; color?: string }[]>();

  const highlightField = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(highlights, tr) {
      let builder = new RangeSetBuilder<Decoration>();

      if (false && !tr.docChanged) {
        let previousDecorations: {
          from: number;
          to: number;
          decoration: Decoration;
        }[] = [];

        highlights.between(0, tr.state.doc.length, (from, to, decoration) => {
          previousDecorations.push({ from, to, decoration });
        });

        // Sort previous decorations by `from` index before adding them
        previousDecorations.sort((a, b) => a.from - b.from);

        for (const { from, to, decoration } of previousDecorations) {
          builder.add(from, to, decoration);
        }
      }

      let effectsList = [];
      for (let effect of tr.effects) {
        if (effect.is(highlightEffect)) {
          effectsList.push(...effect.value);
        }
      }
      effectsList.sort((a, b) => a.start - b.start);

      for (const { start, end, color } of effectsList) {
        builder.add(
          start,
          end,
          Decoration.mark({ 
            class: `highlighted-text-${color}`, 
            startSide: -1 }),
        );
      }

      return builder.finish() as DecorationSet;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  let parser: Parser;
  let code = `function example(name) {
  console.log("Hello, " + name + "!");
}`;
  let prevCode = code;

  let rootNode: SyntaxNode;
  let parsedTree: FormatTree[] = [];
  let highlightedNodeRange = {
    start: 0,
    end: 0,
  };

  let languages = [
    { value: "javascript", label: "JavaScript" },
    { value: "tsx", label: "Typescript (TSX)" },
    { value: "python", label: "Python" },
    { value: "c", label: "C" },
    { value: "cpp", label: "C++" },
    { value: "c_sharp", label: "C#" },
    { value: "java", label: "Java" },
    { value: "sql", label: "SQL" },
    { value: "dart", label: "Dart" },
  ];

  let selectedLanguage = languages[1].value;
  let hideNoNamed = true;
  let hideErrors = false;
  let errorMessage = "";
  let currentLanguage: any;

  // NEW: query variable to hold the query text
  let query = "";
  let queryHighlightRanges: Array<{
    start: number;
    end: number;
    color: string;
  }> = [];

  // Remove or deprecate the old 'div' variable if it's only used for the old code box.
  // Instead, introduce a variable for CodeMirror's container:
  let editorContainer: HTMLDivElement;
  let editorView: EditorView;

  let queryEditorContainer: HTMLDivElement;
  let queryEditor: EditorView;

  async function loadParser() {
    // const response = await fetch('tree-sitter.wasm');
    // console.log(response)
    // const wasmBinary = await response.arrayBuffer();
    await Parser.init({
      locateFile(scriptName: string, scriptDirectory: string) {
        return scriptName;
      },
    });
    // const JavaScript = await Parser.Language.load(`tree-sitter-javascript`);
    parser = new Parser();
    // parser.setLanguage(JavaScript);
  }

  async function loadLanguage(language: string = "javascript") {
    try {
      const xLanguage = await Language.load(
        `tree-sitter-${language}.wasm`,
      );
      parser.setLanguage(xLanguage);
      currentLanguage = xLanguage;
      errorMessage = "";
      await parseCode(code);
    } catch (error: any) {
      errorMessage = "Language not supported";
      console.error(error);
      parsedTree = [];
    }
  }

  async function parseCode(code: string) {
    try {
      const tree = await parser.parse(code);
      rootNode = tree.rootNode;
      parsedTree = formatTree(rootNode, hideNoNamed, hideErrors);
    } catch (error: any) {
      parsedTree = [];
    }
  }

  // NEW: Function to handle executing the query
  let queryResults: any[] = [];
  const captureRegex = /@\s*([\w\._-]+)/g;
  let captureColors = new Map<string, string>();
  const predefinedColors = [
    "red",
    "blue",
    "green",
    "orange",
    "purple",
    "brown",
    "pink",
  ];

  let queryTimeout: NodeJS.Timeout;

  function executeQuery() {
    if (!currentLanguage || !rootNode) {
      console.error("Language or parse tree not available");
      return;
    }

    clearTimeout(queryTimeout);
    queryTimeout = setTimeout(() => {
      try {
        const treeQuery = currentLanguage.query(query);
        const matches = treeQuery.matches(rootNode);

        queryHighlightRanges = matches.flatMap((match) =>
          match.captures.map((capture) => ({
            start: getCharacterIndexFromPosition(capture.node.startPosition),
            end: getCharacterIndexFromPosition(capture.node.endPosition),
            color: captureColors.get(capture.name) || "default-highlight",
          })),
        );

        console.log(
          "Query Highlight Ranges (from executeQuery):",
          queryHighlightRanges,
        );
        applyAllHighlights(); // Apply all highlights at once
      } catch (e) {
        console.error("Query error:", e);
      }
    }, 1000);
  }

  function updateCaptureColors(query: string) {
    captureColors.clear(); // Reset previous color assignments

    const seenCaptures = new Set<string>();
    let match;
    let colorIndex = 0; // Track order of first appearance

    while ((match = captureRegex.exec(query)) !== null) {
      const captureName = match[1];

      if (!seenCaptures.has(captureName)) {
        seenCaptures.add(captureName);

        // Assign colors based on query appearance order
        captureColors.set(
          captureName,
          predefinedColors[colorIndex % predefinedColors.length],
        );
        colorIndex++;
      }
    }

    console.log("Capture Colors (from updateCaptureColors):", captureColors);

    // Update query box highlights
    updateQueryEditor();
  }

  function updateQueryEditor() {
    let effects = [];
    let seenPositions = new Set<number>();

    [...query.matchAll(captureRegex)].forEach((match) => {
      let captureName = match[1];

      // Use the same color from updateCaptureColors()
      let color = captureColors.get(captureName) || "default-highlight";

      let start = query.indexOf(match[0]);
      while (seenPositions.has(start)) {
        start = query.indexOf(match[0], start + 1);
      }
      seenPositions.add(start);

      let end = start + match[0].length;

      if (start >= 0 && start < end) {
        effects.push(highlightEffect.of([{ start, end, color }]));
      } else {
        console.warn(
          `Skipping invalid query range: start(${start}) > end(${end})`,
        );
      }
    });

    effects.sort((a, b) => a.from - b.from);

    console.log("Query Editor Highlights (from updateQueryEditor):", effects);

    queryEditor.dispatch({
      effects: effects,
    });
  }

  function applyAllHighlights() {
    let effects = [
      ...queryHighlightRanges.map(({ start, end, color }) => ({
        start,
        end,
        color,
      })), // Query highlights
    ];

    if (highlightedNodeRange.start !== highlightedNodeRange.end) {
      effects.push({
        start: highlightedNodeRange.start,
        end: highlightedNodeRange.end,
        color: "selected-node",
      }); // Clicked node highlight
    }

    effects.sort((a, b) => a.start - b.start);
    editorView.dispatch({
      effects: [highlightEffect.of(effects)],
    });
  }


  onMount(async () => {
    await loadParser();
    await loadLanguage(selectedLanguage);
    await tick(); // Ensure Svelte has assigned the container before using it

    // Create an EditorState with the current code as the document.
    const state = EditorState.create({
      doc: code,
      extensions: [
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]), // Basic keybindings
        history(), // Undo/redo support
        javascript(), // Language support
        highlightField, // Add highlight tracking
        lineNumbers(), // Enable line numbers
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            code = update.state.doc.toString();
          }
        }),
      ],
    });

    // Create and mount the CodeMirror editor.
    editorView = new EditorView({
      state,
      parent: editorContainer,
    });

    editorView.focus(); // Ensure it accepts input

    queryEditor = new EditorView({
      state: EditorState.create({
        doc: query, // Initial query text
        extensions: [
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          lineNumbers(),
          highlightField, // Enable query highlighting
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              query = update.state.doc.toString();
              updateCaptureColors(query);
              executeQuery(); // Update highlights in both editors
            }
          }),
        ],
      }),
      parent: queryEditorContainer, // Mount the query editor
    });
  });

  onDestroy(() => {
    if (editorView) {
      editorView.destroy();
    }
  });

  $: if (selectedLanguage && parser) {
    loadLanguage(selectedLanguage);
  }

  $: if (code && parser) {
    parseCode(code);
  }

  let lastClickedButton: any = null;
  let lastItem: FormatTree | null = null;
  let lastClickedItem: FormatTree | null = null;

  function handleButtonClick(event: any, item: FormatTree) {
    if (lastClickedItem === item) {
      highlightedNodeRange = { start: 0, end: 0 }; // Remove highlight
      lastClickedItem = null;
    } else {
      highlightedNodeRange = {
        start: getCharacterIndexFromPosition(item.startPosition),
        end: getCharacterIndexFromPosition(item.endPosition),
      };
      lastClickedItem = item;
    }
    console.log("Clicked Node Highlight Range:", highlightedNodeRange);
    applyAllHighlights(); // Apply updates
  }

  function getCharacterIndexFromPosition(position: Point) {
    const { row, column } = position;
    const lines = code.split("\n");
    let charIndex = 0;

    for (let i = 0; i < row; i++) {
      charIndex += lines[i].length + 1; // +1 for the newline character
    }

    charIndex += column;
    return charIndex;
  }

  function handleContentChange() {
    highlightedNodeRange.start = 0;
    highlightedNodeRange.end = 0;
    if (lastClickedButton) {
      lastClickedButton.style.color = "";
      lastClickedButton.style.backgroundColor = "";
      lastClickedButton.style.fontWeight = "";
    }
    lastItem = null;
    lastClickedButton = null;
    // }

    // Add your logic here to run when content changes
  }

  function selectLanguage(value: string) {
    if (value !== selectedLanguage) {
      loadParser();
      selectedLanguage = value;
      handleContentChange();
    }
  }

  function handleCheckBoxChange() {
    if (code && parser) {
      parseCode(code);
    }
  }
</script>

<!--
<style>
  .editor-container {
      height: 300px;
      border: 1px solid #ccc;
      display: flex;
      align-items: flex-start;  /* Ensures alignment to the top */
      justify-content: flex-start; /* Aligns text to the left */
    }

    .container {
      display: flex;
      justify-content: space-between; /* Instead of center */
      align-items: flex-start;
    }  
</style>
-->

<main>
  <div class="language-selector">
    <label for="language-dropdown">Language:</label>
    <select
      id="language-dropdown"
      bind:value={selectedLanguage}
      on:change={(e) => selectLanguage(e.target.value)}
    >
      {#each languages as language}
        <option value={language.value}>{language.label}</option>
      {/each}
    </select>
  </div>
  <div class="container">
    <div class="column">
      <div class="header-container">
        <h2>Input Code</h2>
      </div>
      <!-- New CodeMirror container -->
      <div class="editor-container" bind:this={editorContainer}></div>
    </div>

    <div class="column">
      <div class="header-container">
        <h2>Parsed Syntax Tree</h2>
        <label class="checkbox-label">
          <input
            type="checkbox"
            bind:checked={hideNoNamed}
            on:change={handleCheckBoxChange}
          />
          Hide unnamed nodes
        </label>
        <label class="checkbox-label">
          <input
            type="checkbox"
            style="accent-color: red;"
            bind:checked={hideErrors}
            on:change={handleCheckBoxChange}
          />
          Hide errors
        </label>
      </div>
      {#if errorMessage}
        <p style="color: red;">{errorMessage}</p>
      {:else}
        <pre>
          {#each parsedTree as item}
            <div
              style="font-size: 14px; font-family: monospace;">{item.prefix}<button
                class="hover no-border"
                on:click={(event) => handleButtonClick(event, item)}
                >{#if item.name === "ERROR"}<span class="error"
                    >{item.name}</span
                  >{:else}{item.name}{/if}</button
              >{item.suffix}</div>
          {/each}
        </pre>
      {/if}
    </div>
  </div>
  <div class="container">
    <div class="column">
      <!-- Query Box Section -->
      <div class="query-box" style="margin-top: 20px;">
        <h2>Query</h2>
        <div class="editor-container" bind:this={queryEditorContainer}></div>
      </div>
    </div>
  </div>
</main>
