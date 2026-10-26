import { Button, Row } from '@umami/react-zen';
import { useState } from 'react';
import { useMessages } from '@/components/hooks';
import { DateFilter } from '@/components/input/DateFilter';
import { DATE_RANGE_CONFIG, DEFAULT_DATE_RANGE_VALUE } from '@/lib/constants';
import { getItem, setItem } from '@/lib/storage';
import {
  saveAccountPreferences,
  useAccountPreferences,
} from '@/lib/liekan/upstream/account-preferences-client';

export function DateRangeSetting() {
  const { t, labels } = useMessages();
  const [date, setDate] = useState(getItem(DATE_RANGE_CONFIG) || DEFAULT_DATE_RANGE_VALUE);
  const preferences = useAccountPreferences();
  const [error, setError] = useState('');

  const handleChange = async (value: string) => {
    try {
      if (preferences?.countryCode)
        await saveAccountPreferences({
          countryCode: preferences.countryCode,
          timezone: preferences.timezone,
          range: value,
        });
      else setItem(DATE_RANGE_CONFIG, value);
      setDate(value);
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleReset = () => {
    void handleChange(DEFAULT_DATE_RANGE_VALUE);
  };

  return (
    <Row gap="3">
      <DateFilter
        value={date}
        onChange={handleChange}
        buttonProps={{ style: { minWidth: '250px' } }}
      />
      <Button onPress={handleReset}>{t(labels.reset)}</Button>
      {error && <span role="alert">{error}</span>}
    </Row>
  );
}
