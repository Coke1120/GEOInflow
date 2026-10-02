import { dirname, resolve } from 'node:path';
import ts from 'typescript';

// Resolve the same source aliases and relative imports used by the product build.
export function assertProductImports(file, source) {
  if (/\.test\.tsx?$/.test(file)) return;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const projectSource = resolve('src');
  const own =
    /^(components\/liekan\/|lib\/liekan\/|styles\/liekan\/|app\/\(main\)\/websites\/\[websiteId\]\/geo\/)/;
  const check = specifier => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return;
    const name = specifier.text;
    const target = name.startsWith('@/')
      ? resolve('src', name.slice(2))
      : name.startsWith('.') || name.startsWith('/')
        ? resolve(dirname(file), name)
        : null;
    if (target?.startsWith(`${resolve('generated')}/`))
      throw new Error(`Upstream import crossed product boundary: ${file} -> ${name}`);
    if (!target?.startsWith(`${projectSource}/`)) return;
    if (!own.test(target.slice(projectSource.length + 1)))
      throw new Error(`Upstream import crossed product boundary: ${file} -> ${name}`);
  };
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) check(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
      check(node.moduleReference.expression);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      check(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(tree);
}
