import { Fragment } from 'react';
import { pageUrl } from '@/lib/liekan/contracts/page-url';
import styles from '@/styles/liekan/Shell.module.css';

// Return native elements so table search and sorting can read the visible address.
export function pageLink(
  value: unknown,
  domain?: string,
  missing = '未提供',
  options?: { query?: string; hostname?: string },
) {
  const href = pageUrl(value, domain, options);
  if (!href) return value == null || value === '' ? missing : String(value);
  return (
    <a
      className={styles.pageLink}
      data-search-value={String(value)}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`${href}（新窗口打开）`}
    >
      {href}
    </a>
  );
}

export function pageSequence(paths: string[], domain?: string) {
  return (
    <span className={styles.pageSequence} data-search-value={paths.join(' → ')}>
      {paths.map((path, i) => (
        <Fragment key={`${i}:${path}`}>
          {i > 0 && <span className={styles.pageArrow}> → </span>}
          {pageLink(path, domain)}
        </Fragment>
      ))}
    </span>
  );
}
