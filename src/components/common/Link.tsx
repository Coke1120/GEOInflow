import NextLink from 'next/link';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';

export type LinkProps = ComponentPropsWithoutRef<typeof NextLink>;

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ prefetch, ...props }, ref) {
  return <NextLink ref={ref} prefetch={prefetch ?? false} {...props} />;
});

export default Link;
