import type { Node as SyntaxNode, Point } from 'web-tree-sitter';

export type FormatTree = {id: number, startPosition: Point, endPosition: Point, prefix: string, name: string, suffix: string}

export function formatTree(node: SyntaxNode, hideNoNamed: boolean = true, hideErrors: boolean = true, indent: string = '', childId = 0): Array<FormatTree> {

    let result = [{
      id: node.id,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      prefix: node.parent?.fieldNameForChild(childId) ? indent + node.parent.fieldNameForChild(childId) + ': ' : indent,
      name: node.type,
      suffix: ` [${node.startPosition.row}, ${node.startPosition.column}] - [${node.endPosition.row}, ${node.endPosition.column}]`
    }];
  
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        if (hideNoNamed && !child.isNamed) {
          continue;
        }

        if (hideErrors && child.type == 'ERROR') {
          continue
        }
        result = result.concat(formatTree(child, hideNoNamed, hideErrors, indent + '  ', i));
      }
    }
  
    return result;
  }
  

export function escapeHtml(unsafe: string) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

