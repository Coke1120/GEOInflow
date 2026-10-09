import NextLink from 'next/link';
import type { ComponentProps } from 'react';

/** Statistics load when the destination page is entered. */
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink {...props} prefetch={false} />;
}
