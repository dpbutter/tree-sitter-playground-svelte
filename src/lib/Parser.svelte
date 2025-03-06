<script lang="ts">
import { onMount, tick, onDestroy } from "svelte";
import { Parser, Language } from 'web-tree-sitter';
import { Node as SyntaxNode} from "web-tree-sitter";
import type { Point } from "web-tree-sitter";
import { escapeHtml, formatTree, type FormatTree } from "./utils";
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

// Create separate highlight effects for code and query editors
const codeHighlightEffect = StateEffect.define<{ start: number; end: number; color?: string }[]>();
const queryHighlightEffect = StateEffect.define<{ start: number; end: number; color?: string }[]>();

let currentQueryState = {
  valid: false,
  ranges: []
};

// Create separate highlight state fields for code and query editors
const createHighlightField = (highlightEffect) => StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(highlights, tr) {
    let builder = new RangeSetBuilder<Decoration>();

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

// Create separate highlight fields for code and query
const codeHighlightField = createHighlightField(codeHighlightEffect);
const queryHighlightField = createHighlightField(queryHighlightEffect);

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

// Query variable to hold the query text
let query = "";
let queryHighlightRanges: Array<{
  start: number;
  end: number;
  color: string;
}> = [];

let editorContainer: HTMLDivElement;
let editorView: EditorView;

let queryEditorContainer: HTMLDivElement;
let queryEditor: EditorView;

async function loadParser() {
  await Parser.init({
    locateFile(scriptName: string, scriptDirectory: string) {
      return scriptName;
    },
  });
  parser = new Parser();
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

// Function to handle executing the query
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

      // Store the current query state
      currentQueryState = {
        valid: true,
        ranges: [...queryHighlightRanges]
      };

      console.log(
        "Query Highlight Ranges (from executeQuery):",
        queryHighlightRanges,
      );
      
      // Apply query highlights to the code editor
      applyCodeHighlights();
      
    } catch (e) {
      console.error("Query error:", e);
      currentQueryState.valid = false;
    }
  }, 100);
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
  updateQueryHighlights();
}

function updateQueryHighlights() {
  // Build highlight effects for query editor
  let effects = [];
  let seenPositions = new Set<number>();

  [...query.matchAll(captureRegex)].forEach((match) => {
    let captureName = match[1];
    let color = captureColors.get(captureName) || "default-highlight";

    let start = query.indexOf(match[0]);
    while (seenPositions.has(start)) {
      start = query.indexOf(match[0], start + 1);
    }
    seenPositions.add(start);

    let end = start + match[0].length;

    if (start >= 0 && start < end) {
      effects.push({ start, end, color });
    } else {
      console.warn(`Skipping invalid query range: start(${start}) > end(${end})`);
    }
  });

  effects.sort((a, b) => a.start - b.start);
  console.log("Query Editor Highlights (from updateQueryHighlights):", effects);

  // Apply highlights to query editor
  queryEditor.dispatch({
    effects: [queryHighlightEffect.of(effects)],
  });
}

function applyCodeHighlights() {
  // Use the stored query state
  let effects = [];
  
  // Add query highlights if we have a valid query
  if (currentQueryState.valid) {
    effects.push(...currentQueryState.ranges.map(({ start, end, color }) => ({
      start,
      end,
      color,
    })));
  }

  // Add node selection highlight if present
  if (highlightedNodeRange.start !== highlightedNodeRange.end) {
    effects.push({
      start: highlightedNodeRange.start,
      end: highlightedNodeRange.end,
      color: "selected-node",
    });
  }

  effects.sort((a, b) => a.start - b.start);
  
  // Apply highlights to code editor
  editorView.dispatch({
    effects: [codeHighlightEffect.of(effects)],
  });
}


onMount(async () => {
  await loadParser();
  await loadLanguage(selectedLanguage);
  await tick(); // Ensure Svelte has assigned the container before using it

  // Create the code editor with its own highlight field
  const codeState = EditorState.create({
    doc: code,
    extensions: [
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      history(),
      javascript(),
      codeHighlightField, // Use code-specific highlight field
      lineNumbers(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          code = update.state.doc.toString();
        }
      }),
      EditorView.focusChangeEffect.of(hasFocus => {
          // When focus changes, re-apply the highlights if we have a valid query
          if (currentQueryState.valid) {
            setTimeout(() => applyCodeHighlights(), 0);
          }
          return null;
        }),
    ],
  });

  editorView = new EditorView({
    state: codeState,
    parent: editorContainer,
  });

  editorView.focus();

  // Create the query editor with its own highlight field
  queryEditor = new EditorView({
    state: EditorState.create({
      doc: query,
      extensions: [
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        lineNumbers(),
        queryHighlightField, // Use query-specific highlight field
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            query = update.state.doc.toString();
            updateCaptureColors(query);
            executeQuery();
          }
        }),
        EditorView.focusChangeEffect.of(hasFocus => {
          // When focus changes, re-apply the highlights
          setTimeout(() => updateQueryHighlights(), 0);
          return null;
        }),
      ],
    }),
    parent: queryEditorContainer,
  });
});

onDestroy(() => {
  if (editorView) {
    editorView.destroy();
  }
  if (queryEditor) {
    queryEditor.destroy();
  }
});

$: if (selectedLanguage && parser) {
  loadLanguage(selectedLanguage);
}

$: if (code && parser) {
  parseCode(code);
  // Re-apply query highlights when code changes
  if (query) {
    executeQuery();
  }
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
  applyCodeHighlights(); // Apply only to code editor
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
