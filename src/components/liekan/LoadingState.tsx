'use client';
import { createContext, useContext } from 'react';

export const DataLoadingContext = createContext(false);
export const useDataLoading = () => useContext(DataLoadingContext);
export function hidesPreviousData(error: any) {
  return [401, 403, 404].includes(Number(error?.status));
}
