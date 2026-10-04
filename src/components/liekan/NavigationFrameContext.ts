'use client';
import { createContext } from 'react';
import type { ComponentProps } from 'react';
import type { NavigationView } from './Navigation';
export type NavigationProps = ComponentProps<typeof NavigationView>;
export const NavigationRegistrationContext =
  createContext<(path: string, props: NavigationProps) => () => void>(null);
export const SidebarWidthContext = createContext<readonly [number, (width: number) => void]>(null);
