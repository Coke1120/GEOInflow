/** Split PostgreSQL statements while retaining quoted function bodies and comments. */
export function sqlStatements(sql) {
  const result = [];
  let start = 0,
    quote = '',
    dollar = '',
    line = false,
    block = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i],
      n = sql[i + 1];
    if (line) {
      if (c === '\n') line = false;
      continue;
    }
    if (block) {
      if (c === '/' && n === '*') {
        block++;
        i++;
      } else if (c === '*' && n === '/') {
        block--;
        i++;
      }
      continue;
    }
    if (dollar) {
      if (sql.startsWith(dollar, i)) {
        i += dollar.length - 1;
        dollar = '';
      }
      continue;
    }
    if (quote) {
      if (c === quote) {
        if (n === quote) i++;
        else quote = '';
      }
      continue;
    }
    if (c === '-' && n === '-') {
      line = true;
      i++;
      continue;
    }
    if (c === '/' && n === '*') {
      block = 1;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === '$') {
      const match = /^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(sql.slice(i));
      if (match) {
        dollar = match[0];
        i += dollar.length - 1;
        continue;
      }
    }
    if (c === ';') {
      const statement = sql.slice(start, i).trim();
      if (statement) result.push(statement);
      start = i + 1;
    }
  }
  if (quote || dollar || block)
    throw new Error('Unterminated PostgreSQL migration literal or comment');
  const last = sql.slice(start).trim();
  if (last) result.push(last);
  return result;
}
