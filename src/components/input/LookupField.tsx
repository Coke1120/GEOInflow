import { type ComboBoxProps, ListItem, Loading, useDebounce } from '@umami/react-zen';
import { endOfDay, subMonths } from 'date-fns';
import { type SetStateAction, useEffect, useMemo, useState } from 'react';
import { ComboBox } from '@/components/common/ComboBox';
import { Empty } from '@/components/common/Empty';
import { useMessages, useWebsiteValuesQuery } from '@/components/hooks';

export interface LookupFieldProps extends Omit<ComboBoxProps, 'onChange'> {
  websiteId: string;
  type: string;
  value: string;
  allowCustomValue?: boolean;
  onChange: (value: string) => void;
  onValueChange?: (value: string) => void;
}

export function LookupField({
  websiteId,
  type,
  value,
  allowCustomValue,
  onChange,
  onValueChange,
  ...props
}: LookupFieldProps) {
  const { t, messages } = useMessages();
  const [search, setSearch] = useState(value);
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const searchValue = useDebounce(search, 300);
  const startDate = subMonths(endOfDay(new Date()), 6);
  const endDate = endOfDay(new Date());

  useEffect(() => {
    if (editingValue !== null && editingValue !== value) setEditingValue(null);
  }, [editingValue, value]);

  const { data, isLoading } = useWebsiteValuesQuery({
    websiteId,
    type,
    search: searchValue,
    startDate,
    endDate,
  });

  const items: string[] = useMemo(() => {
    return data?.map(({ value }) => value) || [];
  }, [data]);

  const options = useMemo(() => {
    if (allowCustomValue && value && !items.includes(value)) {
      return [value, ...items];
    }

    return items;
  }, [allowCustomValue, items, value]);

  const handleSearch = (value: SetStateAction<string>) => {
    setSearch(value);
  };

  return (
    <ComboBox
      aria-label="LookupField"
      {...props}
      items={
        type === 'city'
          ? options.map(value => ({
              value,
              label: data?.find(row => row.value === value)?.label || value,
            }))
          : options
      }
      filter={type === 'city' ? null : props.filter}
      inputValue={
        type === 'city' && editingValue !== value
          ? data?.find(row => row.value === value)?.label || value
          : value
      }
      onValueChange={(next, details) => {
        if (type !== 'city' || !['item-press', 'clear-press'].includes(details.reason)) return;
        setEditingValue(null);
        handleSearch(next || '');
        onChange?.(next || '');
        onValueChange?.(next || '');
      }}
      onInputValueChange={(value, details) => {
        if (type === 'city' && !['input-change', 'input-clear'].includes(details.reason)) return;
        if (type === 'city') setEditingValue(value);
        handleSearch(value);
        onChange?.(value);
        onValueChange?.(value);
      }}
      renderEmptyState={() =>
        isLoading ? (
          <Loading placement="center" icon="dots" />
        ) : (
          <Empty message={t(messages.noResultsFound)} />
        )
      }
    >
      {options.map(item => (
        <ListItem key={item} id={item}>
          {data?.find(row => row.value === item)?.label || item}
        </ListItem>
      ))}
    </ComboBox>
  );
}
