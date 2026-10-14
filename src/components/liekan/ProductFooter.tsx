import { GeographyAttribution } from './GeographyAttribution';
import Link from '@/components/liekan/Link';
import { liekanFooterLinks, liekanProduct } from '@/lib/liekan/contracts/product';
import styles from '@/styles/liekan/ProductFooter.module.css';

export function ProductFooter() {
  return (
    <footer className={styles.footer} data-liekan-product-footer aria-label="猎看统计项目信息">
      <div className={styles.inner}>
        <div className={styles.identity}>
          <Link className={styles.version} prefetch={false} href={liekanProduct.links.changelog}>
            {liekanProduct.name} v{liekanProduct.version}
          </Link>
          <span>{liekanProduct.copyright}</span>
          <a href={liekanProduct.links.license} target="_blank" rel="noopener noreferrer">
            {liekanProduct.license}
          </a>
        </div>
        <nav className={styles.links} aria-label="项目相关链接">
          <GeographyAttribution />
          {liekanFooterLinks
            .filter(link => link.label !== 'IP Geolocation by DB-IP')
            .map(({ label, href }) =>
              href.startsWith('https://') ? (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer">
                  {label}
                </a>
              ) : (
                <Link key={label} prefetch={false} href={href}>
                  {label}
                </Link>
              ),
            )}
        </nav>
      </div>
    </footer>
  );
}
