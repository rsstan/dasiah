// ESLint rule for the layers of the web client (apps/web/src):
//
//   app  ->  pages  ->  features  ->  shared  ->  models
//
// 1. A module imports only from its own layer or a lower one (shared never reaches into a feature,
//    a feature never into a page or the app).
// 2. Pages do not import each other (a test may import the page it tests).
// 3. A feature is used from outside only through its public entry, features/<name>/index.ts;
//    inside a feature any file may import any other.
//
// The import path is resolved against the importing file, so "../places/api.ts" is checked by
// where it really points, which a pattern on the import string cannot do.
import path from 'node:path';

const RANK = { models: 0, styles: 0, shared: 1, features: 2, pages: 3, app: 4 };
const SRC = `${path.sep}apps${path.sep}web${path.sep}src${path.sep}`;

/** Position of a file inside src: its layer and, for pages and features, its slice. */
function locate(file) {
  const at = file.indexOf(SRC);
  if (at < 0) {
    return undefined;
  }
  const parts = file.slice(at + SRC.length).split(path.sep);
  // Files directly in src (main.tsx) compose the application.
  const layer = parts.length === 1 ? 'app' : parts[0];
  if (!(layer in RANK)) {
    return undefined;
  }
  let slice;
  if (layer === 'features') {
    slice = parts[1];
  } else if (layer === 'pages') {
    slice = parts[1].split('.')[0];
  }
  return { layer, slice, rest: parts.slice(layer === 'features' ? 2 : 1).join('/') };
}

export const boundaries = {
  meta: {
    type: 'problem',
    docs: { description: 'Layers and public entries of the web client' },
    schema: [],
    messages: {
      upward: '{{from}} must not import from {{to}} (layers: app -> pages -> features -> shared -> models).',
      page: 'Pages do not import other pages; move the shared part into a feature or shared.',
      entry: "Import the {{feature}} feature through its public entry 'features/{{feature}}/index.ts'.",
    },
  },
  create(context) {
    const from = locate(context.filename);
    if (from === undefined) {
      return {};
    }
    function check(node, source) {
      if (typeof source !== 'string' || !source.startsWith('.')) {
        return;
      }
      const to = locate(path.resolve(path.dirname(context.filename), source));
      if (to === undefined) {
        return;
      }
      if (RANK[to.layer] > RANK[from.layer]) {
        context.report({ node, messageId: 'upward', data: { from: from.layer, to: to.layer } });
        return;
      }
      if (from.layer === 'pages' && to.layer === 'pages' && from.slice !== to.slice) {
        context.report({ node, messageId: 'page' });
        return;
      }
      if (
        to.layer === 'features' &&
        !(from.layer === 'features' && from.slice === to.slice) &&
        to.rest !== 'index.ts'
      ) {
        context.report({ node, messageId: 'entry', data: { feature: to.slice } });
      }
    }
    return {
      ImportDeclaration: (node) => check(node.source, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node.source, node.source.value),
      ExportAllDeclaration: (node) => check(node.source, node.source.value),
      ImportExpression: (node) => node.source.type === 'Literal' && check(node.source, node.source.value),
    };
  },
};
